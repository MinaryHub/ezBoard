#!/usr/bin/env tsx
// ezBoard MCP (Model Context Protocol) Server — stdio JSON-RPC 2.0
// Claude Code, Claude Desktop, Cursor 등 MCP 클라이언트에서 ezBoard PCB 엔진을 직접 호출할 수 있다.
// 주의: stdout은 JSON-RPC 프로토콜 전용이므로 로그/오류는 반드시 stderr로만 출력한다.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import type { Net, Part, Project } from '../src/types';
import type { AiCircuit } from '../src/lib/ai';
import { buildFromCircuit } from '../src/lib/build';
import { runDrc } from '../src/lib/drc';
import { EXAMPLES } from '../src/lib/examples';
import { autoPlace } from '../src/lib/geometry';
import { bomItems, buildBom, buildGerbers } from '../src/lib/gerber';
import { exportKicadPcb } from '../src/lib/kicad';
import { LIBRARY, LIBRARY_LIST, librarySummary } from '../src/lib/library';
import { renderPcbSvg, renderSchematicSvg, renderTrueScaleSvg } from '../src/lib/renderSvg';
import { autoRoute } from '../src/lib/router';

interface JsonRpcRequest {
  jsonrpc: '2.0';
  id?: string | number | null;
  method: string;
  params?: Record<string, unknown>;
}

interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: string | number | null;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

const PKG_VERSION = (() => {
  try {
    const dir = dirname(fileURLToPath(import.meta.url));
    const pkg = JSON.parse(readFileSync(join(dir, '..', 'package.json'), 'utf8')) as { version?: string };
    return pkg.version || '1.0.0';
  } catch {
    return '1.0.0';
  }
})();

const SERVER_INFO = { name: 'ezboard-mcp', version: PKG_VERSION };
const DEFAULT_PROTOCOL = '2024-11-05';

function normalizeProject(raw: unknown): Project {
  if (!raw || typeof raw !== 'object') throw new Error('Invalid project object');
  const r = raw as Record<string, unknown>;
  if (!Array.isArray(r.parts)) throw new Error('Project is missing "parts" array');
  const bw = Number((r.board as { width?: unknown } | undefined)?.width);
  const bh = Number((r.board as { height?: unknown } | undefined)?.height);
  const board = {
    width: Number.isFinite(bw) ? Math.min(200, Math.max(10, bw)) : 50,
    height: Number.isFinite(bh) ? Math.min(200, Math.max(10, bh)) : 40,
  };
  const parts: Part[] = r.parts
    .filter((p): p is Record<string, unknown> => !!p && typeof p === 'object' && typeof (p as Record<string, unknown>).ref === 'string' && typeof (p as Record<string, unknown>).type === 'string')
    .map((p) => ({
      ref: String(p.ref),
      type: String(p.type),
      value: typeof p.value === 'string' ? p.value : (LIBRARY[String(p.type)]?.defaultValue ?? ''),
      x: Number.isFinite(Number(p.x)) ? Number(p.x) : 0,
      y: Number.isFinite(Number(p.y)) ? Number(p.y) : 0,
      rot: Number.isFinite(Number(p.rot)) ? (((Math.round(Number(p.rot) / 90) * 90) % 360) + 360) % 360 : 0,
      note: typeof p.note === 'string' ? p.note : undefined,
    }));
  const nets: Net[] = Array.isArray(r.nets)
    ? r.nets
      .filter((n): n is { name: string; pins: unknown[]; width?: unknown } => !!n && typeof n === 'object' && typeof (n as { name?: unknown }).name === 'string' && Array.isArray((n as { pins?: unknown }).pins))
      .map((n) => {
        const w = Number(n.width);
        const out: Net = { name: n.name, pins: n.pins.map(String) };
        if (Number.isFinite(w) && w >= 0.25 && w <= 3.0) out.width = Math.round(w * 100) / 100;
        return out;
      })
    : [];
  const tracks = Array.isArray(r.tracks) ? (r.tracks as Project['tracks']) : [];
  const vias = Array.isArray(r.vias) ? (r.vias as Project['vias']) : [];
  const sch = r.sch && typeof r.sch === 'object' && !Array.isArray(r.sch) ? (r.sch as Project['sch']) : undefined;
  return {
    name: typeof r.name === 'string' && r.name.trim() ? r.name.trim() : 'ezBoard Project',
    board,
    parts,
    nets,
    tracks,
    vias,
    sch,
    pour: typeof r.pour === 'boolean' ? r.pour : true,
    holes: typeof r.holes === 'boolean' ? r.holes : false,
  };
}

