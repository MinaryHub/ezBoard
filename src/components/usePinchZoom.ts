import { useEffect, useRef } from 'react';

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
  const drop = (id: number) => {
    if (!pts.current.delete(id)) return;
    last.current = pts.current.size === 2 ? measure() : null;
  };
  const end = (e: React.PointerEvent) => drop(e.pointerId);

  // 손가락이 SVG 밖에서 떨어지거나 브라우저가 취소해도 잔류 포인터가 남지 않게 전역 정리
  useEffect(() => {
    const onEnd = (e: PointerEvent) => drop(e.pointerId);
    const onBlur = () => { pts.current.clear(); last.current = null; };
    window.addEventListener('pointerup', onEnd);
    window.addEventListener('pointercancel', onEnd);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('pointerup', onEnd);
      window.removeEventListener('pointercancel', onEnd);
      window.removeEventListener('blur', onBlur);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return {
    onPointerDownCapture: (e: React.PointerEvent) => {
      if (e.pointerType !== 'touch') return;
      pts.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pts.current.size === 2) {
        onStart();
        last.current = measure();
        e.stopPropagation();
      } else if (pts.current.size > 2) {
        last.current = null;
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
        // 이전 중심 세계 좌표 pPrev가 새 viewBox에서도 현재 손가락 중심 pNow 아래에 머물도록 계산
        const x = pPrev.x - (pNow.x - v.x) * f;
        const y = pPrev.y - (pNow.y - v.y) * f;
        return { x, y, w, h: v.h * f };
      });
      last.current = now;
    },
    onPointerUpCapture: end,
    onPointerCancelCapture: end,
  };
}
