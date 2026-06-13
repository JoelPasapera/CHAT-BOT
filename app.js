// Orquestador. Une config + api + image + markdown con la interfaz.

import { CONFIG } from './config.js';
import { listModels, streamChat } from './api.js';
import { resizeImage } from './image.js';
import { renderMarkdown, stripThink, hasOpenThink } from './markdown.js';

// ------------------------- Estado -------------------------
const history = [];        // [{role, content}] content = string | bloques[]
let attachedImages = [];   // [{ dataUrl, name }]
let modelsMap = {};        // id -> { id, vision, label }
let currentModel = null;
let isBusy = false;
let abortController = null;

// ------------------------- DOM -------------------------
const $ = (id) => document.getElementById(id);
const messagesEl  = $('messages');
const inputEl     = $('input');
const sendBtn     = $('sendBtn');
const newChatBtn  = $('newChatBtn');
const modelEl     = $('modelSelect');
const dotEl       = $('statusDot');
const visionBadge = $('visionBadge');
const attachBtn   = $('attachBtn');
const fileInput   = $('fileInput');
const imgPreview  = $('imgPreviewArea');
const imgModal    = $('imgModal');
const imgModalImg = $('imgModalImg');

// ------------------------- Modelos -------------------------
async function loadModels() {
  let models;
  try {
    models = await listModels();
  } catch (e) {
    showError(`${e.message} Revisa GATEWAY_URL en assets/config.js y que el Worker esté desplegado.`);
    modelEl.innerHTML = '<option>sin conexión con el gateway</option>';
    return;
  }
  if (!models.length) {
    showError('El gateway no devolvió modelos. Configura al menos un proveedor (secret) en el Worker.');
    modelEl.innerHTML = '<option>sin modelos configurados</option>';
    return;
  }

  // Visión primero, luego alfabético
  models.sort((a, b) => (b.vision ? 1 : 0) - (a.vision ? 1 : 0) || a.id.localeCompare(b.id));

  modelsMap = {};
  modelEl.innerHTML = '';
  for (const m of models) {
    modelsMap[m.id] = m;
    const opt = document.createElement('option');
    opt.value = m.id;
    opt.textContent = (m.vision ? '👁 ' : '') + m.label;
    modelEl.appendChild(opt);
  }

  const firstVision = models.find((m) => m.vision);
  currentModel = (firstVision || models[0]).id;
  modelEl.value = currentModel;
  updateVisionBadge();
}

function currentModelVision() {
  return !!(modelsMap[currentModel] && modelsMap[currentModel].vision);
}

function updateVisionBadge() {
  const v = currentModelVision();
  visionBadge.classList.toggle('active', v);
  attachBtn.disabled = !v || isBusy;
  attachBtn.title = v ? 'Adjuntar imagen' : 'Este modelo no acepta imágenes';
}

modelEl.addEventListener('change', () => {
  currentModel = modelEl.value;
  updateVisionBadge();
  if (!currentModelVision() && attachedImages.length) {
    clearImages();
    showError('Cambiaste a un modelo de solo texto: quité las imágenes adjuntas.');
  }
});

// ------------------------- UI de mensajes -------------------------
function removeEmptyHint() { const e = $('emptyHint'); if (e) e.remove(); }
function scrollDown() { messagesEl.scrollTop = messagesEl.scrollHeight; }

function showError(text) {
  const el = document.createElement('div');
  el.className = 'msg error';
  el.textContent = text;
  messagesEl.appendChild(el);
  scrollDown();
}

function renderUserMessage(text, imgs) {
  const el = document.createElement('div');
  el.className = 'msg user';
  if (imgs.length) {
    const row = document.createElement('div');
    row.className = 'imgs';
    for (const im of imgs) {
      const img = document.createElement('img');
      img.className = 'chat-img';
      img.src = im.dataUrl;
      img.alt = im.name || 'imagen';
      img.addEventListener('click', () => openModal(im.dataUrl));
      row.appendChild(img);
    }
    el.appendChild(row);
  }
  if (text) {
    const cap = document.createElement('div');
    cap.className = 'img-caption';
    cap.textContent = text;
    el.appendChild(cap);
  }
  messagesEl.appendChild(el);
  scrollDown();
}

function copyText(t) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(t).catch(() => fallbackCopy(t));
  } else {
    fallbackCopy(t);
  }
}
function fallbackCopy(t) {
  const ta = document.createElement('textarea');
  ta.value = t;
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.select();
  try { document.execCommand('copy'); } catch (_) { /* noop */ }
  ta.remove();
}

