// ============================================================
//  Selector de periodo: rango de fechas + agrupación (día/mes/año).
//
//  Es un componente "controlado": no guarda estado propio, recibe los valores
//  actuales y avisa de los cambios con callbacks. La página (PanelPage) es la
//  dueña del estado y, cuando cambia, vuelve a pedir las gráficas que dependen
//  del periodo.
// ============================================================

import type { Agrupacion } from "../../services/reportes";

interface Props {
  fechaInicio: string;
  fechaFin: string;
  agrupacion: Agrupacion;
  onFechaInicio: (v: string) => void;
  onFechaFin: (v: string) => void;
  onAgrupacion: (v: Agrupacion) => void;
}

const claseControl =
  "rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-200 outline-none transition focus:border-acero focus:ring-2 focus:ring-acero/40";

export default function SelectorPeriodo({
  fechaInicio,
  fechaFin,
  agrupacion,
  onFechaInicio,
  onFechaFin,
  onAgrupacion,
}: Props) {
  return (
    <div className="flex flex-wrap items-end gap-3">
      <div>
        <label className="mb-1 block text-xs text-slate-400">Desde</label>
        <input
          type="date"
          value={fechaInicio}
          onChange={(e) => onFechaInicio(e.target.value)}
          className={claseControl}
        />
      </div>
      <div>
        <label className="mb-1 block text-xs text-slate-400">Hasta</label>
        <input
          type="date"
          value={fechaFin}
          onChange={(e) => onFechaFin(e.target.value)}
          className={claseControl}
        />
      </div>
      <div>
        <label className="mb-1 block text-xs text-slate-400">Agrupar por</label>
        <select
          value={agrupacion}
          onChange={(e) => onAgrupacion(e.target.value as Agrupacion)}
          className={claseControl}
        >
          <option value="dia">Día</option>
          <option value="mes">Mes</option>
          <option value="anio">Año</option>
        </select>
      </div>
    </div>
  );
}
