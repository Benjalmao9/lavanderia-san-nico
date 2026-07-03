// ============================================================
//  Servicio de autenticación: login, logout y lectura del rol desde el token.
// ============================================================

import { API_URL, guardarToken, obtenerToken, limpiarSesion } from "./api";
import { mensajeDeError } from "./errores";

// Los dos roles que maneja el backend.
export type Rol = "administrador" | "empleado";

// Forma de la "carga útil" (payload) del JWT que emite el backend.
export interface DatosToken {
  sub?: string; // nombre de usuario
  id?: number; // id del usuario
  rol?: Rol; // rol (lo usamos SOLO para la interfaz)
  exp?: number; // expiración, en segundos desde 1970
}

// ------------------------------------------------------------
//  decodificarToken: lee el payload de un JWT SIN verificar la firma.
//
//  Un JWT tiene 3 partes separadas por puntos: cabecera.payload.firma
//  El payload es JSON codificado en base64url. Aquí lo decodificamos para
//  poder LEER datos como el rol.
//
//  ¡IMPORTANTE! Esto NO valida el token: cualquiera puede leer (e incluso
//  falsificar) el contenido de un JWT. Por eso lo que leemos acá es SOLO para
//  decidir qué mostrar en la INTERFAZ (ej: ocultar el menú de admin). La
//  SEGURIDAD REAL la hace el backend, que verifica la firma con su clave
//  secreta en cada petición: aunque alguien truque su rol en el navegador, el
//  backend rechazará (403) las acciones para las que no tiene permiso.
// ------------------------------------------------------------
export function decodificarToken(token: string): DatosToken | null {
  try {
    const payloadB64 = token.split(".")[1];
    // base64url -> base64 estándar (cambia los caracteres - y _).
    const base64 = payloadB64.replace(/-/g, "+").replace(/_/g, "/");
    // atob decodifica base64; el resto reconstruye correctamente los caracteres
    // UTF-8 (tildes, ñ) que pudiera haber en el payload.
    const json = decodeURIComponent(
      atob(base64)
        .split("")
        .map((c) => "%" + c.charCodeAt(0).toString(16).padStart(2, "0"))
        .join("")
    );
    return JSON.parse(json) as DatosToken;
  } catch {
    // Token mal formado o ilegible.
    return null;
  }
}

// ¿El token sigue vigente (no expiró)? exp viene en segundos; Date.now() en ms.
export function tokenVigente(token: string): boolean {
  const datos = decodificarToken(token);
  if (!datos?.exp) return false;
  return datos.exp * 1000 > Date.now();
}

// ¿Hay una sesión válida? (token presente y todavía no expirado)
export function estaAutenticado(): boolean {
  const token = obtenerToken();
  return token != null && tokenVigente(token);
}

// Rol del usuario actual (o null si no hay sesión). Solo para la interfaz.
export function obtenerRol(): Rol | null {
  const token = obtenerToken();
  if (!token) return null;
  return decodificarToken(token)?.rol ?? null;
}

// Nombre de usuario del token (el claim 'sub'). Solo para mostrarlo en la
// interfaz (p. ej. en la barra lateral). No se usa para decidir permisos.
export function obtenerNombreUsuario(): string | null {
  const token = obtenerToken();
  if (!token) return null;
  return decodificarToken(token)?.sub ?? null;
}

// Id del usuario del token (el claim 'id'). Es el identificador ESTABLE de la
// sesión (no cambia aunque se renombrara el usuario), y es el MISMO criterio que
// usa el backend para reglas como "no borrarse a sí mismo". Por eso lo preferimos
// al nombre para comparar "esta fila es mi cuenta". Solo para la interfaz.
export function obtenerIdUsuario(): number | null {
  const token = obtenerToken();
  if (!token) return null;
  const id = decodificarToken(token)?.id;
  return typeof id === "number" ? id : null;
}

// Momento de expiración del token actual en MILISEGUNDOS (o null si no hay token
// o no se puede leer). Lo usa el contexto para programar el cierre de sesión
// automático justo cuando el token vence.
export function obtenerExpiracionMs(): number | null {
  const token = obtenerToken();
  if (!token) return null;
  const exp = decodificarToken(token)?.exp;
  return exp ? exp * 1000 : null;
}

// ------------------------------------------------------------
//  login: llama a POST /login del backend.
//
//  El backend espera los datos como FORMULARIO OAuth2 (no JSON): los campos
//  username y password en formato x-www-form-urlencoded. Por eso usamos
//  URLSearchParams (que produce ese formato) en vez de JSON.stringify.
//
//  tokenTurnstile (opcional): el token del CAPTCHA de Cloudflare. Solo llega
//  cuando el CAPTCHA está activo (producción, con VITE_TURNSTILE_SITE_KEY);
//  viaja como un campo más del formulario con el nombre estándar de Cloudflare
//  ('cf-turnstile-response'), que es el que espera el backend. En desarrollo
//  no se manda nada y el backend tampoco lo exige.
// ------------------------------------------------------------
export async function login(
  username: string,
  password: string,
  tokenTurnstile?: string | null
): Promise<void> {
  const cuerpo = new URLSearchParams();
  cuerpo.set("username", username);
  cuerpo.set("password", password);
  if (tokenTurnstile) {
    cuerpo.set("cf-turnstile-response", tokenTurnstile);
  }

  let respuesta: Response;
  try {
    respuesta = await fetch(`${API_URL}/login`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: cuerpo,
    });
  } catch {
    // fetch SOLO lanza ante errores de RED: backend apagado, sin conexión, o
    // CORS mal configurado. Lo traducimos a un mensaje claro para el usuario.
    throw new Error("No se pudo conectar con el servidor. ¿Está encendido el backend?");
  }

  if (respuesta.status === 401) {
    // Mensaje GENÉRICO, coherente con el backend: no revelamos si falló el
    // usuario o la contraseña (no le damos pistas a un atacante).
    throw new Error("Usuario o contraseña incorrectos");
  }
  if (!respuesta.ok) {
    // Cualquier otro error. Usamos el detalle del backend cuando existe porque
    // ahora hay errores del login que el usuario SÍ puede resolver y necesita
    // distinguir: el 400 del CAPTCHA ("La verificación de seguridad no fue
    // superada...") y el 503 fail-closed si Cloudflare no responde. Si el
    // cuerpo no trae detalle (500 raro, proxy...), cae al mensaje neutro.
    throw new Error(
      await mensajeDeError(respuesta, "Ocurrió un error al iniciar sesión. Intenta de nuevo.")
    );
  }

  // Respuesta esperada: { "access_token": "...", "token_type": "bearer" }.
  // Validamos el cuerpo ANTES de guardar: un 200 con un cuerpo inesperado o no
  // parseable NO debe dejar una sesión "rota". Si guardáramos undefined/vacío,
  // el contexto creería que hay sesión mientras el token no sirve, y cada
  // petición recibiría 401 expulsando al usuario.
  let datos: unknown;
  try {
    datos = await respuesta.json();
  } catch {
    throw new Error("Ocurrió un error al iniciar sesión. Intenta de nuevo.");
  }
  const token = (datos as { access_token?: unknown }).access_token;
  if (typeof token !== "string" || token.length === 0) {
    throw new Error("Ocurrió un error al iniciar sesión. Intenta de nuevo.");
  }
  guardarToken(token);
}

// Cierra la sesión: borra el token guardado.
export function logout(): void {
  limpiarSesion();
}
