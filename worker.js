/**
 * mini-chat gateway  ·  Cloudflare Worker
 * =======================================
 * Pasarela OpenAI-compatible que vive "en otro lugar" (no en la pagina, no en
 * tu maquina). Hace tres cosas y nada mas:
 *
 *   1. Esconde las API keys (van como secrets del Worker, nunca en el navegador).
 *   2. Resuelve CORS para que la pagina estatica pueda llamarla desde el navegador.
 *   3. Enruta: el modelo llega como "proveedor/modelo" (ej. "gemini/gemini-2.5-flash"),
 *      el Worker mira el prefijo, inyecta la key del proveedor correcto y reenvia.
 *
 * NO hace inferencia. Solo reenvia bytes. Todo el "pensar" ocurre en el proveedor.
 *
 * Anadir un proveedor nuevo = anadir una entrada a PROVIDERS + un secret. Nada mas.
 * El front-end se entera solo: /v1/models solo lista proveedores que tengan key.
 *
 * Endpoints expuestos (OpenAI-compatible):
 *   GET  /v1/models            -> modelos usables (segun los secrets configurados)
 *   POST /v1/chat/completions  -> chat (texto y vision), soporta stream
 *   GET  /health               -> { ok: true }
 *
 * Secrets (npx wrangler secret put NOMBRE):
 *   GEMINI_API_KEY    (recomendado · vision · gratis en aistudio.google.com/apikey)
 *   POLLINATIONS_KEY  (opcional · vision alternativa · enter.pollinations.ai)
 *   OPENROUTER_KEY    (opcional · 300+ modelos · openrouter.ai)
 *   LLM7_TOKEN        (opcional · si falta, usa el nivel anonimo "unused")
 *   APP_TOKEN         (opcional · anti-abuso · debe coincidir con el front)
 * Vars (wrangler.toml):
 *   ALLOWED_ORIGIN    "*" o tu dominio, ej "https://c48484518.github.io"
 */

// ---------------------------------------------------------------------------
// Registro de proveedores. Editar aqui para anadir/quitar/cambiar modelos.
// "vision: true" = el modelo acepta imagenes (el front lo marca con 👁).
// "keyless: true" = no necesita key (se llama directo, gratis).
// ---------------------------------------------------------------------------
const PROVIDERS = {
  gemini: {
    baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai',
    keyEnv: 'GEMINI_API_KEY',
    models: [
      { id: 'gemini-2.5-flash', vision: true, label: 'Gemini 2.5 Flash · visión' },
      { id: 'gemini-2.0-flash', vision: true, label: 'Gemini 2.0 Flash · visión' },
    ],
  },

  llm7: {
    baseURL: 'https://api.llm7.io/v1',
    keyEnv: 'LLM7_TOKEN',
    keyless: true, // si no hay LLM7_TOKEN, usa "unused" (nivel anonimo)
    models: [
      { id: 'qwen3-235b',        vision: false, label: 'Qwen3 235B · potente' },
      { id: 'mistral-small-3.2', vision: false, label: 'Mistral Small 3.2' },
      { id: 'codestral-latest',  vision: false, label: 'Codestral · código' },
    ],
  },

  pollinations: {
    baseURL: 'https://gen.pollinations.ai/v1',
    keyEnv: 'POLLINATIONS_KEY',
    models: [
      { id: 'openai', vision: true, label: 'Pollinations · GPT (visión)' },
      { id: 'gemini', vision: true, label: 'Pollinations · Gemini (visión)' },
    ],
  },

  openrouter: {
    baseURL: 'https://openrouter.ai/api/v1',
    keyEnv: 'OPENROUTER_KEY',
    models: [
      // Ejemplos. Edita libremente con cualquier modelo de openrouter.ai/models.
      { id: 'meta-llama/llama-3.3-70b-instruct', vision: false, label: 'Llama 3.3 70B' },
      { id: 'google/gemini-2.0-flash-001',       vision: true,  label: 'OR · Gemini 2.0 Flash (visión)' },
    ],
  },
};

