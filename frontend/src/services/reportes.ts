// ============================================================
//  Servicio de Reportes: llamadas a /reportes/* del backend (solo admin).
//
//  Todas pasan por apiFetch, que agrega el token. Los parámetros de fecha y
//  agrupación viajan como query string (?fecha_inicio=...&fecha_fin=...&agrupacion=...).
// ============================================================

import { apiFetch } from "./api";
import { mensajeDeError } from "./errores";

export type Agrupacion = "dia" | "mes" | "anio";

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
