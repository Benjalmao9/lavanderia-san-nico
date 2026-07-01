// ============================================================
//  Contexto de autenticación.
//
//  Un "contexto" de React comparte estado con toda la app sin tener que pasar
//  props manualmente por cada componente. Aquí guardamos si hay sesión activa
//  y el rol, y exponemos iniciarSesion / cerrarSesion. Al usar useState, los
//  componentes que dependen de la sesión se vuelven a renderizar solos cuando
//  el usuario entra o sale (p. ej. para redirigir tras el login).
// ============================================================

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import type { ReactNode } from "react";
import * as auth from "../services/auth";

interface ContextoAuth {
  estaAutenticado: boolean;
  rol: auth.Rol | null;
  usuario: string | null; // nombre de usuario (para mostrar en la interfaz)
  iniciarSesion: (usuario: string, contrasena: string) => Promise<void>;
  cerrarSesion: () => void;
}

const Contexto = createContext<ContextoAuth | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  // Estado inicial: leemos el token guardado (si existe y sigue vigente).
  const [autenticado, setAutenticado] = useState<boolean>(auth.estaAutenticado());
  const [rol, setRol] = useState<auth.Rol | null>(auth.obtenerRol());
  const [usuario, setUsuario] = useState<string | null>(auth.obtenerNombreUsuario());

  // Limpia el estado de React de la sesión (no toca el token del storage).
  const limpiarEstado = useCallback(() => {
    setAutenticado(false);
    setRol(null);
    setUsuario(null);
  }, []);

  const cerrarSesion = useCallback(() => {
    auth.logout(); // borra el token guardado
    limpiarEstado();
  }, [limpiarEstado]);

  // Revalida la vigencia REAL del token y, si ya no es válido (p. ej. expiró),
  // cierra la sesión para sincronizar la interfaz. Idempotente.
  const revalidarSesion = useCallback(() => {
    if (autenticado && !auth.estaAutenticado()) {
      cerrarSesion();
    }
  }, [autenticado, cerrarSesion]);

  async function iniciarSesion(usuario: string, contrasena: string): Promise<void> {
    // Si las credenciales son incorrectas, auth.login lanza un error que el
    // componente de login captura para mostrar el mensaje.
    await auth.login(usuario, contrasena);
    setAutenticado(true);
    setRol(auth.obtenerRol());
    setUsuario(auth.obtenerNombreUsuario());
  }

  // ----------------------------------------------------------------
  //  Mantener el estado de sesión SINCRONIZADO con la vigencia real del token.
  //
  //  El token expira a las 6 h. Sin esto, una pestaña abierta seguiría mostrando
  //  la interfaz "autenticada" con un token ya vencido hasta que una llamada a la
  //  API fallara con 401 (y una pantalla estática nunca llamaría). Para evitarlo:
  //   - Programamos un temporizador que cierra la sesión justo al expirar (exp).
  //   - Revalidamos cuando la pestaña vuelve al primer plano (focus/visibility) o
  //     cuando cambia el storage (p. ej. cerraste sesión en otra pestaña).
  //  Es coherencia de INTERFAZ; la seguridad real la sigue imponiendo el backend.
  // ----------------------------------------------------------------
  useEffect(() => {
    if (!autenticado) return;

    // 1) Temporizador hasta el instante exacto de expiración del token.
    let timer: number | undefined;
    const expMs = auth.obtenerExpiracionMs();
    if (expMs) {
      // Acotamos al máximo de setTimeout (~24,8 días) por las dudas.
      const restante = Math.max(0, Math.min(expMs - Date.now(), 2_147_483_647));
      timer = window.setTimeout(revalidarSesion, restante);
    }

    // 2) Revalidar ante eventos relevantes.
    window.addEventListener("focus", revalidarSesion);
    window.addEventListener("storage", revalidarSesion);
    document.addEventListener("visibilitychange", revalidarSesion);

    return () => {
      if (timer) window.clearTimeout(timer);
      window.removeEventListener("focus", revalidarSesion);
      window.removeEventListener("storage", revalidarSesion);
      document.removeEventListener("visibilitychange", revalidarSesion);
    };
  }, [autenticado, revalidarSesion]);

  return (
    <Contexto.Provider
      value={{ estaAutenticado: autenticado, rol, usuario, iniciarSesion, cerrarSesion }}
    >
      {children}
    </Contexto.Provider>
  );
}

// Hook para consumir el contexto cómodamente desde cualquier componente.
export function useAuth(): ContextoAuth {
  const ctx = useContext(Contexto);
  if (!ctx) {
    throw new Error("useAuth debe usarse dentro de <AuthProvider>");
  }
  return ctx;
}
