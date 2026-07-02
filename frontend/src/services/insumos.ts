// ============================================================
//  Servicio de Insumos (y categorías): llamadas a /insumos y /categorias.
//
//  Usa apiFetch (token + 401 global) y el helper compartido mensajeDeError.
// ============================================================

import { apiFetch } from "./api";
import { mensajeDeError } from "./errores";

// Insumo tal como lo devuelve el backend (InsumoRespuesta). OJO: trae
// categoria_id (un número), NO el nombre de la categoría: el nombre lo
// resolvemos en el frontend cruzando contra la lista de categorías.
export interface Insumo {
  id: number;
  nombre: string;
  categoria_id: number | null;
  cantidad: number;
  stock_minimo: number;
}

export interface Categoria {
  id: number;
  nombre: string;
}

// Datos que enviamos al crear/editar un insumo. categoria_id AHORA es un número
// obligatorio (antes admitía null = "sin categoría"): la categoría dejó de ser
// opcional. El backend exige un id válido al crear y el formulario siempre envía
// una categoría elegida (también al editar), así que aquí ya no hay null.
export interface InsumoEntrada {
  nombre: string;
  categoria_id: number;
  cantidad: number;
  stock_minimo: number;
}

// Datos para crear una categoría (POST /categorias): solo el nombre.
export interface CategoriaEntrada {
  nombre: string;
}

// GET /insumos -> todos los insumos.
export async function listarInsumos(): Promise<Insumo[]> {
  const r = await apiFetch("/insumos");
  if (!r.ok) throw new Error(await mensajeDeError(r, "No se pudieron cargar los insumos."));
  return r.json();
}

// GET /insumos/alertas -> solo los insumos con stock bajo (cantidad <= mínimo).
// El backend es la fuente de verdad de qué está "en alerta".
export async function insumosEnAlerta(): Promise<Insumo[]> {
  const r = await apiFetch("/insumos/alertas");
  if (!r.ok) throw new Error(await mensajeDeError(r, "No se pudieron cargar las alertas de stock."));
  return r.json();
}

// GET /categorias -> para llenar el desplegable del formulario y mostrar nombres.
export async function listarCategorias(): Promise<Categoria[]> {
  const r = await apiFetch("/categorias");
  if (!r.ok) throw new Error(await mensajeDeError(r, "No se pudieron cargar las categorías."));
  return r.json();
}

// POST /categorias -> crea una categoría (solo admin). El backend responde 409 si
// el nombre ya existe; mensajeDeError expone ese texto tal cual al usuario.
export async function crearCategoria(datos: CategoriaEntrada): Promise<Categoria> {
  const r = await apiFetch("/categorias", { method: "POST", body: JSON.stringify(datos) });
  if (!r.ok) throw new Error(await mensajeDeError(r, "No se pudo crear la categoría."));
  return r.json();
}

// POST /insumos -> crea un insumo.
export async function crearInsumo(datos: InsumoEntrada): Promise<Insumo> {
  const r = await apiFetch("/insumos", { method: "POST", body: JSON.stringify(datos) });
  if (!r.ok) throw new Error(await mensajeDeError(r, "No se pudo crear el insumo."));
  return r.json();
}

// PUT /insumos/{id} -> edición parcial.
export async function actualizarInsumo(id: number, datos: InsumoEntrada): Promise<Insumo> {
  const r = await apiFetch(`/insumos/${id}`, { method: "PUT", body: JSON.stringify(datos) });
  if (!r.ok) throw new Error(await mensajeDeError(r, "No se pudo actualizar el insumo."));
  return r.json();
}

// DELETE /insumos/{id} -> elimina el insumo (puede dar 409 por integridad).
export async function eliminarInsumo(id: number): Promise<void> {
  const r = await apiFetch(`/insumos/${id}`, { method: "DELETE" });
  if (!r.ok) throw new Error(await mensajeDeError(r, "No se pudo eliminar el insumo."));
}
