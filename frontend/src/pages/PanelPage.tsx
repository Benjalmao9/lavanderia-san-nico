// ============================================================
//  Panel / Dashboard (pantalla de inicio del admin).
//
//  CÓMO SE PIDEN LOS DATOS:
//  Hay DOS grupos de datos, con cargas independientes:
//   1) MÉTRICAS (las 4 tarjetas de arriba): son una "foto" del estado actual y
//      NO dependen del selector. Se cargan una vez (cargarMetricas) combinando:
//        - ingresos del mes en curso (GET /reportes/ingresos del 1° del mes a hoy),
//        - total y "por entregar" (GET /reportes/pedidos-por-estado, sin rango = histórico),
//        - alertas de stock (GET /insumos/alertas).
//   2) GRÁFICAS (las 4 de abajo): dependen del SELECTOR de periodo. Se cargan en
//      cargarGraficas con el rango de fechas y la agrupación elegidos.
//
//  CÓMO EL SELECTOR ACTUALIZA LAS GRÁFICAS:
//  cargarGraficas está envuelta en useCallback con [fechaInicio, fechaFin,
//  agrupacion] como dependencias. El useEffect que la llama se vuelve a ejecutar
//  cada vez que cambia el selector, así que al mover una fecha o cambiar la
//  agrupación, las 4 gráficas se vuelven a pedir y a dibujar solas.
//
//  ESTADOS: cada grupo maneja su propio cargando/error (con reintentar). Si un
//  reporte viene vacío, su tarjeta muestra "sin datos" en vez de romperse.
//
//  (Esta pantalla es solo para admin: la ruta ya está protegida por AdminRoute,
//  y las llamadas usan apiFetch, que incluye el token.)
// ============================================================

import { useCallback, useEffect, useRef, useState } from "react";
import { Wallet, ClipboardList, Truck, AlertTriangle, AlertCircle } from "lucide-react";
import {
  reporteIngresos,
  reportePedidosPorPeriodo,
  reportePedidosPorEstado,
  reportePedidosPorEmpleado,
} from "../services/reportes";
import type {
  Agrupacion,
  IngresoPeriodo,
  ConteoPeriodo,
  PedidosPorEstado,
  PedidosPorEmpleado,
} from "../services/reportes";
import { insumosEnAlerta } from "../services/insumos";
import { formatearMoneda, formatearNumero } from "../utils/formato";
import MetricaCard from "../components/dashboard/MetricaCard";
import TarjetaGrafica from "../components/dashboard/TarjetaGrafica";
import SelectorPeriodo from "../components/dashboard/SelectorPeriodo";
import {
  GraficaIngresos,
  GraficaPedidosPorEstado,
  GraficaPedidosPorPeriodo,
  GraficaPedidosPorEmpleado,
} from "../components/dashboard/graficas";

