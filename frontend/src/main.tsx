// Punto de entrada del frontend: monta el componente <App /> dentro del div
// #root de index.html. Importamos index.css para que Tailwind cargue los estilos.
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
