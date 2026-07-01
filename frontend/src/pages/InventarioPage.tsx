// ============================================================
//  Pantalla de Inventario (insumos), conectada a la API real.
//
//  CÓMO SE CARGAN LOS DATOS:
//  cargar() pide EN PARALELO (Promise.all) tres cosas: la lista de insumos
//  (GET /insumos), los insumos en alerta (GET /insumos/alertas) y las categorías
//  (GET /categorias). Las categorías sirven para dos cosas: (1) mostrar el NOMBRE
//  de la categoría en la tabla (el backend solo manda categoria_id, así que
//  cruzamos id -> nombre con un Map) y (2) llenar el desplegable del formulario.
//
//  CÓMO SE SINCRONIZA LA SECCIÓN DE ALERTAS:
//  La fuente de verdad de "qué está en alerta" es el backend (/insumos/alertas).
//  Por eso, cada vez que se crea/edita/borra un insumo, llamamos a cargar() de
//  nuevo, que vuelve a pedir TANTO los insumos COMO las alertas. Así la caja de
//  alertas y el resaltado de la tabla quedan siempre consistentes (p. ej. si
//  subís la cantidad de un insumo por encima del mínimo, sale de la alerta solo).
//
//  ESTADOS DE UI: cargando / error (con reintentar) / vacío / tabla.
// ============================================================

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Plus,
  Search,
  Pencil,
  Trash2,
  Loader2,
  AlertCircle,
  AlertTriangle,
  Inbox,
} from "lucide-react";
import {
  listarInsumos,
  insumosEnAlerta,
  listarCategorias,
  eliminarInsumo,
} from "../services/insumos";
import type { Insumo, Categoria } from "../services/insumos";
import AlertasStock from "../components/AlertasStock";
import InsumoFormModal from "../components/InsumoFormModal";
import ConfirmDialog from "../components/ConfirmDialog";

