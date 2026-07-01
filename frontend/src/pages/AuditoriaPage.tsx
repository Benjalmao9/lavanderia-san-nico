// ============================================================
//  Pantalla de Auditoría (solo admin): bitácora de acciones, SOLO LECTURA.
//
//  QUÉ MUESTRA: fecha/hora, quién hizo la acción, qué acción, sobre qué entidad
//  (y su id) y un detalle. Del más reciente al más antiguo (el backend ya los
//  ordena así). No hay crear/editar/borrar: es una vista de consulta.
//
//  CÓMO SE RESUELVE "QUIÉN":
//  El registro guarda solo 'usuario_id'. Para mostrar el NOMBRE cruzamos contra
//  la lista de usuarios (GET /usuarios), igual que Inventario hace con las
//  categorías. usuario_id nulo -> "sistema" (p. ej. un login fallido). Un id que
//  ya no está en la lista (usuario borrado) se muestra como "usuario #id".
//
//  FILTROS (en el frontend, sobre lo ya cargado):
//   - desplegable por tipo de acción (se arma con las acciones presentes), y
//   - buscador libre (sobre usuario, acción, entidad y detalle).
//
//  "CARGAR MÁS" (paginación por 'limite': 100 inicial, 500 máx del backend):
//  Para saber si hay MÁS historia sin equivocarnos, pedimos UNA fila extra como
//  centinela: si el backend devuelve más filas que las que mostramos, hay más
//  (mostramos solo 'limite' y habilitamos el botón). Así el botón no aparece "en
//  falso" cuando el total es justo un múltiplo del paso. La carga inicial usa el
//  spinner grande; "cargar más" recarga sin ocultar la tabla (spinner en el botón)
//  y, si falla, muestra el error JUNTO al botón sin desmontar lo ya cargado.
// ============================================================

import { useCallback, useEffect, useMemo, useState } from "react";
import { Search, Loader2, AlertCircle, Inbox, ScrollText } from "lucide-react";
import { listarAuditoria } from "../services/auditoria";
import type { RegistroAuditoria } from "../services/auditoria";
import { listarUsuarios } from "../services/usuarios";
import { formatearFecha } from "../utils/formato";

// Parámetros de paginación por 'limite' (coinciden con los topes del backend).
const LIMITE_INICIAL = 100;
const LIMITE_MAXIMO = 500;
const PASO = 100;

// Convierte una acción cruda ('crear_usuario') en una etiqueta legible
// ('Crear usuario'): cambia guiones bajos por espacios y capitaliza.
function etiquetaAccion(accion: string): string {
  const texto = accion.replace(/_/g, " ");
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}

// Color de la pastilla según el tipo de acción, para distinguirlas de un vistazo:
// crear/login_exitoso -> verde; editar -> azul; eliminar/login_fallido -> rojo/ámbar.
function claseAccion(accion: string): string {
  if (accion.startsWith("crear") || accion === "login_exitoso")
    return "bg-emerald-500/15 text-emerald-300 border-emerald-500/30";
  if (accion.startsWith("editar"))
    return "bg-blue-500/15 text-blue-300 border-blue-500/30";
  if (accion.startsWith("eliminar"))
    return "bg-red-500/15 text-red-300 border-red-500/30";
  if (accion === "login_fallido")
    return "bg-amber-500/15 text-amber-300 border-amber-500/30";
  return "bg-slate-500/15 text-slate-300 border-slate-500/30";
}

