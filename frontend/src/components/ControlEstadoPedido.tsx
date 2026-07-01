// ============================================================
//  Control de CAMBIO RÁPIDO de estado de un pedido, desde la lista (sin abrir el
//  formulario de edición). Su forma depende del ROL (coherente con la regla que
//  fuerza el backend):
//
//   - EMPLEADO: un botón que AVANZA un paso en el flujo lineal
//     recibido → en proceso → listo → entregado. Si el pedido ya está
//     'entregado' (estado final), no se muestra botón. Avanzar es directo (sin
//     confirmación, no es destructivo).
//
//   - ADMINISTRADOR: un desplegable con TODOS los estados (puede corregir,
//     saltar o retroceder). Avanzar/saltar es directo; RETROCEDER pide
//     confirmación (es la acción "destructiva" que mencionó el pedido).
//
//  IMPORTANTE: esto es solo la UX. La autoridad real es el backend, que valida la
//  transición según el rol del token; si un empleado intentara saltarse el flujo
//  por fuera de esta UI, el backend responde 409.
//
//  Tras un cambio exitoso llama a onCambiado() (el padre recarga la lista). Los
//  errores se reportan con onError() (el padre los muestra).
// ============================================================

import { useState } from "react";
import { Loader2, ArrowRight } from "lucide-react";
import { cambiarEstadoPedido } from "../services/pedidos";
import type { Pedido } from "../services/pedidos";
import ConfirmDialog from "./ConfirmDialog";

// Orden del flujo lineal. El índice marca el "avance": un estado posterior tiene
// índice mayor; retroceder = ir a un índice menor.
const FLUJO = ["recibido", "en proceso", "listo", "entregado"];

interface Props {
  pedido: Pedido;
  esAdmin: boolean;
  // Devuelve el pedido YA actualizado (lo que retorna el PUT), para que el padre
  // actualice ese pedido en su lista SIN recargar todo (evita el parpadeo del
  // spinner de página completa en cada cambio rápido).
  onCambiado: (pedidoActualizado: Pedido) => void;
  onError: (mensaje: string) => void; // reportar el error al padre
}

export default function ControlEstadoPedido({ pedido, esAdmin, onCambiado, onError }: Props) {
  const [cambiando, setCambiando] = useState(false);
  // Estado destino pendiente de confirmar (solo para los retrocesos de un admin).
  const [aConfirmar, setAConfirmar] = useState<string | null>(null);

  const indiceActual = FLUJO.indexOf(pedido.estado);
  const siguiente =
    indiceActual >= 0 && indiceActual < FLUJO.length - 1 ? FLUJO[indiceActual + 1] : null;

  // Hace el cambio real contra el backend y avisa al padre.
  const aplicar = async (estado: string) => {
    setCambiando(true);
    try {
      const actualizado = await cambiarEstadoPedido(pedido.id, estado);
      onCambiado(actualizado);
    } catch (err) {
      onError(err instanceof Error ? err.message : "No se pudo cambiar el estado.");
    } finally {
      setCambiando(false);
    }
  };

  // ---------- ADMIN: desplegable con todos los estados ----------
  if (esAdmin) {
    const alElegir = (nuevo: string) => {
      if (nuevo === pedido.estado) return;
      // Retroceder (ir a un estado anterior) es la acción destructiva: confirmamos.
      // Avanzar o saltar hacia adelante se aplica directo.
      if (FLUJO.indexOf(nuevo) < indiceActual) setAConfirmar(nuevo);
      else aplicar(nuevo);
    };

    return (
      <>
        <div className="inline-flex items-center gap-2">
          <select
            value={pedido.estado}
            disabled={cambiando}
            onChange={(e) => alElegir(e.target.value)}
            aria-label={`Cambiar estado del pedido ${pedido.id}`}
            className="rounded-lg border border-slate-700 bg-slate-800 px-2 py-1 text-xs capitalize text-slate-200 outline-none transition focus:border-acero focus:ring-2 focus:ring-acero/40 disabled:opacity-60"
          >
            {/* Si el estado actual NO es uno del flujo (dato legacy), lo mostramos
                igual como opción para que el select refleje el valor REAL y no
                tergiverse el estado del pedido. */}
            {indiceActual === -1 && (
              <option value={pedido.estado}>{pedido.estado} (actual)</option>
            )}
            {FLUJO.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          {cambiando && <Loader2 className="h-4 w-4 animate-spin text-slate-400" />}
        </div>

        {/* Confirmación SOLO para retrocesos. */}
        {aConfirmar && (
          <ConfirmDialog
            titulo="Retroceder estado"
            mensaje={`¿Seguro que quieres cambiar el pedido #${pedido.id} de "${pedido.estado}" a "${aConfirmar}"? Es un retroceso en el flujo.`}
            textoConfirmar="Cambiar"
            onConfirmar={() => {
              const destino = aConfirmar;
              setAConfirmar(null);
              if (destino) aplicar(destino);
            }}
            onCancelar={() => setAConfirmar(null)}
          />
        )}
      </>
    );
  }

  // ---------- EMPLEADO: botón de avance al siguiente estado ----------
  // Si ya está 'entregado' (sin siguiente), no hay nada que avanzar.
  if (!siguiente) return null;

  return (
    <button
      onClick={() => aplicar(siguiente)}
      disabled={cambiando}
      aria-label={`Avanzar el pedido ${pedido.id} a ${siguiente}`}
      className="inline-flex items-center gap-1 whitespace-nowrap rounded-lg border border-acero/40 bg-acero/10 px-2.5 py-1 text-xs font-medium text-acero transition hover:bg-acero/20 disabled:cursor-not-allowed disabled:opacity-60"
    >
      {cambiando ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
      ) : (
        <ArrowRight className="h-3.5 w-3.5" />
      )}
      <span className="capitalize">{siguiente}</span>
    </button>
  );
}
