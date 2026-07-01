// ============================================================
//  Ruta solo para ADMINISTRADORES (protección por rol).
//
//  Si el usuario es admin, renderiza la ruta hija (<Outlet />). Si no, muestra
//  una pantalla de "Sin acceso" (dentro del layout, con la barra visible).
//
//  ⚠️ IMPORTANTE: esto es protección de INTERFAZ (UX), NO seguridad real.
//  Solo evita mostrarle a un empleado pantallas que no le corresponden. La
//  seguridad de verdad la fuerza el BACKEND: cada endpoint de administración
//  (reportes, usuarios, auditoría) exige rol administrador y responde 403 si no
//  lo tiene. Aunque un empleado fuerce la URL y vea el cascarón de la pantalla,
//  no podrá obtener ningún dato protegido porque el backend se lo niega.
// ============================================================

import { Outlet } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import SinAccesoPage from "../pages/SinAccesoPage";

export default function AdminRoute() {
  const { rol } = useAuth();

  if (rol !== "administrador") {
    return <SinAccesoPage />;
  }

  return <Outlet />;
}
