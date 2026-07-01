// ============================================================
//  Servicio de Usuarios: llamadas al CRUD /usuarios del backend (solo admin).
//
//  Usa apiFetch (agrega el token + maneja el 401 global) y el helper compartido
//  mensajeDeError para traducir los errores del backend a texto legible
//  (incluido el 409 de "nombre de usuario ya en uso").
//
//  SEGURIDAD: el backend NUNCA devuelve la contraseña ni su hash (UsuarioRespuesta
//  no los incluye), así que del lado del cliente tampoco existen. Acá solo
//  manejamos datos públicos del usuario (id, nombre_usuario, rol, nombre_completo).
// ============================================================

import { apiFetch } from "./api";
import { mensajeDeError } from "./errores";

// Los dos roles válidos (coinciden con el Literal del backend).
export type Rol = "administrador" | "empleado";

// Usuario tal como lo devuelve el backend (UsuarioRespuesta). Sin contraseña.
export interface Usuario {
  id: number;
  nombre_usuario: string;
  rol: Rol;
  nombre_completo: string | null;
}

// Datos para CREAR un usuario (POST /usuarios). La contraseña es OBLIGATORIA:
// viaja en texto plano y el backend la hashea con bcrypt antes de guardarla.
export interface UsuarioCrear {
  nombre_usuario: string;
  contrasena: string;
  rol: Rol;
  nombre_completo: string | null;
}

// Datos para EDITAR un usuario (PUT /usuarios/{id}). Edición parcial:
//  - nombre_completo y rol se envían siempre (los dejamos editar).
//  - contrasena es OPCIONAL: si se omite la clave, el backend (exclude_unset)
//    NO la toca; si se incluye, la cambia. Por eso el campo es opcional y, si no
//    se cambia, directamente NO mandamos la clave (no mandamos "" ni null).
//  - nombre_usuario NO se envía: en edición lo dejamos fijo (identificador de
//    login). El backend igual lo soporta, pero acá no lo exponemos a cambios.
export interface UsuarioActualizar {
  nombre_completo: string | null;
  rol: Rol;
  contrasena?: string;
}

// GET /usuarios -> lista de usuarios (sin contraseñas).
export async function listarUsuarios(): Promise<Usuario[]> {
  const r = await apiFetch("/usuarios");
  if (!r.ok) throw new Error(await mensajeDeError(r, "No se pudieron cargar los usuarios."));
  return r.json();
}

// POST /usuarios -> crea un usuario. 409 si el nombre de usuario ya existe.
export async function crearUsuario(datos: UsuarioCrear): Promise<Usuario> {
  const r = await apiFetch("/usuarios", { method: "POST", body: JSON.stringify(datos) });
  if (!r.ok) throw new Error(await mensajeDeError(r, "No se pudo crear el usuario."));
  return r.json();
}

// PUT /usuarios/{id} -> edición parcial. 409 si el nombre de usuario choca.
export async function actualizarUsuario(
  id: number,
  datos: UsuarioActualizar
): Promise<Usuario> {
  const r = await apiFetch(`/usuarios/${id}`, { method: "PUT", body: JSON.stringify(datos) });
  if (!r.ok) throw new Error(await mensajeDeError(r, "No se pudo actualizar el usuario."));
  return r.json();
}

// DELETE /usuarios/{id} -> elimina un usuario. Puede dar 409 (tiene pedidos
// asociados, es el último admin, o es tu propia cuenta): el mensaje del backend
// se muestra tal cual al usuario.
export async function eliminarUsuario(id: number): Promise<void> {
  const r = await apiFetch(`/usuarios/${id}`, { method: "DELETE" });
  if (!r.ok) throw new Error(await mensajeDeError(r, "No se pudo eliminar el usuario."));
}
