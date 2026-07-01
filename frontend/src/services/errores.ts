// ============================================================
//  Helper compartido para traducir errores del backend a texto legible.
//
//  Lo usan los servicios (pedidos, insumos, ...) para mostrar un mensaje claro
//  al usuario a partir de la respuesta de error de FastAPI:
//   - 400/404/409/503: {"detail": "texto"}        -> usamos ese texto.
//   - 422 (validación): {"detail": [{loc, msg}]}   -> juntamos los mensajes.
//   - Cuerpo no-JSON                               -> usamos el mensaje por defecto.
// ============================================================

export async function mensajeDeError(
  respuesta: Response,
  porDefecto: string
): Promise<string> {
  try {
    const data = await respuesta.json();
    const detail = data?.detail;
    if (typeof detail === "string") return detail;
    if (Array.isArray(detail)) {
      return detail
        .map((e) => {
          const campo = Array.isArray(e.loc) ? e.loc[e.loc.length - 1] : "";
          return campo ? `${campo}: ${e.msg}` : e.msg;
        })
        .join(" · ");
    }
  } catch {
    // El cuerpo no era JSON; caemos al mensaje por defecto.
  }
  return porDefecto;
}
