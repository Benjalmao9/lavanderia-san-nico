// ============================================================
//  Servicio de Pedidos: todas las llamadas a /pedidos del backend.
//
//  Usa apiFetch (de api.ts), que ya agrega el token de autorización y maneja el
//  401 global. Cada función traduce una respuesta de error del backend a un
//  mensaje claro (Error con .message) que la interfaz muestra al usuario.
// ============================================================

import { apiFetch } from "./api";
import { mensajeDeError } from "./errores";

// Forma de un pedido tal como lo DEVUELVE el backend (PedidoRespuesta).
// kilos/precio/total se tipan como number|string porque el Decimal del backend
// puede serializarse de cualquiera de las dos formas; los formateadores ya lo
// contemplan (ver utils/formato.ts).
export interface Pedido {
  id: number;
  cliente: string;
  telefono: string | null;
  kilos: number | string;
  precio_por_kilo: number | string;
  total: number | string;
  estado: string;
  fecha_recepcion: string | null;
  fecha_entrega: string | null;
  usuario_id: number | null;
  // Observaciones de texto libre (opcional). Puede ser null/"".
  notas: string | null;
}

// Datos que ENVIAMOS al crear/editar. El total y el estado inicial los maneja
// el backend; 'estado' solo se manda al editar. 'notas' es opcional (null = sin
// notas / borrar las que hubiera).
export interface PedidoEntrada {
  cliente: string;
  telefono: string | null;
  kilos: string;
  precio_por_kilo: string;
  estado?: string;
  notas?: string | null;
}

// GET /pedidos -> lista completa de pedidos.
export async function listarPedidos(): Promise<Pedido[]> {
  const respuesta = await apiFetch("/pedidos");
  if (!respuesta.ok) {
    throw new Error(await mensajeDeError(respuesta, "No se pudieron cargar los pedidos."));
  }
  return respuesta.json();
}

// POST /pedidos -> crea un pedido. Devuelve el pedido creado (con id y total).
export async function crearPedido(datos: PedidoEntrada): Promise<Pedido> {
  const respuesta = await apiFetch("/pedidos", {
    method: "POST",
    body: JSON.stringify(datos),
  });
  if (!respuesta.ok) {
    throw new Error(await mensajeDeError(respuesta, "No se pudo crear el pedido."));
  }
  return respuesta.json();
}

// PUT /pedidos/{id} -> edición parcial. Devuelve el pedido actualizado.
export async function actualizarPedido(id: number, datos: PedidoEntrada): Promise<Pedido> {
  const respuesta = await apiFetch(`/pedidos/${id}`, {
    method: "PUT",
    body: JSON.stringify(datos),
  });
  if (!respuesta.ok) {
    throw new Error(await mensajeDeError(respuesta, "No se pudo actualizar el pedido."));
  }
  return respuesta.json();
}

// PUT /pedidos/{id} enviando SOLO el estado: cambio RÁPIDO desde la lista, sin
// abrir el formulario de edición. El backend valida la transición según el rol
// (un empleado solo avanza un paso; un admin puede ir a cualquier estado válido).
export async function cambiarEstadoPedido(id: number, estado: string): Promise<Pedido> {
  const respuesta = await apiFetch(`/pedidos/${id}`, {
    method: "PUT",
    body: JSON.stringify({ estado }),
  });
  if (!respuesta.ok) {
    throw new Error(await mensajeDeError(respuesta, "No se pudo cambiar el estado del pedido."));
  }
  return respuesta.json();
}

// DELETE /pedidos/{id} -> elimina el pedido.
export async function eliminarPedido(id: number): Promise<void> {
  const respuesta = await apiFetch(`/pedidos/${id}`, { method: "DELETE" });
  if (!respuesta.ok) {
    throw new Error(await mensajeDeError(respuesta, "No se pudo eliminar el pedido."));
  }
}
