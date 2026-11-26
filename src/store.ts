import { create } from 'zustand';
import { t } from './i18n';
import type { AiSettings, ChatMessage, Part, Project, SchPos } from './types';
import { layoutSchematic } from './lib/schematic';
import { symbolFor } from './lib/symbols';
import { autoPlace, findFreeSpot, GRID, snap } from './lib/geometry';
import { autoRoute, type RouteResult } from './lib/router';
import { PROVIDERS, type AiCircuit } from './lib/ai';
import { buildFromCircuit } from './lib/build';
import { forLocalStorage, loadKeys, saveKeys } from './lib/secureKeys';
import { connectPins, disconnectPin, type PinId } from './lib/connect';
import { hitsHole, mountingHoles } from './lib/features';
import { getDef, nextRef, partBox } from './lib/library';

const emptyProject = (): Project => ({ name: t('app.newProject'), board: { width: 50, height: 40 }, parts: [], nets: [], tracks: [], vias: [], pour: true });

function save(key: string, v: unknown) {
  try { localStorage.setItem(key, JSON.stringify(v)); } catch { /* 저장 실패는 무시 */ }
}

const defaultSettings: AiSettings = {
  provider: 'claude',
  keys: { claude: '', gemini: '', openai: '' },
  models: { claude: PROVIDERS.claude.defaultModel, gemini: PROVIDERS.gemini.defaultModel, openai: PROVIDERS.openai.defaultModel },
  auth: { claude: 'key', gemini: 'key', openai: 'key' },
  cliModels: { claude: '', gemini: '', openai: '' },
};

function loadSettings(): AiSettings {
  try {
    const raw = localStorage.getItem('ezboard.settings');
    if (!raw) return defaultSettings;
    const p = JSON.parse(raw);
    if (!p || typeof p !== 'object') return defaultSettings;
    const prov = p.provider === 'gemini' || p.provider === 'openai' || p.provider === 'claude' ? p.provider : defaultSettings.provider;
    return {
      provider: prov,
      keys: { ...defaultSettings.keys, ...(p.keys && typeof p.keys === 'object' ? p.keys : {}) },
      models: { ...defaultSettings.models, ...(p.models && typeof p.models === 'object' ? p.models : {}) },
      auth: { ...defaultSettings.auth, ...(p.auth && typeof p.auth === 'object' ? p.auth : {}) },
      cliModels: { ...defaultSettings.cliModels, ...(p.cliModels && typeof p.cliModels === 'object' ? p.cliModels : {}) },
    };
  } catch {
    return defaultSettings;
  }
}

export function sanitizeProject(raw: unknown): Project | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (!Array.isArray(r.parts)) return null;
  const base = emptyProject();
  const bw = Number((r.board as { width?: unknown } | undefined)?.width);
  const bh = Number((r.board as { height?: unknown } | undefined)?.height);
  const board = {
    width: Number.isFinite(bw) ? Math.min(200, Math.max(10, bw)) : base.board.width,
    height: Number.isFinite(bh) ? Math.min(200, Math.max(10, bh)) : base.board.height,
  };
  const parts: Part[] = r.parts
    .filter((p): p is Record<string, unknown> => !!p && typeof p === 'object' && typeof (p as Record<string, unknown>).ref === 'string' && typeof (p as Record<string, unknown>).type === 'string')
    .map((p) => ({
      ref: String(p.ref),
      type: String(p.type),
      value: typeof p.value === 'string' ? p.value : '',
      x: Number.isFinite(Number(p.x)) ? Number(p.x) : 0,
      y: Number.isFinite(Number(p.y)) ? Number(p.y) : 0,
      rot: Number.isFinite(Number(p.rot)) ? (((Math.round(Number(p.rot) / 90) * 90) % 360) + 360) % 360 : 0,
      note: typeof p.note === 'string' ? p.note : undefined,
    }));
  const nets = Array.isArray(r.nets)
    ? r.nets
      .filter((n): n is { name: string; pins: unknown[] } => !!n && typeof n === 'object' && typeof (n as { name?: unknown }).name === 'string' && Array.isArray((n as { pins?: unknown }).pins))
      .map((n) => ({ name: n.name, pins: n.pins.map(String) }))
    : [];
  const tracks = Array.isArray(r.tracks)
    ? r.tracks.filter((tr) => !!tr && typeof tr === 'object' && Array.isArray((tr as { points?: unknown }).points))
    : [];
  const vias = Array.isArray(r.vias)
    ? r.vias.filter((v) => !!v && typeof v === 'object' && Number.isFinite(Number((v as { x?: unknown }).x)) && Number.isFinite(Number((v as { y?: unknown }).y)))
    : [];
  const sch = r.sch && typeof r.sch === 'object' && !Array.isArray(r.sch) ? (r.sch as Record<string, SchPos>) : undefined;
  return {
    name: typeof r.name === 'string' ? r.name : base.name,
    board,
    parts,
    nets,
    tracks,
    vias,
    sch,
    pour: typeof r.pour === 'boolean' ? r.pour : base.pour,
    holes: typeof r.holes === 'boolean' ? r.holes : false,
  };
}

