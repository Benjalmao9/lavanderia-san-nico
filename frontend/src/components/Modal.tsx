// ============================================================
//  Modal reutilizable (ventana centrada sobre un fondo oscurecido).
//
//  El comportamiento accesible (bloqueo de scroll del fondo, cierre con Escape,
//  trampa de foco y retorno del foco al disparador) lo aporta el hook compartido
//  useDialogoModal. Acá solo armamos la estructura visual.
//
//  'cargando': mientras una acción (p. ej. guardar el formulario) está en curso,
//  bloqueamos el cierre por Escape, por clic en el fondo y por el botón X. Si no,
//  el usuario podría cerrar el modal con la petición en vuelo y (a) no ver el
//  error si falla y (b) reabrir y reenviar, duplicando el alta.
// ============================================================

import type { ReactNode } from "react";
import { X } from "lucide-react";
import { useDialogoModal } from "../hooks/useDialogoModal";

interface Props {
  titulo: string;
  onCerrar: () => void;
  children: ReactNode;
  cargando?: boolean;
}

export default function Modal({ titulo, onCerrar, children, cargando = false }: Props) {
  const refDialogo = useDialogoModal(onCerrar, cargando);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Fondo oscurecido: un clic aquí cierra el modal (salvo mientras guarda). */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={cargando ? undefined : onCerrar}
        aria-hidden
      />

      {/* Tarjeta del modal. En móvil ocupa casi todo el ancho y, si el contenido
          es alto (formulario largo + teclado en pantalla), se limita a 90vh con
          scroll interno para que no se corten campos ni botones. */}
      <div
        ref={refDialogo}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        className="relative z-10 max-h-[90vh] w-full max-w-md overflow-y-auto rounded-2xl border border-slate-800 bg-slate-900 p-5 shadow-2xl outline-none sm:p-6"
      >
        <div className="mb-5 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-slate-100">{titulo}</h2>
          <button
            type="button"
            onClick={onCerrar}
            disabled={cargando}
            aria-label="Cerrar"
            className="rounded-md p-1 text-slate-400 transition hover:text-slate-200 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
