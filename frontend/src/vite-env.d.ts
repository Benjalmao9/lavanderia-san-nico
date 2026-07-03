/// <reference types="vite/client" />

// Tipado de las variables de entorno que usamos (para que TypeScript las conozca).
interface ImportMetaEnv {
  readonly VITE_API_URL?: string;
  // Site key (pública) de Cloudflare Turnstile. Si NO está definida (desarrollo),
  // el login no muestra CAPTCHA; si está (producción), se muestra y se exige.
  readonly VITE_TURNSTILE_SITE_KEY?: string;
}
interface ImportMeta {
  readonly env: ImportMetaEnv;
}
