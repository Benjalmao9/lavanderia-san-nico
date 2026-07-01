// ============================================================
//  Pantalla "Sin acceso" (403 a nivel de interfaz).
//
//  Se muestra cuando un empleado intenta entrar (por URL) a una sección que es
//  solo para administradores. Es un aviso amable de UX; la verdadera negación
//  la hace el backend con un 403 si se intentara pedir los datos.
// ============================================================

import { ShieldAlert } from "lucide-react";

export default function SinAccesoPage() {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center text-center">
      <ShieldAlert className="h-12 w-12 text-acero" aria-hidden />
      <h1 className="mt-4 text-2xl font-semibold text-slate-100">Sin acceso</h1>
      <p className="mt-2 max-w-md text-slate-400">
        Esta sección es solo para administradores. Si creés que es un error,
        contactá a un administrador.
      </p>
    </div>
  );
}
