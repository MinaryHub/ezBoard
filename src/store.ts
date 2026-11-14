import { create } from 'zustand';
import { t } from './i18n';
import type { AiSettings, ChatMessage, Part, Project, SchPos } from './types';
import { layoutSchematic } from './lib/schematic';
import { symbolFor } from './lib/symbols';
import { autoPlace, suggestBoardSize } from './lib/geometry';
import { autoRoute, type RouteResult } from './lib/router';
import { circuitToParts, PROVIDERS, type AiCircuit } from './lib/ai';

const emptyProject = (): Project => ({ name: t('app.newProject'), board: { width: 50, height: 40 }, parts: [], nets: [], tracks: [], vias: [] });

function load<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(key);
    return v ? { ...fallback, ...JSON.parse(v) } : fallback;
  } catch {
    return fallback;
  }
}
function save(key: string, v: unknown) {
  try { localStorage.setItem(key, JSON.stringify(v)); } catch { /* 저장 실패는 무시 */ }
}

const defaultSettings: AiSettings = {
  provider: 'claude',
  keys: { claude: '', gemini: '', openai: '' },
  models: { claude: PROVIDERS.claude.defaultModel, gemini: PROVIDERS.gemini.defaultModel, openai: PROVIDERS.openai.defaultModel },
};

export type ViewMode = 'edit' | 'real';
export type Stage = 'sch' | 'pcb';
export type Appearance = 'dark' | 'light';

interface State {
  project: Project;
  past: Project[];
  future: Project[];
  selected: string | null;
  messages: ChatMessage[];
  settings: AiSettings;
  view: ViewMode;
  stage: Stage;
  appearance: Appearance;
  fitTick: number;
  showLayer: { top: boolean; bottom: boolean; silk: boolean; ratsnest: boolean };
  lastRoute: RouteResult | null;
  toast: string | null;

  commit: (p: Project, label?: string) => void;
  undo: () => void;
  redo: () => void;
  select: (ref: string | null) => void;
  movePart: (ref: string, x: number, y: number, record: boolean) => void;
  updatePart: (ref: string, patch: Partial<Part>) => void;
  rotatePart: (ref: string) => void;
  deletePart: (ref: string) => void;
  addPart: (part: Part) => void;
  applyCircuit: (c: AiCircuit) => void;
  runAutoPlace: () => void;
  runAutoRoute: () => RouteResult;
  clearRoutes: () => void;
  setBoard: (w: number, h: number) => void;
  setName: (name: string) => void;
  newProject: () => void;
  loadProject: (p: Project) => void;
  pushMessage: (m: ChatMessage) => void;
  clearChat: () => void;
  setSettings: (s: AiSettings) => void;
  setView: (v: ViewMode) => void;
  setStage: (s: Stage) => void;
  setAppearance: (a: Appearance) => void;
  requestFit: () => void;
  moveSchPart: (ref: string, x: number, y: number, current: Record<string, SchPos>) => void;
  rotateSchPart: (ref: string) => void;
  relayoutSchematic: () => void;
  toggleLayer: (k: keyof State['showLayer']) => void;
  notify: (msg: string) => void;
}

/** 부품이 움직이면 그 부품에 연결된 넷의 배선은 지운다 */
function dropTracksOf(p: Project, ref: string): Project {
  const nets = new Set(p.nets.filter((n) => n.pins.some((x) => x.toLowerCase().startsWith(ref.toLowerCase() + '.'))).map((n) => n.name));
  return { ...p, tracks: p.tracks.filter((t) => !nets.has(t.net)), vias: p.vias.filter((v) => !nets.has(v.net)) };
}

let toastTimer: ReturnType<typeof setTimeout> | undefined;