function attachCodeCopiers(scope) {
  scope.querySelectorAll('pre.md-pre').forEach((pre) => {
    const btn = pre.querySelector('.code-copy');
    if (!btn || btn.dataset.wired) return;
    btn.dataset.wired = '1';
    btn.addEventListener('click', () => {
      const code = pre.querySelector('code');
      copyText(code ? code.innerText : '');
      btn.textContent = 'copiado';
      btn.classList.add('done');
      setTimeout(() => { btn.textContent = 'copiar'; btn.classList.remove('done'); }, 1400);
    });
  });
}

function createBotMessage() {
  const wrap = document.createElement('div');
  wrap.className = 'msg bot';
  const body = document.createElement('div');
  body.className = 'md';
  wrap.appendChild(body);
  messagesEl.appendChild(wrap);
  scrollDown();

  return {
    render(raw) {
      const open = hasOpenThink(raw);
      const disp = stripThink(raw);
      let html = disp ? renderMarkdown(disp) : '';
      if (open) html = '<span class="thinking-pill">razonando…</span>' + (html ? '<br>' + html : '');
      body.innerHTML = html || '<span class="thinking-pill">…</span>';
    },
    finalize(text) {
      body.innerHTML = renderMarkdown(text);
      attachCodeCopiers(body);
      const copy = document.createElement('button');
      copy.className = 'msg-copy';
      copy.type = 'button';
      copy.textContent = 'copiar';
      copy.addEventListener('click', () => {
        copyText(text);
        copy.textContent = 'copiado';
        copy.classList.add('done');
        setTimeout(() => { copy.textContent = 'copiar'; copy.classList.remove('done'); }, 1400);
      });
      wrap.appendChild(copy);
      scrollDown();
    },
    remove() { wrap.remove(); },
  };
}

// ------------------------- Ocupado / historial -------------------------
function setBusy(busy) {
  isBusy = busy;
  dotEl.classList.toggle('busy', busy);
  attachBtn.disabled = busy || !currentModelVision();
  sendBtn.textContent = busy ? 'Detener' : 'Enviar';
  sendBtn.classList.toggle('stop', busy);
}

function trimHistory() {
  if (history.length > CONFIG.HISTORY_LIMIT) {
    history.splice(0, history.length - CONFIG.HISTORY_LIMIT);
  }
  while (history.length && history[0].role !== 'user') history.shift();
}

// ------------------------- Imágenes -------------------------
async function handleFiles(fileList) {
  if (!currentModelVision()) {
    showError('Este modelo no acepta imágenes. Elige uno marcado con 👁.');
    return;
  }
  const files = Array.from(fileList).filter((f) => f.type.startsWith('image/'));
  if (!files.length) {
    showError('Solo se pueden adjuntar imágenes (JPG, PNG, GIF, WebP…).');
    return;
  }
  for (const f of files) {
    if (attachedImages.length >= CONFIG.MAX_IMAGES) {
      showError(`Máximo ${CONFIG.MAX_IMAGES} imágenes por mensaje.`);
      break;
    }
    try {
      attachedImages.push(await resizeImage(f, { maxDim: CONFIG.MAX_DIM, quality: CONFIG.JPEG_QUALITY }));
    } catch (e) {
      showError(e.message);
    }
  }
  renderPreviews();
}

function renderPreviews() {
  imgPreview.innerHTML = '';
  attachedImages.forEach((im, idx) => {
    const wrap = document.createElement('div');
    wrap.className = 'thumb-wrap';
    const img = document.createElement('img');
    img.className = 'img-thumb';
    img.src = im.dataUrl;
    img.alt = im.name;
    const x = document.createElement('button');
    x.className = 'thumb-x';
    x.type = 'button';
    x.textContent = '×';
    x.title = 'Quitar';
    x.addEventListener('click', () => { attachedImages.splice(idx, 1); renderPreviews(); });
    wrap.appendChild(img);
    wrap.appendChild(x);
    imgPreview.appendChild(wrap);
  });
  imgPreview.classList.toggle('active', attachedImages.length > 0);
}

function clearImages() {
  attachedImages = [];
  fileInput.value = '';
  renderPreviews();
}

