// ============================================================
//  Sección de alertas de stock (se muestra arriba del Inventario).
//
//  Recibe la lista de insumos EN ALERTA (la que devuelve GET /insumos/alertas,
//  o sea cantidad <= stock_minimo). El backend es quien decide qué está en
//  alerta; este componente solo lo presenta:
//   - Si hay alertas: caja ámbar con un contador y, por cada insumo, su nombre,
//     la cantidad actual y el stock mínimo (dejando claro que está por debajo).
//   - Si NO hay alertas: caja verde con un mensaje positivo.
// ============================================================

import { AlertTriangle, CheckCircle2 } from "lucide-react";
import type { Insumo } from "../services/insumos";

interface Props {
  alertas: Insumo[];
}

export default function AlertasStock({ alertas }: Props) {
  // Caso positivo: no hay nada por debajo del mínimo.
  if (alertas.length === 0) {
    return (
      <div className="flex items-center gap-3 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-emerald-300">
        <CheckCircle2 className="h-5 w-5 shrink-0" />
        <span className="text-sm">Todo el inventario está en niveles correctos.</span>
      </div>
    );
  }

  // Caso de alerta: caja ámbar con contador y el detalle de cada insumo.
  return (
    <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4">
      <div className="flex items-center gap-2 text-amber-300">
        <AlertTriangle className="h-5 w-5 shrink-0" />
        <h2 className="font-semibold">Stock bajo</h2>
        {/* Contador de cuántos insumos están en alerta */}
        <span className="ml-1 rounded-full bg-amber-500/20 px-2 py-0.5 text-xs font-medium text-amber-200">
          {alertas.length}
        </span>
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        {alertas.map((a) => (
          <div
            key={a.id}
            // min-w-0 + max-w-full + break-words: un nombre largo (incluso una
            // sola palabra sin espacios) se corta dentro del chip en vez de
            // empujar el ancho y provocar scroll horizontal en móvil.
            className="min-w-0 max-w-full break-words rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-sm"
          >
            <span className="font-medium text-amber-100">{a.nombre}</span>
            <span className="ml-2 text-amber-300/90">
              {a.cantidad} / mín {a.stock_minimo}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
