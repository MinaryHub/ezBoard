import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

class McpClient {
  private proc;
  private nextId = 1;
  private pending = new Map<number, { resolve: (v: Record<string, unknown>) => void; reject: (e: Error) => void }>();
  stderr = '';

  constructor() {
    this.proc = spawn(process.execPath, ['--import', 'tsx', join(ROOT, 'mcp', 'server.ts')], {
      cwd: ROOT,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const rl = createInterface({ input: this.proc.stdout });
    rl.on('line', (line) => {
      const msg = JSON.parse(line) as { id?: number } & Record<string, unknown>;
      if (typeof msg.id === 'number') {
        const entry = this.pending.get(msg.id);
        if (entry) {
          this.pending.delete(msg.id);
          entry.resolve(msg);
        }
      }
    });
    this.proc.stderr.on('data', (chunk) => { this.stderr += String(chunk); });
    this.proc.on('exit', (code) => {
      for (const [, p] of this.pending) p.reject(new Error(`MCP server exited (${code}): ${this.stderr}`));
      this.pending.clear();
    });
  }

  request(method: string, params?: Record<string, unknown>): Promise<Record<string, unknown>> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.proc.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
    });
  }

  notify(method: string, params?: Record<string, unknown>) {
    this.proc.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method, params })}\n`);
  }

  async callTool<T = Record<string, unknown>>(name: string, args: Record<string, unknown> = {}): Promise<{ isError?: boolean; data: T; rawText: string }> {
    const res = await this.request('tools/call', { name, arguments: args });
    assert.equal(res.error, undefined, `RPC error on ${name}: ${JSON.stringify(res.error)}`);
    const result = res.result as { isError?: boolean; content: { type: string; text: string }[] };
    const text = result.content[0]?.text ?? '';
    return {
      isError: result.isError,
      rawText: text,
      data: (result.isError ? ({} as T) : JSON.parse(text) as T),
    };
  }

  async close() {
    this.proc.stdin.end();
    await new Promise<void>((resolve) => {
      if (this.proc.exitCode !== null) { resolve(); return; }
      this.proc.once('exit', () => resolve());
    });
  }
}

test('MCP server: full stdio lifecycle, tools, resources, and file exports', async () => {
  const client = new McpClient();
  const dir = mkdtempSync(join(tmpdir(), 'ezboard-mcp-test-'));
  try {
    // 1. initialize + notification
    const init = await client.request('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'test-client', version: '1.0' },
    });
    const initRes = init.result as { protocolVersion: string; serverInfo: { name: string } };
    assert.equal(initRes.protocolVersion, '2024-11-05');
    assert.equal(initRes.serverInfo.name, 'ezboard-mcp');
    client.notify('notifications/initialized');

    // 2. tools/list
    const list = await client.request('tools/list');
    const tools = (list.result as { tools: { name: string }[] }).tools;
    const names = tools.map((t) => t.name).sort();
    assert.deepEqual(names, [
      'ezboard_build_circuit',
      'ezboard_export_gerber',
      'ezboard_export_kicad',
      'ezboard_list_parts',
      'ezboard_render_svg',
      'ezboard_reroute',
      'ezboard_run_drc',
    ]);

    // 3. resources/list + resources/read
    const rList = await client.request('resources/list');
    const resources = (rList.result as { resources: { uri: string }[] }).resources;
    assert.equal(resources.length, 2);
    const summaryRes = await client.request('resources/read', { uri: 'ezboard://library/summary' });
    const summaryText = (summaryRes.result as { contents: { text: string }[] }).contents[0].text;
    assert.ok(summaryText.includes('esp32_devkit'));
    assert.ok(summaryText.includes('dc_jack'));

    // 4. ezboard_list_parts
    const partsRes = await client.callTool<{ count: number; totalLibrarySize: number; parts: { type: string }[] }>(
      'ezboard_list_parts',
      { query: 'jst' },
    );
    assert.ok(partsRes.data.totalLibrarySize >= 52);
    assert.equal(partsRes.data.count, 3);

    // 5. ezboard_build_circuit (with custom net width & file output)
    const projPath = join(dir, 'led.ezboard.json');
    const built = await client.callTool<{
      savedPath: string;
      route: { failedCount: number; tracks: number };
      drc: { ok: boolean; errors: number };
      project: Record<string, unknown>;
    }>('ezboard_build_circuit', {
      name: 'MCP Test LED',
      parts: [
        { ref: 'J1', type: 'jst_xh2', value: '5V IN' },
        { ref: 'R1', type: 'resistor', value: '330Ω' },
        { ref: 'LED1', type: 'led', value: '초록' },
      ],
      nets: [
        { name: '5V', pins: ['J1.1', 'R1.1'], width: 1.2 },
        { name: 'LED_A', pins: ['R1.2', 'LED1.A'] },
        { name: 'GND', pins: ['J1.2', 'LED1.K'], width: 1.2 },
      ],
      pour: true,
      holes: true,
      outputPath: projPath,
    });
    assert.equal(built.isError, undefined);
    assert.equal(built.data.route.failedCount, 0);
    assert.equal(built.data.drc.ok, true);
    assert.ok(existsSync(projPath));

    // 6. ezboard_run_drc (from saved projectPath)
    const drc = await client.callTool<{ ok: boolean; errorCount: number }>('ezboard_run_drc', { projectPath: projPath });
    assert.equal(drc.data.ok, true);
    assert.equal(drc.data.errorCount, 0);

    // 7. ezboard_reroute
    const rerouted = await client.callTool<{ route: { failedCount: number } }>('ezboard_reroute', {
      projectPath: projPath,
      board: { width: 55, height: 45 },
      autoPlace: true,
      outputPath: projPath,
    });
    assert.equal(rerouted.data.route.failedCount, 0);

    // 8. ezboard_export_gerber (write to outputDir + zip)
    const gerberDir = join(dir, 'gerbers');
    const gerber = await client.callTool<{ files: string[]; zipPath: string }>('ezboard_export_gerber', {
      projectPath: projPath,
      outputDir: gerberDir,
    });
    assert.ok(gerber.data.files.includes('ezboard-F_Cu.gtl'));
    assert.ok(gerber.data.files.includes('ezboard-PTH.drl'));
    assert.ok(gerber.data.files.includes('ezboard-NPTH.drl'));
    assert.ok(existsSync(gerber.data.zipPath));
    assert.ok(existsSync(join(gerberDir, 'BOM.csv')));

    // 9. ezboard_export_kicad
    const kicadPath = join(dir, 'board.kicad_pcb');
    const kicad = await client.callTool<{ savedPath: string; bytes: number }>('ezboard_export_kicad', {
      projectPath: projPath,
      outputPath: kicadPath,
    });
    assert.ok(kicad.data.bytes > 500);
    assert.ok(readFileSync(kicadPath, 'utf8').includes('(kicad_pcb'));

    // 10. ezboard_render_svg (true_scale + schematic)
    const svgPath = join(dir, 'check_1to1.svg');
    const svg1to1 = await client.callTool<{ savedPath: string; bytes: number }>('ezboard_render_svg', {
      projectPath: projPath,
      kind: 'true_scale',
      outputPath: svgPath,
    });
    assert.ok(svg1to1.data.bytes > 500);
    assert.ok(readFileSync(svgPath, 'utf8').includes('1:1 TRUE SCALE'));

    const schSvg = await client.callTool<{ svg: string }>('ezboard_render_svg', {
      projectPath: projPath,
      kind: 'schematic',
    });
    assert.ok(schSvg.data.svg.includes('<svg '));

    // 11. error handling on unknown part
    const bad = await client.callTool('ezboard_build_circuit', {
      parts: [{ ref: 'U1', type: 'nonexistent_part_xyz' }],
      nets: [{ name: 'N1', pins: ['U1.1'] }],
    });
    assert.equal(bad.isError, true);
    assert.match(bad.rawText, /Unknown part type/);
  } finally {
    await client.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
