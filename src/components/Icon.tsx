// 선 아이콘 모음 (24 그리드, 1.6 굵기). Kreate 리본처럼 글자 위에 놓는 용도.
const P: Record<string, string> = {
  schematic: 'M3 12h4l2-4 3 8 2-4h7M3 6h2M3 18h2M19 6h2M19 18h2',
  pcb: 'M4 4h16v16H4zM8 8h3v3H8zM13 13h3v3h-3zM11 9.5h4.5V13M8 16h2',
  tidy: 'M14 4l6 6M9 9l6 6-5 5H5v-5zM5 15l4 4',
  place: 'M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 17h6M17 14v6',
  route: 'M13 3L5 14h6l-1 7 8-11h-6z',
  clear: 'M4 20h16M7 16l9-9 3 3-9 9H7zM13 7l3 3',
  edit: 'M4 17V7l8-4 8 4v10l-8 4zM4 7l8 4 8-4M12 11v10',
  real: 'M2.5 12s3.5-6.5 9.5-6.5S21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12zM12 9a3 3 0 100 6 3 3 0 000-6z',
  layerTop: 'M12 3l9 5-9 5-9-5zM3 13l9 5 9-5',
  layerBottom: 'M3 11l9 5 9-5M12 16v0M12 6l9 5-9 5-9-5zM3 16l9 5 9-5',
  labels: 'M5 6h14M12 6v13M9 19h6',
  rats: 'M5 18L19 6M5 18h.01M19 6h.01M8 15.5l1.5-1.2M12 12l1.5-1.2M15.5 9.2L17 8',
  new: 'M6 3h8l4 4v14H6zM14 3v4h4M12 11v6M9 14h6',
  open: 'M3 7h6l2 2h10v10H3zM3 7V5h6',
  save: 'M5 3h11l3 3v15H5zM8 3v5h7V3M8 21v-7h8v7',
  undo: 'M9 14L4 9l5-5M4 9h10a6 6 0 010 12h-3',
  redo: 'M15 14l5-5-5-5M20 9H10a6 6 0 000 12h3',
  settings: 'M12 9a3 3 0 100 6 3 3 0 000-6zM19.4 15a1.7 1.7 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.8-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 11-4 0v-.1a1.7 1.7 0 00-1.1-1.5 1.7 1.7 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.8 1.7 1.7 0 00-1.5-1H3a2 2 0 110-4h.1a1.7 1.7 0 001.5-1.1 1.7 1.7 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.8.3H9a1.7 1.7 0 001-1.5V3a2 2 0 114 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.8V9a1.7 1.7 0 001.5 1H21a2 2 0 110 4h-.1a1.7 1.7 0 00-1.5 1z',
  globe: 'M12 3a9 9 0 100 18 9 9 0 000-18zM3 12h18M12 3c2.5 2.5 3.5 5.5 3.5 9s-1 6.5-3.5 9c-2.5-2.5-3.5-5.5-3.5-9s1-6.5 3.5-9z',
  part: 'M7 4h10v16H7zM4 8h3M4 12h3M4 16h3M17 8h3M17 12h3M17 16h3',
  add: 'M12 5v14M5 12h14',
  nets: 'M6 6h.01M18 6h.01M6 18h.01M18 18h.01M6 6l12 12M18 6L6 18M9 12h6',
  check: 'M4 12l5 5L20 6',
  shield: 'M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6zM8.5 12l2.5 2.5 4.5-5',
  order: 'M3 7l9-4 9 4v10l-9 4-9-4zM3 7l9 4 9-4M12 11v10',
  send: 'M4 12l16-8-6 16-2-7z',
  trash: 'M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13',
  chat: 'M4 5h16v11H9l-5 4z',
  fit: 'M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5',
  chevron: 'M6 9l6 6 6-6',
  close: 'M6 6l12 12M18 6L6 18',
  rotate: 'M20 12a8 8 0 11-2.3-5.7M20 4v5h-5',
  sun: 'M12 8a4 4 0 100 8 4 4 0 000-8zM12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4',
  moon: 'M20 14.5A8 8 0 019.5 4 8 8 0 1020 14.5z',
  key: 'M14 4a6 6 0 11-5.2 9H8v3H5v3H2v-3.5l6.8-6.8A6 6 0 0114 4zM16 8h.01',
  heart: 'M12 20s-7.5-4.6-9.2-9.4C1.6 7.2 3.8 4 7 4c2 0 3.6 1.1 5 3 1.4-1.9 3-3 5-3 3.2 0 5.4 3.2 4.2 6.6C19.5 15.4 12 20 12 20z',
  help: 'M12 3a9 9 0 100 18 9 9 0 000-18zM9.5 9.3a2.6 2.6 0 015 .9c0 1.7-2.5 2.3-2.5 3.8M12 17h.01',
  issue: 'M12 3a9 9 0 100 18 9 9 0 000-18zM12 8v4M12 16h.01',
  download: 'M12 4v11M7 10l5 5 5-5M5 20h14',
};

export type IconName = keyof typeof P;

export default function Icon({ name, size = 18 }: { name: IconName; size?: number }) {
  return (
    <svg className="icon" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={P[name]} />
    </svg>
  );
}
