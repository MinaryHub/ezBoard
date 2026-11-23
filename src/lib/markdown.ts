// 아주 작은 마크다운 렌더러 (AI 답변, 릴리스 노트)
function escapeHtml(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function formatInline(escaped: string): string {
  // 인라인 코드를 먼저 분리해 코드 내부의 **가 <b>로 깨지지 않게 한다
  const parts = escaped.split(/`([^`]+)`/);
  return parts
    .map((seg, idx) => (idx % 2 === 1 ? `<code>${seg}</code>` : seg.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')))
    .join('');
}

export function renderMarkdown(src: string): string {
  const blocks = src.replace(/\r\n/g, '\n').split(/```[^\n]*\n?/);
  return blocks
    .map((b, i) => {
      if (i % 2 === 1) return `<pre>${escapeHtml(b)}</pre>`;
      const lines = escapeHtml(b).split('\n');
      const out: string[] = [];
      let list: 'ul' | 'ol' | null = null;
      const close = () => { if (list) { out.push(`</${list}>`); list = null; } };
      for (const raw of lines) {
        const line = formatInline(raw);
        const ul = line.match(/^\s*[-*•]\s+(.*)/);
        const ol = line.match(/^\s*\d+[.)]\s+(.*)/);
        const h = line.match(/^#{1,6}\s+(.*)/);
        if (ul) { if (list !== 'ul') { close(); out.push('<ul>'); list = 'ul'; } out.push(`<li>${ul[1]}</li>`); }
        else if (ol) { if (list !== 'ol') { close(); out.push('<ol>'); list = 'ol'; } out.push(`<li>${ol[1]}</li>`); }
        else if (h) { close(); out.push(`<h4>${h[1]}</h4>`); }
        else if (line.trim() === '') { close(); out.push('<div class="gap"></div>'); }
        else { close(); out.push(`<p>${line}</p>`); }
      }
      close();
      return out.join('');
    })
    .join('');
}

