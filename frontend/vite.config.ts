import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// Configuración de Vite (el "empaquetador" y servidor de desarrollo).
//  - react(): habilita JSX/TSX y el refresco en caliente (HMR).
//  - tailwindcss(): plugin de Tailwind v4 que procesa las clases de estilo.
// El servidor de desarrollo corre por defecto en http://localhost:5173.
export default defineConfig({
  plugins: [react(), tailwindcss()],
});
