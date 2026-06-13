# mini-chat

Chatbot con visión (texto + imágenes), **gratis y sin registro para quien lo usa**,
con todo el cómputo de IA ocurriendo en proveedores externos.

## Cómo respeta la filosofía

- **Procesamiento remoto:** la inferencia ocurre en el proveedor (Gemini, LLM7, etc.).
  El navegador solo redimensiona la imagen antes de enviarla. El Worker solo reenvía
  bytes; no "piensa".
- **Sin registro para el usuario final:** nadie crea cuenta ni ve ninguna key. La key
  vive escondida como secret del Worker.
- **Gratis:** Cloudflare Workers (free) + nivel gratis del proveedor.
- **Modular:** front-end estático + un gateway. Cambiar de proveedor o modelo = editar
  un objeto en `worker.js`. El front-end se adapta solo.

## Arquitectura

```
navegador (GitHub Pages, estático)
        │   OpenAI-compatible (/v1/chat/completions, /v1/models)
        ▼
Cloudflare Worker  ──►  enruta "proveedor/modelo", inyecta la key, reenvía
        │
        ├─ gemini/…        (visión, key gratis de Google)
        ├─ llm7/…          (texto, sin key)
        ├─ pollinations/…  (visión, opcional)
        └─ openrouter/…    (300+ modelos, opcional)
```

El modelo viaja como `proveedor/modelo` (ej. `gemini/gemini-2.5-flash`). El Worker mira
el prefijo y decide a quién llamar. `/v1/models` solo lista proveedores cuya key esté
configurada, así la lista del front refleja lo que de verdad funciona.

## Puesta en marcha (≈10 min)

### 1. Consigue una key de visión (gratis)

Google AI Studio: https://aistudio.google.com/apikey → "Create API key". Sin tarjeta.
(Alternativas: Pollinations en enter.pollinations.ai, u OpenRouter en openrouter.ai.)

### 2. Despliega el Worker

> Todos los archivos van en **una sola carpeta** (sin subcarpetas). Desde ahí:

```bash
npx wrangler login
npx wrangler secret put GEMINI_API_KEY      # pega tu key cuando lo pida
npx wrangler deploy
```

Wrangler te dará una URL tipo `https://mini-chat-gateway.TU-SUBDOMINIO.workers.dev`.

Secrets opcionales (mismo comando, otro nombre):
- `POLLINATIONS_KEY`, `OPENROUTER_KEY` → más proveedores de visión.
- `LLM7_TOKEN` → texto con más límite (si falta, usa el nivel anónimo).
- `APP_TOKEN` → exige `X-App-Token` para frenar abuso (debe coincidir con el front).

Para bloquear orígenes ajenos, edita `ALLOWED_ORIGIN` en `wrangler.toml`
(ej. `"https://c48484518.github.io"`) y vuelve a `npx wrangler deploy`.

### 3. Conecta el front-end

En `config.js`, pon tu URL del Worker en `GATEWAY_URL`
(y `APP_TOKEN` si configuraste ese secret).

### 4. Publica el front-end

Sube los archivos del front-end (`index.html`, `styles.css` y los `.js`) a tu repo,
todos en la **misma carpeta**, y activa GitHub Pages. Listo.

> Los archivos `worker.js` y `wrangler.toml` son solo para desplegar con wrangler;
> no se sirven en la web (puedes dejarlos en la misma carpeta sin problema, no
> contienen ninguna key).

## Añadir o cambiar proveedores / modelos

Edita el objeto `PROVIDERS` en `worker.js`. Cada modelo:

```js
{ id: 'gemini-2.5-flash', vision: true, label: 'Gemini 2.5 Flash · visión' }
```

`vision: true` hace que el front lo marque con 👁 y permita adjuntar imágenes.
Un proveedor nuevo necesita `baseURL`, `keyEnv` (nombre del secret) y su lista de
modelos. Tras editar: `npx wrangler deploy`. El front no se toca.

## Notas honestas

- **Por qué hace falta el Worker:** en 2026 no existe un proveedor que sea a la vez
  sin key + llamable desde el navegador + gratis + con visión. LLM7 (sin key) no
  permite imágenes; Pollinations ahora pide key; OVHcloud no permite llamadas directas
  desde el navegador. El Worker resuelve las tres cosas de golpe.
- **Texto sin gastar:** usa un modelo `llm7/…` y no consume créditos de nadie.
- **El `APP_TOKEN` es protección ligera** (es visible en el código del navegador).
  Para frenar abuso de verdad, combina `ALLOWED_ORIGIN` + `APP_TOKEN` y, si hace falta,
  añade rate limiting en Cloudflare.
- **Pruebas locales:** al usar módulos ES, ábrelo con un servidor estático
  (`npx serve` o Live Server de VS Code), no con doble clic (`file://` los bloquea).
  En GitHub Pages funciona sin más.
- **Nada se guarda:** la conversación vive solo en memoria; al recargar, empieza limpia.
```
