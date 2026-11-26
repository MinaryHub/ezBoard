// 회로도 / PCB 캔버스 SVG → SVG 파일 또는 고해상도 PNG 파일로 내보내기
import { saveFile } from './platform';

const EXPORT_CSS = `
text { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
.sch-text { font-family: "IBM Plex Mono", ui-monospace, Menlo, monospace; }
.sch-text.bold { font-weight: 600; }
.part-value { fill: #e6e7ea; font-family: "IBM Plex Mono", ui-monospace, Menlo, monospace; paint-order: stroke; stroke: #0d2b22; stroke-width: 0.35px; stroke-linejoin: round; }
.pad-label { fill: #ffffff; font-family: "IBM Plex Mono", ui-monospace, Menlo, monospace; font-weight: 600; paint-order: stroke; stroke: #111; stroke-width: 0.2px; }
.dim-label { fill: #8a8f98; font-family: "IBM Plex Mono", ui-monospace, Menlo, monospace; }
`;

function buildStandaloneSvg(svg: SVGSVGElement, bg: string): { markup: string; width: number; height: number } {
  const clone = svg.cloneNode(true) as SVGSVGElement;
  const vb = (svg.getAttribute('viewBox') || '0 0 100 100').trim().split(/\s+/).map(Number);
  const [vx, vy, vw, vh] = vb.length === 4 && vb.every(Number.isFinite) ? vb : [0, 0, 100, 100];
  const rect = svg.getBoundingClientRect();
  const ratio = vw / Math.max(1e-3, vh);
  const targetW = Math.min(2400, Math.max(1200, Math.round(rect.width * 2) || 1600));
  const targetH = Math.max(400, Math.round(targetW / ratio));

  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  clone.setAttribute('width', String(targetW));
  clone.setAttribute('height', String(targetH));
  clone.setAttribute('viewBox', `${vx} ${vy} ${vw} ${vh}`);

  const style = document.createElementNS('http://www.w3.org/2000/svg', 'style');
  style.textContent = EXPORT_CSS;
  clone.insertBefore(style, clone.firstChild);

  const bgRect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
  bgRect.setAttribute('x', String(vx));
  bgRect.setAttribute('y', String(vy));
  bgRect.setAttribute('width', String(vw));
  bgRect.setAttribute('height', String(vh));
  bgRect.setAttribute('fill', bg);
  clone.insertBefore(bgRect, style.nextSibling);

  const markup = '<?xml version="1.0" encoding="UTF-8"?>\n' + new XMLSerializer().serializeToString(clone);
  return { markup, width: targetW, height: targetH };
}

export async function exportCanvasSvg(svg: SVGSVGElement, fileName: string, bg: string): Promise<void> {
  const { markup } = buildStandaloneSvg(svg, bg);
  await saveFile(new Blob([markup], { type: 'image/svg+xml;charset=utf-8' }), fileName);
}

export async function exportCanvasPng(svg: SVGSVGElement, fileName: string, bg: string): Promise<void> {
  const { markup, width, height } = buildStandaloneSvg(svg, bg);
  const blob = new Blob([markup], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('SVG image render failed'));
      el.src = url;
    });
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D unavailable');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(img, 0, 0, width, height);
    const png = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('PNG encode failed'))), 'image/png');
    });
    await saveFile(png, fileName);
  } finally {
    URL.revokeObjectURL(url);
  }
}
