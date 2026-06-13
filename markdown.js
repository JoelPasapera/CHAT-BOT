// Renderizador de markdown mínimo y seguro (sin dependencias externas).
// Siempre escapa HTML; solo emite etiquetas conocidas; sanea los href.

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function sanitizeUrl(u) {
  try {
    const url = new URL(u, 'https://x.invalid');
    if (['http:', 'https:', 'mailto:'].includes(url.protocol)) return url.href;
  } catch (_) { /* noop */ }
  return '#';
}

function blockify(text) {
  const lines = text.split('\n');
  let html = '';
  let i = 0;
  const isPlaceholder = (l) => /^\u0000\d+\u0000$/.test(l.trim());
  const special = (l) =>
    l.trim() === '' ||
    /^(#{1,6})\s+/.test(l) ||
    /^\s*[-*+]\s+/.test(l) ||
    /^\s*\d+\.\s+/.test(l) ||
    isPlaceholder(l);

  while (i < lines.length) {
    const line = lines[i];

    if (isPlaceholder(line)) { html += line.trim(); i++; continue; }

    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) { html += `<h${h[1].length}>${h[2]}</h${h[1].length}>`; i++; continue; }

    if (/^\s*[-*+]\s+/.test(line)) {
      const items = [];
      while (i < lines.length && /^\s*[-*+]\s+/.test(lines[i])) {
        items.push('<li>' + lines[i].replace(/^\s*[-*+]\s+/, '') + '</li>');
        i++;
      }
      html += '<ul>' + items.join('') + '</ul>';
      continue;
    }

    if (/^\s*\d+\.\s+/.test(line)) {
      const items = [];
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
        items.push('<li>' + lines[i].replace(/^\s*\d+\.\s+/, '') + '</li>');
        i++;
      }
      html += '<ol>' + items.join('') + '</ol>';
      continue;
    }

    if (line.trim() === '') { i++; continue; }

    const buf = [];
    while (i < lines.length && !special(lines[i])) { buf.push(lines[i]); i++; }
    html += '<p>' + buf.join('<br>') + '</p>';
  }
  return html;
}

export function renderMarkdown(src) {
  const store = [];
  const stash = (h) => { const i = store.length; store.push(h); return `\u0000${i}\u0000`; };

  // bloques de código cercados
  src = src.replace(/```([^\n`]*)\n?([\s\S]*?)```/g, (m, lang, code) =>
    stash(`<pre class="md-pre"><button class="code-copy" type="button">copiar</button><code>${escapeHtml(code.replace(/\n$/, ''))}</code></pre>`));
  // enlaces
  src = src.replace(/\[([^\]\n]+)\]\(([^)\s]+)\)/g, (m, t, u) =>
    stash(`<a href="${sanitizeUrl(u)}" target="_blank" rel="noopener noreferrer">${escapeHtml(t)}</a>`));
  // código en línea
  src = src.replace(/`([^`\n]+)`/g, (m, c) => stash(`<code class="md-code">${escapeHtml(c)}</code>`));

  // escapar el resto
  src = escapeHtml(src);

  // negrita / cursiva
  src = src.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>').replace(/__([^_]+)__/g, '<strong>$1</strong>');
  src = src.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');
  src = src.replace(/(^|[^_\w])_([^_\n]+)_/g, '$1<em>$2</em>');

  // bloques
  src = blockify(src);

  // restaurar
  src = src.replace(/\u0000(\d+)\u0000/g, (m, i) => store[+i]);
  return src;
}

// --- Bloques <think> de modelos de razonamiento ---
export function hasOpenThink(t) {
  const o = (t.match(/<think>/gi) || []).length;
  const c = (t.match(/<\/think>/gi) || []).length;
  return o > c;
}

export function stripThink(t) {
  let s = t.replace(/<think>[\s\S]*?<\/think>/gi, '');
  const open = s.search(/<think>/i);
  if (open !== -1) s = s.slice(0, open);
  return s.trim();
}