function loadProjectStorage(): Project {
  try {
    const raw = localStorage.getItem('ezboard.project');
    if (!raw) return emptyProject();
    return sanitizeProject(JSON.parse(raw)) ?? emptyProject();
  } catch {
    return emptyProject();
  }
}

function loadChatStorage(): ChatMessage[] {
  try {
    const raw = JSON.parse(localStorage.getItem('ezboard.chat') ?? '[]');
    if (!Array.isArray(raw)) return [];
    return raw.filter((m): m is ChatMessage => !!m && typeof m === 'object' && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string');
  } catch {
    return [];
  }
}

export type ViewMode = 'edit' | 'real';
export type Stage = 'sch' | 'pcb';
export type Appearance = 'dark' | 'light';

interface State {
  project: Project;
  past: Project[];
  future: Project[];
  dirty: boolean;
  /** 새 프로젝트·열기·채팅 초기화 시 증가 — 진행 중 AI 응답 경합 차단 */
  sessionGen: number;
  selected: string | null;
  highlightNet: string | null;
  pendingPrompt: string | null;
  messages: ChatMessage[];
  settings: AiSettings;
  view: ViewMode;
  realSide: 'top' | 'bottom';
  stage: Stage;
  appearance: Appearance;
  fitTick: number;
  showLayer: { top: boolean; bottom: boolean; silk: boolean; ratsnest: boolean };
  lastRoute: RouteResult | null;
  toast: string | null;
  /** 상태 막대에 남겨 두는 마지막 알림 */
  lastToast: string;

  commit: (p: Project, label?: string) => void;
  markSaved: () => void;
  undo: () => void;
  redo: () => void;
  select: (ref: string | null) => void;
  setHighlightNet: (net: string | null) => void;
  requestAiPrompt: (text: string | null) => void;
  movePart: (ref: string, x: number, y: number, record: boolean) => void;
  nudgePart: (ref: string, dxSteps: number, dySteps: number) => void;
  nudgeSchPart: (ref: string, dx: number, dy: number) => void;
  updatePart: (ref: string, patch: Partial<Part>, record?: boolean) => void;
  rotatePart: (ref: string) => void;
  duplicatePart: (ref: string) => void;
  deletePart: (ref: string) => void;
  addPart: (part: Part) => void;
  applyCircuit: (c: AiCircuit) => void;
  runAutoPlace: () => void;
  runAutoRoute: () => RouteResult;
  clearRoutes: () => void;
  setBoard: (w: number, h: number) => void;
  setPour: (on: boolean) => void;
  setHoles: (on: boolean) => void;
  setName: (name: string) => void;
  newProject: () => void;
  loadProject: (p: Project) => void;
  pushMessage: (m: ChatMessage) => void;
  clearChat: () => void;
  setSettings: (s: AiSettings) => void;
  setView: (v: ViewMode) => void;
  toggleRealSide: () => void;
  setStage: (s: Stage) => void;
  setAppearance: (a: Appearance) => void;
  requestFit: () => void;
  moveSchPart: (ref: string, x: number, y: number, current: Record<string, SchPos>) => void;
  rotateSchPart: (ref: string) => void;
  relayoutSchematic: () => void;
  connectSchPins: (a: PinId, b: PinId) => boolean;
  disconnectSchPin: (p: PinId) => void;
  toggleLayer: (k: keyof State['showLayer']) => void;
  notify: (msg: string) => void;
}

/** 부품이 움직이면 그 부품에 연결된 넷의 배선은 지운다 */
function dropTracksOf(p: Project, ref: string): Project {
  const prefix = ref.toLowerCase() + '.';
  const nets = new Set(p.nets.filter((n) => n.pins.some((x) => x.trim().toLowerCase().startsWith(prefix))).map((n) => n.name));
  return { ...p, tracks: p.tracks.filter((tr) => !nets.has(tr.net)), vias: p.vias.filter((v) => !nets.has(v.net)) };
}

let toastTimer: ReturnType<typeof setTimeout> | undefined;

export const useStore = create<State>((set, get) => ({
  project: loadProjectStorage(),
  past: [],
  future: [],
  dirty: false,
  sessionGen: 0,
  selected: null,
  highlightNet: null,
  pendingPrompt: null,
  messages: loadChatStorage(),
  settings: loadSettings(),
  view: 'edit',
  realSide: 'top',
  stage: 'sch',
  appearance: (() => { try { return localStorage.getItem('ezboard.appearance') === 'light' ? 'light' : 'dark'; } catch { return 'dark'; } })(),
  fitTick: 0,
  showLayer: { top: true, bottom: true, silk: true, ratsnest: true },
  lastRoute: null,
  toast: null,
  lastToast: '',

  commit: (p) => set((s) => ({ project: p, past: [...s.past.slice(-50), s.project], future: [], dirty: true })),
  markSaved: () => set({ dirty: false }),
  undo: () => set((s) => {
    if (!s.past.length) return {};
    const project = s.past[s.past.length - 1];
    const selected = s.selected && project.parts.some((p) => p.ref === s.selected) ? s.selected : null;
    return { project, past: s.past.slice(0, -1), future: [s.project, ...s.future], lastRoute: null, selected, dirty: true };
  }),
  redo: () => set((s) => {
    if (!s.future.length) return {};
    const project = s.future[0];
    const selected = s.selected && project.parts.some((p) => p.ref === s.selected) ? s.selected : null;
    return { project, future: s.future.slice(1), past: [...s.past, s.project], lastRoute: null, selected, dirty: true };
  }),
  select: (ref) => set({ selected: ref }),
  setHighlightNet: (highlightNet) => set({ highlightNet }),
  requestAiPrompt: (pendingPrompt) => set({ pendingPrompt }),

  movePart: (ref, x, y, record) => {
    const s = get();
    const parts = s.project.parts.map((p) => (p.ref === ref ? { ...p, x, y } : p));
    const next = dropTracksOf({ ...s.project, parts }, ref);
    if (record) s.commit(next); else set({ project: next, dirty: true });
  },
  nudgePart: (ref, dxSteps, dySteps) => {
    const s = get();
    const cur = s.project.parts.find((p) => p.ref === ref);
    if (!cur) return;
    s.movePart(ref, snap(cur.x + dxSteps * GRID), snap(cur.y + dySteps * GRID), true);
  },
  nudgeSchPart: (ref, dx, dy) => {
    const s = get();
    const cur = layoutSchematic(s.project.parts, s.project.nets, s.project.sch ?? {});
    const old = cur[ref];
    if (!old) return;
    s.commit({ ...s.project, sch: { ...cur, [ref]: { ...old, x: old.x + dx, y: old.y + dy } } });
  },
  updatePart: (ref, patch, record = true) => {
    const s = get();
    const next = { ...s.project, parts: s.project.parts.map((p) => (p.ref === ref ? { ...p, ...patch } : p)) };
    if (record) s.commit(next); else set({ project: next, dirty: true });
  },
  rotatePart: (ref) => {
    const s = get();
    const parts = s.project.parts.map((p) => (p.ref === ref ? { ...p, rot: (p.rot + 90) % 360 } : p));
    s.commit(dropTracksOf({ ...s.project, parts }, ref));
  },
  duplicatePart: (ref) => {
    const s = get();
    const src = s.project.parts.find((p) => p.ref === ref);
    if (!src) return;
    const def = getDef(src.type);
    const prefix = def?.prefix ?? (ref.replace(/\d+$/, '') || 'U');
    const newRef = nextRef(s.project.parts, prefix);
    const spot = findFreeSpot(s.project, src, { x: src.x + GRID * 3, y: src.y + GRID * 2 });
    const clone: Part = { ...src, ref: newRef, x: spot.x, y: spot.y };
    const parts = [...s.project.parts, clone];
    const baseSch = layoutSchematic(s.project.parts, s.project.nets, s.project.sch ?? {});
    const srcSch = baseSch[src.ref];
    const sch = srcSch
      ? { ...baseSch, [newRef]: { x: srcSch.x + 6, y: srcSch.y + 4, rot: srcSch.rot } }
      : layoutSchematic(parts, s.project.nets, baseSch);
    const next: Project = { ...s.project, parts, sch };
    set((cur) => ({ project: next, past: [...cur.past.slice(-50), cur.project], future: [], selected: newRef, dirty: true }));
    get().notify(t('toast.duplicated', { ref: newRef }));
  },
  deletePart: (ref) => {
    const s = get();
    const p = dropTracksOf(s.project, ref);
    const lower = ref.toLowerCase() + '.';
    const sch = { ...(p.sch ?? {}) };
    delete sch[ref];
    const next: Project = {
      ...p,
      sch,
      parts: p.parts.filter((x) => x.ref !== ref),
      nets: p.nets.map((n) => ({ ...n, pins: n.pins.filter((x) => !x.trim().toLowerCase().startsWith(lower)) })).filter((n) => n.pins.length > 1),
    };
    set((cur) => ({ project: next, past: [...cur.past.slice(-50), cur.project], future: [], selected: null, dirty: true }));
  },
  addPart: (part) => {
    const s = get();
    const spot = part.x === 0 && part.y === 0 ? findFreeSpot(s.project, part) : { x: part.x, y: part.y };
    const placed: Part = { ...part, x: spot.x, y: spot.y };
    const parts = [...s.project.parts, placed];
    const next: Project = { ...s.project, parts, sch: layoutSchematic(parts, s.project.nets, s.project.sch ?? {}) };
    set((cur) => ({ project: next, past: [...cur.past.slice(-50), cur.project], future: [], selected: placed.ref, dirty: true }));
  },

  applyCircuit: (c) => {
    const s = get();
    const { project, route, grown } = buildFromCircuit(s.project, c);
    set((cur) => ({ project, past: [...cur.past.slice(-50), cur.project], future: [], lastRoute: route, selected: null, dirty: true }));
    if (grown) get().notify(t('toast.boardGrown', { w: project.board.width, h: project.board.height }));
  },
  runAutoPlace: () => {
    const s = get();
    const next = autoPlace({ ...s.project, tracks: [], vias: [] }, new Set());
    set((cur) => ({ project: next, past: [...cur.past.slice(-50), cur.project], future: [], lastRoute: null, dirty: true }));
  },
  runAutoRoute: () => {
    const s = get();
    const r = autoRoute({ ...s.project, tracks: [], vias: [] });
    const next = { ...s.project, tracks: r.tracks, vias: r.vias };
    set((cur) => ({ project: next, past: [...cur.past.slice(-50), cur.project], future: [], lastRoute: r, dirty: true }));
    return r;
  },
  clearRoutes: () => {
    set((cur) => ({ project: { ...cur.project, tracks: [], vias: [] }, past: [...cur.past.slice(-50), cur.project], future: [], lastRoute: null, dirty: true }));
  },
  setBoard: (width, height) => {
    const w = Math.min(200, Math.max(10, Number.isFinite(width) ? Math.round(width) : 50));
    const h = Math.min(200, Math.max(10, Number.isFinite(height) ? Math.round(height) : 40));
    set((cur) => ({ project: { ...cur.project, board: { width: w, height: h }, tracks: [], vias: [] }, past: [...cur.past.slice(-50), cur.project], future: [], lastRoute: null, dirty: true }));
  },
  setPour: (on) => { const s = get(); s.commit({ ...s.project, pour: on }); },
  setHoles: (on) => {
    const s = get();
    const hadTracks = s.project.tracks.length > 0;
    let p: Project = { ...s.project, holes: on };
    let route: RouteResult | null = s.lastRoute;
    const holes = mountingHoles(p);
    if (on && !holes.length) s.notify(t('toast.holesSmall'));
    if (on && holes.length) {
      // 구멍 자리에 걸린 부품만 다시 배치하고, 배선이 있었다면 구멍을 피해 다시 배선
      const keep = new Set(p.parts.filter((x) => !hitsHole(holes, partBox(x), 0.5)).map((x) => x.ref));
      const moved = p.parts.length - keep.size;
      if (moved) p = autoPlace(p, keep);
      if (hadTracks) {
        const r = autoRoute({ ...p, tracks: [], vias: [] });
        p = { ...p, tracks: r.tracks, vias: r.vias };
        route = r;
      }
      if (moved) s.notify(t('toast.holesMoved', { n: moved }));
    }
    set((cur) => ({ project: p, past: [...cur.past.slice(-50), cur.project], future: [], lastRoute: route, dirty: true }));
  },
  setName: (name) => set((s) => ({ project: { ...s.project, name }, dirty: true })),
  newProject: () => set((cur) => ({
    project: emptyProject(),
    past: [...cur.past.slice(-50), cur.project],
    future: [],
    dirty: false,
    sessionGen: cur.sessionGen + 1,
    messages: [],
    selected: null,
    lastRoute: null,
  })),
  loadProject: (p) => {
    const clean = sanitizeProject(p);
    if (!clean) return;
    set((cur) => ({
      project: clean,
      past: [...cur.past.slice(-50), cur.project],
      future: [],
      dirty: false,
      sessionGen: cur.sessionGen + 1,
      selected: null,
      lastRoute: null,
    }));
  },
  pushMessage: (m) => set((s) => ({ messages: [...s.messages, m] })),
  clearChat: () => set((s) => ({ messages: [], sessionGen: s.sessionGen + 1 })),
  setSettings: (settings) => {
    save('ezboard.settings', forLocalStorage(settings));
    void saveKeys(settings.keys);
    set({ settings });
  },
  setView: (view) => set({ view }),
  toggleRealSide: () => set((s) => ({ realSide: s.realSide === 'top' ? 'bottom' : 'top' })),
  setStage: (stage) => set({ stage }),
  setAppearance: (appearance) => { try { localStorage.setItem('ezboard.appearance', appearance); } catch { /* 무시 */ } set({ appearance }); },
  requestFit: () => set((s) => ({ fitTick: s.fitTick + 1 })),
  moveSchPart: (ref, x, y, current) => {
    const s = get();
    const old = current[ref] ?? { x, y, rot: 0 };
    s.commit({ ...s.project, sch: { ...current, [ref]: { ...old, x, y } } });
  },
  rotateSchPart: (ref) => {
    const s = get();
    const part = s.project.parts.find((p) => p.ref === ref);
    if (!part) return;
    const cur = layoutSchematic(s.project.parts, s.project.nets, s.project.sch ?? {});
    const box = !symbolFor(part.type).rotatable;
    const rot = box ? (cur[ref].rot === 180 ? 0 : 180) : (cur[ref].rot + 90) % 360;
    if (box) s.notify(t('toast.boxFlip'));
    s.commit({ ...s.project, sch: { ...cur, [ref]: { ...cur[ref], rot } } });
  },
  relayoutSchematic: () => {
    const s = get();
    s.commit({ ...s.project, sch: layoutSchematic(s.project.parts, s.project.nets, {}) });
  },
  connectSchPins: (a, b) => {
    const s = get();
    const r = connectPins(s.project, a, b);
    if (!r.ok) {
      if (r.reason === 'same') s.notify(t('toast.wireSame', { net: r.a! }));
      if (r.reason === 'short') s.notify(t('toast.wireShort', { a: r.a!, b: r.b! }));
      return false;
    }
    set((cur) => ({ project: r.project, past: [...cur.past.slice(-50), cur.project], future: [], lastRoute: null, dirty: true }));
    get().notify(r.merged ? t('toast.wireMerged', { a: r.merged, b: r.net }) : t('toast.wireAdded', { a: `${a.ref}.${a.name}`, b: `${b.ref}.${b.name}`, net: r.net }));
    return true;
  },
  disconnectSchPin: (pin) => {
    const s = get();
    const r = disconnectPin(s.project, pin);
    if (!r) return;
    set((cur) => ({ project: r.project, past: [...cur.past.slice(-50), cur.project], future: [], lastRoute: null, dirty: true }));
    get().notify(t('toast.wireRemoved', { pin: `${pin.ref}.${pin.name}`, net: r.net }));
  },
  toggleLayer: (k) => set((s) => ({ showLayer: { ...s.showLayer, [k]: !s.showLayer[k] } })),
  notify: (toast) => {
    clearTimeout(toastTimer);
    set({ toast, lastToast: toast });
    toastTimer = setTimeout(() => set({ toast: null }), 3500);
  },
}));

// 데스크톱: AI 키는 운영체제 보안 저장소에서 읽고, localStorage에 남은 예전 평문 키는 옮긴 뒤 지운다
void loadKeys(useStore.getState().settings.keys).then((r) => {
  if (!r) return;
  const settings = { ...useStore.getState().settings, keys: r.keys };
  useStore.setState({ settings });
  save('ezboard.settings', forLocalStorage(settings));
}).catch(() => { /* 보안 저장소를 못 쓰면 예전처럼 */ });

// 자동 저장 (프로젝트는 350ms 디바운스 + 창 닫힘 시 즉시 반영)
let projectSaveTimer: ReturnType<typeof setTimeout> | undefined;
function flushProjectSave() {
  if (projectSaveTimer) {
    clearTimeout(projectSaveTimer);
    projectSaveTimer = undefined;
    save('ezboard.project', useStore.getState().project);
  }
}
if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', flushProjectSave);
  window.addEventListener('pagehide', flushProjectSave);
}
useStore.subscribe((s, prev) => {
  if (s.project !== prev.project) {
    clearTimeout(projectSaveTimer);
    projectSaveTimer = setTimeout(() => {
      projectSaveTimer = undefined;
      save('ezboard.project', useStore.getState().project);
    }, 350);
  }
  if (s.messages !== prev.messages) save('ezboard.chat', s.messages.slice(-60));
});
