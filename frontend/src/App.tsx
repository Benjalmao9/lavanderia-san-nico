// ============================================================
//  App: enrutamiento principal (React Router).
//
//  Mapa de rutas:
//   - /login                      -> pública (si ya hay sesión, va al inicio).
//   - Dentro de <ProtectedRoute>  -> requiere estar logueado:
//       - <MainLayout> (barra lateral + contenido):
//           - "/"          -> inicio según rol (admin: Panel; empleado: Pedidos)
//           - /pedidos     -> cualquier rol
//           - /inventario  -> cualquier rol
//           - dentro de <AdminRoute> (requiere admin):
//               - /categorias, /usuarios, /auditoria
//   - *  -> cualquier otra ruta vuelve a "/".
//
//  CÓMO FUNCIONAN LAS RUTAS PROTEGIDAS:
//   - ProtectedRoute mira si hay token válido; si no, redirige a /login.
//   - AdminRoute mira el rol; si no es admin, muestra "Sin acceso".
//  AMBAS son protección de INTERFAZ (para no mostrar lo que no corresponde).
//  La SEGURIDAD REAL está en el backend: cada endpoint exige el token y el rol
//  adecuado y responde 401/403. El frontend nunca es la barrera de seguridad.
//
//  CARGA PEREZOSA (code splitting): las pantallas de adentro se importan con
//  React.lazy, así cada una queda en su propio "chunk" que el navegador descarga
//  SOLO cuando se entra a esa ruta. Lo importante: el Panel arrastra Recharts
//  (pesado), y con esto quien entra directo a Login/Pedidos ya NO paga ese costo
//  en el bundle inicial. LoginPage se deja SIN lazy (import normal) a propósito:
//  es lo primero que ve quien no tiene sesión, y así no parpadea el fallback.
//  El límite <Suspense> que muestra el fallback mientras baja el chunk vive en
//  MainLayout (envuelve el <Outlet>).
// ============================================================

import { lazy } from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider, useAuth } from "./context/AuthContext";
import ProtectedRoute from "./components/ProtectedRoute";
import AdminRoute from "./components/AdminRoute";
import MainLayout from "./components/MainLayout";
import LoginPage from "./pages/LoginPage";

// Pantallas autenticadas: cargadas de forma perezosa (cada una es su propio chunk).
const PanelPage = lazy(() => import("./pages/PanelPage"));
const PedidosPage = lazy(() => import("./pages/PedidosPage"));
const InventarioPage = lazy(() => import("./pages/InventarioPage"));
const CategoriasPage = lazy(() => import("./pages/CategoriasPage"));
const UsuariosPage = lazy(() => import("./pages/UsuariosPage"));
const AuditoriaPage = lazy(() => import("./pages/AuditoriaPage"));

// La ruta /login: si el usuario ya tiene sesión, no tiene sentido mostrar el
// login otra vez, así que lo mandamos al inicio.
function RutaLogin() {
  const { estaAutenticado } = useAuth();
  return estaAutenticado ? <Navigate to="/" replace /> : <LoginPage />;
}

// "/" decide la pantalla inicial según el rol: el admin ve el Panel; el empleado
// no tiene Panel, así que lo llevamos a su primera pantalla útil (Pedidos).
function InicioSegunRol() {
  const { rol } = useAuth();
  return rol === "administrador" ? <PanelPage /> : <Navigate to="/pedidos" replace />;
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          {/* Ruta pública */}
          <Route path="/login" element={<RutaLogin />} />

          {/* Rutas privadas: requieren sesión activa */}
          <Route element={<ProtectedRoute />}>
            {/* Todo lo autenticado vive dentro del layout con barra lateral */}
            <Route element={<MainLayout />}>
              <Route index element={<InicioSegunRol />} />
              <Route path="pedidos" element={<PedidosPage />} />
              <Route path="inventario" element={<InventarioPage />} />

              {/* Secciones solo para administradores */}
              <Route element={<AdminRoute />}>
                <Route path="categorias" element={<CategoriasPage />} />
                <Route path="usuarios" element={<UsuariosPage />} />
                <Route path="auditoria" element={<AuditoriaPage />} />
              </Route>
            </Route>
          </Route>

          {/* Cualquier otra ruta vuelve a la raíz */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
