// ============================================================
//  Barra lateral (Sidebar) — responsive: drawer en móvil, colapsable en escritorio.
//
//  ESCRITORIO (lg+):
//   - Angosta por defecto (lg:w-16, solo iconos) y se EXPANDE al pasar el cursor
//     (lg:hover:w-60). Los textos están ocultos (lg:opacity-0) y aparecen en hover
//     (lg:group-hover:opacity-100). Siempre visible (lg:translate-x-0).
//
//  MÓVIL / TABLET (debajo de lg):
//   - Funciona como DRAWER: ancho fijo (w-64) con los textos SIEMPRE visibles
//     (opacity-100), y se desliza dentro/fuera de pantalla con translate-x según
//     'abierto'. El layout dibuja el fondo oscurecido y el botón hamburguesa.
//   - Se cierra al elegir una opción (onClick={onCerrar} en cada enlace) o con la
//     X de arriba. (Tocar fuera y Escape los maneja el layout.)
//
//  Así una sola barra cubre ambos mundos: en táctil no dependemos del hover, y en
//  escritorio mantenemos el comportamiento colapsable de siempre.
//
//  FILTRADO POR ROL: cada item tiene 'soloAdmin'; dejamos los públicos siempre y
//  los de admin solo si el rol es administrador. (Es de INTERFAZ; la seguridad
//  real la fuerza el backend.)
// ============================================================

import { NavLink } from "react-router-dom";
import {
  LayoutDashboard,
  ClipboardList,
  Package,
  Users,
  ScrollText,
  LogOut,
  User,
  X,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { Ref } from "react";
import { useAuth } from "../context/AuthContext";

interface ItemNav {
  to: string;
  etiqueta: string;
  icono: LucideIcon;
  soloAdmin: boolean;
}

interface Props {
  abierto: boolean; // ¿el drawer está desplegado? (solo afecta en móvil)
  onCerrar: () => void; // cerrar el drawer (al elegir opción / tocar la X)
  inerte: boolean; // true = drawer cerrado en móvil (no enfocable / fuera del a11y)
  refCerrar: Ref<HTMLButtonElement>; // ref al botón X (para enfocarlo al abrir)
}

// Lista completa de items. El orden es el del menú.
const ITEMS: ItemNav[] = [
  { to: "/", etiqueta: "Panel", icono: LayoutDashboard, soloAdmin: true },
  { to: "/pedidos", etiqueta: "Pedidos", icono: ClipboardList, soloAdmin: false },
  { to: "/inventario", etiqueta: "Inventario", icono: Package, soloAdmin: false },
  { to: "/usuarios", etiqueta: "Usuarios", icono: Users, soloAdmin: true },
  { to: "/auditoria", etiqueta: "Auditoría", icono: ScrollText, soloAdmin: true },
];

// Clases del label de texto: visible en móvil (opacity-100); en escritorio oculto
// y revelado al pasar el cursor (lg:opacity-0 lg:group-hover:opacity-100).
const LABEL = "whitespace-nowrap opacity-100 transition-opacity duration-200 lg:opacity-0 lg:group-hover:opacity-100";

export default function Sidebar({ abierto, onCerrar, inerte, refCerrar }: Props) {
  const { rol, usuario, cerrarSesion } = useAuth();

  // Filtrado por rol: items públicos siempre; los de admin solo si es admin.
  const visibles = ITEMS.filter((item) => !item.soloAdmin || rol === "administrador");

  return (
    <aside
      // inert (móvil cerrado): saca al drawer del orden de tabulación y del árbol
      // de accesibilidad mientras está fuera de pantalla.
      inert={inerte}
      className={[
        // Base común (móvil): drawer ancho que se desliza. z alto para tapar el
        // overlay. Transición tanto del deslizamiento (transform) como del ancho
        // (width, que solo cambia en escritorio).
        "group fixed inset-y-0 left-0 z-40 flex w-64 flex-col overflow-hidden border-r border-slate-800 bg-slate-900 transition-[transform,width] duration-300 ease-in-out",
        // Deslizamiento en móvil según 'abierto'.
        abierto ? "translate-x-0" : "-translate-x-full",
        // Escritorio: siempre visible, angosta y expandible con el cursor.
        "lg:w-16 lg:translate-x-0 lg:hover:w-60",
      ].join(" ")}
    >
      {/* Encabezado: marca + botón de cerrar (X) visible solo en móvil */}
      <div className="flex h-14 shrink-0 items-center justify-between px-3 lg:h-16">
        <span className={`text-lg font-semibold tracking-tight text-acero ${LABEL}`}>
          Lavandería San Nico
        </span>
        <button
          ref={refCerrar}
          onClick={onCerrar}
          aria-label="Cerrar menú"
          className="rounded-md p-1 text-slate-400 transition hover:text-slate-200 lg:hidden"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      {/* Navegación. Cada enlace cierra el drawer al tocarlo (en escritorio es
          inocuo: la barra está siempre visible). */}
      <nav className="flex-1 space-y-1 px-2 py-3">
        {visibles.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            onClick={onCerrar}
            // 'end' solo para "/", para que no quede activo en todas las rutas.
            end={item.to === "/"}
            className={({ isActive }) =>
              [
                "flex items-center gap-3 rounded-lg px-3 py-2.5 transition-colors",
                isActive
                  ? "bg-acero text-white" // sección activa en azul acero
                  : "text-slate-400 hover:bg-slate-800 hover:text-slate-100",
              ].join(" ")
            }
          >
            <item.icono className="h-5 w-5 shrink-0" aria-hidden />
            <span className={LABEL}>{item.etiqueta}</span>
          </NavLink>
        ))}
      </nav>

      {/* Pie: datos del usuario logueado + cerrar sesión */}
      <div className="shrink-0 border-t border-slate-800 p-2">
        <div className="flex items-center gap-3 px-2 py-2">
          <div className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-slate-800 text-slate-300">
            <User className="h-5 w-5" aria-hidden />
          </div>
          <div className={`min-w-0 ${LABEL}`}>
            <p className="truncate text-sm font-medium text-slate-200">
              {usuario ?? "—"}
            </p>
            <p className="truncate text-xs capitalize text-slate-500">
              {rol ?? "—"}
            </p>
          </div>
        </div>

        <button
          onClick={cerrarSesion}
          className="mt-1 flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-slate-400 transition-colors hover:bg-slate-800 hover:text-red-300"
        >
          <LogOut className="h-5 w-5 shrink-0" aria-hidden />
          <span className={LABEL}>Cerrar sesión</span>
        </button>
      </div>
    </aside>
  );
}
