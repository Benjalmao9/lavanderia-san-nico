# ============================================================
#  Rutas (endpoints) del CRUD de pedidos.
#
#  Agrupamos todas las rutas de pedidos en un APIRouter. Un router
#  es como una "mini-aplicación" de FastAPI: definimos aquí las rutas
#  y luego lo conectamos al servidor principal en main.py con
#  app.include_router(...). Esto mantiene el código ordenado: cada
#  entidad (pedidos, usuarios, insumos...) tiene su propio archivo.
# ============================================================

# datetime para la fecha/hora de recepción.
from datetime import datetime

# Decimal y ROUND_HALF_UP para calcular el total con dinero de forma
# exacta y redondearlo a 2 decimales (como el DECIMAL(10,2) de MySQL).
from decimal import Decimal, ROUND_HALF_UP

# APIRouter: el agrupador de rutas.
# Depends: para inyectar la sesión de base de datos.
# HTTPException: para responder con errores HTTP (ej: 404).
# status: constantes legibles de códigos HTTP (status.HTTP_201_CREATED...).
from fastapi import APIRouter, Depends, HTTPException, status

# Session: tipo de la sesión de SQLAlchemy.
from sqlalchemy.orm import Session

# Excepciones de SQLAlchemy para traducir fallos de base de datos a
# respuestas HTTP limpias en vez de un 500 con traceback:
#   - IntegrityError: viola una restricción (FK RESTRICT, NOT NULL, UNIQUE...).
#   - DataError: el valor no entra en la columna (ej. DECIMAL fuera de rango).
#   - SQLAlchemyError: cualquier otro error de la capa de base de datos.
from sqlalchemy.exc import IntegrityError, DataError, SQLAlchemyError

# logging para registrar el detalle técnico del error en el servidor
# (sin filtrarlo al cliente en la respuesta HTTP).
import logging

logger = logging.getLogger("lavanderia")

# La dependencia que entrega (y cierra) una sesión de base de datos.
from database import get_db

# El modelo de SQLAlchemy (la tabla) y los esquemas de Pydantic.
# Importamos también Usuario para tipar el usuario autenticado que inyecta
# la dependencia de autenticación.
from models import Pedido, Usuario
from schemas import PedidoCrear, PedidoActualizar, PedidoRespuesta

# Dependencia de AUTENTICACIÓN: exige un token válido e identifica al usuario.
from dependencias import obtener_usuario_actual

# Registro de auditoría: dejamos constancia de crear/editar/borrar pedidos.
from auditoria import registrar_auditoria


# Creamos el router.
#  - prefix="/pedidos" -> todas las rutas de aquí empiezan con /pedidos.
#  - tags=["pedidos"]  -> agrupa estas rutas bajo el título "pedidos"
#                         en la documentación automática (/docs).
#  - dependencies=[Depends(obtener_usuario_actual)] -> AUTENTICACIÓN a nivel de
#    router: TODAS las rutas de pedidos exigen estar logueado (con cualquier
#    rol). Si no llega un token válido, FastAPI responde 401 y la ruta ni se
#    ejecuta. Ponerlo aquí evita repetir el Depends en cada endpoint.
router = APIRouter(
    prefix="/pedidos",
    tags=["pedidos"],
    dependencies=[Depends(obtener_usuario_actual)],
)


# ------------------------------------------------------------
#  Función auxiliar: calcular el total.
#
#  ¿Por qué el total se calcula en el SERVIDOR y no se recibe del
#  cliente? Por seguridad e integridad de los datos. Si confiáramos
#  en el total que envía el cliente, alguien podría mandar kilos=10,
#  precio=2 pero total=1 y pagar de menos. Calculándolo nosotros,
#  el total SIEMPRE es coherente con los kilos y el precio.
# ------------------------------------------------------------
# Tope del total = máximo de la columna pedidos.total DECIMAL(10,2).
_TOTAL_MAXIMO = Decimal("99999999.99")

# Flujo de estados válido del pedido: cada estado solo puede avanzar al/los
# siguiente(s). 'entregado' es terminal (no se retrocede ni se salta). Esto se
# valida en actualizar_pedido; el esquema (Literal) ya garantiza que el valor sea
# uno de estos cuatro.
_TRANSICIONES_ESTADO = {
    "recibido": {"en proceso"},
    "en proceso": {"listo"},
    "listo": {"entregado"},
    "entregado": set(),
}


