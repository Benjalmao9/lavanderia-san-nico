// ============================================================
//  Widget de Cloudflare Turnstile (CAPTCHA del login) — sin librerías extra.
//
//  Turnstile funciona así: cargamos UN script oficial de Cloudflare
//  (challenges.cloudflare.com), que expone la API global window.turnstile.
//  Con ella "renderizamos" el widget dentro de un <div> nuestro; Cloudflare
//  evalúa al visitante (casi siempre sin pedirle nada) y nos entrega un TOKEN
//  de un solo uso vía callback. Ese token viaja con el formulario del login y
//  el BACKEND lo verifica contra Cloudflare (la verificación del navegador no
//  vale nada por sí sola: la fuente de verdad es siteverify en el servidor).
//
//  Este componente SOLO se monta cuando hay VITE_TURNSTILE_SITE_KEY definida
//  (producción). En desarrollo no existe la variable, el componente nunca se
//  renderiza y no se carga ningún script de terceros: el mismo principio que
//  el backend aplica a /docs con ENTORNO (blindajes activos solo donde
//  importan, sin estorbar el desarrollo).
//
//  Detalle importante: los tokens son de UN SOLO USO. Si el login falla (p.ej.
//  contraseña incorrecta), el backend ya "gastó" el token al verificarlo, así
//  que la pantalla de login debe REINICIAR el widget para obtener uno nuevo.
//  Para eso exponemos reset() a través de una ref (patrón de ref-como-prop que
//  ya usa Sidebar con refCerrar).
// ============================================================

import { useEffect, useImperativeHandle, useRef, useState } from "react";
import type { Ref } from "react";

// Tipado mínimo de la API global que inyecta el script oficial de Turnstile.
// Solo declaramos lo que usamos (render / reset / remove).
interface TurnstileApi {
  render: (
    contenedor: HTMLElement,
    opciones: {
      sitekey: string;
      theme?: "light" | "dark" | "auto";
      language?: string;
      callback?: (token: string) => void;
      "expired-callback"?: () => void;
      "error-callback"?: () => void;
    }
  ) => string; // devuelve el id del widget
  reset: (widgetId: string) => void;
  remove: (widgetId: string) => void;
}

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

// URL oficial del script. render=explicit: NOSOTROS decidimos cuándo y dónde
// renderizar (en el useEffect), en vez de que el script escanee el HTML.
const SRC_SCRIPT =
  "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

// Lo que la pantalla de login puede invocar a través de la ref.
export interface TurnstileHandle {
  // Reinicia el widget para obtener un token NUEVO (los tokens son de un solo
  // uso; hay que llamarlo tras cada intento de login fallido).
  reset: () => void;
}

interface Props {
  siteKey: string; // clave PÚBLICA del widget (VITE_TURNSTILE_SITE_KEY)
  // Aviso del token al padre: string cuando Cloudflare lo entrega; null cuando
  // deja de ser válido (expiró, hubo error o se reinició el widget).
  onToken: (token: string | null) => void;
  refWidget?: Ref<TurnstileHandle>; // para exponer reset() al padre
}

export default function TurnstileWidget({ siteKey, onToken, refWidget }: Props) {
  const contenedorRef = useRef<HTMLDivElement>(null);
  // Id que Cloudflare le asigna a ESTE widget (necesario para reset/remove).
  const widgetIdRef = useRef<string | null>(null);
  // Guardamos onToken en una ref para que el efecto de abajo no dependa de la
  // identidad de la función (el padre la recrea en cada render) y el widget no
  // se destruya/recree en cada tecleo del formulario.
  const onTokenRef = useRef(onToken);
  onTokenRef.current = onToken;

  // Si el script de Cloudflare no se pudo cargar (sin internet, bloqueado por
  // una extensión...), lo decimos claro en vez de dejar un hueco vacío y el
  // botón deshabilitado sin explicación.
  const [errorCarga, setErrorCarga] = useState(false);

  // reset() para el padre (ver el comentario del encabezado).
  useImperativeHandle(refWidget, () => ({
    reset() {
      if (widgetIdRef.current !== null && window.turnstile) {
        window.turnstile.reset(widgetIdRef.current);
      }
    },
  }));

  useEffect(() => {
    // 'cancelado' evita renderizar si el componente se desmontó mientras el
    // script todavía se estaba descargando (evita fugas y dobles renders).
    let cancelado = false;

    function renderizar() {
      if (cancelado || !contenedorRef.current || !window.turnstile) return;
      // Evitamos renderizar dos veces en el mismo contenedor.
      if (widgetIdRef.current !== null) return;
      widgetIdRef.current = window.turnstile.render(contenedorRef.current, {
        sitekey: siteKey,
        theme: "dark", // coherente con el modo oscuro de la app
        language: "es",
        callback: (token) => onTokenRef.current(token),
        // El token expira a los pocos minutos: si pasa, avisamos null para que
        // el botón se vuelva a deshabilitar hasta que Cloudflare renueve.
        "expired-callback": () => onTokenRef.current(null),
        "error-callback": () => onTokenRef.current(null),
      });
    }

    if (window.turnstile) {
      // El script ya estaba cargado (p. ej. volvimos a la pantalla de login).
      renderizar();
    } else {
      // Cargamos el script UNA sola vez (si ya hay un <script> nuestro en el
      // documento, lo reutilizamos y solo esperamos su 'load').
      let script = document.querySelector<HTMLScriptElement>(
        `script[src="${SRC_SCRIPT}"]`
      );
      if (!script) {
        script = document.createElement("script");
        script.src = SRC_SCRIPT;
        script.async = true;
        document.head.appendChild(script);
      }
      script.addEventListener("load", renderizar);
      script.addEventListener("error", () => {
        if (!cancelado) setErrorCarga(true);
      });
    }

    return () => {
      cancelado = true;
      // Al desmontar, quitamos el widget para no dejar iframes huérfanos.
      if (widgetIdRef.current !== null && window.turnstile) {
        window.turnstile.remove(widgetIdRef.current);
        widgetIdRef.current = null;
      }
    };
  }, [siteKey]);

  if (errorCarga) {
    return (
      <p className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
        No se pudo cargar la verificación de seguridad. Revisa tu conexión y
        recarga la página.
      </p>
    );
  }

  // min-h reserva el alto típico del widget (~65px) para que el formulario no
  // "salte" cuando Cloudflare termina de dibujarlo.
  return <div ref={contenedorRef} className="flex min-h-[65px] justify-center" />;
}
