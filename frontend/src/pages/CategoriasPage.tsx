// ============================================================
//  Pantalla de Categorías (solo admin): lista y CREA categorías de insumos.
//
//  QUÉ HACE: muestra la lista de categorías existentes (id + nombre) y un botón
//  "Nueva categoría" que abre un modal para crear una. Por ahora SOLO lista y
//  crea: no hay editar ni borrar (borrar una categoría en uso desclasificaría
//  insumos, así que se deja fuera del alcance por ahora).
//
//  SEGURIDAD: es protección de INTERFAZ (la ruta usa <AdminRoute>). La barrera
//  REAL la fuerza el backend: POST /categorias exige rol administrador (403 si no).
//
//  ESTADOS DE UI: cargando / error (con reintentar) / vacío / lista. Mismo patrón
//  visual (modo oscuro, azul acero) que Inventario, Usuarios y Auditoría.
// ============================================================

import { useCallback, useEffect, useState } from "react";
import { Plus, Loader2, AlertCircle, Tags } from "lucide-react";
import { listarCategorias } from "../services/insumos";
import type { Categoria } from "../services/insumos";
import CategoriaFormModal from "../components/CategoriaFormModal";

export default function CategoriasPage() {
  const [categorias, setCategorias] = useState<Categoria[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // ¿Está abierto el modal de "Nueva categoría"?
  const [modalAbierto, setModalAbierto] = useState(false);

  // Carga (o recarga) la lista de categorías.
  const cargar = useCallback(async () => {
    setCargando(true);
    setError(null);
    try {
      setCategorias(await listarCategorias());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al cargar las categorías.");
    } finally {
      setCargando(false);
    }
  }, []);

  useEffect(() => {
    cargar();
  }, [cargar]);

  return (
    <div>
      {/* Encabezado + botón de alta */}
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-slate-100">Categorías</h1>
          <p className="mt-1 text-sm text-slate-400">
            Clasificación de los insumos del inventario.
          </p>
        </div>
        <button
          onClick={() => setModalAbierto(true)}
          className="flex shrink-0 items-center gap-2 rounded-lg bg-acero px-4 py-2 text-sm font-medium text-white transition hover:bg-acero-fuerte"
        >
          <Plus className="h-4 w-4" />
          Nueva categoría
        </button>
      </div>

      {/* Contenido: cargando / error / vacío / lista */}
      <div className="mt-5">
        {cargando ? (
          <div className="flex items-center justify-center gap-3 py-16 text-slate-400">
            <Loader2 className="h-5 w-5 animate-spin" />
            Cargando categorías...
          </div>
        ) : error ? (
          <div className="flex flex-col items-center gap-3 rounded-xl border border-red-500/30 bg-red-500/10 py-12 text-center">
            <AlertCircle className="h-8 w-8 text-red-400" />
            <p className="text-red-300">{error}</p>
            <button
              onClick={cargar}
              className="mt-1 rounded-lg border border-slate-700 bg-slate-800 px-4 py-2 text-sm text-slate-200 transition hover:bg-slate-700"
            >
              Reintentar
            </button>
          </div>
        ) : categorias.length === 0 ? (
          <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-slate-700 bg-slate-900/40 py-16 text-center text-slate-500">
            <Tags className="h-8 w-8" />
            <p>No hay categorías aún. Crea la primera con “Nueva categoría”.</p>
          </div>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-slate-800">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-slate-800 bg-slate-900/60 text-slate-400">
                <tr>
                  <th className="px-4 py-3 font-medium">ID</th>
                  <th className="px-4 py-3 font-medium">Nombre</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {categorias.map((c) => (
                  <tr key={c.id} className="transition-colors hover:bg-slate-900/40">
                    <td className="px-4 py-3 text-slate-500">#{c.id}</td>
                    <td className="px-4 py-3 font-medium text-slate-200">{c.nombre}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Modal de alta. Al guardar: cierra y recarga la lista. */}
      {modalAbierto && (
        <CategoriaFormModal
          onCerrar={() => setModalAbierto(false)}
          onGuardado={() => {
            setModalAbierto(false);
            cargar();
          }}
        />
      )}
    </div>
  );
}
