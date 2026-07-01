// ============================================================
//  Formulario de Usuario (crear / editar) dentro de un Modal.
//
//  - usuario=null  -> CREAR (POST /usuarios): pide nombre de usuario, nombre
//    completo, rol y contraseña (obligatoria).
//  - usuario=objeto -> EDITAR (PUT /usuarios/{id}): deja cambiar nombre completo
//    y rol. El NOMBRE DE USUARIO queda fijo (es el identificador de login) y se
//    muestra solo como referencia. La CONTRASEÑA es OPCIONAL: si se deja vacía,
//    NO se cambia; si se completa, se actualiza.
//
//  SEGURIDAD / validación espejada del backend:
//   - nombre_usuario: 3-50 caracteres (solo en alta).
//   - contraseña: mínimo 8 caracteres, con al menos una letra y un dígito, y
//     como máximo 72 BYTES (límite real de bcrypt; en UTF-8 un acento ocupa 2
//     bytes, así que validamos bytes y no solo caracteres, igual que el backend).
//   - nombre_completo: opcional, hasta 150 caracteres (vacío -> null).
//  Igual que en el backend, NUNCA mostramos ni manejamos hashes de contraseña.
// ============================================================

import { useState } from "react";
import type { FormEvent } from "react";
import { Loader2 } from "lucide-react";
import Modal from "./Modal";
import { crearUsuario, actualizarUsuario } from "../services/usuarios";
import type { Usuario, Rol } from "../services/usuarios";

interface Props {
  usuario: Usuario | null; // null = crear; objeto = editar
  onCerrar: () => void;
  onGuardado: () => void; // el padre recarga la tabla y cierra
}

interface ErroresForm {
  nombre_usuario?: string;
  contrasena?: string;
  nombre_completo?: string;
}

function claseInput(hayError: boolean): string {
  const base =
    "w-full rounded-lg border bg-slate-800 px-3 py-2 text-slate-100 placeholder-slate-500 outline-none transition focus:ring-2 focus:ring-acero/40";
  return hayError
    ? `${base} border-red-500/60 focus:border-red-500`
    : `${base} border-slate-700 focus:border-acero`;
}

// Cuenta los BYTES UTF-8 de un texto (para replicar el límite de 72 bytes de
// bcrypt). TextEncoder devuelve los bytes reales de la codificación.
function bytesUtf8(texto: string): number {
  return new TextEncoder().encode(texto).length;
}

