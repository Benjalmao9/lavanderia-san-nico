// ============================================================
//  Contenedor (tarjeta) para una gráfica.
//
//  Da el marco y el título, y resuelve los estados internos del recuadro:
//   - cargando -> spinner,
//   - vacia    -> mensaje "sin datos para este periodo" (para que la gráfica no
//                 se rompa cuando un reporte viene vacío),
//   - si no, muestra la gráfica (children) con una altura fija (la gráfica usa
//     ResponsiveContainer para llenar ese espacio).
// ============================================================

import type { ReactNode } from "react";
import { Loader2 } from "lucide-react";

interface Props {
  titulo: string;
  cargando: boolean;
  vacia: boolean;
  children: ReactNode;
}

export default function TarjetaGrafica({ titulo, cargando, vacia, children }: Props) {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-5">
      <h3 className="mb-4 text-sm font-medium text-slate-300">{titulo}</h3>
      {/* Altura fija: la gráfica (ResponsiveContainer) la llena al 100%. */}
      <div className="h-64">
        {cargando ? (
          <div className="flex h-full items-center justify-center text-slate-500">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        ) : vacia ? (
          <div className="flex h-full items-center justify-center text-sm text-slate-500">
            Sin datos para este periodo.
          </div>
        ) : (
          children
        )}
      </div>
    </div>
  );
}
