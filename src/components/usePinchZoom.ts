import { useRef } from 'react';

type VB = { x: number; y: number; w: number; h: number };

/** 두 손가락으로 확대/축소 + 이동 (터치 화면용). svg 요소에 캡처 단계 핸들러로 붙인다 */
export function usePinchZoom(
  toSvg: (p: { clientX: number; clientY: number }) => { x: number; y: number },
  setVb: (f: (v: VB) => VB) => void,
  onStart: () => void,
) {
  const pts = useRef(new Map<number, { x: number; y: number }>());
  const last = useRef<{ d: number; mx: number; my: number } | null>(null);

  const measure = () => {
    const [a, b] = [...pts.current.values()];
    return { d: Math.hypot(a.x - b.x, a.y - b.y), mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 };
  };
  const end = (e: React.PointerEvent) => {
    pts.current.delete(e.pointerId);
    if (pts.current.size < 2) last.current = null;
  };

  return {
    onPointerDownCapture: (e: React.PointerEvent) => {
      if (e.pointerType !== 'touch') return;
      pts.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pts.current.size === 2) {
        onStart();
        last.current = measure();
        e.stopPropagation();
      }
    },
    onPointerMoveCapture: (e: React.PointerEvent) => {
      if (!pts.current.has(e.pointerId)) return;
      pts.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pts.current.size !== 2 || !last.current) return;
      e.stopPropagation();
      const now = measure();
      const prev = last.current;
      const k = prev.d / Math.max(1, now.d);
      const pPrev = toSvg({ clientX: prev.mx, clientY: prev.my });
      const pNow = toSvg({ clientX: now.mx, clientY: now.my });
      setVb((v) => {
        const w = Math.min(600, Math.max(8, v.w * k));
        const f = w / v.w;
        // 손가락 중심점은 같은 위치에 머물고, 중심 이동만큼 화면도 이동
        const x = pPrev.x - (pPrev.x - v.x) * f - (pNow.x - pPrev.x);
        const y = pPrev.y - (pPrev.y - v.y) * f - (pNow.y - pPrev.y);
        return { x, y, w, h: v.h * f };
      });
      last.current = now;
    },
    onPointerUpCapture: end,
    onPointerCancelCapture: end,
  };
}
