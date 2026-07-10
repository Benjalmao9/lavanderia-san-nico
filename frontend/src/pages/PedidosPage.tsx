// ============================================================
//  Pantalla de Pedidos (conectada a la API real).
//
//  CÓMO SE CARGAN LOS DATOS:
//  Al montar la pantalla, useEffect llama a cargar(), que pide GET /pedidos
//  (con el token, vía el servicio). El resultado se guarda en el estado.
//
//  CÓMO SE MANEJAN LOS ESTADOS DE LA INTERFAZ:
//   - cargando: mientras se piden los datos -> spinner.
//   - error: si la petición falla -> mensaje + botón "Reintentar".
//   - vacío: si no hay pedidos -> mensaje claro (distingue "no hay ninguno"
//     de "ninguno coincide con el filtro").
//
//  FLUJO DE CREAR/EDITAR/BORRAR:
//   - "Nuevo pedido" / botón editar -> abre el modal del formulario.
//   - Al guardar con éxito, el modal llama onGuardado, que cierra y RECARGA la
//     lista desde el servidor (cargar()), así la tabla queda consistente.
//   - Borrar pide confirmación; al confirmar, DELETE y recarga.
//
//  El buscador (por cliente) y el filtro por estado actúan en el FRONTEND sobre
//  los datos ya cargados (no vuelven a pegarle a la API).
// ============================================================

import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  Plus,
  Search,
  Pencil,
  Trash2,
  Loader2,
  AlertCircle,
  Inbox,
  StickyNote,
  X,
} from "lucide-react";
import { listarPedidos, eliminarPedido } from "../services/pedidos";
import type { Pedido } from "../services/pedidos";
import { useAuth } from "../context/AuthContext";
import EstadoBadge from "../components/EstadoBadge";
import ControlEstadoPedido from "../components/ControlEstadoPedido";
import PedidoFormModal from "../components/PedidoFormModal";
import ConfirmDialog from "../components/ConfirmDialog";
import Modal from "../components/Modal";
import { formatearMoneda, formatearNumero, formatearFecha } from "../utils/formato";

// Opciones del filtro por estado. "pendientes" es un PSEUDO-estado (todo lo que
// NO está 'entregado'): lo usa el atajo "Por entregar" del Panel, que llega con
// ?estado=pendientes. El resto son los estados reales.
const ESTADOS_FILTRO = ["todos", "pendientes", "recibido", "en proceso", "listo", "entregado"];

// ¿El pedido (según su estado) coincide con el filtro elegido? Centralizado para
// que la lista y el aviso de "salió del filtro" usen EXACTAMENTE el mismo criterio.
function coincideEstadoFiltro(estado: string, filtro: string): boolean {
  if (filtro === "todos") return true;
  if (filtro === "pendientes") return estado !== "entregado";
  return estado === filtro;
}

// Etiqueta legible de cada opción del filtro.
function etiquetaFiltro(filtro: string): string {
  if (filtro === "todos") return "Todos los estados";
  if (filtro === "pendientes") return "Pendientes de entrega";
  return filtro;
}

