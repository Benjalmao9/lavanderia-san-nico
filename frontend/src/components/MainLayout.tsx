// ============================================================
//  Layout principal de la app autenticada (responsive).
//
//  ESCRITORIO (lg+): la barra lateral está SIEMPRE visible (angosta, se expande
//  con el cursor). El contenido deja margen (lg:ml-16). No hay barra superior.
//
//  MÓVIL / TABLET (debajo de lg): la barra se vuelve un DRAWER, oculto por
//  defecto y desplegable con la hamburguesa (☰) de la barra superior. Se cierra
//  al elegir una opción, al tocar el fondo, o con Escape.
//
//  COHERENCIA AL CRUZAR EL BREAKPOINT: los breakpoints de Tailwind son solo CSS;
//  no avisan a React. Por eso seguimos el ancho con matchMedia: si el drawer
//  quedó abierto en móvil y la ventana crece a escritorio (o la tablet rota a
//  horizontal), lo CERRAMOS. Sin esto, el bloqueo de scroll del body quedaría
//  "pegado" en escritorio (un bug detectado en revisión).
//
//  ACCESIBILIDAD DEL DRAWER: al abrir llevamos el foco al botón de cerrar; al
//  cerrar lo devolvemos a la hamburguesa. Mientras está abierto, el contenido de
//  fondo (<main>) queda 'inert' (no enfocable) y la barra cerrada también lo está
//  en móvil, para que el foco con teclado no se vaya a controles fuera de pantalla.
// ============================================================

import { useEffect, useRef, useState } from "react";
import { Outlet } from "react-router-dom";
import { Menu } from "lucide-react";
import Sidebar from "./Sidebar";

// Punto de corte (lg de Tailwind = 1024px): a partir de acá es "escritorio".
const CONSULTA_ESCRITORIO = "(min-width: 1024px)";

export default function MainLayout() {
  const [menuAbierto, setMenuAbierto] = useState(false);
  // ¿Estamos en escritorio (lg+)? Lo seguimos con matchMedia para reaccionar al
  // cambio de tamaño/orientación (las clases CSS de Tailwind no nos lo avisan).
  const [esEscritorio, setEsEscritorio] = useState(
    () => typeof window !== "undefined" && window.matchMedia(CONSULTA_ESCRITORIO).matches
  );

  const botonMenuRef = useRef<HTMLButtonElement>(null);
  const botonCerrarRef = useRef<HTMLButtonElement>(null);
  const primerRender = useRef(true);

  // Al CRUZAR a escritorio, cerramos el drawer (no tiene sentido en lg+ y, sobre
  // todo, así el bloqueo de scroll del body nunca queda activo en escritorio).
  useEffect(() => {
    const mq = window.matchMedia(CONSULTA_ESCRITORIO);
    const alCambiar = (e: MediaQueryListEvent) => {
      setEsEscritorio(e.matches);
      if (e.matches) setMenuAbierto(false);
    };
    mq.addEventListener("change", alCambiar);
    return () => mq.removeEventListener("change", alCambiar);
  }, []);

  // Mientras el drawer está abierto (solo móvil): cerrar con Escape y bloquear el
  // scroll del fondo. El cleanup restaura el scroll. Como al pasar a escritorio
  // cerramos el menú (efecto de arriba), este lock nunca queda "pegado" en lg+.
  useEffect(() => {
    if (!menuAbierto) return;
    const alPresionar = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenuAbierto(false);
    };
    document.addEventListener("keydown", alPresionar);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", alPresionar);
      document.body.style.overflow = "";
    };
  }, [menuAbierto]);

  // Manejo del foco: al abrir, foco al botón de cerrar del menú; al cerrar, foco
  // de vuelta a la hamburguesa. Saltamos el primer render para no robar el foco
  // al cargar la página.
  useEffect(() => {
    if (primerRender.current) {
      primerRender.current = false;
      return;
    }
    if (menuAbierto) botonCerrarRef.current?.focus();
    // Al cerrar devolvemos el foco a la hamburguesa, PERO solo si seguimos en
    // móvil: si el cierre fue por cruzar a escritorio, la hamburguesa ya está
    // display:none (lg:hidden) y enfocarla tiraría el foco al <body>.
    else if (!esEscritorio) botonMenuRef.current?.focus();
  }, [menuAbierto, esEscritorio]);

  // ¿El drawer está abierto actuando como menú móvil? (en escritorio nunca).
  const drawerMovilAbierto = menuAbierto && !esEscritorio;

  return (
    <div className="min-h-screen">
      {/* Barra superior SOLO en móvil/tablet (lg:hidden): hamburguesa + marca.
          Mientras el drawer está abierto la marcamos 'inert' (igual que <main>)
          para que el foco con teclado no se escape a la hamburguesa, que queda
          detrás del overlay. */}
      <header
        inert={drawerMovilAbierto}
        className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b border-slate-800 bg-slate-900 px-4 lg:hidden"
      >
        <button
          ref={botonMenuRef}
          onClick={() => setMenuAbierto(true)}
          aria-label="Abrir menú"
          aria-expanded={menuAbierto}
          className="rounded-lg p-2 text-slate-300 transition hover:bg-slate-800 hover:text-white"
        >
          <Menu className="h-6 w-6" />
        </button>
        <span className="text-lg font-semibold tracking-tight text-acero">
          Lavandería San Nico
        </span>
      </header>

      {/* Fondo oscurecido detrás del drawer (solo móvil y solo si está abierto):
          un toque acá cierra el menú. */}
      {menuAbierto && (
        <div
          className="fixed inset-0 z-30 bg-black/60 backdrop-blur-sm lg:hidden"
          onClick={() => setMenuAbierto(false)}
          aria-hidden
        />
      )}

      <Sidebar
        abierto={menuAbierto}
        onCerrar={() => setMenuAbierto(false)}
        // Drawer cerrado en móvil -> inert (sus enlaces fuera de pantalla no deben
        // ser enfocables ni leídos). En escritorio nunca es inert (siempre visible).
        inerte={!menuAbierto && !esEscritorio}
        refCerrar={botonCerrarRef}
      />

      {/* Contenido. Mientras el drawer móvil está abierto, el main queda 'inert'
          (no enfocable ni interactivo) para contener el foco en el menú. En
          escritorio deja lugar para la barra (lg:ml-16); en móvil ocupa todo. */}
      <main
        inert={drawerMovilAbierto}
        className="min-h-screen p-4 sm:p-6 lg:ml-16 lg:p-8"
      >
        <Outlet />
      </main>
    </div>
  );
}
