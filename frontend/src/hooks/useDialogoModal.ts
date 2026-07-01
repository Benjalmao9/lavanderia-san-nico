// ============================================================
//  Hook compartido para los diálogos (Modal y ConfirmDialog).
//
//  Centraliza el comportamiento accesible de un diálogo modal, para no
//  duplicarlo entre componentes:
//   1) BLOQUEA EL SCROLL DEL FONDO mientras el diálogo está abierto. Sin esto, en
//      móvil al arrastrar el dedo se desplaza la página de atrás ("scroll bleed")
//      y, con el teclado en pantalla, el formulario "se va" detrás.
//   2) CIERRA CON ESCAPE, salvo cuando 'bloqueado' es true (p. ej. mientras se
//      guarda): así no se desmonta el diálogo con una petición en vuelo.
//   3) ATRAPA EL FOCO dentro del diálogo (Tab/Shift+Tab hacen ciclo y no se
//      escapan a los controles del fondo).
//   4) Al abrir lleva el foco al diálogo y, al cerrar, lo DEVUELVE al elemento que
//      lo abrió (el botón disparador).
//
//  Devuelve un ref que hay que colocar en el contenedor del diálogo (el div con
//  role="dialog" y tabIndex={-1}).
//
//  Detalle de implementación: el efecto corre UNA sola vez (al montar/desmontar).
//  'onCerrar' y 'bloqueado' se leen a través de refs siempre actualizados, para
//  que el manejador de teclado use el valor vigente sin re-ejecutar el setup (lo
//  que reengancharía el foco/scroll en cada render del padre).
// ============================================================

import { useEffect, useRef } from "react";

export function useDialogoModal(onCerrar: () => void, bloqueado: boolean) {
  const ref = useRef<HTMLDivElement>(null);
  const onCerrarRef = useRef(onCerrar);
  const bloqueadoRef = useRef(bloqueado);
  onCerrarRef.current = onCerrar;
  bloqueadoRef.current = bloqueado;

  useEffect(() => {
    // Guardamos a quién devolverle el foco al cerrar (el control que abrió el modal).
    const elementoPrevio = document.activeElement as HTMLElement | null;
    const contenedor = ref.current;

    // 1) Bloqueo de scroll del fondo (recordando el valor previo para restaurarlo).
    const overflowPrevio = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    // Lista de elementos enfocables VISIBLES dentro del diálogo (para la trampa de foco).
    const enfocables = (): HTMLElement[] => {
      if (!contenedor) return [];
      return Array.from(
        contenedor.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
        )
      ).filter((el) => el.offsetParent !== null);
    };

    // 4) Foco inicial: el contenedor (tabIndex=-1). Así el lector de pantalla
    //    anuncia el diálogo y el primer Tab entra al primer control.
    contenedor?.focus();

    const alPresionar = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (!bloqueadoRef.current) onCerrarRef.current();
        return;
      }
      // 3) Trampa de foco: ciclamos el Tab dentro del diálogo.
      if (e.key === "Tab") {
        const lista = enfocables();
        if (lista.length === 0) {
          e.preventDefault();
          return;
        }
        const primero = lista[0];
        const ultimo = lista[lista.length - 1];
        const activo = document.activeElement;
        if (e.shiftKey && (activo === primero || activo === contenedor)) {
          e.preventDefault();
          ultimo.focus();
        } else if (!e.shiftKey && activo === ultimo) {
          e.preventDefault();
          primero.focus();
        }
      }
    };
    document.addEventListener("keydown", alPresionar);

    return () => {
      document.removeEventListener("keydown", alPresionar);
      document.body.style.overflow = overflowPrevio;
      // Devolvemos el foco al disparador SOLO si sigue en el DOM y está habilitado.
      // Tras un borrado, el botón disparador (de la fila) se desmonta; y tras
      // confirmar un retroceso de estado, el <select> disparador queda deshabilitado
      // mientras se aplica el cambio. En ambos casos enfocarlo tiraría el foco al
      // <body>: mejor no tocarlo (el navegador lo maneja) que enfocar un destino inútil.
      const disp = elementoPrevio as (HTMLElement & { disabled?: boolean }) | null;
      if (disp && document.contains(disp) && !disp.disabled) {
        disp.focus?.();
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return ref;
}
