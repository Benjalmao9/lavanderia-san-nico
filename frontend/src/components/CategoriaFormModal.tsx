// ============================================================
//  Formulario para crear una CATEGORÍA dentro de un Modal (solo admin).
//
//  Es un formulario mínimo: un único campo (nombre). Solo CREA (POST /categorias);
//  por ahora no hay editar ni borrar categorías.
//
//  Validación coherente con el backend: nombre no vacío y máximo 100 caracteres
//  (VARCHAR(100)). El backend además rechaza nombres repetidos con un 409, cuyo
//  mensaje ("Ya existe una categoría con ese nombre") mostramos tal cual.
// ============================================================

import { useState } from "react";
import type { FormEvent } from "react";
import { Loader2 } from "lucide-react";
import Modal from "./Modal";
import { crearCategoria } from "../services/insumos";

interface Props {
  onCerrar: () => void;
  onGuardado: () => void; // el padre refresca la lista y cierra el modal
}

export default function CategoriaFormModal({ onCerrar, onGuardado }: Props) {
  const [nombre, setNombre] = useState("");
  // Error de validación del propio campo (nombre) vs. error general del backend
  // (p. ej. el 409 de nombre repetido), que va en un recuadro aparte.
  const [errorNombre, setErrorNombre] = useState<string | null>(null);
  const [errorGeneral, setErrorGeneral] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  function claseInput(hayError: boolean): string {
    const base =
      "w-full rounded-lg border bg-slate-800 px-3 py-2 text-slate-100 placeholder-slate-500 outline-none transition focus:ring-2 focus:ring-acero/40";
    return hayError
      ? `${base} border-red-500/60 focus:border-red-500`
      : `${base} border-slate-700 focus:border-acero`;
  }

  async function manejarEnvio(ev: FormEvent) {
    ev.preventDefault();
    setErrorGeneral(null);

    // Validación en el frontend, coherente con el backend (no vacío, <=100).
    const n = nombre.trim();
    if (!n) {
      setErrorNombre("Ingresa el nombre de la categoría.");
      return;
    }
    if (n.length > 100) {
      setErrorNombre("Máximo 100 caracteres.");
      return;
    }
    setErrorNombre(null);

    setGuardando(true);
    try {
      // Enviamos el nombre ya recortado; el backend igual vuelve a validarlo.
      await crearCategoria({ nombre: n });
      onGuardado();
    } catch (err) {
      // Incluye el 409 "Ya existe una categoría con ese nombre" (mensaje del backend).
      setErrorGeneral(
        err instanceof Error ? err.message : "No se pudo crear la categoría."
      );
    } finally {
      setGuardando(false);
    }
  }

  return (
    <Modal titulo="Nueva categoría" onCerrar={onCerrar} cargando={guardando}>
      <form onSubmit={manejarEnvio} className="space-y-4" noValidate>
        {/* Nombre */}
        <div>
          <label htmlFor="nombre-categoria" className="mb-1.5 block text-sm text-slate-300">
            Nombre
          </label>
          <input
            id="nombre-categoria"
            type="text"
            value={nombre}
            onChange={(e) => {
              setNombre(e.target.value);
              if (errorNombre) setErrorNombre(null);
            }}
            placeholder="Ej: Limpieza"
            autoFocus
            className={claseInput(!!errorNombre)}
          />
          {errorNombre && <p className="mt-1 text-xs text-red-400">{errorNombre}</p>}
        </div>

        {/* Error general del backend (incluye el 409 de nombre repetido) */}
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
            Crear categoría
          </button>
        </div>
      </form>
    </Modal>
  );
}