def calcular_total(kilos: Decimal, precio_por_kilo: Decimal) -> Decimal:
    total = kilos * precio_por_kilo
    # Redondeamos a 2 decimales (centavos) para que encaje en DECIMAL(10,2).
    total = total.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
    # kilos y precio_por_kilo son válidos por separado, pero su PRODUCTO puede
    # superar el máximo de la columna total (DECIMAL(10,2) = 99999999.99) y
    # reventar el commit con un DataError -> 400 genérico confuso. Lo atajamos
    # acá con un 422 explícito y claro.
    if total > _TOTAL_MAXIMO:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"El total ({total}) supera el máximo permitido ({_TOTAL_MAXIMO}).",
        )
    return total


# ============================================================
#  GET /pedidos
#  Devuelve la lista de TODOS los pedidos.
#  response_model=list[PedidoRespuesta] hace que FastAPI convierta
#  cada objeto de la base a la forma de PedidoRespuesta (y valida
#  que no se filtre nada que no deba salir).
# ============================================================
@router.get("", response_model=list[PedidoRespuesta])
def listar_pedidos(db: Session = Depends(get_db)):
    # Traemos todos los registros de la tabla pedidos.
    pedidos = db.query(Pedido).all()
    return pedidos


# ============================================================
#  GET /pedidos/{pedido_id}
#  Devuelve UN pedido por su id. Si no existe, error 404.
#  {pedido_id} es un "parámetro de ruta": FastAPI lo toma de la URL
#  y nos lo pasa como argumento (convertido a int automáticamente).
# ============================================================
@router.get("/{pedido_id}", response_model=PedidoRespuesta)
def obtener_pedido(pedido_id: int, db: Session = Depends(get_db)):
    # Buscamos el pedido por su clave primaria.
    pedido = db.query(Pedido).filter(Pedido.id == pedido_id).first()

    # Si no se encontró, db devuelve None -> respondemos 404.
    if pedido is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"No existe un pedido con id {pedido_id}",
        )
    return pedido


# ============================================================
#  POST /pedidos
#  Crea un pedido nuevo a partir de PedidoCrear.
#  El SERVIDOR se encarga de:
#    - calcular el total (kilos * precio_por_kilo),
#    - poner el estado inicial en 'recibido',
#    - registrar la fecha de recepción (ahora),
#    - dejar la fecha de entrega en NULL (aún no se entregó).
#  status_code=201 = "Created" (lo correcto al crear un recurso).
# ============================================================
@router.post("", response_model=PedidoRespuesta, status_code=status.HTTP_201_CREATED)
def crear_pedido(
    datos: PedidoCrear,
    db: Session = Depends(get_db),
    # usuario_actual: el usuario autenticado que está creando el pedido. Aunque
    # el router ya exige login, aquí declaramos la dependencia de nuevo para
    # RECIBIR el objeto Usuario y poder registrar quién creó el pedido. FastAPI
    # cachea la dependencia dentro de la misma petición, así que obtener_usuario_actual
    # se ejecuta una sola vez (no se repite la consulta a la BD).
    usuario_actual: Usuario = Depends(obtener_usuario_actual),
):
    # Calculamos el total en el servidor (ver explicación en calcular_total).
    total = calcular_total(datos.kilos, datos.precio_por_kilo)

    # Creamos el objeto del modelo con los datos del cliente + los que
    # genera el servidor.
    nuevo_pedido = Pedido(
        cliente=datos.cliente,
        telefono=datos.telefono,
        kilos=datos.kilos,
        precio_por_kilo=datos.precio_por_kilo,
        total=total,                       # calculado, no recibido
        estado="recibido",                 # estado inicial
        fecha_recepcion=datetime.now(),    # momento de la recepción
        fecha_entrega=None,                # todavía no se entrega
        notas=datos.notas,                 # observaciones opcionales del usuario
        # Registramos QUIÉN creó el pedido: el id del usuario autenticado.
        usuario_id=usuario_actual.id,
    )

    # add() lo marca para insertar; commit() lo guarda de verdad.
    db.add(nuevo_pedido)
    # Envolvemos el commit en try/except: si la base rechaza el insert
    # (datos inválidos, restricción violada, etc.) no queremos un 500 con
    # traceback que filtre detalles internos. Hacemos rollback para dejar
    # la sesión limpia y traducimos el error a un código HTTP claro.
    try:
        db.commit()
    except (IntegrityError, DataError):
        # Error por culpa de los datos enviados -> 400 Bad Request.
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Datos del pedido inválidos",
        )
    except SQLAlchemyError:
        # Fallo inesperado de la base (conexión, etc.) -> 503 y log interno.
        db.rollback()
        logger.exception("Error de base de datos al crear pedido")
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="No se pudo guardar el pedido",
        )
    # refresh() recarga el objeto desde la base para obtener los valores
    # que generó ella (sobre todo el id autoincremental).
    db.refresh(nuevo_pedido)

    # Auditoría: el pedido ya está guardado (commit hecho). Registramos quién lo
    # creó y su id. Va DESPUÉS del commit para que un fallo del log no deshaga
    # el pedido (registrar_auditoria nunca propaga errores).
    registrar_auditoria(
        usuario_actual,
        "crear_pedido",
        "pedido",
        nuevo_pedido.id,
        detalle=f"cliente={nuevo_pedido.cliente}, total={nuevo_pedido.total}",
    )
    return nuevo_pedido


