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

// ------------------------------------------------------------
//  formatearFecha: AQUÍ ocurre la conversión de UTC a hora local.
//
//  El backend guarda TODAS las fechas en UTC y las manda marcadas como UTC
//  explícito: ISO 8601 terminado en "Z" (ej: "2026-07-03T21:30:00Z"). Esa "Z"
//  es la clave: le dice a new Date() "este instante es UTC", y a partir de ahí
//  toLocaleString() lo muestra automáticamente en la ZONA HORARIA DEL
//  DISPOSITIVO de quien está mirando (México UTC-6 → "03/07/2026, 15:30";
//  alguien en España vería "03/07/2026, 23:30"). No hay que restar horas a
//  mano: las utilidades estándar de JavaScript hacen la conversión solas.
//
//  ¿Por qué así? Guardar en UTC hace que los datos signifiquen lo mismo corra
//  donde corra el servidor, y convertir AL MOSTRAR hace que cada usuario vea
//  su propia hora. (El bug del desfase de 6 horas era exactamente la falta de
//  la "Z": el navegador interpretaba la fecha UTC como si ya fuera local.)
//
//  Si no hay fecha o es inválida, devuelve "—".
// ------------------------------------------------------------
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