export default function PedidosPage() {
  // Datos y estados de carga.
  const [pedidos, setPedidos] = useState<Pedido[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filtros (solo en el frontend). El filtro por estado se INICIALIZA desde el
  // query param ?estado=... de la URL (así el atajo del Panel llega ya filtrado y
  // el link sobrevive un refresh). Si no viene o es inválido, "todos".
  const [searchParams, setSearchParams] = useSearchParams();
  const [busqueda, setBusqueda] = useState("");
  const [filtroEstado, setFiltroEstado] = useState(() => {
    const e = searchParams.get("estado");
    return e && ESTADOS_FILTRO.includes(e) ? e : "todos";
  });

  // Cambiar el filtro desde el <select>: actualiza el estado Y refleja el valor
  // en la URL (link compartible), quitando el parámetro cuando es el default.
  function cambiarFiltroEstado(nuevo: string) {
    setFiltroEstado(nuevo);
    setAvisoEstado(null); // el aviso de "salió del filtro" ya no aplica
    setSearchParams(
      (prev) => {
        const p = new URLSearchParams(prev);
        if (nuevo === "todos") p.delete("estado");
        else p.set("estado", nuevo);
        return p;
      },
      { replace: true }
    );
  }

  // Modal de formulario: null = cerrado, "nuevo" = crear, objeto = editar.
  const [modal, setModal] = useState<"nuevo" | Pedido | null>(null);

  // Borrado: pedido a borrar (o null), con su estado de carga/error.
  const [aBorrar, setABorrar] = useState<Pedido | null>(null);
  const [borrando, setBorrando] = useState(false);
  const [errorBorrar, setErrorBorrar] = useState<string | null>(null);

  // Rol del usuario, para el cambio rápido de estado: el EMPLEADO solo avanza un
  // paso; el ADMINISTRADOR puede ir a cualquier estado. (La regla real la fuerza
  // el backend; esto solo decide qué control mostrar.)
  const { rol } = useAuth();
  const esAdmin = rol === "administrador";

  // Ver las notas de un pedido en un modal de SOLO LECTURA (sin abrir el formulario).
  const [verNotas, setVerNotas] = useState<Pedido | null>(null);
  // Error de un cambio rápido de estado (aviso descartable arriba de la lista).
  const [errorEstado, setErrorEstado] = useState<string | null>(null);
  // Aviso NEUTRO (no error): cuando un cambio rápido saca al pedido del filtro
  // activo y su fila desaparece de la vista, avisamos para que no parezca que
  // "se borró".
  const [avisoEstado, setAvisoEstado] = useState<string | null>(null);

  // Carga (o recarga) la lista de pedidos desde la API.
  const cargar = useCallback(async () => {
    setCargando(true);
    setError(null);
    try {
      const datos = await listarPedidos();
      setPedidos(datos);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al cargar los pedidos.");
    } finally {
      setCargando(false);
    }
  }, []);

  // Al montar la pantalla, cargamos los datos.
  useEffect(() => {
    cargar();
  }, [cargar]);

  // Lista filtrada por cliente (buscador) y estado (desplegable).
  const filtrados = pedidos.filter((p) => {
    const coincideCliente = p.cliente
      .toLowerCase()
      .includes(busqueda.trim().toLowerCase());
    return coincideCliente && coincideEstadoFiltro(p.estado, filtroEstado);
  });

  // Actualización SILENCIOSA tras un cambio rápido de estado: reemplazamos ese
  // pedido en la lista con el que devolvió el PUT (sin recargar toda la lista ni
  // mostrar el spinner de página completa) y limpiamos el aviso de error previo si
  // lo hubiera (así, tras un reintento exitoso, no queda un mensaje contradictorio).
  const alCambiarEstado = useCallback(
    (actualizado: Pedido) => {
      setErrorEstado(null);
      setPedidos((prev) => prev.map((p) => (p.id === actualizado.id ? actualizado : p)));
      // Si hay un filtro de estado activo y el pedido pasó a un estado que ya NO
      // coincide, su fila desaparece de la lista: lo avisamos (si coincide, se
      // limpia cualquier aviso previo).
      setAvisoEstado(
        !coincideEstadoFiltro(actualizado.estado, filtroEstado)
          ? `El pedido #${actualizado.id} pasó a “${actualizado.estado}” y ya no coincide con el filtro “${etiquetaFiltro(filtroEstado)}”.`
          : null
      );
    },
    [filtroEstado]
  );

  // Confirma el borrado del pedido seleccionado.
  async function confirmarBorrado() {
    if (!aBorrar) return;
    setBorrando(true);
    setErrorBorrar(null);
    try {
      await eliminarPedido(aBorrar.id);
      setABorrar(null);
      await cargar(); // refrescamos la tabla
    } catch (err) {
      setErrorBorrar(err instanceof Error ? err.message : "No se pudo eliminar el pedido.");
    } finally {
      setBorrando(false);
    }
  }

  return (
    <div>
      {/* Encabezado */}
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-slate-100">Pedidos</h1>
          <p className="mt-1 text-sm text-slate-400">
            Gestión de los pedidos de la lavandería.
          </p>
        </div>
        <button
          onClick={() => setModal("nuevo")}
          className="flex shrink-0 items-center gap-2 rounded-lg bg-acero px-4 py-2 text-sm font-medium text-white transition hover:bg-acero-fuerte"
        >
          <Plus className="h-4 w-4" />
          Nuevo pedido
        </button>
      </div>

      {/* Barra de búsqueda + filtro por estado */}
      <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
          <input
            type="text"
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            placeholder="Buscar por cliente..."
            className="w-full rounded-lg border border-slate-700 bg-slate-800 py-2 pl-9 pr-3 text-sm text-slate-100 placeholder-slate-500 outline-none transition focus:border-acero focus:ring-2 focus:ring-acero/40"
          />
        </div>
        <select
          value={filtroEstado}
          onChange={(e) => cambiarFiltroEstado(e.target.value)}
          className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm capitalize text-slate-200 outline-none transition focus:border-acero"
        >
          {ESTADOS_FILTRO.map((s) => (
            <option key={s} value={s}>
              {etiquetaFiltro(s)}
            </option>
          ))}
        </select>
      </div>

      {/* Aviso de error de un cambio rápido de estado (descartable). */}
      {errorEstado && (
        <div className="mt-4 flex items-start justify-between gap-3 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
          <span>{errorEstado}</span>
          <button
            onClick={() => setErrorEstado(null)}
            aria-label="Cerrar aviso"
            className="shrink-0 rounded p-0.5 text-red-300/80 transition hover:text-red-200"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* Aviso neutro: el pedido cambiado ya no coincide con el filtro activo. */}
      {avisoEstado && (
        <div className="mt-4 flex items-start justify-between gap-3 rounded-lg border border-acero/30 bg-acero/10 px-3 py-2 text-sm text-slate-200">
          <span>{avisoEstado}</span>
          <button
            onClick={() => setAvisoEstado(null)}
            aria-label="Cerrar aviso"
            className="shrink-0 rounded p-0.5 text-slate-400 transition hover:text-slate-200"
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
            Cargando pedidos...
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
        ) : pedidos.length === 0 ? (
          <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-slate-700 bg-slate-900/40 py-16 text-center text-slate-500">
            <Inbox className="h-8 w-8" />
            <p>No hay pedidos aún. Crea el primero con “Nuevo pedido”.</p>
          </div>
        ) : filtrados.length === 0 ? (
          <div className="rounded-xl border border-dashed border-slate-700 bg-slate-900/40 py-12 text-center text-slate-500">
            Ningún pedido coincide con la búsqueda o el filtro.
          </div>
        ) : (
          // En móvil (debajo de lg) mostramos TARJETAS; en escritorio (lg+), la
          // tabla. Ambas recorren la MISMA lista 'filtrados' y usan los mismos
          // handlers: solo cambia la presentación según el ancho de pantalla.
          <>
            {/* MÓVIL: cada pedido como tarjeta (datos apilados, estado visible y
                acciones grandes para el dedo). */}
            <div className="space-y-3 lg:hidden">
              {filtrados.map((p) => (
                <div
                  key={p.id}
                  className="rounded-xl border border-slate-800 bg-slate-900/60 p-4"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="flex items-center gap-1.5 font-medium text-slate-200">
                        <span className="truncate">{p.cliente}</span>
                        {/* Indicador de notas: solo si el pedido tiene. Un toque
                            abre el modal de solo lectura. */}
                        {p.notas && (
                          <button
                            onClick={() => setVerNotas(p)}
                            aria-label={`Ver notas del pedido ${p.id}`}
                            title="Ver notas"
                            className="shrink-0 text-amber-300/80 transition hover:text-amber-300"
                          >
                            <StickyNote className="h-4 w-4" />
                          </button>
                        )}
                      </p>
                      <p className="mt-0.5 text-xs text-slate-500">
                        #{p.id}
                        {p.telefono ? ` · ${p.telefono}` : ""}
                      </p>
                    </div>
                    <EstadoBadge estado={p.estado} />
                  </div>
                  <div className="mt-3 grid grid-cols-2 gap-y-1 text-sm">
                    <span className="text-slate-500">Kilos</span>
                    <span className="text-right text-slate-300">
                      {formatearNumero(p.kilos)} kg
                    </span>
                    <span className="text-slate-500">Total</span>
                    <span className="text-right text-slate-200">
                      {formatearMoneda(p.total)}
                    </span>
                    <span className="text-slate-500">Recepción</span>
                    <span className="text-right text-slate-400">
                      {formatearFecha(p.fecha_recepcion)}
                    </span>
                  </div>
                  {/* Pie: a la izquierda el cambio rápido de estado (según el rol);
                      a la derecha, editar / eliminar. flex-wrap para que en
                      pantallas muy angostas las acciones bajen a otra línea en vez
                      de desbordar. */}
                  <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-slate-800 pt-3">
                    <ControlEstadoPedido
                      pedido={p}
                      esAdmin={esAdmin}
                      onCambiado={alCambiarEstado}
                      onError={setErrorEstado}
                    />
                    <div className="flex gap-2">
                      <button
                        onClick={() => setModal(p)}
                        className="flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-sm text-slate-200 transition hover:bg-slate-700"
                      >
                        <Pencil className="h-4 w-4" />
                        Editar
                      </button>
                      <button
                        onClick={() => {
                          setErrorBorrar(null);
                          setABorrar(p);
                        }}
                        className="flex items-center gap-1.5 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-1.5 text-sm text-red-300 transition hover:bg-red-500/20"
                      >
                        <Trash2 className="h-4 w-4" />
                        Eliminar
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {/* ESCRITORIO: tabla normal. */}
            <div className="hidden overflow-x-auto rounded-xl border border-slate-800 lg:block">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-slate-800 bg-slate-900/60 text-slate-400">
                  <tr>
                    <th className="px-4 py-3 font-medium">ID</th>
                    <th className="px-4 py-3 font-medium">Cliente</th>
                    <th className="px-4 py-3 font-medium">Teléfono</th>
                    <th className="px-4 py-3 text-right font-medium">Kilos</th>
                    <th className="px-4 py-3 text-right font-medium">Total</th>
                    <th className="px-4 py-3 font-medium">Estado</th>
                    <th className="px-4 py-3 font-medium">Recepción</th>
                    <th className="px-4 py-3 text-right font-medium">Acciones</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800">
                  {filtrados.map((p) => (
                    <tr key={p.id} className="transition-colors hover:bg-slate-900/40">
                      <td className="px-4 py-3 text-slate-500">#{p.id}</td>
                      <td className="px-4 py-3 font-medium text-slate-200">
                        <span className="inline-flex items-center gap-1.5">
                          {p.cliente}
                          {/* Indicador de notas (solo si hay): abre el modal de lectura. */}
                          {p.notas && (
                            <button
                              onClick={() => setVerNotas(p)}
                              aria-label={`Ver notas del pedido ${p.id}`}
                              title="Ver notas"
                              className="text-amber-300/80 transition hover:text-amber-300"
                            >
                              <StickyNote className="h-4 w-4" />
                            </button>
                          )}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-slate-400">{p.telefono ?? "—"}</td>
                      <td className="px-4 py-3 text-right text-slate-300">
                        {formatearNumero(p.kilos)} kg
                      </td>
                      <td className="px-4 py-3 text-right text-slate-200">
                        {formatearMoneda(p.total)}
                      </td>
                      <td className="px-4 py-3">
                        {/* Badge del estado + control de cambio rápido (según rol). */}
                        <div className="flex flex-col items-start gap-1.5">
                          <EstadoBadge estado={p.estado} />
                          <ControlEstadoPedido
                            pedido={p}
                            esAdmin={esAdmin}
                            onCambiado={alCambiarEstado}
                            onError={setErrorEstado}
                          />
                        </div>
                      </td>
                      <td className="px-4 py-3 text-slate-400">
                        {formatearFecha(p.fecha_recepcion)}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex justify-end gap-2">
                          <button
                            onClick={() => setModal(p)}
                            aria-label={`Editar pedido ${p.id}`}
                            className="rounded-md p-2 text-slate-400 transition hover:bg-slate-800 hover:text-acero"
                          >
                            <Pencil className="h-4 w-4" />
                          </button>
                          <button
                            onClick={() => {
                              setErrorBorrar(null);
                              setABorrar(p);
                            }}
                            aria-label={`Eliminar pedido ${p.id}`}
                            className="rounded-md p-2 text-slate-400 transition hover:bg-slate-800 hover:text-red-300"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>

      {/* Modal de crear/editar */}
      {modal !== null && (
        <PedidoFormModal
          pedido={modal === "nuevo" ? null : modal}
          onCerrar={() => setModal(null)}
          onGuardado={() => {
            setModal(null);
            // Editar el pedido con éxito descarta avisos previos del cambio rápido
            // (evita que quede "pegado" un error/aviso viejo del mismo pedido).
            setErrorEstado(null);
            setAvisoEstado(null);
            cargar();
          }}
        />
      )}

      {/* Diálogo de confirmación de borrado */}
      {aBorrar && (
        <ConfirmDialog
          titulo="Eliminar pedido"
          mensaje={`¿Seguro que quieres eliminar el pedido #${aBorrar.id} de ${aBorrar.cliente}? Esta acción no se puede deshacer.`}
          cargando={borrando}
          error={errorBorrar}
          onConfirmar={confirmarBorrado}
          onCancelar={() => {
            setABorrar(null);
            setErrorBorrar(null);
          }}
        />
      )}

      {/* Notas en SOLO LECTURA: se abre con el icono de la fila/tarjeta, sin tener
          que entrar al formulario de edición (lo pidió quien usa la app). */}
      {verNotas && (
        <Modal
          titulo={`Notas del pedido #${verNotas.id}`}
          onCerrar={() => setVerNotas(null)}
        >
          <div className="space-y-3">
            <p className="text-xs text-slate-500">Cliente: {verNotas.cliente}</p>
            {/* whitespace-pre-wrap conserva los saltos de línea de las notas. */}
            <p className="whitespace-pre-wrap break-words rounded-lg border border-slate-800 bg-slate-800/50 p-3 text-sm text-slate-200">
              {verNotas.notas}
            </p>
            <div className="flex justify-end">
              <button
                onClick={() => setVerNotas(null)}
                className="rounded-lg border border-slate-700 bg-slate-800 px-4 py-2 text-sm text-slate-200 transition hover:bg-slate-700"
              >
                Cerrar
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
