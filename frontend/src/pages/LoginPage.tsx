// ============================================================
//  Pantalla de Login.
//
//  Diseño: modo oscuro, tarjeta centrada, título "Lavandería San Nico" en azul acero,
//  campos de usuario y contraseña con iconos, botón de mostrar/ocultar la
//  contraseña, y botón "Iniciar sesión". Maneja el estado de "cargando" y los
//  mensajes de error (credenciales incorrectas o fallo de conexión).
// ============================================================

import { useState } from "react";
import type { FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { User, Lock, Eye, EyeOff, Loader2 } from "lucide-react";
import { useAuth } from "../context/AuthContext";

export default function LoginPage() {
  const { iniciarSesion } = useAuth();
  const navigate = useNavigate();

  // Estado del formulario.
  const [usuario, setUsuario] = useState("");
  const [contrasena, setContrasena] = useState("");
  const [mostrarContrasena, setMostrarContrasena] = useState(false);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function manejarEnvio(e: FormEvent) {
    e.preventDefault(); // evitamos que el navegador recargue la página
    setError(null);
    setCargando(true);
    try {
      // iniciarSesion llama a POST /login y guarda el token si todo va bien.
      await iniciarSesion(usuario, contrasena);
      // Login correcto: vamos al dashboard (replace para no dejar el login en
      // el historial de "atrás").
      navigate("/", { replace: true });
    } catch (err) {
      // Mostramos el mensaje del error (genérico para credenciales, o de
      // conexión si el backend no responde).
      setError(err instanceof Error ? err.message : "Error al iniciar sesión");
    } finally {
      // Pase lo que pase, dejamos de mostrar "cargando".
      setCargando(false);
    }
  }

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

          {/* Mensaje de error (solo si hay) */}
          {error && (
            <p className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
              {error}
            </p>
          )}

          {/* Botón de envío en azul acero, con estado de carga */}
          <button
            type="submit"
            disabled={cargando}
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
