// ============================================================
//  Utilidades de formato para mostrar datos al usuario.
//
//  Los montos (kilos, precio, total) pueden llegar del backend como número o
//  como string (según cómo serialice el Decimal), así que SIEMPRE los pasamos
//  por Number() antes de formatear. Si no es un número válido, mostramos "—".
// ============================================================

export function formatearMoneda(valor: number | string): string {
  const n = Number(valor);
  if (Number.isNaN(n)) return "—";
  return "$" + n.toLocaleString("es-AR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function formatearNumero(valor: number | string, decimales = 2): string {
  const n = Number(valor);
  if (Number.isNaN(n)) return "—";
  return n.toLocaleString("es-AR", {
    minimumFractionDigits: 0,
    maximumFractionDigits: decimales,
  });
}

// Convierte la fecha ISO del backend (ej: "2026-06-28T14:30:00") a algo legible
// (28/06/2026, 14:30). Si no hay fecha o es inválida, devuelve "—".
export function formatearFecha(iso: string | null): string {
  if (!iso) return "—";
  const fecha = new Date(iso);
  if (Number.isNaN(fecha.getTime())) return "—";
  return fecha.toLocaleString("es-AR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
