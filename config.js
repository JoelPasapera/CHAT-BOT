// Configuración del front-end. Lo único que tocas tras desplegar el Worker.

export const CONFIG = {
  // URL de tu Cloudflare Worker (gateway). Cámbiala por la tuya:
  //   https://mini-chat-gateway.TU-SUBDOMINIO.workers.dev
  GATEWAY_URL: 'https://mini-chat-gateway.TU-SUBDOMINIO.workers.dev',

  // Token anti-abuso opcional. Debe coincidir con el secret APP_TOKEN del Worker.
  // Déjalo vacío si no configuraste APP_TOKEN.
  APP_TOKEN: '',

  // Instrucción de sistema para el modelo.
  SYSTEM:
    'Eres un asistente útil y conciso. Responde en el idioma del usuario. ' +
    'Cuando se comparta una imagen, analízala con detalle si lo piden, o tenla ' +
    'en cuenta para tu respuesta. Usa markdown cuando ayude a la claridad.',

  // Imagen: se redimensiona EN EL NAVEGADOR antes de enviar (único proceso local).
  MAX_DIM: 1280,        // lado mayor en píxeles
  JPEG_QUALITY: 0.85,   // calidad de salida
  MAX_IMAGES: 4,        // adjuntos por mensaje

  HISTORY_LIMIT: 24,    // mensajes en contexto (solo en memoria, nada se guarda)
};