// ------------------------- Adjuntar / arrastrar / pegar -------------------------
attachBtn.addEventListener('click', () => { if (!attachBtn.disabled) fileInput.click(); });
fileInput.addEventListener('change', (e) => { if (e.target.files.length) handleFiles(e.target.files); });

['dragenter', 'dragover', 'dragleave', 'drop'].forEach((evt) => {
  messagesEl.addEventListener(evt, prevent, false);
  document.body.addEventListener(evt, prevent, false);
});
function prevent(e) { e.preventDefault(); e.stopPropagation(); }

messagesEl.addEventListener('dragenter', () => { if (currentModelVision()) messagesEl.classList.add('drag-over'); });
messagesEl.addEventListener('dragleave', (e) => {
  if (e.relatedTarget && !messagesEl.contains(e.relatedTarget)) messagesEl.classList.remove('drag-over');
});
messagesEl.addEventListener('drop', (e) => {
  messagesEl.classList.remove('drag-over');
  if (e.dataTransfer.files.length) handleFiles(e.dataTransfer.files);
});

document.addEventListener('paste', (e) => {
  const items = e.clipboardData && e.clipboardData.items;
  if (!items) return;
  const imgFiles = [];
  for (const it of items) {
    if (it.type.startsWith('image/')) { const f = it.getAsFile(); if (f) imgFiles.push(f); }
  }
  if (imgFiles.length) { e.preventDefault(); handleFiles(imgFiles); }
});

// ------------------------- Modal -------------------------
function openModal(src) { imgModalImg.src = src; imgModal.classList.add('active'); }
imgModal.addEventListener('click', () => imgModal.classList.remove('active'));
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') imgModal.classList.remove('active'); });

// ------------------------- Envío -------------------------
async function send() {
  const text = inputEl.value.trim();
  const imgs = attachedImages.slice();
  if ((!text && !imgs.length) || isBusy || !currentModel) return;

  removeEmptyHint();

  let content;
  if (imgs.length) {
    const blocks = [];
    if (text) blocks.push({ type: 'text', text });
    for (const im of imgs) blocks.push({ type: 'image_url', image_url: { url: im.dataUrl } });
    content = blocks;
  } else {
    content = text;
  }

  history.push({ role: 'user', content });
  trimHistory();

  renderUserMessage(text, imgs);
  inputEl.value = '';
  autosize();
  clearImages();
  setBusy(true);

  const bot = createBotMessage();
  abortController = new AbortController();

  let raw = '';
  let scheduled = false;
  const flush = () => { scheduled = false; bot.render(raw); scrollDown(); };
  const onDelta = (chunk) => {
    raw += chunk;
    if (!scheduled) { scheduled = true; requestAnimationFrame(flush); }
  };

  try {
    await streamChat(
      [{ role: 'system', content: CONFIG.SYSTEM }, ...history],
      currentModel,
      { onDelta, signal: abortController.signal },
    );
    const finalText = stripThink(raw) || '(respuesta vacía)';
    bot.finalize(finalText);
    history.push({ role: 'assistant', content: finalText });
    trimHistory();
  } catch (err) {
    if (err.name === 'AbortError') {
      const partial = stripThink(raw);
      if (partial) { bot.finalize(partial); history.push({ role: 'assistant', content: partial }); trimHistory(); }
      else { bot.remove(); history.pop(); }
    } else {
      bot.remove();
      history.pop(); // no envenenar el contexto con un turno fallido
      showError(err.handled ? err.message : `Error: ${err.message || 'sin conexión con el gateway.'}`);
    }
  } finally {
    setBusy(false);
    abortController = null;
    inputEl.focus();
  }
}

// ------------------------- Input -------------------------
function autosize() {
  inputEl.style.height = 'auto';
  inputEl.style.height = Math.min(inputEl.scrollHeight, 160) + 'px';
}
inputEl.addEventListener('input', autosize);
inputEl.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
});

sendBtn.addEventListener('click', () => { if (isBusy) { if (abortController) abortController.abort(); } else { send(); } });

newChatBtn.addEventListener('click', () => {
  if (isBusy && abortController) abortController.abort();
  history.length = 0;
  clearImages();
  messagesEl.innerHTML =
    '<p class="empty" id="emptyHint">Conversación nueva.<br><br>' +
    'Escribe tu mensaje o <strong>arrastra una imagen</strong>.<br>' +
    'Los modelos con <span class="eye">👁</span> aceptan imágenes.</p>';
});

// ------------------------- Arranque -------------------------
loadModels();
autosize();
