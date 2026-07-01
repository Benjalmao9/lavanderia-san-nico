/// <reference types="vite/client" />

// Tipado de las variables de entorno que usamos (para que TypeScript las conozca).
interface ImportMetaEnv {
  readonly VITE_API_URL?: string;
}
interface ImportMeta {
  readonly env: ImportMetaEnv;
}