# ============================================================
#  PUT /pedidos/{pedido_id}
#  Actualiza un pedido existente con los campos de PedidoActualizar.
#  Es una edición PARCIAL: solo se cambian los campos que el cliente
#  envió. Si se modifican kilos o precio, recalculamos el total.
#  Si el pedido no existe, error 404.
# ============================================================
@router.put("/{pedido_id}", response_model=PedidoRespuesta)
def actualizar_pedido(
    pedido_id: int,
    datos: PedidoActualizar,
    db: Session = Depends(get_db),
    # Recibimos el usuario autenticado para registrar QUIÉN editó (la dependencia
    # ya corre a nivel de router; FastAPI la cachea, no se repite la consulta).
    usuario_actual: Usuario = Depends(obtener_usuario_actual),
):
    # Buscamos el pedido a editar.
    pedido = db.query(Pedido).filter(Pedido.id == pedido_id).first()
    if pedido is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"No existe un pedido con id {pedido_id}",
        )

    # exclude_unset=True nos da SOLO los campos que el cliente realmente
    # envió (no los que dejó sin tocar). Así no pisamos con None lo que
    # no quería cambiar.
    cambios = datos.model_dump(exclude_unset=True)

    # kilos y precio_por_kilo son Optional[Decimal]=None en el esquema, así
    # que un cliente podría enviarlos EXPLÍCITAMENTE como null. Con
    # exclude_unset=True esa clave SÍ aparece en 'cambios' con valor None, y
    # más abajo el recálculo haría None * Decimal -> TypeError -> 500. Además
    # ambas columnas son NOT NULL en la tabla. Por eso rechazamos el null
    # explícito con un 400 claro en vez de dejar que reviente.
    for campo in ("kilos", "precio_por_kilo"):
        if campo in cambios and cambios[campo] is None:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"{campo} no puede ser null",
            )

    # Validación de TRANSICIÓN de estado SEGÚN EL ROL. El esquema (Literal) ya
    # garantiza que 'estado' sea uno de los cuatro válidos; acá controlamos el
    # ORDEN del cambio, y la regla depende del rol del usuario AUTENTICADO:
    #   - ADMINISTRADOR: puede poner CUALQUIER estado válido (corregir, retroceder
    #     o saltar). No se restringe el orden.
    #   - EMPLEADO: solo puede AVANZAR un paso en el flujo lineal
    #     recibido → en proceso → listo → entregado (no retrocede ni salta).
    # La AUTORIDAD es el backend: leemos el rol del usuario (usuario_actual.rol,
    # que sale del token verificado) y NO confiamos en el frontend. Así un empleado
    # no puede saltarse el flujo aunque manipule la petición (curl, etc.).
    nuevo_estado = cambios.get("estado")
    if (
        nuevo_estado is not None
        and nuevo_estado != pedido.estado
        and usuario_actual.rol != "administrador"
    ):
        permitidos = _TRANSICIONES_ESTADO.get(pedido.estado, set())
        if nuevo_estado not in permitidos:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=(
                    f"Transición de estado inválida para un empleado: de "
                    f"'{pedido.estado}' a '{nuevo_estado}'. El flujo es "
                    f"recibido → en proceso → listo → entregado (sin saltar ni retroceder). "
                    f"Un administrador sí puede corregirlo."
                ),
            )

    # Coherencia de fecha_entrega: si el cliente la envía, no puede ser anterior a
    # la fecha de recepción (un pedido no se entrega antes de recibirse).
    nueva_fecha_entrega = cambios.get("fecha_entrega")
    if (
        nueva_fecha_entrega is not None
        and pedido.fecha_recepcion is not None
        and nueva_fecha_entrega < pedido.fecha_recepcion
    ):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="La fecha de entrega no puede ser anterior a la de recepción.",
        )

    # Aplicamos cada cambio al objeto del pedido.
    for campo, valor in cambios.items():
        setattr(pedido, campo, valor)

    # Coherencia de fecha_entrega con el estado (el servidor es la fuente de verdad):
    #  - Al pasar a 'entregado', si no se indicó una fecha, la fija el servidor
    #    (igual que la recepción): un pedido entregado SIEMPRE tiene su fecha.
    #  - Si el pedido DEJA de estar 'entregado' (un admin lo corrige/retrocede) y
    #    no se envió una fecha_entrega explícita en este PUT, la limpiamos: una
    #    fecha de entrega en un pedido no entregado sería incoherente.
    if pedido.estado == "entregado":
        if pedido.fecha_entrega is None:
            pedido.fecha_entrega = datetime.now()
    else:
        # Cualquier estado que NO sea 'entregado' NO debe tener fecha de entrega.
        # La forzamos a None SIEMPRE (aunque el cliente la haya enviado en este PUT,
        # p. ej. un admin que retrocede el estado y manda fecha_entrega a la vez):
        # la coherencia depende del estado final, no de si el campo vino en el body.
        pedido.fecha_entrega = None

    # Si cambió kilos o el precio, el total quedó desactualizado:
    # lo recalculamos en el servidor con los valores ya actualizados.
    if "kilos" in cambios or "precio_por_kilo" in cambios:
        pedido.total = calcular_total(pedido.kilos, pedido.precio_por_kilo)

    # Mismo manejo defensivo del commit que en crear_pedido: traducimos los
    # fallos de base de datos a códigos HTTP claros y hacemos rollback para
    # no dejar la sesión en un estado inválido.
    try:
        db.commit()
    except (IntegrityError, DataError):
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Datos del pedido inválidos",
        )
    except SQLAlchemyError:
        db.rollback()
        logger.exception("Error de base de datos al actualizar pedido")
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="No se pudo actualizar el pedido",
        )
    db.refresh(pedido)

    # Auditoría del pedido ya actualizado (commit hecho).
    registrar_auditoria(usuario_actual, "editar_pedido", "pedido", pedido.id)
    return pedido


