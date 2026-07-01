// ============================================================
//  Etiqueta de color (badge) para el ROL de un usuario.
//
//  Mismo patrón visual que EstadoBadge (pastilla con borde translúcido), pero
//  para roles: administrador y empleado en colores claramente distintos.
//   - administrador -> azul acero (el color de marca; rol privilegiado).
//   - empleado      -> gris neutro (rol estándar).
//  Un icono refuerza la distinción de un vistazo (escudo vs. persona).
// ============================================================

import { ShieldCheck, User } from "lucide-react";
import type { Rol } from "../services/usuarios";

interface Props {
  rol: Rol;
}

export default function RolBadge({ rol }: Props) {
  const esAdmin = rol === "administrador";
  const clase = esAdmin
    ? "bg-acero/15 text-acero border-acero/40"
    : "bg-slate-500/15 text-slate-300 border-slate-500/40";
  const Icono = esAdmin ? ShieldCheck : User;

  return (
    <span
      className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2.5 py-0.5 text-xs font-medium capitalize ${clase}`}
    >
      <Icono className="h-3.5 w-3.5" aria-hidden />
      {rol}
    </span>
  );
}
