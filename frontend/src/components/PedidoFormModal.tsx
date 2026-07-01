// ============================================================
//  Formulario de Pedido (crear / editar) dentro de un Modal.
//
//  - Si recibe pedido=null -> modo CREAR (POST /pedidos). No pide total ni
//    estado: el total lo calcula el backend y el estado inicia en 'recibido'.
//  - Si recibe un pedido -> modo EDITAR (PUT /pedidos/{id}). Además de los
//    campos, permite cambiar el ESTADO (recibido -> en proceso -> listo -> entregado).
//
//  La validación replica las reglas del backend (cliente no vacío ni solo
//  números, teléfono con formato, kilos y precio > 0 con hasta 2 decimales) para
//  avisar al usuario ANTES de enviar. Si aun así el backend rechaza (422), su
//  mensaje se muestra como error general.
// ============================================================

import { useState } from "react";
import type { FormEvent } from "react";
import { Loader2 } from "lucide-react";
import Modal from "./Modal";
import { useAuth } from "../context/AuthContext";
import { crearPedido, actualizarPedido } from "../services/pedidos";
import type { Pedido, PedidoEntrada } from "../services/pedidos";

// Estados posibles que ofrece el desplegable al editar.
const ESTADOS = ["recibido", "en proceso", "listo", "entregado"];

interface Props {
  pedido: Pedido | null; // null = crear; objeto = editar
  onCerrar: () => void;
  onGuardado: () => void; // el padre refresca la tabla y cierra el modal
}

interface ErroresForm {
  cliente?: string;
  telefono?: string;
  kilos?: string;
  precio?: string;
  notas?: string;
}

// Clases base de los inputs; si el campo tiene error, marcamos el borde en rojo.
function claseInput(hayError: boolean): string {
  const base =
    "w-full rounded-lg border bg-slate-800 px-3 py-2 text-slate-100 placeholder-slate-500 outline-none transition focus:ring-2 focus:ring-acero/40";
  return hayError
    ? `${base} border-red-500/60 focus:border-red-500`
    : `${base} border-slate-700 focus:border-acero`;
}