export default function InventarioPage() {
  const [insumos, setInsumos] = useState<Insumo[]>([]);
  const [alertas, setAlertas] = useState<Insumo[]>([]);
  const [categorias, setCategorias] = useState<Categoria[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [busqueda, setBusqueda] = useState("");

  const [modal, setModal] = useState<"nuevo" | Insumo | null>(null);

  const [aBorrar, setABorrar] = useState<Insumo | null>(null);
  const [borrando, setBorrando] = useState(false);
  const [errorBorrar, setErrorBorrar] = useState<string | null>(null);

  // Carga (o recarga) insumos + alertas + categorías a la vez.
  const cargar = useCallback(async () => {
    setCargando(true);
    setError(null);
    try {
      const [ins, ale, cats] = await Promise.all([
        listarInsumos(),
        insumosEnAlerta(),
        listarCategorias(),
      ]);
      setInsumos(ins);
      setAlertas(ale);
      setCategorias(cats);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al cargar el inventario.");
    } finally {
      setCargando(false);
    }
  }, []);

  useEffect(() => {
    cargar();
  }, [cargar]);

  // Map id -> nombre de categoría, para mostrar el nombre en la tabla.
  // useMemo: solo se recalcula cuando cambian las categorías.
  const mapaCategorias = useMemo(
    () => new Map(categorias.map((c) => [c.id, c.nombre])),
    [categorias]
  );

  // Conjunto de ids en alerta (del backend), para resaltar esas filas.
  const idsEnAlerta = useMemo(() => new Set(alertas.map((a) => a.id)), [alertas]);

  // Nombre de categoría a mostrar para un insumo.
  function nombreCategoria(insumo: Insumo): string {
    if (insumo.categoria_id == null) return "Sin categoría";
    return mapaCategorias.get(insumo.categoria_id) ?? "—";
  }

  // Filtro por nombre (en el frontend, sobre lo ya cargado).
  const filtrados = insumos.filter((i) =>
    i.nombre.toLowerCase().includes(busqueda.trim().toLowerCase())
  );

  async function confirmarBorrado() {
    if (!aBorrar) return;
    setBorrando(true);
    setErrorBorrar(null);
    try {
      await eliminarInsumo(aBorrar.id);
      setABorrar(null);
      await cargar(); // refresca tabla + alertas
    } catch (err) {
      setErrorBorrar(err instanceof Error ? err.message : "No se pudo eliminar el insumo.");
    } finally {
      setBorrando(false);
    }
  }

  return (
    <div>
      {/* Encabezado */}
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-slate-100">Inventario</h1>
          <p className="mt-1 text-sm text-slate-400">
            Insumos, stock y alertas de reposición.
          </p>
        </div>
        <button
          onClick={() => setModal("nuevo")}
          className="flex shrink-0 items-center gap-2 rounded-lg bg-acero px-4 py-2 text-sm font-medium text-white transition hover:bg-acero-fuerte"
        >
          <Plus className="h-4 w-4" />
          Nuevo insumo
        </button>
      </div>

      {/* Sección de alertas de stock (solo cuando ya cargó y no hay error) */}
      {!cargando && !error && (
        <div className="mt-5">
          <AlertasStock alertas={alertas} />
        </div>
      )}

      {/* Buscador por nombre */}
      <div className="relative mt-5">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
        <input
          type="text"
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
          placeholder="Buscar por nombre..."
          className="w-full rounded-lg border border-slate-700 bg-slate-800 py-2 pl-9 pr-3 text-sm text-slate-100 placeholder-slate-500 outline-none transition focus:border-acero focus:ring-2 focus:ring-acero/40 sm:max-w-xs"
        />
      </div>

      {/* Contenido: cargando / error / vacío / tabla */}
      <div className="mt-5">
        {cargando ? (
          <div className="flex items-center justify-center gap-3 py-16 text-slate-400">
            <Loader2 className="h-5 w-5 animate-spin" />
            Cargando inventario...
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
        ) : insumos.length === 0 ? (
          <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-slate-700 bg-slate-900/40 py-16 text-center text-slate-500">
            <Inbox className="h-8 w-8" />
            <p>No hay insumos aún. Crea el primero con “Nuevo insumo”.</p>
          </div>
        ) : filtrados.length === 0 ? (
          <div className="rounded-xl border border-dashed border-slate-700 bg-slate-900/40 py-12 text-center text-slate-500">
            Ningún insumo coincide con la búsqueda.
          </div>
        ) : (
          // Móvil (debajo de lg): TARJETAS; escritorio (lg+): tabla. Misma lista
          // 'filtrados' y mismos handlers; cambia solo la presentación.
          <>
            {/* MÓVIL: cada insumo como tarjeta. Las que están en alerta se
                resaltan con borde ámbar y una etiqueta "Stock bajo". */}
            <div className="space-y-3 lg:hidden">
              {filtrados.map((i) => {
                const enAlerta = idsEnAlerta.has(i.id);
                return (
                  <div
                    key={i.id}
                    className={`rounded-xl border p-4 ${
                      enAlerta
                        ? "border-amber-500/30 bg-amber-500/5"
                        : "border-slate-800 bg-slate-900/60"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate font-medium text-slate-200">{i.nombre}</p>
                        <p className="mt-0.5 text-xs text-slate-500">
                          #{i.id} · {nombreCategoria(i)}
                        </p>
                      </div>
                      {enAlerta && (
                        <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-xs font-medium text-amber-300">
                          <AlertTriangle className="h-3.5 w-3.5" />
                          Stock bajo
                        </span>
                      )}
                    </div>
                    <div className="mt-3 grid grid-cols-2 gap-y-1 text-sm">
                      <span className="text-slate-500">Cantidad</span>
                      <span
                        className={`text-right ${
                          enAlerta ? "font-medium text-amber-300" : "text-slate-300"
                        }`}
                      >
                        {i.cantidad}
                      </span>
                      <span className="text-slate-500">Stock mínimo</span>
                      <span className="text-right text-slate-400">{i.stock_minimo}</span>
                    </div>
                    <div className="mt-3 flex justify-end gap-2 border-t border-slate-800 pt-3">
                      <button
                        onClick={() => setModal(i)}
                        className="flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-sm text-slate-200 transition hover:bg-slate-700"
                      >
                        <Pencil className="h-4 w-4" />
                        Editar
                      </button>
                      <button
                        onClick={() => {
                          setErrorBorrar(null);
                          setABorrar(i);
                        }}
                        className="flex items-center gap-1.5 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-1.5 text-sm text-red-300 transition hover:bg-red-500/20"
                      >
                        <Trash2 className="h-4 w-4" />
                        Eliminar
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* ESCRITORIO: tabla normal. */}
            <div className="hidden overflow-x-auto rounded-xl border border-slate-800 lg:block">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-slate-800 bg-slate-900/60 text-slate-400">
                  <tr>
                    <th className="px-4 py-3 font-medium">ID</th>
                    <th className="px-4 py-3 font-medium">Nombre</th>
                    <th className="px-4 py-3 font-medium">Categoría</th>
                    <th className="px-4 py-3 text-right font-medium">Cantidad</th>
                    <th className="px-4 py-3 text-right font-medium">Stock mínimo</th>
                    <th className="px-4 py-3 text-right font-medium">Acciones</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800">
                  {filtrados.map((i) => {
                    const enAlerta = idsEnAlerta.has(i.id);
                    return (
                      <tr
                        key={i.id}
                        // Resalte sutil de las filas en stock bajo (tinte ámbar).
                        className={`transition-colors ${
                          enAlerta ? "bg-amber-500/5 hover:bg-amber-500/10" : "hover:bg-slate-900/40"
                        }`}
                      >
                        <td className="px-4 py-3 text-slate-500">#{i.id}</td>
                        <td className="px-4 py-3 font-medium text-slate-200">{i.nombre}</td>
                        <td className="px-4 py-3 text-slate-400">{nombreCategoria(i)}</td>
                        <td className="px-4 py-3 text-right">
                          <span
                            className={`inline-flex items-center gap-1 ${
                              enAlerta ? "font-medium text-amber-300" : "text-slate-300"
                            }`}
                          >
                            {enAlerta && <AlertTriangle className="h-3.5 w-3.5" />}
                            {i.cantidad}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right text-slate-400">{i.stock_minimo}</td>
                        <td className="px-4 py-3">
                          <div className="flex justify-end gap-2">
                            <button
                              onClick={() => setModal(i)}
                              aria-label={`Editar insumo ${i.id}`}
                              className="rounded-md p-2 text-slate-400 transition hover:bg-slate-800 hover:text-acero"
                            >
                              <Pencil className="h-4 w-4" />
                            </button>
                            <button
                              onClick={() => {
                                setErrorBorrar(null);
                                setABorrar(i);
                              }}
                              aria-label={`Eliminar insumo ${i.id}`}
                              className="rounded-md p-2 text-slate-400 transition hover:bg-slate-800 hover:text-red-300"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>

      {/* Modal de crear/editar (le pasamos las categorías para el desplegable) */}
      {modal !== null && (
        <InsumoFormModal
          insumo={modal === "nuevo" ? null : modal}
          categorias={categorias}
          onCerrar={() => setModal(null)}
          onGuardado={() => {
            setModal(null);
            cargar(); // refresca tabla + alertas
          }}
        />
      )}

      {/* Confirmación de borrado */}
      {aBorrar && (
        <ConfirmDialog
          titulo="Eliminar insumo"
          mensaje={`¿Seguro que quieres eliminar “${aBorrar.nombre}”? Esta acción no se puede deshacer.`}
          cargando={borrando}
          error={errorBorrar}
          onConfirmar={confirmarBorrado}
          onCancelar={() => {
            setABorrar(null);
            setErrorBorrar(null);
          }}
        />
      )}
    </div>
  );
}
