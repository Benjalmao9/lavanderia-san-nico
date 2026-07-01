// ============================================================
//  Formulario de Insumo (crear / editar) dentro de un Modal.
//
//  - insumo=null -> CREAR (POST /insumos). insumo=objeto -> EDITAR (PUT /insumos/{id}).
//  - Recibe la lista de CATEGORÍAS ya cargada (la trae la pantalla desde
//    GET /categorias) para llenar el desplegable. categoria es OPCIONAL: la
//    opción "Sin categoría" envía categoria_id = null.
//
//  Validación coherente con el backend: nombre no vacío (<=150), cantidad y
//  stock mínimo enteros >= 0 (no negativos).
// ============================================================

import { useState } from "react";
import type { FormEvent } from "react";
import { Loader2 } from "lucide-react";
import Modal from "./Modal";
import { crearInsumo, actualizarInsumo } from "../services/insumos";
import type { Insumo, Categoria, InsumoEntrada } from "../services/insumos";

interface Props {
  insumo: Insumo | null; // null = crear; objeto = editar
  categorias: Categoria[]; // opciones del desplegable
  onCerrar: () => void;
  onGuardado: () => void; // el padre refresca tabla + alertas y cierra
}

interface ErroresForm {
  nombre?: string;
  cantidad?: string;
  stock_minimo?: string;
}

function claseInput(hayError: boolean): string {
  const base =
    "w-full rounded-lg border bg-slate-800 px-3 py-2 text-slate-100 placeholder-slate-500 outline-none transition focus:ring-2 focus:ring-acero/40";
  return hayError
    ? `${base} border-red-500/60 focus:border-red-500`
    : `${base} border-slate-700 focus:border-acero`;
}

export default function InsumoFormModal({ insumo, categorias, onCerrar, onGuardado }: Props) {
  const esEdicion = insumo !== null;

  const [nombre, setNombre] = useState(insumo?.nombre ?? "");
  // El <select> trabaja con strings; "" representa "Sin categoría" (null).
  const [categoriaId, setCategoriaId] = useState(
    insumo?.categoria_id != null ? String(insumo.categoria_id) : ""
  );
  const [cantidad, setCantidad] = useState(insumo ? String(insumo.cantidad) : "0");
  const [stockMinimo, setStockMinimo] = useState(
    insumo ? String(insumo.stock_minimo) : "0"
  );

  const [errores, setErrores] = useState<ErroresForm>({});
  const [errorGeneral, setErrorGeneral] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  function validar(): ErroresForm {
    const e: ErroresForm = {};

    const n = nombre.trim();
    if (!n) e.nombre = "Ingresa el nombre del insumo.";
    else if (n.length > 150) e.nombre = "Máximo 150 caracteres.";

    // Cantidad y stock mínimo: enteros >= 0 (no negativos, sin decimales) y con
    // tope superior = máximo de un INT de MySQL (la columna es INT). Sin el tope,
    // un número enorme pasaría acá y daría un error confuso del backend.
    const MAX_ENTERO = 2147483647;

    const c = cantidad.trim();
    if (!/^\d+$/.test(c)) e.cantidad = "Debe ser un número entero de 0 o más.";
    else if (Number(c) > MAX_ENTERO) e.cantidad = "El valor es demasiado grande.";

    const s = stockMinimo.trim();
    if (!/^\d+$/.test(s)) e.stock_minimo = "Debe ser un número entero de 0 o más.";
    else if (Number(s) > MAX_ENTERO) e.stock_minimo = "El valor es demasiado grande.";

    return e;
  }

  async function manejarEnvio(ev: FormEvent) {
    ev.preventDefault();
    setErrorGeneral(null);

    const e = validar();
    setErrores(e);
    if (Object.keys(e).length > 0) return;

    const payload: InsumoEntrada = {
      nombre: nombre.trim(),
      // "" -> null (Sin categoría); si hay valor, lo pasamos a número.
      categoria_id: categoriaId === "" ? null : Number(categoriaId),
      cantidad: Number(cantidad),
      stock_minimo: Number(stockMinimo),
    };

    setGuardando(true);
    try {
      if (esEdicion && insumo) {
        await actualizarInsumo(insumo.id, payload);
      } else {
        await crearInsumo(payload);
      }
      onGuardado();
    } catch (err) {
      setErrorGeneral(err instanceof Error ? err.message : "No se pudo guardar el insumo.");
    } finally {
      setGuardando(false);
    }
  }

  return (
    <Modal
      titulo={esEdicion ? `Editar insumo #${insumo?.id}` : "Nuevo insumo"}
      onCerrar={onCerrar}
      cargando={guardando}
    >
      <form onSubmit={manejarEnvio} className="space-y-4" noValidate>
        {/* Nombre */}
        <div>
          <label htmlFor="nombre" className="mb-1.5 block text-sm text-slate-300">
            Nombre
          </label>
          <input
            id="nombre"
            type="text"
            value={nombre}
            onChange={(e) => setNombre(e.target.value)}
            placeholder="Ej: Detergente líquido"
            className={claseInput(!!errores.nombre)}
          />
          {errores.nombre && <p className="mt-1 text-xs text-red-400">{errores.nombre}</p>}
        </div>

        {/* Categoría: desplegable cargado desde la API (con opción Sin categoría) */}
        <div>
          <label htmlFor="categoria" className="mb-1.5 block text-sm text-slate-300">
            Categoría
          </label>
          <select
            id="categoria"
            value={categoriaId}
            onChange={(e) => setCategoriaId(e.target.value)}
            className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-slate-100 outline-none transition focus:border-acero focus:ring-2 focus:ring-acero/40"
          >
            <option value="">Sin categoría</option>
            {categorias.map((c) => (
              <option key={c.id} value={c.id}>
                {c.nombre}
              </option>
            ))}
          </select>
        </div>

        {/* Cantidad y stock mínimo, en una fila */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor="cantidad" className="mb-1.5 block text-sm text-slate-300">
              Cantidad
            </label>
            <input
              id="cantidad"
              type="text"
              inputMode="numeric"
              value={cantidad}
              onChange={(e) => setCantidad(e.target.value)}
              placeholder="0"
              className={claseInput(!!errores.cantidad)}
            />
            {errores.cantidad && (
              <p className="mt-1 text-xs text-red-400">{errores.cantidad}</p>
            )}
          </div>
          <div>
            <label htmlFor="stock_minimo" className="mb-1.5 block text-sm text-slate-300">
              Stock mínimo
            </label>
            <input
              id="stock_minimo"
              type="text"
              inputMode="numeric"
              value={stockMinimo}
              onChange={(e) => setStockMinimo(e.target.value)}
              placeholder="0"
              className={claseInput(!!errores.stock_minimo)}
            />
            {errores.stock_minimo && (
              <p className="mt-1 text-xs text-red-400">{errores.stock_minimo}</p>
            )}
          </div>
        </div>

        {/* Error general del backend */}
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
            {esEdicion ? "Guardar cambios" : "Crear insumo"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
