// ============================================================
//  Pantalla de Usuarios (solo admin): CRUD de cuentas (empleados y admins).
//
//  SEGURIDAD:
//   - La tabla NUNCA muestra contraseñas ni hashes (el backend no los devuelve).
//   - Un admin NO puede borrar su PROPIA cuenta: detectamos cuál es la sesión
//     activa leyendo el nombre de usuario del token (solo para la interfaz) y
//     deshabilitamos el botón de borrar en esa fila. La barrera REAL igual está
//     en el backend (rechaza con 409 borrarse a sí mismo o al último admin); si
//     el backend lo impide, mostramos su mensaje.
//
//  ESTADOS DE UI: cargando / error (con reintentar) / vacío / tabla.
//  Tras cada alta/edición/baja recargamos la lista para reflejar los cambios.
// ============================================================

import { useCallback, useEffect, useState } from "react";
import {
  Plus,
  Search,
  Pencil,
  Trash2,
  LogOut,
  Loader2,
  AlertCircle,
  Inbox,
  X,
} from "lucide-react";
import { listarUsuarios, eliminarUsuario, cerrarSesionesUsuario } from "../services/usuarios";
import type { Usuario } from "../services/usuarios";
import { obtenerIdUsuario } from "../services/auth";
import { useAuth } from "../context/AuthContext";
import RolBadge from "../components/RolBadge";
import UsuarioFormModal from "../components/UsuarioFormModal";
import ConfirmDialog from "../components/ConfirmDialog";

