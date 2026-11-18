import { create } from 'zustand';
import { t } from './i18n';
import type { AiSettings, ChatMessage, Part, Project, SchPos } from './types';
import { layoutSchematic } from './lib/schematic';
import { symbolFor } from './lib/symbols';
import { autoPlace } from './lib/geometry';
import { autoRoute, type RouteResult } from './lib/router';
import { PROVIDERS, type AiCircuit } from './lib/ai';
import { buildFromCircuit } from './lib/build';
import { forLocalStorage, loadKeys, saveKeys } from './lib/secureKeys';
import { connectPins, disconnectPin, type PinId } from './lib/connect';
import { hitsHole, mountingHoles } from './lib/features';
import { partBox } from './lib/library';

const emptyProject = (): Project => ({ name: t('app.newProject'), board: { width: 50, height: 40 }, parts: [], nets: [], tracks: [], vias: [], pour: true });

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
  auth: { claude: 'key', gemini: 'key', openai: 'key' },
  cliModels: { claude: '', gemini: '', openai: '' },
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
  /** 상태 막대에 남겨 두는 마지막 알림 */
  lastToast: string;

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
  setPour: (on: boolean) => void;
  setHoles: (on: boolean) => void;
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
  connectSchPins: (a: PinId, b: PinId) => boolean;
  disconnectSchPin: (p: PinId) => void;
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
  lastToast: '',

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
    const { project, route, grown } = buildFromCircuit(s.project, c);
    s.commit(project);
    set({ lastRoute: route, selected: null });
    if (grown) s.notify(t('toast.boardGrown', { w: project.board.width, h: project.board.height }));
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
  setPour: (on) => { const s = get(); s.commit({ ...s.project, pour: on }); },
  setHoles: (on) => {
    const s = get();
    let p: Project = { ...s.project, holes: on };
    const holes = mountingHoles(p);
    if (on && !holes.length) s.notify(t('toast.holesSmall'));
    if (on && holes.length) {
      // 구멍 자리에 걸린 부품만 다시 배치하고, 배선이 있었다면 구멍을 피해 다시 배선
      const keep = new Set(p.parts.filter((x) => !hitsHole(holes, partBox(x), 0.5)).map((x) => x.ref));
      const moved = p.parts.length - keep.size;
      if (moved) p = autoPlace(p, keep);
      if (p.tracks.length || moved) {
        const r = autoRoute({ ...p, tracks: [], vias: [] });
        p = { ...p, tracks: r.tracks, vias: r.vias };
        set({ lastRoute: r });
      }
      if (moved) s.notify(t('toast.holesMoved', { n: moved }));
    }
    s.commit(p);
  },
  setName: (name) => set((s) => ({ project: { ...s.project, name } })),
  newProject: () => { get().commit(emptyProject()); set({ messages: [], selected: null, lastRoute: null }); },
  loadProject: (p) => { get().commit({ ...emptyProject(), ...p }); set({ selected: null }); },
  pushMessage: (m) => set((s) => ({ messages: [...s.messages, m] })),
  clearChat: () => set({ messages: [] }),
  setSettings: (settings) => { save('ezboard.settings', forLocalStorage(settings)); void saveKeys(settings.keys); set({ settings }); },
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
  connectSchPins: (a, b) => {
    const s = get();
    const r = connectPins(s.project, a, b);
    if (!r.ok) {
      if (r.reason === 'same') s.notify(t('toast.wireSame', { net: r.a! }));
      if (r.reason === 'short') s.notify(t('toast.wireShort', { a: r.a!, b: r.b! }));
      return false;
    }
    s.commit(r.project);
    set({ lastRoute: null });
    s.notify(r.merged ? t('toast.wireMerged', { a: r.merged, b: r.net }) : t('toast.wireAdded', { a: `${a.ref}.${a.name}`, b: `${b.ref}.${b.name}`, net: r.net }));
    return true;
  },
  disconnectSchPin: (pin) => {
    const s = get();
    const r = disconnectPin(s.project, pin);
    if (!r) return;
    s.commit(r.project);
    set({ lastRoute: null });
    s.notify(t('toast.wireRemoved', { pin: `${pin.ref}.${pin.name}`, net: r.net }));
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

// 자동 저장
useStore.subscribe((s, prev) => {
  if (s.project !== prev.project) save('ezboard.project', s.project);
  if (s.messages !== prev.messages) save('ezboard.chat', s.messages.slice(-60));
});
