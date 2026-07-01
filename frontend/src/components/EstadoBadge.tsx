// ============================================================
//  Etiqueta de color (badge) para el estado de un pedido.
//
//  Colores: recibido = azul, en proceso = violeta, listo = ámbar,
//  entregado = verde. Cualquier estado desconocido cae a un gris neutro.
// ============================================================

interface Props {
  estado: string;
}

// Mapa estado -> clases de color (fondo translúcido + texto + borde).
const COLORES: Record<string, string> = {
  recibido: "bg-blue-500/15 text-blue-300 border-blue-500/30",
  "en proceso": "bg-violet-500/15 text-violet-300 border-violet-500/30",
  listo: "bg-amber-500/15 text-amber-300 border-amber-500/30",
  entregado: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
};

export default function EstadoBadge({ estado }: Props) {
  const clase =
    COLORES[estado] ?? "bg-slate-500/15 text-slate-300 border-slate-500/30";
  return (
    <span
      className={`inline-block whitespace-nowrap rounded-full border px-2.5 py-0.5 text-xs font-medium capitalize ${clase}`}
    >
      {estado}
    </span>
  );
}
