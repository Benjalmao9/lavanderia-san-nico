// ============================================================
//  Servicio de Auditoría: lectura de la bitácora (GET /auditoria, solo admin).
//
//  Es de SOLO LECTURA: no hay crear/editar/borrar. El backend devuelve los
//  registros del más reciente al más antiguo y acota la cantidad con 'limite'
//  (por defecto 100, máximo 500).
//
//  OJO: cada registro trae 'usuario_id' (un número), NO el nombre de quien hizo
//  la acción. El nombre lo resolvemos en el frontend cruzando contra la lista de
//  usuarios (igual que insumos hace con las categorías). Un usuario_id nulo
//  significa "sistema" (p. ej. un login fallido, sin usuario identificado).
// ============================================================

import { apiFetch } from "./api";
import { mensajeDeError } from "./errores";

// Registro de auditoría tal como lo devuelve el backend (AuditoriaRespuesta).
export interface RegistroAuditoria {
  id: number;
  usuario_id: number | null;
  accion: string;
  entidad: string | null;
  entidad_id: number | null;
  detalle: string | null;
  fecha: string; // fecha+hora en formato ISO
}

// GET /auditoria?limite=N -> los N registros más recientes (orden: nuevo -> viejo).
export async function listarAuditoria(limite: number): Promise<RegistroAuditoria[]> {
  const r = await apiFetch(`/auditoria?limite=${limite}`);
  if (!r.ok) throw new Error(await mensajeDeError(r, "No se pudo cargar la auditoría."));
  return r.json();
}
