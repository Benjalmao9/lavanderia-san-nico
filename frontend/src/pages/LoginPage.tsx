// ============================================================
//  Pantalla de Login.
//
//  Diseño: modo oscuro, tarjeta centrada, título "Lavandería San Nico" en azul acero,
//  campos de usuario y contraseña con iconos, botón de mostrar/ocultar la
//  contraseña, y botón "Iniciar sesión". Maneja el estado de "cargando" y los
//  mensajes de error (credenciales incorrectas o fallo de conexión).
// ============================================================

import { useRef, useState } from "react";
import type { FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { User, Lock, Eye, EyeOff, Loader2 } from "lucide-react";
import { useAuth } from "../context/AuthContext";
import TurnstileWidget from "../components/TurnstileWidget";
import type { TurnstileHandle } from "../components/TurnstileWidget";

// CAPTCHA (Cloudflare Turnstile): se activa SOLO si existe la variable
// VITE_TURNSTILE_SITE_KEY (definida únicamente en producción, en Vercel).
// En desarrollo no está definida, así que no se muestra ningún widget y el
// formulario funciona igual que siempre. Es el mismo principio que el backend
// aplica con ENTORNO para esconder /docs: los blindajes se activan solo donde
// importan, sin estorbar el desarrollo. (import.meta.env se resuelve en el
// BUILD, por eso puede vivir fuera del componente como constante.)
const TURNSTILE_SITE_KEY = import.meta.env.VITE_TURNSTILE_SITE_KEY;
const CAPTCHA_ACTIVO = Boolean(TURNSTILE_SITE_KEY);

export default function LoginPage() {
  const { iniciarSesion } = useAuth();
  const navigate = useNavigate();

  // Estado del formulario.
  const [usuario, setUsuario] = useState("");
  const [contrasena, setContrasena] = useState("");
  const [mostrarContrasena, setMostrarContrasena] = useState(false);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Token entregado por el CAPTCHA (null = todavía no completado / expiró).
  const [tokenTurnstile, setTokenTurnstile] = useState<string | null>(null);
  // Ref para poder REINICIAR el widget tras un intento fallido: los tokens de
  // Turnstile son de UN SOLO USO y el backend lo consume al verificarlo, así
  // que sin reinicio el segundo intento se rechazaría siempre.
  const refTurnstile = useRef<TurnstileHandle>(null);

  async function manejarEnvio(e: FormEvent) {
    e.preventDefault(); // evitamos que el navegador recargue la página
    // Guard defensivo: el botón ya está deshabilitado sin CAPTCHA completado,
    // pero por si el envío llega por otra vía (Enter, etc.), avisamos claro.
    if (CAPTCHA_ACTIVO && !tokenTurnstile) {
      setError("Completa la verificación de seguridad para iniciar sesión.");
      return;
    }
    setError(null);
    setCargando(true);
    try {
      // iniciarSesion llama a POST /login (con el token del CAPTCHA si está
      // activo) y guarda el token de sesión si todo va bien.
      await iniciarSesion(usuario, contrasena, tokenTurnstile);
      // Login correcto: vamos al dashboard (replace para no dejar el login en
      // el historial de "atrás").
      navigate("/", { replace: true });
    } catch (err) {
      // Mostramos el mensaje del error (genérico para credenciales, o de
      // conexión si el backend no responde).
      setError(err instanceof Error ? err.message : "Error al iniciar sesión");
      // El intento consumió el token del CAPTCHA (aunque la contraseña haya
      // sido lo que falló): lo reiniciamos para obtener uno nuevo. Cloudflare
      // suele renovarlo solo, sin pedirle nada al usuario.
      if (CAPTCHA_ACTIVO) {
        setTokenTurnstile(null);
        refTurnstile.current?.reset();
      }
    } finally {
      // Pase lo que pase, dejamos de mostrar "cargando".
      setCargando(false);
    }
  }

  // ¿Falta completar el CAPTCHA? (solo puede pasar cuando está activo)
  const faltaCaptcha = CAPTCHA_ACTIVO && !tokenTurnstile;

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      {/* Tarjeta centrada: ancho acotado (max-w-sm) y, en móvil, ocupa el ancho
          disponible menos el padding del contenedor (px-4). Padding algo menor en
          pantallas chicas. */}
      <div className="w-full max-w-sm rounded-2xl border border-slate-800 bg-slate-900/70 p-6 shadow-2xl backdrop-blur sm:p-8">
        {/* Título de la marca en azul acero */}
        <h1 className="text-center text-3xl font-bold tracking-tight text-acero">
          Lavandería San Nico
        </h1>
        <p className="mt-1 mb-7 text-center text-sm text-slate-400">
          Gestión de lavandería
        </p>

        <form onSubmit={manejarEnvio} className="space-y-4" noValidate>
          {/* Campo: usuario */}
          <div>
            <label htmlFor="usuario" className="mb-1.5 block text-sm text-slate-300">
              Usuario
            </label>
            <div className="relative">
              <User
                className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-500"
                aria-hidden
              />
              <input
                id="usuario"
                type="text"
                autoComplete="username"
                value={usuario}
                onChange={(e) => setUsuario(e.target.value)}
                placeholder="tu usuario"
                required
                className="w-full rounded-lg border border-slate-700 bg-slate-800 py-2.5 pl-10 pr-3 text-slate-100 placeholder-slate-500 outline-none transition focus:border-acero focus:ring-2 focus:ring-acero/40"
              />
            </div>
          </div>

          {/* Campo: contraseña con botón de mostrar/ocultar */}
          <div>
            <label htmlFor="contrasena" className="mb-1.5 block text-sm text-slate-300">
              Contraseña
            </label>
            <div className="relative">
              <Lock
                className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-500"
                aria-hidden
              />
              <input
                id="contrasena"
                type={mostrarContrasena ? "text" : "password"}
                autoComplete="current-password"
                value={contrasena}
                onChange={(e) => setContrasena(e.target.value)}
                placeholder="tu contraseña"
                required
                className="w-full rounded-lg border border-slate-700 bg-slate-800 py-2.5 pl-10 pr-11 text-slate-100 placeholder-slate-500 outline-none transition focus:border-acero focus:ring-2 focus:ring-acero/40"
              />
              <button
                type="button"
                onClick={() => setMostrarContrasena((v) => !v)}
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1.5 text-slate-400 transition hover:text-slate-200"
                aria-label={mostrarContrasena ? "Ocultar contraseña" : "Mostrar contraseña"}
              >
                {mostrarContrasena ? (
                  <EyeOff className="h-5 w-5" />
                ) : (
                  <Eye className="h-5 w-5" />
                )}
              </button>
            </div>
          </div>

          {/* CAPTCHA (solo en producción, cuando hay site key configurada).
              En desarrollo este bloque no se renderiza y no se carga nada. */}
          {CAPTCHA_ACTIVO && TURNSTILE_SITE_KEY && (
            <div>
              <TurnstileWidget
                siteKey={TURNSTILE_SITE_KEY}
                onToken={setTokenTurnstile}
                refWidget={refTurnstile}
              />
              {/* Mensaje claro mientras la verificación no esté completa (suele
                  resolverse sola en un par de segundos, sin acertijos). */}
              {faltaCaptcha && !cargando && (
                <p className="mt-1.5 text-center text-xs text-slate-500">
                  Completa la verificación de seguridad para habilitar el botón.
                </p>
              )}
            </div>
          )}

          {/* Mensaje de error (solo si hay) */}
          {error && (
            <p className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
              {error}
            </p>
          )}

          {/* Botón de envío en azul acero, con estado de carga. Con el CAPTCHA
              activo queda deshabilitado hasta que Cloudflare entregue el token. */}
          <button
            type="submit"
            disabled={cargando || faltaCaptcha}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-acero py-2.5 font-medium text-white transition hover:bg-acero-fuerte focus:outline-none focus:ring-2 focus:ring-acero/50 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {cargando && <Loader2 className="h-5 w-5 animate-spin" />}
            {cargando ? "Ingresando..." : "Iniciar sesión"}
          </button>
        </form>
      </div>
    </div>
  );
}