function loadProjectArg(args: Record<string, unknown>): Project {
  if (args.project && typeof args.project === 'object') {
    return normalizeProject(args.project);
  }
  if (typeof args.projectPath === 'string' && args.projectPath.trim()) {
    const abs = resolve(args.projectPath);
    const raw = JSON.parse(readFileSync(abs, 'utf8'));
    return normalizeProject(raw);
  }
  throw new Error('Provide either "project" (JSON object) or "projectPath" (path to .ezboard.json)');
}

function writeTextFile(filePath: string, content: string): string {
  const abs = resolve(filePath);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, content, 'utf8');
  return abs;
}

const TOOLS = [
  {
    name: 'ezboard_list_parts',
    description: 'Search and list available through-hole (THT) components in the ezBoard library (52 parts) with pin names, footprints, default values, and antenna keepout info.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Optional search substring matching type, name, description, or footprint (e.g. "esp32", "jst", "relay", "led")' },
        category: { type: 'string', description: 'Optional category filter' },
      },
    },
  },
  {
    name: 'ezboard_build_circuit',
    description: 'Build a complete ezBoard PCB project from a circuit spec (parts + nets). Automatically places parts, auto-routes 2-layer tracks/vias (respecting custom net widths and ESP32 antenna keepouts), runs DRC/ERC, and optionally saves .ezboard.json.',
    inputSchema: {
      type: 'object',
      required: ['parts', 'nets'],
      properties: {
        name: { type: 'string', description: 'Project title (printed on silkscreen)' },
        board: {
          type: 'object',
          properties: {
            width: { type: 'number', description: 'Board width in mm (10..200)' },
            height: { type: 'number', description: 'Board height in mm (10..200)' },
          },
        },
        parts: {
          type: 'array',
          description: 'List of parts using types from ezboard_list_parts',
          items: {
            type: 'object',
            required: ['ref', 'type'],
            properties: {
              ref: { type: 'string' },
              type: { type: 'string' },
              value: { type: 'string' },
              note: { type: 'string' },
            },
          },
        },
        nets: {
          type: 'array',
          description: 'List of electrical nets with "REF.PIN" strings and optional custom trace width (mm)',
          items: {
            type: 'object',
            required: ['name', 'pins'],
            properties: {
              name: { type: 'string' },
              pins: { type: 'array', items: { type: 'string' } },
              width: { type: 'number', description: 'Optional custom trace width in mm (0.25..3.0)' },
            },
          },
        },
        pour: { type: 'boolean', description: 'Enable GND copper pour (default true)' },
        holes: { type: 'boolean', description: 'Add M3 corner mounting holes (default false)' },
        outputPath: { type: 'string', description: 'Optional file path to save the resulting .ezboard.json project' },
      },
    },
  },
  {
    name: 'ezboard_run_drc',
    description: 'Run full Design Rule Check (DRC) & Electrical Rule Check (ERC) on an ezBoard project — checks overlaps, board bounds, clearance, unrouted nets, shorts, LED series resistors, capacitor polarity, 3.3V/5V voltage mix, I2C pull-ups, decoupling caps, and antenna keepouts.',
    inputSchema: {
      type: 'object',
      properties: {
        project: { type: 'object', description: 'ezBoard Project JSON object' },
        projectPath: { type: 'string', description: 'Path to an .ezboard.json file' },
      },
    },
  },
  {
    name: 'ezboard_reroute',
    description: 'Re-place (optional) and re-route a PCB project, optionally updating board size, GND pour, or M3 mounting holes.',
    inputSchema: {
      type: 'object',
      properties: {
        project: { type: 'object', description: 'ezBoard Project JSON object' },
        projectPath: { type: 'string', description: 'Path to an .ezboard.json file' },
        autoPlace: { type: 'boolean', description: 'Re-run auto placement before routing (default false)' },
        board: {
          type: 'object',
          properties: {
            width: { type: 'number' },
            height: { type: 'number' },
          },
        },
        pour: { type: 'boolean' },
        holes: { type: 'boolean' },
        outputPath: { type: 'string', description: 'Optional path to save updated .ezboard.json' },
      },
    },
  },
  {
    name: 'ezboard_export_gerber',
    description: 'Generate JLCPCB / PCBWay manufacturing files (RS-274X Gerbers, Excellon PTH/NPTH drill files, and BOM.csv) from an ezBoard project. Optionally writes files + gerber.zip to outputDir.',
    inputSchema: {
      type: 'object',
      properties: {
        project: { type: 'object', description: 'ezBoard Project JSON object' },
        projectPath: { type: 'string', description: 'Path to an .ezboard.json file' },
        outputDir: { type: 'string', description: 'Optional directory path to write Gerber files, BOM.csv, and gerber.zip' },
        includeContent: { type: 'boolean', description: 'Include full Gerber file text inline in JSON response (default: true if outputDir is omitted, false otherwise)' },
      },
    },
  },
  {
    name: 'ezboard_export_kicad',
    description: 'Export an ezBoard project to a KiCad 8 (.kicad_pcb) S-expression board file with footprints, pads, tracks, vias, mounting holes, antenna keepouts, and GND pour zones.',
    inputSchema: {
      type: 'object',
      properties: {
        project: { type: 'object', description: 'ezBoard Project JSON object' },
        projectPath: { type: 'string', description: 'Path to an .ezboard.json file' },
        outputPath: { type: 'string', description: 'Optional path to save .kicad_pcb file' },
      },
    },
  },
  {
    name: 'ezboard_render_svg',
    description: 'Render standalone SVG artwork of the PCB (edit view, realistic front/back, or 1:1 true-scale print verification with calibration ruler) or the schematic.',
    inputSchema: {
      type: 'object',
      properties: {
        project: { type: 'object', description: 'ezBoard Project JSON object' },
        projectPath: { type: 'string', description: 'Path to an .ezboard.json file' },
        kind: {
          type: 'string',
          enum: ['pcb_edit', 'pcb_real', 'pcb_real_back', 'schematic', 'true_scale'],
          description: 'Render mode (default: pcb_edit)',
        },
        outputPath: { type: 'string', description: 'Optional path to save the .svg file' },
      },
    },
  },
];