# ============================================================
#  DELETE /pedidos/{pedido_id}
#  Elimina un pedido. Si no existe, error 404.
#  Responde con un mensaje de confirmación.
# ============================================================
@router.delete("/{pedido_id}")
def eliminar_pedido(
    pedido_id: int,
    db: Session = Depends(get_db),
    usuario_actual: Usuario = Depends(obtener_usuario_actual),
):
    pedido = db.query(Pedido).filter(Pedido.id == pedido_id).first()
    if pedido is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"No existe un pedido con id {pedido_id}",
        )

    # delete() lo marca para borrar; commit() confirma el borrado.
    db.delete(pedido)
    # Envolvemos el borrado en try/except: si alguna restricción impide
    # eliminar el pedido (p. ej. una FK con ON DELETE RESTRICT que apunte a
    # este pedido), la base lanza IntegrityError. Lo traducimos a 409
    # Conflict en vez de un 500, y hacemos rollback para limpiar la sesión.
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"No se puede borrar el pedido {pedido_id}: tiene registros asociados",
        )
    except SQLAlchemyError:
        db.rollback()
        logger.exception("Error de base de datos al eliminar pedido")
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="No se pudo eliminar el pedido",
        )

    # Auditoría del borrado (ya confirmado). Usamos pedido_id porque el objeto
    # 'pedido' ya no existe en la base tras el commit del delete.
    registrar_auditoria(usuario_actual, "eliminar_pedido", "pedido", pedido_id)
    return {"mensaje": f"El pedido con id {pedido_id} fue eliminado correctamente"}