// ---------------------------------------------------------------------------
// CORS
// ---------------------------------------------------------------------------
function pickOrigin(env, reqOrigin) {
  const allow = (env.ALLOWED_ORIGIN || '*').trim();
  if (allow === '*') return '*';
  const list = allow.split(',').map((s) => s.trim()).filter(Boolean);
  if (reqOrigin && list.includes(reqOrigin)) return reqOrigin;
  return list[0] || '*';
}

function corsHeaders(origin) {
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-App-Token',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin',
  };
}

function json(obj, status, cors) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json', ...cors },
  });
}

// ---------------------------------------------------------------------------
// /v1/models  -> solo proveedores con key configurada (o keyless)
// ---------------------------------------------------------------------------
function listModels(env) {
  const data = [];
  for (const [name, p] of Object.entries(PROVIDERS)) {
    const hasKey = p.keyless || !!env[p.keyEnv];
    if (!hasKey) continue;
    for (const m of p.models) {
      data.push({
        id: `${name}/${m.id}`,
        object: 'model',
        created: 0,
        owned_by: name,
        vision: !!m.vision,
        label: m.label || m.id,
      });
    }
  }
  return { object: 'list', data };
}

// ---------------------------------------------------------------------------
// /v1/chat/completions  -> enruta + inyecta key + passthrough (stream o json)
// ---------------------------------------------------------------------------
async function handleChat(request, env, cors) {
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: { message: 'Cuerpo JSON inválido.' } }, 400, cors);
  }

  const requested = String(body.model || '');
  const slash = requested.indexOf('/');
  if (slash < 0) {
    return json({ error: { message: `El modelo debe ser "proveedor/modelo" (recibido: "${requested}").` } }, 400, cors);
  }

  const providerName = requested.slice(0, slash);
  const bareModel = requested.slice(slash + 1);
  const p = PROVIDERS[providerName];
  if (!p) {
    return json({ error: { message: `Proveedor desconocido: "${providerName}".` } }, 400, cors);
  }

  const key = p.keyless ? (env[p.keyEnv] || 'unused') : env[p.keyEnv];
  if (!p.keyless && !key) {
    return json({ error: { message: `Proveedor "${providerName}" no configurado (falta el secret ${p.keyEnv}).` } }, 501, cors);
  }

  // Reescribe el modelo a su nombre real (sin el prefijo del proveedor)
  body.model = bareModel;

  const headers = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${key}`,
  };
  if (providerName === 'openrouter') {
    headers['HTTP-Referer'] = env.OPENROUTER_REFERER || 'https://mini-chat.local';
    headers['X-Title'] = 'mini-chat';
  }

  let upstream;
  try {
    upstream = await fetch(`${p.baseURL}/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });
  } catch (e) {
    return json({ error: { message: `Fallo al contactar el proveedor: ${e.message}` } }, 502, cors);
  }

  // Passthrough: sirve el cuerpo tal cual (stream SSE o JSON) con cabeceras CORS
  const respHeaders = new Headers(cors);
  const ct = upstream.headers.get('Content-Type');
  if (ct) respHeaders.set('Content-Type', ct);
  return new Response(upstream.body, { status: upstream.status, headers: respHeaders });
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get('Origin') || '';
    const cors = corsHeaders(pickOrigin(env, origin));

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors });
    }

    // Anti-abuso opcional: si hay APP_TOKEN, exige cabecera X-App-Token igual.
    if (env.APP_TOKEN && request.headers.get('X-App-Token') !== env.APP_TOKEN) {
      return json({ error: { message: 'X-App-Token inválido o ausente.' } }, 401, cors);
    }

    if (url.pathname === '/health') {
      return json({ ok: true }, 200, cors);
    }
    if (url.pathname === '/v1/models' && request.method === 'GET') {
      return json(listModels(env), 200, cors);
    }
    if (url.pathname === '/v1/chat/completions' && request.method === 'POST') {
      return handleChat(request, env, cors);
    }
    return json({ error: { message: 'No encontrado.' } }, 404, cors);
  },
};
