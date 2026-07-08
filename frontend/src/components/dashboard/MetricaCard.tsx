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
  // Si se pasa, la tarjeta es CLICKEABLE (navega a su sección filtrada). Se
  // renderiza como <button> (accesible con teclado) con un hover discreto.
  onClick?: () => void;
}

export default function MetricaCard({ titulo, valor, icono: Icono, secundario, acento = "acero", onClick }: Props) {
  const colorIcono = acento === "ambar" ? "text-amber-400" : "text-acero";
  const claseBase = "rounded-xl border border-slate-800 bg-slate-900/60 p-5";

  const contenido = (
    <>
      <div className="flex items-center justify-between">
        <span className="text-sm text-slate-400">{titulo}</span>
        <Icono className={`h-5 w-5 ${colorIcono}`} aria-hidden />
      </div>
      <p className="mt-2 text-2xl font-semibold text-slate-100">{valor}</p>
      {secundario && <p className="mt-1 text-xs text-slate-500">{secundario}</p>}
    </>
  );

  // Clickeable: <button> con cursor pointer y un hover sutil (borde azul acero),
  // coherente con el estilo oscuro. Si no hay onClick, es un <div> informativo.
  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        className={`${claseBase} w-full cursor-pointer text-left transition hover:border-acero/50 hover:bg-slate-900 focus:outline-none focus:ring-2 focus:ring-acero/40`}
      >
        {contenido}
      </button>
    );
  }
  return <div className={claseBase}>{contenido}</div>;
}
