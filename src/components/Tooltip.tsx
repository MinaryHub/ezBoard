import { useEffect, useRef, useState } from 'react';

/**
 * 초보자용 설명 풍선. data-tip 속성이 있는 요소에 마우스를 잠시 올리면 설명이 나타난다.
 * (터치 화면에서는 마우스 호버가 없으므로 표시하지 않는다)
 */
export default function Tooltip() {
  const [tip, setTip] = useState<{ text: string; x: number; y: number; below: boolean } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const current = useRef<Element | null>(null);

  useEffect(() => {
    const hide = () => { clearTimeout(timer.current); current.current = null; setTip(null); };
    const schedule = (el: Element, delay: number) => {
      current.current = el;
      timer.current = setTimeout(() => {
        const text = el.getAttribute('data-tip');
        if (!text || !document.body.contains(el)) return;
        const r = el.getBoundingClientRect();
        const below = r.top < 120;
        setTip({ text, x: r.left + r.width / 2, y: below ? r.bottom + 8 : r.top - 8, below });
      }, delay);
    };
    const onOver = (e: PointerEvent) => {
      if (e.pointerType === 'touch') return;
      const el = (e.target as Element | null)?.closest?.('[data-tip]');
      if (el === current.current) return;
      hide();
      if (el) schedule(el, 450);
    };
    const onFocusIn = (e: FocusEvent) => {
      const el = (e.target as Element | null)?.closest?.('[data-tip]');
      if (!el || el === current.current) return;
      hide();
      schedule(el, 350);
    };
    const onKeyDown = (e: KeyboardEvent) => { if (e.key === 'Escape') hide(); };
    // 설명 대상이 들어 있는 영역이 스크롤될 때만 숨긴다 (채팅 자동 스크롤 등은 무시)
    const onScroll = (e: Event) => {
      const target = e.target as Node | null;
      if (current.current && target && (target === document || target.contains?.(current.current))) hide();
    };
    window.addEventListener('pointerover', onOver);
    window.addEventListener('pointerdown', hide, true);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('focusin', onFocusIn);
    window.addEventListener('focusout', hide);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('blur', hide);
    document.documentElement.addEventListener('pointerleave', hide);
    return () => {
      window.removeEventListener('pointerover', onOver);
      window.removeEventListener('pointerdown', hide, true);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('focusin', onFocusIn);
      window.removeEventListener('focusout', hide);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('blur', hide);
      document.documentElement.removeEventListener('pointerleave', hide);
      clearTimeout(timer.current);
    };
  }, []);

  if (!tip) return null;
  const estWidth = Math.min(280, Math.max(96, tip.text.length * 9 + 24));
  const left = Math.max(8, Math.min(window.innerWidth - estWidth - 8, tip.x - estWidth / 2));
  return (
    <div
      className={`tooltip ${tip.below ? 'below' : 'above'}`}
      role="tooltip"
      style={{ left, top: tip.y, maxWidth: 280 }}
    >
      {tip.text}
    </div>
  );
}
