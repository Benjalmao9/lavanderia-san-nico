// ============================================================
//  Las cuatro gráficas del dashboard (Recharts), con tema oscuro.
//
//  Cada componente recibe ya los DATOS (la página los pidió a la API) y solo
//  se encarga de dibujarlos. Comparten las constantes de estilo de abajo para
//  verse coherentes con el resto: ejes en gris tenue, grilla sutil, tooltip
//  oscuro, y el azul acero (#5b8fc7) como color principal.
// ============================================================

import {
  ResponsiveContainer,
  AreaChart,
  Area,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from "recharts";
import type {
  Agrupacion,
  IngresoPeriodo,
  ConteoPeriodo,
  PedidosPorEstado,
  PedidosPorEmpleado,
} from "../../services/reportes";
import { formatearMoneda } from "../../utils/formato";

// --- Constantes de estilo compartidas ---
const ACERO = "#5b8fc7";

// Color por estado de pedido (coherente con los badges de la tabla de pedidos).
const COLOR_ESTADO: Record<string, string> = {
  recibido: "#60a5fa", // azul
  "en proceso": "#a78bfa", // violeta
  listo: "#fbbf24", // ámbar
  entregado: "#34d399", // verde
};
function colorEstado(estado: string): string {
  return COLOR_ESTADO[estado] ?? "#94a3b8"; // gris para estados desconocidos
}

// Estilo de los ejes (texto gris tenue, línea sutil).
const PROPS_EJE = {
  tick: { fill: "#94a3b8", fontSize: 12 },
  tickLine: false,
  axisLine: { stroke: "#334155" },
} as const;

// Estilo del tooltip oscuro.
const ESTILO_TOOLTIP = {
  contentStyle: {
    backgroundColor: "#0f172a",
    border: "1px solid #334155",
    borderRadius: 8,
  },
  labelStyle: { color: "#94a3b8" },
  itemStyle: { color: "#e2e8f0" },
} as const;

// Acorta la etiqueta del periodo en el eje X según la agrupación:
//  día '2026-06-28' -> '06-28'; mes '2026-06' y año '2026' quedan tal cual.
function formatearTick(periodo: string, agrupacion: Agrupacion): string {
  if (agrupacion === "dia") return periodo.slice(5);
  return periodo;
}

// ------------------------------------------------------------
//  Gráfica 1: Ingresos por periodo (área).
// ------------------------------------------------------------
export function GraficaIngresos({
  datos,
  agrupacion,
}: {
  datos: IngresoPeriodo[];
  agrupacion: Agrupacion;
}) {
  // Recharts necesita números para el eje Y; convertimos 'ingresos' (que puede
  // venir como string) a número.
  const datosNum = datos.map((d) => ({
    periodo: d.periodo,
    ingresos: Number(d.ingresos),
  }));

  return (
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={datosNum} margin={{ top: 5, right: 10, bottom: 0, left: 0 }}>
        <defs>
          <linearGradient id="gradIngresos" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={ACERO} stopOpacity={0.4} />
            <stop offset="100%" stopColor={ACERO} stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
        <XAxis
          dataKey="periodo"
          tickFormatter={(v) => formatearTick(String(v), agrupacion)}
          {...PROPS_EJE}
        />
        <YAxis width={72} {...PROPS_EJE} />
        <Tooltip
          {...ESTILO_TOOLTIP}
          formatter={(value) => [formatearMoneda(Number(value)), "Ingresos"]}
          cursor={{ stroke: "#475569" }}
        />
        <Area
          type="monotone"
          dataKey="ingresos"
          stroke={ACERO}
          strokeWidth={2}
          fill="url(#gradIngresos)"
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}

// ------------------------------------------------------------
//  Gráfica 2: Pedidos por estado (dona).
// ------------------------------------------------------------
export function GraficaPedidosPorEstado({ datos }: { datos: PedidosPorEstado[] }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <PieChart>
        <Pie
          data={datos}
          dataKey="cantidad"
          nameKey="estado"
          cx="50%"
          cy="50%"
          innerRadius={55}
          outerRadius={85}
          paddingAngle={2}
          stroke="none"
        >
          {datos.map((d) => (
            <Cell key={d.estado} fill={colorEstado(d.estado)} />
          ))}
        </Pie>
        <Tooltip
          {...ESTILO_TOOLTIP}
          formatter={(value, name) => [value, String(name)]}
        />
        <Legend
          formatter={(value) => (
            <span style={{ color: "#cbd5e1", textTransform: "capitalize" }}>{value}</span>
          )}
        />
      </PieChart>
    </ResponsiveContainer>
  );
}

// ------------------------------------------------------------
//  Gráfica 3: Pedidos por periodo (barras verticales).
// ------------------------------------------------------------
export function GraficaPedidosPorPeriodo({
  datos,
  agrupacion,
}: {
  datos: ConteoPeriodo[];
  agrupacion: Agrupacion;
}) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={datos} margin={{ top: 5, right: 10, bottom: 0, left: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
        <XAxis
          dataKey="periodo"
          tickFormatter={(v) => formatearTick(String(v), agrupacion)}
          {...PROPS_EJE}
        />
        <YAxis allowDecimals={false} width={40} {...PROPS_EJE} />
        <Tooltip
          {...ESTILO_TOOLTIP}
          formatter={(value) => [value, "Pedidos"]}
          cursor={{ fill: "rgba(148,163,184,0.1)" }}
        />
        <Bar dataKey="cantidad" fill={ACERO} radius={[4, 4, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

// ------------------------------------------------------------
//  Gráfica 4: Pedidos por empleado (barras horizontales / ranking).
// ------------------------------------------------------------
export function GraficaPedidosPorEmpleado({ datos }: { datos: PedidosPorEmpleado[] }) {
  // Clave ÚNICA por empleado (usuario_id): si dos empleados distintos tienen el
  // mismo nombre_completo (homónimos), usar el nombre como categoría del eje los
  // colapsaría en una sola barra con un conteo incorrecto. Con una clave basada
  // en el id se grafican como barras separadas; el nombre se muestra solo como
  // ETIQUETA (en el eje y en el tooltip).
  const datosConClave = datos.map((d, i) => ({
    ...d,
    clave: d.usuario_id != null ? `u${d.usuario_id}` : `sin-${i}`,
  }));
  const nombrePorClave = new Map(datosConClave.map((d) => [d.clave, d.nombre_completo]));
  const etiqueta = (clave: string) => nombrePorClave.get(clave) ?? clave;

  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart
        data={datosConClave}
        layout="vertical"
        margin={{ top: 5, right: 12, bottom: 0, left: 10 }}
      >
        <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" horizontal={false} />
        <XAxis type="number" allowDecimals={false} {...PROPS_EJE} />
        <YAxis
          type="category"
          dataKey="clave"
          width={140}
          // Mostramos el NOMBRE (no la clave interna), truncado si es largo; el
          // nombre completo igual aparece en el tooltip vía labelFormatter.
          tickFormatter={(v) => {
            const s = etiqueta(String(v));
            return s.length > 18 ? s.slice(0, 17) + "…" : s;
          }}
          {...PROPS_EJE}
        />
        <Tooltip
          {...ESTILO_TOOLTIP}
          formatter={(value) => [value, "Pedidos"]}
          labelFormatter={(label) => etiqueta(String(label))}
          cursor={{ fill: "rgba(148,163,184,0.1)" }}
        />
        <Bar dataKey="cantidad" fill={ACERO} radius={[0, 4, 4, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}
