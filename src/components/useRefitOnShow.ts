import { useEffect, useRef, type RefObject } from 'react';

/** 캔버스가 숨겨져 있다가(크기 0) 보이게 되거나 크기가 크게 바뀌면 화면 맞추기를 다시 한다 */
export function useRefitOnShow(ref: RefObject<Element | null>, fit: () => void) {
  const fitRef = useRef(fit);
  fitRef.current = fit;
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let last = { w: 0, h: 0 };
    const ro = new ResizeObserver(([entry]) => {
      const { width: w, height: h } = entry.contentRect;
      const wasHidden = last.w < 10 || last.h < 10;
      const bigChange = Math.abs(w - last.w) > 120 || Math.abs(h - last.h) > 120;
      last = { w, h };
      if (w >= 10 && h >= 10 && (wasHidden || bigChange)) fitRef.current();
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
}
