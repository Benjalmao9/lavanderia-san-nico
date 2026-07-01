// ============================================================
//  Servicio central de conexión a la API (backend FastAPI).
//
//  Aquí vive: la URL base del backend, el guardado/lectura del token JWT, y
//  un "wrapper" (apiFetch) para las llamadas AUTENTICADAS que agrega solo el
//  token y maneja de forma global el 401 (token vencido/inválido).
// ============================================================

// URL base del backend. Se puede cambiar con la variable VITE_API_URL en .env.
// Si no está definida, usamos el backend de desarrollo por defecto.
export const API_URL = import.meta.env.VITE_API_URL ?? "http://127.0.0.1:8000";

// Clave bajo la que guardamos el token en el navegador.
const CLAVE_TOKEN = "lavaclean_token";

// --- Manejo del token en localStorage ---
// Usamos localStorage para que la sesión PERSISTA aunque el usuario recargue la
// página o cierre y vuelva a abrir el navegador. (Nota de seguridad: localStorage
// es accesible por JavaScript, así que es vulnerable a XSS; para esta app es la
// opción pragmática habitual y, sobre todo, la SEGURIDAD REAL la hace el backend,
// que verifica la firma del token en cada petición.)
export function guardarToken(token: string): void {
  localStorage.setItem(CLAVE_TOKEN, token);
}

export function obtenerToken(): string | null {
  return localStorage.getItem(CLAVE_TOKEN);
}

export function limpiarSesion(): void {
  localStorage.removeItem(CLAVE_TOKEN);
}

// ------------------------------------------------------------
//  apiFetch: para llamadas que requieren estar logueado.
//
//  - Antepone la URL base del backend al path (ej: "/pedidos").
//  - Si hay token guardado, agrega la cabecera "Authorization: Bearer <token>"
//    automáticamente (así no la repetimos en cada llamada).
//  - Si el backend responde 401 (token inválido o expirado), limpia la sesión
//    y manda al usuario al login. Esto cubre el caso "se me venció el token
//    mientras usaba la app".
//
//  OJO: el login NO usa esta función (usa su propio fetch en auth.ts), porque
//  el 401 del login significa "credenciales incorrectas", no "sesión vencida".
// ------------------------------------------------------------
export async function apiFetch(path: string, options: RequestInit = {}): Promise<Response> {
  const token = obtenerToken();
  const headers = new Headers(options.headers);

  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }
  // Si mandamos un cuerpo y no se especificó el tipo, asumimos JSON.
  if (options.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const respuesta = await fetch(`${API_URL}${path}`, { ...options, headers });

  if (respuesta.status === 401) {
    limpiarSesion();
    // Redirección "dura" al login. Es simple y robusta para "token vencido".
    window.location.assign("/login");
    throw new Error("Tu sesión expiró. Inicia sesión de nuevo.");
  }

  return respuesta;
}
