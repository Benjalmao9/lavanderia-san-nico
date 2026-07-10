// ============================================================
//  Fallback de carga para los límites de <Suspense>.
//
//  Se muestra el instante en que una pantalla cargada de forma PEREZOSA
//  (React.lazy) todavía está descargando su código. Es a propósito simple y
//  coherente con el resto: modo oscuro y el spinner en azul acero, para que la
//  transición no rompa el estilo (nada de spinners genéricos).
// ============================================================

import { Loader2 } from "lucide-react";

export default function CargandoPagina() {
  return (
    <div className="flex items-center justify-center gap-3 py-24 text-slate-400">
      <Loader2 className="h-6 w-6 animate-spin text-acero" />
      <span className="text-sm">Cargando…</span>
    </div>
  );
}