export const useStore = create<State>((set, get) => ({
  project: load<Project>('ezboard.project', emptyProject()),
  past: [],
  future: [],
  selected: null,
  messages: (() => { try { return JSON.parse(localStorage.getItem('ezboard.chat') ?? '[]'); } catch { return []; } })(),
  settings: load('ezboard.settings', defaultSettings),
  view: 'edit',
  stage: 'sch',
  appearance: (() => { try { return localStorage.getItem('ezboard.appearance') === 'light' ? 'light' : 'dark'; } catch { return 'dark'; } })(),
  fitTick: 0,
  showLayer: { top: true, bottom: true, silk: true, ratsnest: true },
  lastRoute: null,
  toast: null,

  commit: (p) => set((s) => ({ project: p, past: [...s.past.slice(-50), s.project], future: [] })),
  undo: () => set((s) => s.past.length ? { project: s.past[s.past.length - 1], past: s.past.slice(0, -1), future: [s.project, ...s.future] } : {}),
  redo: () => set((s) => s.future.length ? { project: s.future[0], future: s.future.slice(1), past: [...s.past, s.project] } : {}),
  select: (ref) => set({ selected: ref }),

  movePart: (ref, x, y, record) => {
    const s = get();
    const parts = s.project.parts.map((p) => (p.ref === ref ? { ...p, x, y } : p));
    const next = dropTracksOf({ ...s.project, parts }, ref);
    if (record) s.commit(next); else set({ project: next });
  },
  updatePart: (ref, patch) => {
    const s = get();
    s.commit({ ...s.project, parts: s.project.parts.map((p) => (p.ref === ref ? { ...p, ...patch } : p)) });
  },
  rotatePart: (ref) => {
    const s = get();
    const parts = s.project.parts.map((p) => (p.ref === ref ? { ...p, rot: (p.rot + 90) % 360 } : p));
    s.commit(dropTracksOf({ ...s.project, parts }, ref));
  },
  deletePart: (ref) => {
    const s = get();
    const p = dropTracksOf(s.project, ref);
    const lower = ref.toLowerCase() + '.';
    const sch = { ...(p.sch ?? {}) };
    delete sch[ref];
    s.commit({
      ...p,
      sch,
      parts: p.parts.filter((x) => x.ref !== ref),
      nets: p.nets.map((n) => ({ ...n, pins: n.pins.filter((x) => !x.toLowerCase().startsWith(lower)) })).filter((n) => n.pins.length > 0),
    });
    set({ selected: null });
  },
  addPart: (part) => {
    const s = get();
    const parts = [...s.project.parts, part];
    const p = { ...s.project, parts, sch: layoutSchematic(parts, s.project.nets, s.project.sch ?? {}) };
    s.commit(autoPlace(p, new Set(s.project.parts.map((x) => x.ref))));
    set({ selected: part.ref });
  },

  applyCircuit: (c) => {
    const s = get();
    const { parts, keep } = circuitToParts(c, s.project.parts);
    let board = s.project.board;
    if (c.board?.width && c.board?.height) board = { width: Math.min(200, Math.max(15, c.board.width)), height: Math.min(200, Math.max(15, c.board.height)) };
    else if (!keep.size) board = suggestBoardSize(parts);
    const oldSch = Object.fromEntries(Object.entries(s.project.sch ?? {}).filter(([ref]) => keep.has(ref)));
    const sch = layoutSchematic(parts, c.nets, oldSch);
    let p: Project = { ...s.project, name: c.name || s.project.name, board, parts, nets: c.nets, tracks: [], vias: [], sch };
    p = autoPlace(p, keep);
    // 보드에 다 안 들어가면 키워서 다시 배치
    for (let i = 0; i < 4 && p.parts.some((x) => x.x > board.width || x.y > board.height); i++) {
      board = { width: Math.round(board.width * 1.2), height: Math.round(board.height * 1.2) };
      p = autoPlace({ ...p, board }, keep);
    }
    const r = autoRoute(p);
    p = { ...p, tracks: r.tracks, vias: r.vias };
    s.commit(p);
    set({ lastRoute: r, selected: null });
  },
  runAutoPlace: () => {
    const s = get();
    s.commit(autoPlace({ ...s.project, tracks: [], vias: [] }, new Set()));
  },
  runAutoRoute: () => {
    const s = get();
    const r = autoRoute({ ...s.project, tracks: [], vias: [] });
    s.commit({ ...s.project, tracks: r.tracks, vias: r.vias });
    set({ lastRoute: r });
    return r;
  },
  clearRoutes: () => { const s = get(); s.commit({ ...s.project, tracks: [], vias: [] }); set({ lastRoute: null }); },
  setBoard: (width, height) => { const s = get(); s.commit({ ...s.project, board: { width, height }, tracks: [], vias: [] }); },
  setName: (name) => set((s) => ({ project: { ...s.project, name } })),
  newProject: () => { get().commit(emptyProject()); set({ messages: [], selected: null, lastRoute: null }); },
  loadProject: (p) => { get().commit({ ...emptyProject(), ...p }); set({ selected: null }); },
  pushMessage: (m) => set((s) => ({ messages: [...s.messages, m] })),
  clearChat: () => set({ messages: [] }),
  setSettings: (settings) => { save('ezboard.settings', settings); set({ settings }); },
  setView: (view) => set({ view }),
  setStage: (stage) => set({ stage }),
  setAppearance: (appearance) => { try { localStorage.setItem('ezboard.appearance', appearance); } catch { /* 무시 */ } set({ appearance }); },
  requestFit: () => set((s) => ({ fitTick: s.fitTick + 1 })),
  moveSchPart: (ref, x, y, current) => {
    const s = get();
    const old = current[ref];
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
  toggleLayer: (k) => set((s) => ({ showLayer: { ...s.showLayer, [k]: !s.showLayer[k] } })),
  notify: (toast) => {
    clearTimeout(toastTimer);
    set({ toast });
    toastTimer = setTimeout(() => set({ toast: null }), 3500);
  },
}));

// 자동 저장
useStore.subscribe((s, prev) => {
  if (s.project !== prev.project) save('ezboard.project', s.project);
  if (s.messages !== prev.messages) save('ezboard.chat', s.messages.slice(-60));
});
