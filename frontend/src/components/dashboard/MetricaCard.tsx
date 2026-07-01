// ============================================================
//  Tarjeta de métrica (los números clave de arriba del dashboard).
//  Muestra un título, un valor grande, un icono y un dato secundario opcional.
//  'acento' permite teñir el icono/valor (p. ej. ámbar para las alertas).
// ============================================================

import type { LucideIcon } from "lucide-react";

interface Props {
  titulo: string;
  valor: string;
  icono: LucideIcon;
  secundario?: string;
  acento?: "acero" | "ambar";
}

export default function MetricaCard({ titulo, valor, icono: Icono, secundario, acento = "acero" }: Props) {
  const colorIcono = acento === "ambar" ? "text-amber-400" : "text-acero";
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-5">
      <div className="flex items-center justify-between">
        <span className="text-sm text-slate-400">{titulo}</span>
        <Icono className={`h-5 w-5 ${colorIcono}`} aria-hidden />
      </div>
      <p className="mt-2 text-2xl font-semibold text-slate-100">{valor}</p>
      {secundario && <p className="mt-1 text-xs text-slate-500">{secundario}</p>}
    </div>
  );
}