export default function PedidoFormModal({ pedido, onCerrar, onGuardado }: Props) {
  const esEdicion = pedido !== null;

  // Rol del usuario, para limitar las opciones de estado al editar (coherente con
  // la regla que fuerza el backend):
  //  - ADMINISTRADOR: puede elegir cualquiera de los 4 estados.
  //  - EMPLEADO: solo el estado ACTUAL y el SIGUIENTE del flujo (solo avanza un
  //    paso). Así el <select> no ofrece transiciones que el backend rechazaría con
  //    un 409 al guardar.
  const { rol } = useAuth();
  const esAdmin = rol === "administrador";
  const estadosDisponibles: string[] = (() => {
    if (esAdmin) return ESTADOS;
    const actual = pedido?.estado ?? "recibido";
    const i = ESTADOS.indexOf(actual);
    if (i === -1) return [actual]; // estado legacy: solo mostrarlo, sin ofrecer cambios
    return i < ESTADOS.length - 1 ? [ESTADOS[i], ESTADOS[i + 1]] : [ESTADOS[i]];
  })();

  // Estado del formulario (todos los inputs son texto; convertimos al enviar).
  const [cliente, setCliente] = useState(pedido?.cliente ?? "");
  const [telefono, setTelefono] = useState(pedido?.telefono ?? "");
  const [kilos, setKilos] = useState(pedido ? String(pedido.kilos) : "");
  const [precio, setPrecio] = useState(pedido ? String(pedido.precio_por_kilo) : "");
  const [estado, setEstado] = useState(pedido?.estado ?? "recibido");
  // Notas / observaciones (opcional). Texto libre, hasta 500 caracteres.
  const [notas, setNotas] = useState(pedido?.notas ?? "");

  const [errores, setErrores] = useState<ErroresForm>({});
  const [errorGeneral, setErrorGeneral] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  // Validación en el frontend (coherente con el backend).
  function validar(): ErroresForm {
    const e: ErroresForm = {};

    const c = cliente.trim();
    if (!c) e.cliente = "Ingresa el nombre del cliente.";
    else if (/^[0-9]+$/.test(c)) e.cliente = "El nombre no puede ser solo números.";
    else if (c.length > 150) e.cliente = "Máximo 150 caracteres.";

    const t = telefono.trim();
    // Teléfono es opcional; si viene, debe cumplir el formato del backend.
    if (t && !/^[0-9+()\-\s]{6,30}$/.test(t)) {
      e.telefono = "Teléfono inválido (6 a 30: dígitos, + ( ) - y espacios).";
    }

    const k = kilos.trim();
    if (!k) e.kilos = "Ingresa los kilos.";
    else if (!/^\d+(\.\d{1,2})?$/.test(k) || Number(k) <= 0)
      e.kilos = "Debe ser un número mayor a 0 (hasta 2 decimales).";
    else if (Number(k) > 9999.99) e.kilos = "Máximo 9999.99 kg.";

    const p = precio.trim();
    if (!p) e.precio = "Ingresa el precio por kilo.";
    else if (!/^\d+(\.\d{1,2})?$/.test(p) || Number(p) <= 0)
      e.precio = "Debe ser un número mayor a 0 (hasta 2 decimales).";
    // Tope superior coherente con el backend (precio: max_digits=10, decimal_places=2
    // -> máximo 99999999.99). Sin esto, un precio enorme pasaría y daría un 422.
    else if (Number(p) > 99999999.99) e.precio = "Máximo 99999999.99.";

    // Notas: opcional; si se completa, hasta 500 caracteres (igual que el backend).
    if (notas.trim().length > 500) e.notas = "Máximo 500 caracteres.";

    return e;
  }

  async function manejarEnvio(ev: FormEvent) {
    ev.preventDefault();
    setErrorGeneral(null);

    const e = validar();
    setErrores(e);
    if (Object.keys(e).length > 0) return; // hay errores: no enviamos

    // Armamos el cuerpo. Teléfono vacío -> null (no mandamos "" porque el
    // backend lo rechazaría por formato). El estado solo se envía al editar.
    const payload: PedidoEntrada = {
      cliente: cliente.trim(),
      telefono: telefono.trim() === "" ? null : telefono.trim(),
      kilos: kilos.trim(),
      precio_por_kilo: precio.trim(),
      // Notas vacías -> null (no guardamos un string vacío). Se envía siempre, así
      // que al editar también permite BORRAR las notas que hubiera (dejar el campo
      // vacío manda null y el backend lo limpia).
      notas: notas.trim() === "" ? null : notas.trim(),
      ...(esEdicion ? { estado } : {}),
    };

    setGuardando(true);
    try {
      if (esEdicion && pedido) {
        await actualizarPedido(pedido.id, payload);
      } else {
        await crearPedido(payload);
      }
      onGuardado(); // éxito: el padre refresca la tabla y cierra
    } catch (err) {
      // Error del backend (422 de validación, 503, etc.): lo mostramos.
      setErrorGeneral(err instanceof Error ? err.message : "No se pudo guardar el pedido.");
    } finally {
      setGuardando(false);
    }
  }

  return (
    <Modal
      titulo={esEdicion ? `Editar pedido #${pedido?.id}` : "Nuevo pedido"}
      onCerrar={onCerrar}
      cargando={guardando}
    >
      <form onSubmit={manejarEnvio} className="space-y-4" noValidate>
        {/* Cliente */}
        <div>
          <label htmlFor="cliente" className="mb-1.5 block text-sm text-slate-300">
            Cliente
          </label>
          <input
            id="cliente"
            type="text"
            value={cliente}
            onChange={(e) => setCliente(e.target.value)}
            placeholder="Nombre del cliente"
            className={claseInput(!!errores.cliente)}
          />
          {errores.cliente && (
            <p className="mt-1 text-xs text-red-400">{errores.cliente}</p>
          )}
        </div>

        {/* Teléfono (opcional) */}
        <div>
          <label htmlFor="telefono" className="mb-1.5 block text-sm text-slate-300">
            Teléfono <span className="text-slate-500">(opcional)</span>
          </label>
          <input
            id="telefono"
            type="text"
            value={telefono}
            onChange={(e) => setTelefono(e.target.value)}
            placeholder="Ej: +54 11 1234-5678"
            className={claseInput(!!errores.telefono)}
          />
          {errores.telefono && (
            <p className="mt-1 text-xs text-red-400">{errores.telefono}</p>
          )}
        </div>

        {/* Kilos y precio, en una fila */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor="kilos" className="mb-1.5 block text-sm text-slate-300">
              Kilos
            </label>
            <input
              id="kilos"
              type="text"
              inputMode="decimal"
              value={kilos}
              onChange={(e) => setKilos(e.target.value)}
              placeholder="0.00"
              className={claseInput(!!errores.kilos)}
            />
            {errores.kilos && (
              <p className="mt-1 text-xs text-red-400">{errores.kilos}</p>
            )}
          </div>
          <div>
            <label htmlFor="precio" className="mb-1.5 block text-sm text-slate-300">
              Precio por kilo
            </label>
            <input
              id="precio"
              type="text"
              inputMode="decimal"
              value={precio}
              onChange={(e) => setPrecio(e.target.value)}
              placeholder="0.00"
              className={claseInput(!!errores.precio)}
            />
            {errores.precio && (
              <p className="mt-1 text-xs text-red-400">{errores.precio}</p>
            )}
          </div>
        </div>

        {/* Notas / observaciones (opcional) */}
        <div>
          <label htmlFor="notas" className="mb-1.5 block text-sm text-slate-300">
            Notas <span className="text-slate-500">(opcional)</span>
          </label>
          <textarea
            id="notas"
            rows={3}
            value={notas}
            onChange={(e) => setNotas(e.target.value)}
            placeholder="Observaciones: instrucciones especiales, detalles de la prenda, etc."
            className={`${claseInput(!!errores.notas)} resize-y`}
          />
          <div className="mt-1 flex items-center justify-between">
            {errores.notas ? (
              <p className="text-xs text-red-400">{errores.notas}</p>
            ) : (
              <span />
            )}
            {/* Contador de caracteres: gris normal, ámbar al acercarse al límite
                (más de 450) y rojo si se pasa de 500. */}
            <span
              className={`text-xs ${
                notas.trim().length > 500
                  ? "text-red-400"
                  : notas.trim().length > 450
                    ? "text-amber-400"
                    : "text-slate-500"
              }`}
            >
              {notas.trim().length}/500
            </span>
          </div>
        </div>

        {/* Estado: solo al editar (al crear, el backend lo pone en 'recibido') */}
        {esEdicion && (
          <div>
            <label htmlFor="estado" className="mb-1.5 block text-sm text-slate-300">
              Estado
            </label>
            <select
              id="estado"
              value={estado}
              onChange={(e) => setEstado(e.target.value)}
              className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-slate-100 capitalize outline-none transition focus:border-acero focus:ring-2 focus:ring-acero/40"
            >
              {estadosDisponibles.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>
        )}

        {/* Error general del backend */}
        {errorGeneral && (
          <p className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
            {errorGeneral}
          </p>
        )}

        {/* Botones */}
        <div className="flex justify-end gap-3 pt-2">
          <button
            type="button"
            onClick={onCerrar}
            disabled={guardando}
            className="rounded-lg border border-slate-700 bg-slate-800 px-4 py-2 text-sm text-slate-200 transition hover:bg-slate-700 disabled:opacity-60"
          >
            Cancelar
          </button>
          <button
            type="submit"
            disabled={guardando}
            className="flex items-center gap-2 rounded-lg bg-acero px-4 py-2 text-sm font-medium text-white transition hover:bg-acero-fuerte disabled:cursor-not-allowed disabled:opacity-60"
          >
            {guardando && <Loader2 className="h-4 w-4 animate-spin" />}
            {esEdicion ? "Guardar cambios" : "Crear pedido"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