const RESOURCES = [
  {
    uri: 'ezboard://library/summary',
    name: 'ezBoard THT Component Library Summary',
    description: 'Complete list of supported through-hole parts and exact pin names for circuit JSON generation',
    mimeType: 'text/plain',
  },
  {
    uri: 'ezboard://examples',
    name: 'ezBoard Example Circuits',
    description: 'Verified starter circuit definitions (LED, timer, Arduino, sensor boards)',
    mimeType: 'application/json',
  },
];

async function callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
  switch (name) {
    case 'ezboard_list_parts': {
      const q = typeof args.query === 'string' ? args.query.trim().toLowerCase() : '';
      const cat = typeof args.category === 'string' ? args.category.trim().toLowerCase() : '';
      const items = LIBRARY_LIST.filter((d) => {
        if (cat && d.category.toLowerCase() !== cat) return false;
        if (!q) return true;
        const hay = `${d.type} ${d.name} ${d.category} ${d.defaultValue} ${d.desc} ${d.footprint.name}`.toLowerCase();
        return hay.includes(q);
      }).map((d) => ({
        type: d.type,
        name: d.name,
        category: d.category,
        prefix: d.prefix,
        defaultValue: d.defaultValue,
        footprint: d.footprint.name,
        sizeMm: { w: d.footprint.w, h: d.footprint.h },
        pins: [...new Set(d.footprint.pads.map((p) => p.pin))],
        hasKeepout: Boolean(d.footprint.keepout?.length),
      }));
      return { count: items.length, totalLibrarySize: LIBRARY_LIST.length, parts: items };
    }

    case 'ezboard_build_circuit': {
      if (!Array.isArray(args.parts) || !Array.isArray(args.nets)) {
        throw new Error('"parts" and "nets" arrays are required');
      }
      const unknown: string[] = [];
      const parts = (args.parts as Record<string, unknown>[]).map((p) => {
        const ref = String(p.ref ?? '').trim();
        const type = String(p.type ?? '').trim();
        if (!ref || !type) throw new Error('Each part must have "ref" and "type"');
        if (!LIBRARY[type]) unknown.push(`${ref}:${type}`);
        return {
          ref,
          type,
          value: typeof p.value === 'string' ? p.value : undefined,
          note: typeof p.note === 'string' ? p.note : undefined,
        };
      });
      if (unknown.length) {
        throw new Error(`Unknown part type(s): ${unknown.join(', ')}. Call ezboard_list_parts first.`);
      }
      const nets: Net[] = (args.nets as Record<string, unknown>[]).map((n) => {
        const netName = String(n.name ?? '').trim();
        const pins = Array.isArray(n.pins) ? n.pins.map((x) => String(x).trim()).filter(Boolean) : [];
        if (!netName || !pins.length) throw new Error('Each net must have non-empty "name" and "pins"');
        const out: Net = { name: netName, pins };
        const w = Number(n.width);
        if (Number.isFinite(w) && w >= 0.25 && w <= 3.0) out.width = Math.round(w * 100) / 100;
        return out;
      });
      const bArg = args.board as { width?: unknown; height?: unknown } | undefined;
      const bw = Number(bArg?.width), bh = Number(bArg?.height);
      const board = Number.isFinite(bw) && Number.isFinite(bh) && bw > 0 && bh > 0 ? { width: bw, height: bh } : undefined;
      const circuit: AiCircuit = {
        name: typeof args.name === 'string' && args.name.trim() ? args.name.trim() : 'ezBoard Circuit',
        board,
        parts,
        nets,
      };
      const base: Project = {
        name: circuit.name!,
        board: board ?? { width: 50, height: 40 },
        parts: [],
        nets: [],
        tracks: [],
        vias: [],
        pour: typeof args.pour === 'boolean' ? args.pour : true,
        holes: typeof args.holes === 'boolean' ? args.holes : false,
      };
      const { project, route, grown } = buildFromCircuit(base, circuit);
      const issues = runDrc(project);
      const bom = bomItems(project);
      let savedPath: string | undefined;
      if (typeof args.outputPath === 'string' && args.outputPath.trim()) {
        savedPath = writeTextFile(args.outputPath, JSON.stringify(project, null, 2));
      }
      return {
        savedPath,
        grown,
        board: project.board,
        route: {
          routed: route.routed,
          failedCount: route.failed.length,
          failed: route.failed,
          tracks: route.tracks.length,
          vias: route.vias.length,
        },
        drc: {
          ok: !issues.some((i) => i.level === 'error'),
          errors: issues.filter((i) => i.level === 'error').length,
          warnings: issues.filter((i) => i.level === 'warning').length,
          issues,
        },
        bom,
        project,
      };
    }

    case 'ezboard_run_drc': {
      const project = loadProjectArg(args);
      const issues = runDrc(project);
      const errors = issues.filter((i) => i.level === 'error');
      const warnings = issues.filter((i) => i.level === 'warning');
      const infos = issues.filter((i) => i.level === 'info');
      return {
        ok: errors.length === 0,
        errorCount: errors.length,
        warningCount: warnings.length,
        infoCount: infos.length,
        issues,
      };
    }

    case 'ezboard_reroute': {
      let project = loadProjectArg(args);
      const bArg = args.board as { width?: unknown; height?: unknown } | undefined;
      if (bArg && Number.isFinite(Number(bArg.width)) && Number.isFinite(Number(bArg.height))) {
        project = {
          ...project,
          board: {
            width: Math.min(200, Math.max(10, Math.round(Number(bArg.width)))),
            height: Math.min(200, Math.max(10, Math.round(Number(bArg.height)))),
          },
        };
      }
      if (typeof args.pour === 'boolean') project = { ...project, pour: args.pour };
      if (typeof args.holes === 'boolean') project = { ...project, holes: args.holes };
      if (args.autoPlace === true) {
        project = autoPlace({ ...project, tracks: [], vias: [] }, new Set());
      }
      const route = autoRoute({ ...project, tracks: [], vias: [] });
      project = { ...project, tracks: route.tracks, vias: route.vias };
      const issues = runDrc(project);
      let savedPath: string | undefined;
      if (typeof args.outputPath === 'string' && args.outputPath.trim()) {
        savedPath = writeTextFile(args.outputPath, JSON.stringify(project, null, 2));
      }
      return {
        savedPath,
        route: {
          routed: route.routed,
          failedCount: route.failed.length,
          failed: route.failed,
          tracks: route.tracks.length,
          vias: route.vias.length,
        },
        drc: {
          ok: !issues.some((i) => i.level === 'error'),
          errors: issues.filter((i) => i.level === 'error').length,
          warnings: issues.filter((i) => i.level === 'warning').length,
          issues,
        },
        project,
      };
    }

    case 'ezboard_export_gerber': {
      const project = loadProjectArg(args);
      const gerbers = buildGerbers(project);
      const bomCsv = buildBom(project);
      const fileNames = Object.keys(gerbers);
      let outputDir: string | undefined;
      let zipPath: string | undefined;
      if (typeof args.outputDir === 'string' && args.outputDir.trim()) {
        outputDir = resolve(args.outputDir);
        mkdirSync(outputDir, { recursive: true });
        for (const [fn, content] of Object.entries(gerbers)) {
          writeFileSync(join(outputDir, fn), content, 'utf8');
        }
        writeFileSync(join(outputDir, 'BOM.csv'), bomCsv, 'utf8');
        const { default: JSZip } = await import('jszip');
        const zip = new JSZip();
        for (const [fn, content] of Object.entries(gerbers)) zip.file(fn, content);
        const buf = await zip.generateAsync({ type: 'nodebuffer' });
        zipPath = join(outputDir, 'gerber.zip');
        writeFileSync(zipPath, buf);
      }
      const includeContent = typeof args.includeContent === 'boolean' ? args.includeContent : !outputDir;
      return {
        board: project.board,
        files: fileNames,
        outputDir,
        zipPath,
        bomCsv,
        gerberFiles: includeContent ? gerbers : undefined,
      };
    }

    case 'ezboard_export_kicad': {
      const project = loadProjectArg(args);
      const kicadPcb = exportKicadPcb(project);
      let savedPath: string | undefined;
      if (typeof args.outputPath === 'string' && args.outputPath.trim()) {
        savedPath = writeTextFile(args.outputPath, kicadPcb);
      }
      return {
        savedPath,
        bytes: Buffer.byteLength(kicadPcb, 'utf8'),
        kicadPcb: savedPath ? undefined : kicadPcb,
      };
    }

    case 'ezboard_render_svg': {
      const project = loadProjectArg(args);
      const kind = typeof args.kind === 'string' ? args.kind : 'pcb_edit';
      let svg: string;
      if (kind === 'true_scale') svg = renderTrueScaleSvg(project);
      else if (kind === 'schematic') svg = renderSchematicSvg(project);
      else if (kind === 'pcb_real') svg = renderPcbSvg(project, { mode: 'real', side: 'top' });
      else if (kind === 'pcb_real_back') svg = renderPcbSvg(project, { mode: 'real', side: 'bottom' });
      else svg = renderPcbSvg(project, { mode: 'edit' });

      let savedPath: string | undefined;
      if (typeof args.outputPath === 'string' && args.outputPath.trim()) {
        savedPath = writeTextFile(args.outputPath, svg);
      }
      return {
        kind,
        savedPath,
        bytes: Buffer.byteLength(svg, 'utf8'),
        svg: savedPath ? undefined : svg,
      };
    }

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

async function handleRequest(req: JsonRpcRequest): Promise<JsonRpcResponse | null> {
  const { id, method, params } = req;

  // Notifications have no id and require no response
  if (id === undefined) return null;

  try {
    switch (method) {
      case 'initialize': {
        const clientProto = typeof params?.protocolVersion === 'string' ? params.protocolVersion : DEFAULT_PROTOCOL;
        return {
          jsonrpc: '2.0',
          id,
          result: {
            protocolVersion: clientProto,
            capabilities: { tools: {}, resources: {} },
            serverInfo: SERVER_INFO,
          },
        };
      }

      case 'ping':
        return { jsonrpc: '2.0', id, result: {} };

      case 'tools/list':
        return { jsonrpc: '2.0', id, result: { tools: TOOLS } };

      case 'tools/call': {
        const toolName = typeof params?.name === 'string' ? params.name : '';
        const toolArgs = (params?.arguments && typeof params.arguments === 'object' ? params.arguments : {}) as Record<string, unknown>;
        try {
          const data = await callTool(toolName, toolArgs);
          return {
            jsonrpc: '2.0',
            id,
            result: {
              content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
            },
          };
        } catch (err) {
          return {
            jsonrpc: '2.0',
            id,
            result: {
              isError: true,
              content: [{ type: 'text', text: (err as Error).message || String(err) }],
            },
          };
        }
      }

      case 'resources/list':
        return { jsonrpc: '2.0', id, result: { resources: RESOURCES } };

      case 'resources/read': {
        const uri = typeof params?.uri === 'string' ? params.uri : '';
        if (uri === 'ezboard://library/summary') {
          return {
            jsonrpc: '2.0',
            id,
            result: {
              contents: [{ uri, mimeType: 'text/plain', text: librarySummary() }],
            },
          };
        }
        if (uri === 'ezboard://examples') {
          return {
            jsonrpc: '2.0',
            id,
            result: {
              contents: [{ uri, mimeType: 'application/json', text: JSON.stringify(EXAMPLES, null, 2) }],
            },
          };
        }
        return {
          jsonrpc: '2.0',
          id,
          error: { code: -32002, message: `Resource not found: ${uri}` },
        };
      }

      default:
        return {
          jsonrpc: '2.0',
          id,
          error: { code: -32601, message: `Method not found: ${method}` },
        };
    }
  } catch (err) {
    return {
      jsonrpc: '2.0',
      id,
      error: { code: -32603, message: (err as Error).message || 'Internal error' },
    };
  }
}

function send(msg: JsonRpcResponse) {
  process.stdout.write(`${JSON.stringify(msg)}\n`);
}

// stdio JSON-RPC 루프 (줄 단위 JSON 메시지 처리)
const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });

rl.on('line', (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;
  let req: JsonRpcRequest;
  try {
    req = JSON.parse(trimmed) as JsonRpcRequest;
  } catch (err) {
    send({ jsonrpc: '2.0', id: null, error: { code: -32700, message: `Parse error: ${(err as Error).message}` } });
    return;
  }
  void handleRequest(req).then((res) => {
    if (res) send(res);
  });
});

rl.on('close', () => {
  process.exit(0);
});
