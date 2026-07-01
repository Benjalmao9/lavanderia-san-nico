// ============================================================
//  Ruta protegida.
//
//  Envuelve las rutas que requieren estar logueado. Si NO hay sesión, redirige
//  al login. Si la hay, renderiza la ruta hija (<Outlet />).
//
//  Recuerda: esto es una comodidad de INTERFAZ (no mostrar pantallas a quien no
//  inició sesión). No es la barrera de seguridad real: aunque alguien forzara
//  la navegación, el backend exige el token en cada endpoint y rechaza sin él.
// ============================================================

import { Navigate, Outlet } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

export default function ProtectedRoute() {
  const { estaAutenticado } = useAuth();

  if (!estaAutenticado) {
    // replace: evita que el botón "atrás" del navegador vuelva a la ruta privada.
    return <Navigate to="/login" replace />;
  }

  return <Outlet />;
}
