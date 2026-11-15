// 회로도에서 핀을 끌어다 놓아 연결하거나 끊기. 넷(연결 목록)을 고치는 순수 함수.
import type { Net, Project } from '../types';
import { resolvePin } from './library';
import { netKind } from './schematic';

export type PinId = { ref: string; name: string };

export type ConnectResult =
  | { ok: true; project: Project; net: string; merged?: string }
  | { ok: false; reason: 'same' | 'samePin' | 'short'; a?: string; b?: string };

const key = (p: PinId) => `${p.ref}.${p.name}`;
const samePad = (project: Project, pinRef: string, p: PinId) => {
  const pad = resolvePin(project.parts, pinRef)[0];
  return !!pad && pad.ref.toLowerCase() === p.ref.toLowerCase() && pad.pin.toLowerCase() === p.name.toLowerCase();
};

/** 이 핀이 속한 넷 */
export function netOfPin(project: Project, p: PinId): Net | undefined {
  return project.nets.find((n) => n.pins.some((x) => samePad(project, x, p)));
}

/** 바뀐 넷의 PCB 배선은 다시 해야 하므로 지운다 */
function dropTracks(p: Project, names: string[]): Project {
  const s = new Set(names);
  return { ...p, tracks: p.tracks.filter((t) => !s.has(t.net)), vias: p.vias.filter((v) => !s.has(v.net)) };
}

function newNetName(nets: Net[]): string {
  const used = new Set(nets.map((n) => n.name.toLowerCase()));
  for (let i = 1; ; i++) if (!used.has(`net${i}`)) return `NET${i}`;
}

/** 전원·접지끼리 서로 다른 넷을 이으면 합선이다 */
const isRail = (name: string) => netKind(name) !== 'signal';

export function connectPins(project: Project, a: PinId, b: PinId): ConnectResult {
  if (key(a) === key(b)) return { ok: false, reason: 'samePin' };
  const na = netOfPin(project, a);
  const nb = netOfPin(project, b);
  if (na && nb && na.name === nb.name) return { ok: false, reason: 'same', a: na.name };

  if (!na && !nb) {
    const name = newNetName(project.nets);
    return { ok: true, net: name, project: { ...project, nets: [...project.nets, { name, pins: [key(a), key(b)] }] } };
  }
  if (na && !nb || !na && nb) {
    const net = (na ?? nb)!;
    const add = na ? b : a;
    const nets = project.nets.map((n) => (n.name === net.name ? { ...n, pins: [...n.pins, key(add)] } : n));
    return { ok: true, net: net.name, project: dropTracks({ ...project, nets }, [net.name]) };
  }

  // 서로 다른 두 넷을 하나로 합친다
  if (isRail(na!.name) && isRail(nb!.name)) return { ok: false, reason: 'short', a: na!.name, b: nb!.name };
  // 이름은 전원/접지 쪽, 아니면 끌기 시작한 쪽을 남긴다
  const [keep, gone] = isRail(nb!.name) ? [nb!, na!] : [na!, nb!];
  const nets = project.nets
    .filter((n) => n.name !== gone.name)
    .map((n) => (n.name === keep.name ? { ...n, pins: [...n.pins, ...gone.pins] } : n));
  return { ok: true, net: keep.name, merged: gone.name, project: dropTracks({ ...project, nets }, [keep.name, gone.name]) };
}

/** 핀 하나를 연결에서 뺀다. 핀이 하나만 남은 넷은 의미가 없으니 지운다 */
export function disconnectPin(project: Project, p: PinId): { project: Project; net: string } | null {
  const net = netOfPin(project, p);
  if (!net) return null;
  const nets = project.nets
    .map((n) => (n.name === net.name ? { ...n, pins: n.pins.filter((x) => !samePad(project, x, p)) } : n))
    .filter((n) => n.pins.length > 1);
  return { net: net.name, project: dropTracks({ ...project, nets }, [net.name]) };
}