export default function UsuariosPage() {
  const [usuarios, setUsuarios] = useState<Usuario[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [busqueda, setBusqueda] = useState("");

  const [modal, setModal] = useState<"nuevo" | Usuario | null>(null);

  const [aBorrar, setABorrar] = useState<Usuario | null>(null);
  const [borrando, setBorrando] = useState(false);
  const [errorBorrar, setErrorBorrar] = useState<string | null>(null);

  // Cerrar sesiones (en todos los dispositivos): usuario objetivo del diálogo
  // de confirmación, su estado de carga/error, y un aviso de ÉXITO aparte (esta
  // acción, a diferencia de crear/editar/borrar, necesita un mensaje de éxito
  // explícito, ver el pedido original).
  const [aCerrarSesiones, setACerrarSesiones] = useState<Usuario | null>(null);
  const [cerrandoSesiones, setCerrandoSesiones] = useState(false);
  const [errorCerrarSesiones, setErrorCerrarSesiones] = useState<string | null>(null);
  const [mensajeExito, setMensajeExito] = useState<string | null>(null);

  // Id del usuario de la SESIÓN ACTIVA (del token, solo para la interfaz). Lo
  // usamos para impedir que el admin se borre a sí mismo Y para saber si "cerrar
  // sesiones" se está aplicando sobre SU PROPIA cuenta (caso especial: ver
  // confirmarCerrarSesiones). Comparamos por ID (no por nombre) porque es el
  // identificador estable y el MISMO criterio del backend; si por algún motivo
  // no se puede leer (null), el guard de auto-borrado no se activa pero la
  // barrera real del backend igual rechaza el auto-borrado con 409.
  const idUsuarioActual = obtenerIdUsuario();

  // cerrarSesion (del contexto): la usamos SOLO cuando el admin cierra sus
  // PROPIAS sesiones, para reflejar de inmediato en esta pestaña que su token ya
  // no sirve (en vez de esperar a que la próxima llamada a la API reciba el 401
  // del apiFetch global). Es el mismo mecanismo que el botón "Cerrar sesión" de
  // la barra lateral: limpia el estado de auth y ProtectedRoute redirige solo.
  const { cerrarSesion } = useAuth();

  // Carga (o recarga) la lista de usuarios.
  const cargar = useCallback(async () => {
    setCargando(true);
    setError(null);
    try {
      const lista = await listarUsuarios();
      setUsuarios(lista);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al cargar los usuarios.");
    } finally {
      setCargando(false);
    }
  }, []);

  useEffect(() => {
    cargar();
  }, [cargar]);

  // Filtro por nombre de usuario o nombre completo (en el frontend).
  const termino = busqueda.trim().toLowerCase();
  const filtrados = usuarios.filter(
    (u) =>
      u.nombre_usuario.toLowerCase().includes(termino) ||
      (u.nombre_completo ?? "").toLowerCase().includes(termino)
  );

  async function confirmarBorrado() {
    if (!aBorrar) return;
    setBorrando(true);
    setErrorBorrar(null);
    try {
      await eliminarUsuario(aBorrar.id);
      setABorrar(null);
      await cargar();
    } catch (err) {
      setErrorBorrar(err instanceof Error ? err.message : "No se pudo eliminar el usuario.");
    } finally {
      setBorrando(false);
    }
  }

  // Confirma el cierre de sesiones (todos los dispositivos) del usuario elegido.
  async function confirmarCerrarSesiones() {
    if (!aCerrarSesiones) return;
    const esCuentaPropia =
      idUsuarioActual != null && aCerrarSesiones.id === idUsuarioActual;

    setCerrandoSesiones(true);
    setErrorCerrarSesiones(null);
    try {
      await cerrarSesionesUsuario(aCerrarSesiones.id);

      if (esCuentaPropia) {
        // El token que usamos para hacer ESTE MISMO pedido ya quedó invalidado
        // (sesion_valida_desde se puso en "ahora" en el backend): la próxima
        // llamada a la API recibiría 401 igual, pero no tiene sentido esperar
        // a eso. Cerramos la sesión del lado del cliente YA: limpia el token y
        // el estado de auth, y ProtectedRoute redirige solo al login (mismo
        // mecanismo que el botón "Cerrar sesión" de la barra lateral).
        cerrarSesion();
        return;
      }

      // Otro usuario: cerramos el diálogo, avisamos con un mensaje de éxito
      // claro y recargamos la lista (consistente con el resto de las acciones).
      setACerrarSesiones(null);
      setMensajeExito(
        `Sesión cerrada para "${aCerrarSesiones.nombre_usuario}" en todos sus dispositivos.`
      );
      await cargar();
    } catch (err) {
      setErrorCerrarSesiones(
        err instanceof Error ? err.message : "No se pudieron cerrar las sesiones."
      );
    } finally {
      setCerrandoSesiones(false);
    }
  }

  return (
    <div>
      {/* Encabezado */}
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-slate-100">Usuarios</h1>
          <p className="mt-1 text-sm text-slate-400">
            Cuentas del sistema (empleados y administradores).
          </p>
        </div>
        <button
          onClick={() => {
            setMensajeExito(null);
            setModal("nuevo");
          }}
          className="flex shrink-0 items-center gap-2 rounded-lg bg-acero px-4 py-2 text-sm font-medium text-white transition hover:bg-acero-fuerte"
        >
          <Plus className="h-4 w-4" />
          Nuevo usuario
        </button>
      </div>

      {/* Buscador */}
      <div className="relative mt-5">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
        <input
          type="text"
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
          placeholder="Buscar por nombre de usuario o nombre completo..."
          className="w-full rounded-lg border border-slate-700 bg-slate-800 py-2 pl-9 pr-3 text-sm text-slate-100 placeholder-slate-500 outline-none transition focus:border-acero focus:ring-2 focus:ring-acero/40 sm:max-w-md"
        />
      </div>

      {/* Aviso de éxito al cerrar sesiones de OTRO usuario (descartable). */}
      {mensajeExito && (
        <div className="mt-4 flex items-start justify-between gap-3 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-300">
          <span>{mensajeExito}</span>
          <button
            onClick={() => setMensajeExito(null)}
            aria-label="Cerrar aviso"
            className="shrink-0 rounded p-0.5 text-emerald-300/80 transition hover:text-emerald-200"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* Contenido: cargando / error / vacío / tabla */}
      <div className="mt-5">
        {cargando ? (
          <div className="flex items-center justify-center gap-3 py-16 text-slate-400">
            <Loader2 className="h-5 w-5 animate-spin" />
            Cargando usuarios...
          </div>
        ) : error ? (
          <div className="flex flex-col items-center gap-3 rounded-xl border border-red-500/30 bg-red-500/10 py-12 text-center">
            <AlertCircle className="h-8 w-8 text-red-400" />
            <p className="text-red-300">{error}</p>
            <button
              onClick={cargar}
              className="mt-1 rounded-lg border border-slate-700 bg-slate-800 px-4 py-2 text-sm text-slate-200 transition hover:bg-slate-700"
            >
              Reintentar
            </button>
          </div>
        ) : usuarios.length === 0 ? (
          <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-slate-700 bg-slate-900/40 py-16 text-center text-slate-500">
            <Inbox className="h-8 w-8" />
            <p>No hay usuarios aún. Crea el primero con “Nuevo usuario”.</p>
          </div>
        ) : filtrados.length === 0 ? (
          <div className="rounded-xl border border-dashed border-slate-700 bg-slate-900/40 py-12 text-center text-slate-500">
            Ningún usuario coincide con la búsqueda.
          </div>
        ) : (
          // Móvil (debajo de lg): TARJETAS; escritorio (lg+): tabla. Misma lista
          // 'filtrados' y mismos handlers (incluido el guard de cuenta propia).
          <>
            {/* MÓVIL: cada usuario como tarjeta, con su rol visible y las acciones
                accesibles. El botón de borrar sigue deshabilitado en la cuenta propia. */}
            <div className="space-y-3 lg:hidden">
              {filtrados.map((u) => {
                const esCuentaPropia = idUsuarioActual != null && u.id === idUsuarioActual;
                return (
                  <div
                    key={u.id}
                    className="rounded-xl border border-slate-800 bg-slate-900/60 p-4"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="flex items-center gap-2 font-medium text-slate-200">
                          {/* min-w-0 permite que truncate corte un nombre largo en
                              vez de desbordar la tarjeta en móvil. */}
                          <span className="min-w-0 truncate">{u.nombre_usuario}</span>
                          {esCuentaPropia && (
                            <span className="shrink-0 rounded bg-slate-800 px-1.5 py-0.5 text-xs text-slate-400">
                              actual
                            </span>
                          )}
                        </p>
                        <p className="mt-0.5 text-xs text-slate-500">
                          #{u.id} · {u.nombre_completo ?? "—"}
                        </p>
                      </div>
                      <RolBadge rol={u.rol} />
                    </div>
                    {/* flex-wrap: con 3 acciones, en pantallas muy angostas
                        conviene poder bajar a una segunda línea en vez de desbordar. */}
                    <div className="mt-3 flex flex-wrap justify-end gap-2 border-t border-slate-800 pt-3">
                      <button
                        onClick={() => {
                          setMensajeExito(null);
                          setModal(u);
                        }}
                        className="flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-sm text-slate-200 transition hover:bg-slate-700"
                      >
                        <Pencil className="h-4 w-4" />
                        Editar
                      </button>
                      <button
                        onClick={() => {
                          setErrorCerrarSesiones(null);
                          setMensajeExito(null);
                          setACerrarSesiones(u);
                        }}
                        className="flex items-center gap-1.5 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-1.5 text-sm text-amber-300 transition hover:bg-amber-500/20"
                      >
                        <LogOut className="h-4 w-4" />
                        Cerrar sesiones
                      </button>
                      <button
                        onClick={() => {
                          setErrorBorrar(null);
                          setMensajeExito(null);
                          setABorrar(u);
                        }}
                        disabled={esCuentaPropia}
                        title={
                          esCuentaPropia ? "No puedes eliminar tu propia cuenta" : undefined
                        }
                        className="flex items-center gap-1.5 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-1.5 text-sm text-red-300 transition hover:bg-red-500/20 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-red-500/10"
                      >
                        <Trash2 className="h-4 w-4" />
                        Eliminar
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* ESCRITORIO: tabla normal. */}
            <div className="hidden overflow-x-auto rounded-xl border border-slate-800 lg:block">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-slate-800 bg-slate-900/60 text-slate-400">
                  <tr>
                    <th className="px-4 py-3 font-medium">ID</th>
                    <th className="px-4 py-3 font-medium">Nombre de usuario</th>
                    <th className="px-4 py-3 font-medium">Nombre completo</th>
                    <th className="px-4 py-3 font-medium">Rol</th>
                    <th className="px-4 py-3 text-right font-medium">Acciones</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800">
                  {filtrados.map((u) => {
                    // ¿Es la cuenta de la sesión activa? Si sí, no permitimos borrarla.
                    // El '!= null' evita que, si no se pudo leer el id, todas las
                    // filas se comparen contra null y el guard se desactive en silencio.
                    const esCuentaPropia = idUsuarioActual != null && u.id === idUsuarioActual;
                    return (
                      <tr key={u.id} className="transition-colors hover:bg-slate-900/40">
                        <td className="px-4 py-3 text-slate-500">#{u.id}</td>
                        <td className="px-4 py-3 font-medium text-slate-200">
                          {u.nombre_usuario}
                          {esCuentaPropia && (
                            <span className="ml-2 rounded bg-slate-800 px-1.5 py-0.5 text-xs text-slate-400">
                              actual
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-slate-400">
                          {u.nombre_completo ?? "—"}
                        </td>
                        <td className="px-4 py-3">
                          <RolBadge rol={u.rol} />
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex justify-end gap-2">
                            <button
                              onClick={() => {
                                setMensajeExito(null);
                                setModal(u);
                              }}
                              aria-label={`Editar usuario ${u.nombre_usuario}`}
                              className="rounded-md p-2 text-slate-400 transition hover:bg-slate-800 hover:text-acero"
                            >
                              <Pencil className="h-4 w-4" />
                            </button>
                            <button
                              onClick={() => {
                                setErrorCerrarSesiones(null);
                                setMensajeExito(null);
                                setACerrarSesiones(u);
                              }}
                              title="Cerrar sesión en todos los dispositivos"
                              aria-label={`Cerrar sesiones de ${u.nombre_usuario} en todos sus dispositivos`}
                              className="rounded-md p-2 text-slate-400 transition hover:bg-slate-800 hover:text-amber-400"
                            >
                              <LogOut className="h-4 w-4" />
                            </button>
                            <button
                              onClick={() => {
                                setErrorBorrar(null);
                                setMensajeExito(null);
                                setABorrar(u);
                              }}
                              // Deshabilitado para la propia cuenta: un admin no puede
                              // borrarse a sí mismo (evita quedarse sin sesión).
                              disabled={esCuentaPropia}
                              title={
                                esCuentaPropia
                                  ? "No puedes eliminar tu propia cuenta"
                                  : undefined
                              }
                              aria-label={`Eliminar usuario ${u.nombre_usuario}`}
                              className="rounded-md p-2 text-slate-400 transition hover:bg-slate-800 hover:text-red-300 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-slate-400"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>

      {/* Modal de crear/editar */}
      {modal !== null && (
        <UsuarioFormModal
          usuario={modal === "nuevo" ? null : modal}
          onCerrar={() => setModal(null)}
          onGuardado={() => {
            setModal(null);
            cargar();
          }}
        />
      )}

      {/* Confirmación de borrado */}
      {aBorrar && (
        <ConfirmDialog
          titulo="Eliminar usuario"
          mensaje={`¿Seguro que quieres eliminar a “${aBorrar.nombre_usuario}”? Esta acción no se puede deshacer.`}
          cargando={borrando}
          error={errorBorrar}
          onConfirmar={confirmarBorrado}
          onCancelar={() => {
            setABorrar(null);
            setErrorBorrar(null);
          }}
        />
      )}

      {/* Confirmación de cerrar sesiones. El mensaje cambia si es la CUENTA
          PROPIA: advertimos explícitamente que también cierra la sesión actual. */}
      {aCerrarSesiones && (
        <ConfirmDialog
          titulo="Cerrar sesión en todos los dispositivos"
          mensaje={
            idUsuarioActual != null && aCerrarSesiones.id === idUsuarioActual
              ? `¿Seguro que quieres cerrar TODAS tus sesiones activas? Esto incluye tu sesión ACTUAL: se cerrará de inmediato y volverás a la pantalla de inicio de sesión.`
              : `¿Seguro que quieres cerrar todas las sesiones activas de “${aCerrarSesiones.nombre_usuario}”? Tendrá que iniciar sesión de nuevo en todos sus dispositivos.`
          }
          textoConfirmar="Cerrar sesiones"
          cargando={cerrandoSesiones}
          error={errorCerrarSesiones}
          onConfirmar={confirmarCerrarSesiones}
          onCancelar={() => {
            setACerrarSesiones(null);
            setErrorCerrarSesiones(null);
          }}
        />
      )}
    </div>
  );
}
