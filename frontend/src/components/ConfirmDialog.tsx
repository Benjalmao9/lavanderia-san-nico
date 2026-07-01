// ============================================================
//  Diálogo de confirmación reutilizable.
//
//  Lo usamos antes de acciones destructivas (p. ej. borrar un pedido). Muestra
//  un mensaje, un botón de cancelar y uno de confirmar (en rojo). Soporta estado
//  de "cargando" (deshabilita los botones) y un mensaje de error.
// ============================================================

import { Loader2 } from "lucide-react";
import { useDialogoModal } from "../hooks/useDialogoModal";

interface Props {
  titulo: string;
  mensaje: string;
  textoConfirmar?: string;
  cargando?: boolean;
  error?: string | null;
  onConfirmar: () => void;
  onCancelar: () => void;
}

export default function ConfirmDialog({
  titulo,
  mensaje,
  textoConfirmar = "Eliminar",
  cargando = false,
  error = null,
  onConfirmar,
  onCancelar,
}: Props) {
  // Mismo comportamiento accesible que Modal: bloquea el scroll del fondo, cierra
  // con Escape (salvo mientras procesa), atrapa el foco y lo devuelve al cerrar.
  const refDialogo = useDialogoModal(onCancelar, cargando);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Fondo: clic para cancelar (salvo que esté procesando). */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={cargando ? undefined : onCancelar}
        aria-hidden
      />

      <div
        ref={refDialogo}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        className="relative z-10 w-full max-w-sm rounded-2xl border border-slate-800 bg-slate-900 p-6 shadow-2xl outline-none"
      >
        <h2 className="text-lg font-semibold text-slate-100">{titulo}</h2>
        <p className="mt-2 text-sm text-slate-400">{mensaje}</p>

        {error && (
          <p className="mt-3 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
            {error}
          </p>
        )}

        <div className="mt-6 flex justify-end gap-3">
          <button
            type="button"
            onClick={onCancelar}
            disabled={cargando}
            className="rounded-lg border border-slate-700 bg-slate-800 px-4 py-2 text-sm text-slate-200 transition hover:bg-slate-700 disabled:opacity-60"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={onConfirmar}
            disabled={cargando}
            className="flex items-center gap-2 rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-red-500 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {cargando && <Loader2 className="h-4 w-4 animate-spin" />}
            {textoConfirmar}
          </button>
        </div>
      </div>
    </div>
  );
}
