// ============================================================
//  Página "placeholder" reutilizable.
//
//  Por ahora cada sección muestra solo su título y una nota de "próximamente".
//  Las llenaremos con contenido real (tablas, formularios, gráficas) en los
//  próximos pasos. Centralizar el placeholder aquí evita repetir el mismo JSX.
// ============================================================

interface Props {
  titulo: string;
  descripcion?: string;
}

export default function PlaceholderPagina({ titulo, descripcion }: Props) {
  return (
    <div>
      <h1 className="text-2xl font-semibold text-slate-100">{titulo}</h1>
      {descripcion && <p className="mt-1 text-slate-400">{descripcion}</p>}

      <div className="mt-6 rounded-xl border border-dashed border-slate-700 bg-slate-900/40 p-10 text-center text-slate-500">
        Esta sección se construirá en el próximo paso.
      </div>
    </div>
  );
}
