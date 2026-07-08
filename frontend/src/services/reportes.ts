// ============================================================
//  Servicio de Reportes: llamadas a /reportes/* del backend (solo admin).
//
//  Todas pasan por apiFetch, que agrega el token. Los parámetros de fecha y
//  agrupación viajan como query string (?fecha_inicio=...&fecha_fin=...&agrupacion=...).
// ============================================================

import { apiFetch } from "./api";
import { mensajeDeError } from "./errores";

export type Agrupacion = "dia" | "mes" | "anio";

// Límites de fecha válidos para pedir reportes (desde el pedido más antiguo
// hasta hoy). Los calcula el backend; el selector los usa como min/max.
export interface RangoValido {
  fecha_min: string; // YYYY-MM-DD (pedido más antiguo, o hoy si no hay pedidos)
  fecha_max: string; // YYYY-MM-DD (hoy)
}

// Filas que devuelve cada reporte. 'ingresos' puede venir como number o string
// (el Decimal del backend), así que lo tratamos con Number() al graficar.
export interface IngresoPeriodo {
  periodo: string;
  ingresos: number | string;
}
export interface ConteoPeriodo {
  periodo: string;
  cantidad: number;
}
export interface PedidosPorEstado {
  estado: string;
  cantidad: number;
}
export interface PedidosPorEmpleado {
  usuario_id: number | null;
  nombre_completo: string;
  cantidad: number;
}

// Arma el "?clave=valor&..." omitiendo los parámetros vacíos/indefinidos.
function construirQuery(params: Record<string, string | undefined>): string {
  const q = new URLSearchParams();
  for (const [clave, valor] of Object.entries(params)) {
    if (valor !== undefined && valor !== "") q.set(clave, valor);
  }
  const s = q.toString();
  return s ? `?${s}` : "";
}

// GET /reportes/rango-valido -> límites de fecha con sentido para el selector
// (del pedido más antiguo a hoy). Así el frontend NO adivina ni hardcodea un
// valor mágico: los pone como min/max de los inputs de fecha.
export async function rangoValidoReportes(): Promise<RangoValido> {
  const r = await apiFetch("/reportes/rango-valido");
  if (!r.ok) throw new Error(await mensajeDeError(r, "No se pudo obtener el rango de fechas."));
  return r.json();
}

// GET /reportes/ingresos -> suma de ingresos por periodo (depende de fechas + agrupación).
export async function reporteIngresos(
  fechaInicio: string,
  fechaFin: string,
  agrupacion: Agrupacion
): Promise<IngresoPeriodo[]> {
  const q = construirQuery({ fecha_inicio: fechaInicio, fecha_fin: fechaFin, agrupacion });
  const r = await apiFetch(`/reportes/ingresos${q}`);
  if (!r.ok) throw new Error(await mensajeDeError(r, "No se pudieron cargar los ingresos."));
  return r.json();
}

// GET /reportes/pedidos-por-periodo -> conteo de pedidos por periodo.
export async function reportePedidosPorPeriodo(
  fechaInicio: string,
  fechaFin: string,
  agrupacion: Agrupacion
): Promise<ConteoPeriodo[]> {
  const q = construirQuery({ fecha_inicio: fechaInicio, fecha_fin: fechaFin, agrupacion });
  const r = await apiFetch(`/reportes/pedidos-por-periodo${q}`);
  if (!r.ok) throw new Error(await mensajeDeError(r, "No se pudieron cargar los pedidos por periodo."));
  return r.json();
}

// GET /reportes/pedidos-por-estado -> conteo por estado (rango de fechas OPCIONAL).
export async function reportePedidosPorEstado(
  fechaInicio?: string,
  fechaFin?: string
): Promise<PedidosPorEstado[]> {
  const q = construirQuery({ fecha_inicio: fechaInicio, fecha_fin: fechaFin });
  const r = await apiFetch(`/reportes/pedidos-por-estado${q}`);
  if (!r.ok) throw new Error(await mensajeDeError(r, "No se pudieron cargar los pedidos por estado."));
  return r.json();
}

// GET /reportes/pedidos-por-empleado -> conteo por empleado (rango OPCIONAL).
export async function reportePedidosPorEmpleado(
  fechaInicio?: string,
  fechaFin?: string
): Promise<PedidosPorEmpleado[]> {
  const q = construirQuery({ fecha_inicio: fechaInicio, fecha_fin: fechaFin });
  const r = await apiFetch(`/reportes/pedidos-por-empleado${q}`);
  if (!r.ok) throw new Error(await mensajeDeError(r, "No se pudieron cargar los pedidos por empleado."));
  return r.json();
}

// GET /reportes/exportar -> descarga el reporte contable en Excel (.xlsx).
//
// Es una descarga BINARIA autenticada, así que no sirve un <a href> normal (no
// llevaría el token). El patrón: pedimos con apiFetch (que agrega el
// "Authorization: Bearer ..." y maneja el 401 global), leemos el cuerpo como
// BLOB, y disparamos la descarga con una URL temporal + un <a download> que
// clicamos por código. El nombre lo sugiere el backend en Content-Disposition
// (que la API expone en CORS); si no llegara, usamos un fallback con el rango.
export async function exportarReportesExcel(
  fechaInicio: string,
  fechaFin: string,
  agrupacion: Agrupacion
): Promise<void> {
  const q = construirQuery({ fecha_inicio: fechaInicio, fecha_fin: fechaFin, agrupacion });
  const r = await apiFetch(`/reportes/exportar${q}`);
  if (!r.ok) {
    // Ante un error el cuerpo es JSON ({detail}), no el .xlsx: mensajeDeError lo lee.
    throw new Error(await mensajeDeError(r, "No se pudo generar el archivo de Excel."));
  }

  const blob = await r.blob();

  // Nombre de archivo sugerido por el backend (o fallback con el rango).
  const disposition = r.headers.get("Content-Disposition") ?? "";
  const match = /filename="?([^"]+)"?/.exec(disposition);
  const nombre = match?.[1] ?? `reporte_lavanderia_${fechaInicio}_a_${fechaFin}.xlsx`;

  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = nombre;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Liberamos la URL temporal para no dejar el blob en memoria.
  URL.revokeObjectURL(url);
}
