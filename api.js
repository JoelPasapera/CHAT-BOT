// Cliente del gateway. El front no sabe de proveedores ni keys: solo habla
// OpenAI-compatible con el Worker, que ya enruta e inyecta credenciales.

import { CONFIG } from './config.js';

function headers(extra = {}) {
  const h = { 'Content-Type': 'application/json', ...extra };
  if (CONFIG.APP_TOKEN) h['X-App-Token'] = CONFIG.APP_TOKEN;
  return h;
}

function friendly(status, detail) {
  const d = detail ? ` (${String(detail).slice(0, 200)})` : '';
  if (status === 401) return `El gateway pidió autenticación${d}. Revisa APP_TOKEN o la key del proveedor.`;
  if (status === 402) return `Saldo/crédito agotado en el proveedor${d}.`;
  if (status === 403) return `Acceso denegado por el proveedor${d}.`;
  if (status === 404) return `Ruta o modelo no encontrado${d}.`;
  if (status === 429) return `Límite de peticiones alcanzado${d}. Espera un momento y reintenta.`;
  if (status === 501) return `Ese proveedor no está configurado en el Worker${d}.`;
  if (status === 502) return `El gateway no pudo contactar al proveedor${d}.`;
  if (status === 400) return `El modelo rechazó la solicitud (400)${d}. Si adjuntaste imagen, prueba un modelo con 👁.`;
  if (status >= 500) return `Error del servicio (${status})${d}. Reintenta o cambia de modelo.`;
  return `Error ${status}${d}.`;
}

// Lista de modelos: [{ id: "proveedor/modelo", vision: bool, label: string }]
export async function listModels() {
  const r = await fetch(`${CONFIG.GATEWAY_URL}/v1/models`, { headers: headers() });
  if (!r.ok) throw new Error(`No se pudo cargar la lista de modelos (${r.status}).`);
  const data = await r.json();
  return (data.data || []).map((m) => ({
    id: m.id,
    vision: !!m.vision,
    label: m.label || m.id,
  }));
}

// Chat con streaming. onDelta(chunkDeTexto) por cada fragmento.
export async function streamChat(messages, model, { onDelta, signal }) {
  const res = await fetch(`${CONFIG.GATEWAY_URL}/v1/chat/completions`, {
    method: 'POST',
    headers: headers(),
    signal,
    body: JSON.stringify({ model, messages, stream: true }),
  });

  if (!res.ok) {
    let detail = '';
    try {
      const j = await res.json();
      detail = (j.error && j.error.message) || j.message || '';
    } catch (_) {
      try { detail = await res.text(); } catch (__) { /* noop */ }
    }
    const e = new Error(friendly(res.status, detail));
    e.handled = true;
    throw e;
  }

  const ct = res.headers.get('content-type') || '';
  // Si el proveedor ignora stream y devuelve JSON normal, lo procesamos igual.
  if (!ct.includes('text/event-stream') || !res.body) {
    const data = await res.json();
    onDelta((((data.choices || [])[0] || {}).message || {}).content || '');
    return;
  }

  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let nl;
    while ((nl = buf.indexOf('\n')) !== -1) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line.startsWith('data:')) continue;
      const payload = line.slice(5).trim();
      if (payload === '[DONE]') return;
      try {
        const j = JSON.parse(payload);
        const d = (((j.choices || [])[0] || {}).delta || {}).content;
        if (d) onDelta(d);
      } catch (_) { /* keepalive o fragmento parcial */ }
    }
  }
}