export default function UsuarioFormModal({ usuario, onCerrar, onGuardado }: Props) {
  const esEdicion = usuario !== null;

  const [nombreUsuario, setNombreUsuario] = useState(usuario?.nombre_usuario ?? "");
  const [nombreCompleto, setNombreCompleto] = useState(usuario?.nombre_completo ?? "");
  const [rol, setRol] = useState<Rol>(usuario?.rol ?? "empleado");
  // En edición arranca vacía: vacía significa "no cambiar la contraseña".
  const [contrasena, setContrasena] = useState("");

  const [errores, setErrores] = useState<ErroresForm>({});
  const [errorGeneral, setErrorGeneral] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  function validar(): ErroresForm {
    const e: ErroresForm = {};

    // Nombre de usuario: solo se valida al CREAR (en edición queda fijo).
    if (!esEdicion) {
      const u = nombreUsuario.trim();
      if (u.length < 3) e.nombre_usuario = "Mínimo 3 caracteres.";
      else if (u.length > 50) e.nombre_usuario = "Máximo 50 caracteres.";
    }

    // Contraseña:
    //  - al CREAR es obligatoria.
    //  - al EDITAR es opcional: si está vacía, no se valida (no se cambia).
    // Cuando hay valor, exigimos las MISMAS reglas que el backend.
    const c = contrasena; // OJO: no recortamos; un espacio puede ser parte de la clave.
    const debeValidarClave = !esEdicion || c.length > 0;
    if (debeValidarClave) {
      // Contamos PUNTOS DE CÓDIGO ([...c]) y no c.length: String.length cuenta
      // unidades UTF-16 (un emoji vale 2), mientras Pydantic (min_length) cuenta
      // puntos de código. Sin esto, una clave con emojis podría pasar acá y que
      // el backend la rechace con un 422 (o al revés). El spread itera por code
      // points, igual que el backend.
      if ([...c].length < 8) {
        e.contrasena = "Mínimo 8 caracteres.";
      } else if (!/[A-Za-z]/.test(c) || !/[0-9]/.test(c)) {
        e.contrasena = "Debe incluir al menos una letra y un número.";
      } else if (bytesUtf8(c) > 72) {
        e.contrasena = "Demasiado larga (máximo 72 bytes).";
      }
    }

    // Nombre completo: opcional, pero si se completa, hasta 150 caracteres.
    const nc = nombreCompleto.trim();
    if (nc.length > 150) e.nombre_completo = "Máximo 150 caracteres.";

    return e;
  }

  async function manejarEnvio(ev: FormEvent) {
    ev.preventDefault();
    setErrorGeneral(null);

    const e = validar();
    setErrores(e);
    if (Object.keys(e).length > 0) return;

    // nombre_completo vacío -> null (el backend exige min_length=1 si viene con
    // valor; mandar null es la forma correcta de decir "sin nombre completo").
    const nombreCompletoFinal = nombreCompleto.trim() === "" ? null : nombreCompleto.trim();

    setGuardando(true);
    try {
      if (esEdicion && usuario) {
        // Edición parcial: mandamos nombre_completo y rol siempre; la contraseña
        // SOLO si el usuario escribió una nueva (si quedó vacía, omitimos la
        // clave y el backend no la toca).
        await actualizarUsuario(usuario.id, {
          nombre_completo: nombreCompletoFinal,
          rol,
          ...(contrasena.length > 0 ? { contrasena } : {}),
        });
      } else {
        await crearUsuario({
          nombre_usuario: nombreUsuario.trim(),
          contrasena,
          rol,
          nombre_completo: nombreCompletoFinal,
        });
      }
      onGuardado();
    } catch (err) {
      setErrorGeneral(err instanceof Error ? err.message : "No se pudo guardar el usuario.");
    } finally {
      setGuardando(false);
    }
  }

  return (
    <Modal
      titulo={esEdicion ? `Editar usuario #${usuario?.id}` : "Nuevo usuario"}
      onCerrar={onCerrar}
      cargando={guardando}
    >
      <form onSubmit={manejarEnvio} className="space-y-4" noValidate>
        {/* Nombre de usuario: editable al crear; fijo (solo lectura) al editar */}
        <div>
          <label htmlFor="nombre_usuario" className="mb-1.5 block text-sm text-slate-300">
            Nombre de usuario
          </label>
          {esEdicion ? (
            // En edición lo mostramos deshabilitado: es el identificador de login
            // y no lo dejamos cambiar desde esta pantalla.
            <input
              id="nombre_usuario"
              type="text"
              value={nombreUsuario}
              disabled
              className="w-full cursor-not-allowed rounded-lg border border-slate-800 bg-slate-800/50 px-3 py-2 text-slate-400"
            />
          ) : (
            <input
              id="nombre_usuario"
              type="text"
              value={nombreUsuario}
              onChange={(ev) => setNombreUsuario(ev.target.value)}
              placeholder="Ej: jdominguez"
              autoComplete="off"
              className={claseInput(!!errores.nombre_usuario)}
            />
          )}
          {errores.nombre_usuario && (
            <p className="mt-1 text-xs text-red-400">{errores.nombre_usuario}</p>
          )}
        </div>

        {/* Nombre completo (opcional) */}
        <div>
          <label htmlFor="nombre_completo" className="mb-1.5 block text-sm text-slate-300">
            Nombre completo <span className="text-slate-500">(opcional)</span>
          </label>
          <input
            id="nombre_completo"
            type="text"
            value={nombreCompleto}
            onChange={(ev) => setNombreCompleto(ev.target.value)}
            placeholder="Ej: Juan Domínguez"
            className={claseInput(!!errores.nombre_completo)}
          />
          {errores.nombre_completo && (
            <p className="mt-1 text-xs text-red-400">{errores.nombre_completo}</p>
          )}
        </div>

        {/* Rol */}
        <div>
          <label htmlFor="rol" className="mb-1.5 block text-sm text-slate-300">
            Rol
          </label>
          <select
            id="rol"
            value={rol}
            onChange={(ev) => setRol(ev.target.value as Rol)}
            className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-slate-100 outline-none transition focus:border-acero focus:ring-2 focus:ring-acero/40"
          >
            <option value="empleado">Empleado</option>
            <option value="administrador">Administrador</option>
          </select>
        </div>

        {/* Contraseña: obligatoria al crear, opcional al editar */}
        <div>
          <label htmlFor="contrasena" className="mb-1.5 block text-sm text-slate-300">
            Contraseña{" "}
            {esEdicion && (
              <span className="text-slate-500">(dejar vacía para no cambiarla)</span>
            )}
          </label>
          <input
            id="contrasena"
            type="password"
            value={contrasena}
            onChange={(ev) => setContrasena(ev.target.value)}
            placeholder={esEdicion ? "••••••••" : "Mínimo 8, con letra y número"}
            autoComplete="new-password"
            className={claseInput(!!errores.contrasena)}
          />
          {errores.contrasena && (
            <p className="mt-1 text-xs text-red-400">{errores.contrasena}</p>
          )}
        </div>

        {/* Error general del backend (ej: nombre de usuario duplicado -> 409) */}
        {errorGeneral && (
          <p className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
            {errorGeneral}
          </p>
        )}

        {/* Botones */}
        <div className="flex justify-end gap-3 pt-2">
          <button
            type="button"
            onClick={onCerrar}
            disabled={guardando}
            className="rounded-lg border border-slate-700 bg-slate-800 px-4 py-2 text-sm text-slate-200 transition hover:bg-slate-700 disabled:opacity-60"
          >
            Cancelar
          </button>
          <button
            type="submit"
            disabled={guardando}
            className="flex items-center gap-2 rounded-lg bg-acero px-4 py-2 text-sm font-medium text-white transition hover:bg-acero-fuerte disabled:cursor-not-allowed disabled:opacity-60"
          >
            {guardando && <Loader2 className="h-4 w-4 animate-spin" />}
            {esEdicion ? "Guardar cambios" : "Crear usuario"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