// --- Helpers de fecha (YYYY-MM-DD en hora LOCAL, para no correr el día) ---
function aISO(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dia = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dia}`;
}
function hoyISO(): string {
  return aISO(new Date());
}
function primerDiaMesISO(): string {
  const d = new Date();
  return aISO(new Date(d.getFullYear(), d.getMonth(), 1));
}

interface Metricas {
  ingresosMes: number;
  totalPedidos: number;
  porEntregar: number;
  alertas: number;
}
interface DatosGraficas {
  ingresos: IngresoPeriodo[];
  porPeriodo: ConteoPeriodo[];
  porEstado: PedidosPorEstado[];
  porEmpleado: PedidosPorEmpleado[];
  // Agrupación con la que se pidieron estos datos. La guardamos junto a los
  // datos para que el formateo del eje use SIEMPRE la agrupación real de lo que
  // se está mostrando (y no la del selector, que pudo cambiar mientras cargaba).
  agrupacion: Agrupacion;
}

// Cajita de error reutilizable (para métricas y para gráficas).
function CajaError({ mensaje, onReintentar }: { mensaje: string; onReintentar: () => void }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-xl border border-red-500/30 bg-red-500/10 py-10 text-center">
      <AlertCircle className="h-7 w-7 text-red-400" />
      <p className="text-red-300">{mensaje}</p>
      <button
        onClick={onReintentar}
        className="rounded-lg border border-slate-700 bg-slate-800 px-4 py-2 text-sm text-slate-200 transition hover:bg-slate-700"
      >
        Reintentar
      </button>
    </div>
  );
}

export default function PanelPage() {
  // Selector de periodo: por defecto, el MES ACTUAL agrupado por DÍA, así al
  // entrar ya hay datos sin configurar nada.
  const [fechaInicio, setFechaInicio] = useState(primerDiaMesISO());
  const [fechaFin, setFechaFin] = useState(hoyISO());
  const [agrupacion, setAgrupacion] = useState<Agrupacion>("dia");

  // Métricas (tarjetas).
  const [metricas, setMetricas] = useState<Metricas | null>(null);
  const [cargandoMetricas, setCargandoMetricas] = useState(true);
  const [errorMetricas, setErrorMetricas] = useState<string | null>(null);

  // Gráficas.
  const [graficas, setGraficas] = useState<DatosGraficas | null>(null);
  const [cargandoGraficas, setCargandoGraficas] = useState(true);
  const [errorGraficas, setErrorGraficas] = useState<string | null>(null);

  // Carga de las MÉTRICAS (foto actual, no depende del selector).
  const cargarMetricas = useCallback(async () => {
    setCargandoMetricas(true);
    setErrorMetricas(null);
    try {
      const [ingresosMes, porEstado, alertas] = await Promise.all([
        reporteIngresos(primerDiaMesISO(), hoyISO(), "mes"),
        reportePedidosPorEstado(), // sin rango = histórico completo
        insumosEnAlerta(),
      ]);
      const ingresos = ingresosMes.reduce((acc, r) => acc + Number(r.ingresos), 0);
      const total = porEstado.reduce((acc, r) => acc + r.cantidad, 0);
      // "Por entregar" = todos los que NO están 'entregado'.
      const porEntregar = porEstado
        .filter((r) => r.estado !== "entregado")
        .reduce((acc, r) => acc + r.cantidad, 0);
      setMetricas({
        ingresosMes: ingresos,
        totalPedidos: total,
        porEntregar,
        alertas: alertas.length,
      });
    } catch (err) {
      setErrorMetricas(err instanceof Error ? err.message : "No se pudieron cargar las métricas.");
    } finally {
      setCargandoMetricas(false);
    }
  }, []);

  // Contador de cargas, para descartar respuestas OBSOLETAS. Si el usuario
  // cambia el selector rápido, hay varias cargas en vuelo; cada una toma un id y,
  // al resolver, solo aplica su resultado si sigue siendo la última (evita que
  // una respuesta vieja "pise" las gráficas con datos de un periodo anterior).
  const idCargaGraficas = useRef(0);

  // Carga de las GRÁFICAS (depende del selector de periodo).
  const cargarGraficas = useCallback(async () => {
    const miId = ++idCargaGraficas.current;
    const esVigente = () => miId === idCargaGraficas.current;

    // Ingresos y pedidos-por-periodo EXIGEN ambas fechas. Si falta alguna (p. ej.
    // el usuario limpió un campo de fecha), avisamos con un mensaje claro en vez
    // de mandar un request inválido que el backend rechazaría con un 422 críptico.
    if (!fechaInicio || !fechaFin) {
      setGraficas(null);
      setErrorGraficas("Elige una fecha de inicio y una de fin.");
      setCargandoGraficas(false);
      return;
    }
    // El inicio no puede ser posterior al fin (evita un 400 del backend).
    if (fechaInicio > fechaFin) {
      setGraficas(null);
      setErrorGraficas("La fecha de inicio no puede ser posterior a la de fin.");
      setCargandoGraficas(false);
      return;
    }

    // Capturamos la agrupación con la que pedimos para guardarla junto a los datos.
    const agr = agrupacion;
    setCargandoGraficas(true);
    setErrorGraficas(null);
    try {
      const [ingresos, porPeriodo, porEstado, porEmpleado] = await Promise.all([
        reporteIngresos(fechaInicio, fechaFin, agr),
        reportePedidosPorPeriodo(fechaInicio, fechaFin, agr),
        reportePedidosPorEstado(fechaInicio, fechaFin),
        reportePedidosPorEmpleado(fechaInicio, fechaFin),
      ]);
      // Si mientras llegaba esta respuesta se disparó otra carga, la descartamos.
      if (!esVigente()) return;
      setGraficas({ ingresos, porPeriodo, porEstado, porEmpleado, agrupacion: agr });
    } catch (err) {
      if (!esVigente()) return;
      setErrorGraficas(err instanceof Error ? err.message : "No se pudieron cargar las gráficas.");
    } finally {
      // Solo la carga vigente apaga el indicador (una vieja no debe tocarlo).
      if (esVigente()) setCargandoGraficas(false);
    }
  }, [fechaInicio, fechaFin, agrupacion]);

  // Las métricas se cargan una vez; las gráficas, cada vez que cambia el selector.
  useEffect(() => {
    cargarMetricas();
  }, [cargarMetricas]);
  useEffect(() => {
    cargarGraficas();
  }, [cargarGraficas]);

  return (
    <div>
      <h1 className="text-2xl font-semibold text-slate-100">Panel</h1>
      <p className="mt-1 text-sm text-slate-400">Resumen del negocio.</p>

      {/* --- Tarjetas de métricas --- */}
      <div className="mt-5">
        {errorMetricas ? (
          <CajaError mensaje={errorMetricas} onReintentar={cargarMetricas} />
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {cargandoMetricas || !metricas ? (
              // Esqueletos mientras cargan las métricas.
              Array.from({ length: 4 }).map((_, i) => (
                <div
                  key={i}
                  className="h-28 animate-pulse rounded-xl border border-slate-800 bg-slate-900/60"
                />
              ))
            ) : (
              <>
                <MetricaCard
                  titulo="Ingresos del mes"
                  valor={formatearMoneda(metricas.ingresosMes)}
                  icono={Wallet}
                  secundario="Mes en curso"
                />
                <MetricaCard
                  titulo="Total de pedidos"
                  valor={formatearNumero(metricas.totalPedidos, 0)}
                  icono={ClipboardList}
                  secundario="Histórico"
                />
                <MetricaCard
                  titulo="Por entregar"
                  valor={formatearNumero(metricas.porEntregar, 0)}
                  icono={Truck}
                  secundario="Pedidos no entregados"
                />
                <MetricaCard
                  titulo="Alertas de stock"
                  valor={formatearNumero(metricas.alertas, 0)}
                  icono={AlertTriangle}
                  secundario="Insumos bajo el mínimo"
                  acento={metricas.alertas > 0 ? "ambar" : "acero"}
                />
              </>
            )}
          </div>
        )}
      </div>

      {/* --- Selector + gráficas --- */}
      <div className="mt-8">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <h2 className="text-lg font-semibold text-slate-100">Reportes</h2>
          <SelectorPeriodo
            fechaInicio={fechaInicio}
            fechaFin={fechaFin}
            agrupacion={agrupacion}
            onFechaInicio={setFechaInicio}
            onFechaFin={setFechaFin}
            onAgrupacion={setAgrupacion}
          />
        </div>

        <div className="mt-4">
          {errorGraficas ? (
            <CajaError mensaje={errorGraficas} onReintentar={cargarGraficas} />
          ) : (
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <TarjetaGrafica
                titulo="Ingresos por periodo"
                cargando={cargandoGraficas}
                vacia={!graficas || graficas.ingresos.length === 0}
              >
                {graficas && (
                  <GraficaIngresos datos={graficas.ingresos} agrupacion={graficas.agrupacion} />
                )}
              </TarjetaGrafica>

              <TarjetaGrafica
                titulo="Pedidos por estado"
                cargando={cargandoGraficas}
                vacia={!graficas || graficas.porEstado.length === 0}
              >
                {graficas && <GraficaPedidosPorEstado datos={graficas.porEstado} />}
              </TarjetaGrafica>

              <TarjetaGrafica
                titulo="Pedidos por periodo"
                cargando={cargandoGraficas}
                vacia={!graficas || graficas.porPeriodo.length === 0}
              >
                {graficas && (
                  <GraficaPedidosPorPeriodo
                    datos={graficas.porPeriodo}
                    agrupacion={graficas.agrupacion}
                  />
                )}
              </TarjetaGrafica>

              <TarjetaGrafica
                titulo="Pedidos por empleado"
                cargando={cargandoGraficas}
                vacia={!graficas || graficas.porEmpleado.length === 0}
              >
                {graficas && <GraficaPedidosPorEmpleado datos={graficas.porEmpleado} />}
              </TarjetaGrafica>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