export default function AuditoriaPage() {
  const [registros, setRegistros] = useState<RegistroAuditoria[]>([]);
  // Map id -> nombre_usuario, para mostrar quién hizo cada acción.
  const [mapaUsuarios, setMapaUsuarios] = useState<Map<number, string>>(new Map());
  const [limite, setLimite] = useState(LIMITE_INICIAL);
  // ¿El backend tiene más registros de los que mostramos? (lo decide el centinela)
  const [hayMas, setHayMas] = useState(false);

  const [cargando, setCargando] = useState(true); // carga inicial / reintento
  const [cargandoMas, setCargandoMas] = useState(false); // botón "cargar más"
  const [error, setError] = useState<string | null>(null); // error de carga inicial
  const [errorMas, setErrorMas] = useState<string | null>(null); // error de "cargar más"

  const [busqueda, setBusqueda] = useState("");
  const [filtroAccion, setFiltroAccion] = useState(""); // "" = todas

  // Carga registros + usuarios (en paralelo). 'esCargaMas' decide qué spinner y
  // qué error usar: el grande (carga inicial, ocupa toda el área) o el del botón
  // (sin ocultar la tabla, con el error inline).
  const cargar = useCallback(async (limiteVisible: number, esCargaMas: boolean) => {
    if (esCargaMas) {
      setCargandoMas(true);
      setErrorMas(null);
    } else {
      setCargando(true);
      setError(null);
    }
    try {
      // Pedimos UNA fila extra (centinela) para saber si hay más, salvo que ya
      // estemos en el tope del backend (no se puede pedir más de 500).
      const pedir = limiteVisible < LIMITE_MAXIMO ? limiteVisible + 1 : LIMITE_MAXIMO;
      const [logs, usuarios] = await Promise.all([
        listarAuditoria(pedir),
        listarUsuarios(),
      ]);
      // Si volvieron MÁS filas que las visibles, hay más historia: mostramos solo
      // 'limiteVisible' y habilitamos "cargar más". El centinela evita el botón
      // fantasma cuando el total es múltiplo exacto del paso.
      setHayMas(logs.length > limiteVisible);
      setRegistros(logs.slice(0, limiteVisible));
      setMapaUsuarios(new Map(usuarios.map((u) => [u.id, u.nombre_usuario])));
      setLimite(limiteVisible);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Error al cargar la auditoría.";
      // En "cargar más" el error va inline JUNTO al botón: NO tocamos 'registros',
      // así la tabla ya cargada permanece a la vista (no se pierde el progreso).
      if (esCargaMas) setErrorMas(msg);
      else setError(msg);
    } finally {
      if (esCargaMas) setCargandoMas(false);
      else setCargando(false);
    }
  }, []);

  useEffect(() => {
    cargar(LIMITE_INICIAL, false);
  }, [cargar]);

  // Nombre a mostrar para un usuario_id: nulo -> "sistema"; id desconocido
  // (usuario borrado) -> "usuario #id".
  function nombreUsuario(id: number | null): string {
    if (id == null) return "sistema";
    return mapaUsuarios.get(id) ?? `usuario #${id}`;
  }

  // Acciones presentes en los datos cargados, para armar el desplegable de filtro.
  const accionesDisponibles = useMemo(
    () => Array.from(new Set(registros.map((r) => r.accion))).sort(),
    [registros]
  );

  // Aplicación de filtros (acción + buscador) sobre lo ya cargado.
  const termino = busqueda.trim().toLowerCase();
  const visibles = registros.filter((r) => {
    if (filtroAccion && r.accion !== filtroAccion) return false;
    if (termino) {
      const texto = [
        nombreUsuario(r.usuario_id),
        r.accion,
        r.entidad ?? "",
        r.detalle ?? "",
      ]
        .join(" ")
        .toLowerCase();
      if (!texto.includes(termino)) return false;
    }
    return true;
  });

  // ¿Se puede traer más? Lo dice el centinela (hayMas) y que no estemos en el tope.
  const puedeCargarMas = hayMas && limite < LIMITE_MAXIMO;
  // ¿Llegamos al tope del backend? (500 registros servidos, no hay forma de traer más).
  const enTope = limite >= LIMITE_MAXIMO && registros.length >= LIMITE_MAXIMO;

  // Entidad + id en un texto: "usuario #3", o solo la entidad, o "—".
  function textoEntidad(r: RegistroAuditoria): string {
    if (!r.entidad) return "—";
    return r.entidad_id != null ? `${r.entidad} #${r.entidad_id}` : r.entidad;
  }

  return (
    <div>
      {/* Encabezado */}
      <div>
        <h1 className="text-2xl font-semibold text-slate-100">Auditoría</h1>
        <p className="mt-1 text-sm text-slate-400">
          Bitácora de acciones del sistema (solo lectura): quién hizo qué y cuándo.
        </p>
      </div>

      {/* Filtros: buscador + desplegable por tipo de acción */}
      <div className="mt-5 flex flex-wrap items-center gap-3">
        <div className="relative flex-1 sm:max-w-md">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
          <input
            type="text"
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            placeholder="Buscar en usuario, acción, entidad o detalle..."
            className="w-full rounded-lg border border-slate-700 bg-slate-800 py-2 pl-9 pr-3 text-sm text-slate-100 placeholder-slate-500 outline-none transition focus:border-acero focus:ring-2 focus:ring-acero/40"
          />
        </div>
        <select
          value={filtroAccion}
          onChange={(e) => setFiltroAccion(e.target.value)}
          className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-200 outline-none transition focus:border-acero focus:ring-2 focus:ring-acero/40"
        >
          <option value="">Todas las acciones</option>
          {accionesDisponibles.map((a) => (
            <option key={a} value={a}>
              {etiquetaAccion(a)}
            </option>
          ))}
        </select>
      </div>

      {/* Contenido: cargando / error / vacío / (tabla o "sin coincidencias") + pie */}
      <div className="mt-5">
        {cargando ? (
          <div className="flex items-center justify-center gap-3 py-16 text-slate-400">
            <Loader2 className="h-5 w-5 animate-spin" />
            Cargando auditoría...
          </div>
        ) : error ? (
          <div className="flex flex-col items-center gap-3 rounded-xl border border-red-500/30 bg-red-500/10 py-12 text-center">
            <AlertCircle className="h-8 w-8 text-red-400" />
            <p className="text-red-300">{error}</p>
            <button
              onClick={() => cargar(LIMITE_INICIAL, false)}
              className="mt-1 rounded-lg border border-slate-700 bg-slate-800 px-4 py-2 text-sm text-slate-200 transition hover:bg-slate-700"
            >
              Reintentar
            </button>
          </div>
        ) : registros.length === 0 ? (
          <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-slate-700 bg-slate-900/40 py-16 text-center text-slate-500">
            <ScrollText className="h-8 w-8" />
            <p>No hay registros de auditoría aún.</p>
          </div>
        ) : (
          // Hay registros cargados. Mostramos la tabla (o el aviso de "sin
          // coincidencias" si el filtro los oculta) y SIEMPRE el pie debajo, para
          // que se pueda "cargar más" aunque el filtro no encuentre nada acá.
          <>
            {visibles.length === 0 ? (
              <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-slate-700 bg-slate-900/40 py-12 text-center text-slate-500">
                <Inbox className="h-8 w-8" />
                <p>
                  Ninguno de los {registros.length} registros cargados coincide con
                  los filtros.
                  {puedeCargarMas && " Prueba cargar más historia."}
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto rounded-xl border border-slate-800">
                {/* min-w fuerza un ancho mínimo: en móvil la tabla no se aplasta,
                    sino que el contenedor (overflow-x-auto) permite deslizarla
                    horizontalmente para ver todas las columnas. */}
                <table className="w-full min-w-[760px] text-left text-sm">
                  <thead className="border-b border-slate-800 bg-slate-900/60 text-slate-400">
                    <tr>
                      <th className="px-4 py-3 font-medium">Fecha y hora</th>
                      <th className="px-4 py-3 font-medium">Usuario</th>
                      <th className="px-4 py-3 font-medium">Acción</th>
                      <th className="px-4 py-3 font-medium">Entidad</th>
                      <th className="px-4 py-3 font-medium">Detalle</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800">
                    {visibles.map((r) => {
                      const esSistema = r.usuario_id == null;
                      return (
                        <tr
                          key={r.id}
                          className="align-top transition-colors hover:bg-slate-900/40"
                        >
                          <td className="whitespace-nowrap px-4 py-3 text-slate-400">
                            {formatearFecha(r.fecha)}
                          </td>
                          <td className="whitespace-nowrap px-4 py-3">
                            {esSistema ? (
                              // "sistema" es un dato real (no un placeholder): lo
                              // dejamos en itálica pero con suficiente contraste.
                              <span className="italic text-slate-400">sistema</span>
                            ) : (
                              <span className="text-slate-200">
                                {nombreUsuario(r.usuario_id)}
                              </span>
                            )}
                          </td>
                          <td className="whitespace-nowrap px-4 py-3">
                            <span
                              className={`inline-block rounded-full border px-2.5 py-0.5 text-xs font-medium ${claseAccion(
                                r.accion
                              )}`}
                            >
                              {etiquetaAccion(r.accion)}
                            </span>
                          </td>
                          <td className="whitespace-nowrap px-4 py-3 text-slate-400">
                            {textoEntidad(r)}
                          </td>
                          <td className="px-4 py-3 text-slate-400">
                            <span className="block max-w-md break-words">
                              {r.detalle ?? "—"}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {/* Pie: contador + "cargar más" / aviso de tope / error inline de
                "cargar más". Se muestra SIEMPRE que haya registros cargados
                (incluso si el filtro oculta todo), para no dejar al usuario sin
                forma de traer más historia. */}
            <div className="mt-4 flex flex-col items-center gap-2">
              <p className="text-xs text-slate-500">
                Mostrando {visibles.length} de {registros.length}{" "}
                {registros.length === 1 ? "registro cargado" : "registros cargados"}.
              </p>
              {errorMas && (
                <p className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
                  {errorMas}
                </p>
              )}
              {puedeCargarMas && (
                <button
                  onClick={() => cargar(Math.min(limite + PASO, LIMITE_MAXIMO), true)}
                  disabled={cargandoMas}
                  className="flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-800 px-4 py-2 text-sm text-slate-200 transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {cargandoMas && <Loader2 className="h-4 w-4 animate-spin" />}
                  Cargar más
                </button>
              )}
              {enTope && (
                <p className="text-xs text-slate-500">
                  Mostrando los {LIMITE_MAXIMO} registros más recientes (máximo).
                </p>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
