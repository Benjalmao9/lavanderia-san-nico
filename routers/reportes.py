# ============================================================
#  Reportes del negocio (Etapa 4) — SOLO administradores.
#
#  Cuatro reportes que resumen la actividad de la lavandería. La regla clave:
#  la AGREGACIÓN la hace la BASE DE DATOS (func.sum, func.count, group_by), no
#  Python. Es decir, en vez de traer todos los pedidos y sumarlos en memoria,
#  le pedimos a MySQL que devuelva ya el resumen (una fila por periodo/estado/
#  empleado). Esto es mucho más rápido y escala aunque haya millones de filas.
#
#  AGRUPACIÓN POR PERIODO: para agrupar por día/mes/año usamos la función
#  DATE_FORMAT de MySQL sobre fecha_recepcion. DATE_FORMAT convierte la
#  fecha+hora en una etiqueta de texto según un "formato":
#     dia  -> '%Y-%m-%d' -> '2026-03-15'
#     mes  -> '%Y-%m'    -> '2026-03'
#     anio -> '%Y'       -> '2026'
#  Agrupando por esa etiqueta, MySQL junta todos los pedidos del mismo periodo.
#  Como las etiquetas tienen ceros a la izquierda, ordenarlas como texto ya
#  las deja en orden cronológico ('2026-02' < '2026-03').
#
#  ¿Por qué fecha_recepcion y no fecha_entrega? Porque el ingreso/actividad se
#  genera cuando el pedido ENTRA (se recibe). fecha_entrega puede ser NULL
#  (aún no entregado) y dejaría pedidos fuera del reporte.
#
#  Todas las rutas exigen rol administrador (requerir_admin a nivel de router).
# ============================================================

from datetime import date, datetime, time
from typing import Optional, Literal
import logging

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func
from sqlalchemy.orm import Session
from sqlalchemy.exc import SQLAlchemyError

from database import get_db
from models import Pedido, Usuario
from schemas import (
    IngresosPeriodoRespuesta,
    ConteoPeriodoRespuesta,
    PedidosPorEstadoRespuesta,
    PedidosPorEmpleadoRespuesta,
)
from dependencias import requerir_admin

logger = logging.getLogger("lavanderia")


# dependencies=[Depends(requerir_admin)]: TODOS los reportes son solo para
# administradores (un empleado logueado recibe 403; sin token, 401).
router = APIRouter(
    prefix="/reportes",
    tags=["reportes"],
    dependencies=[Depends(requerir_admin)],
)


# Mapa agrupación -> formato de DATE_FORMAT. La CLAVE la valida FastAPI con un
# Literal (solo 'dia'/'mes'/'anio'); el FORMATO es un literal definido por
# NOSOTROS, no entra texto crudo del usuario, así que no hay riesgo de inyección.
_FORMATOS_PERIODO = {
    "dia": "%Y-%m-%d",
    "mes": "%Y-%m",
    "anio": "%Y",
}


def _validar_rango(fecha_inicio: Optional[date], fecha_fin: Optional[date]) -> None:
    """Rechaza un rango invertido (inicio posterior al fin) con un 400 claro."""
    if (
        fecha_inicio is not None
        and fecha_fin is not None
        and fecha_inicio > fecha_fin
    ):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="fecha_inicio no puede ser posterior a fecha_fin",
        )


def _aplicar_rango(consulta, fecha_inicio: Optional[date], fecha_fin: Optional[date]):
    """Aplica el filtro de rango sobre fecha_recepcion (si se indicaron fechas).

    fecha_fin se hace INCLUSIVO de todo su día. Si comparáramos '<= fecha_fin' a
    secas, como fecha_fin es una fecha sin hora valdría 'hasta las 00:00 de ese
    día' y dejaría afuera los pedidos de más tarde. Por eso comparamos contra el
    ÚLTIMO instante del día con datetime.combine(fecha_fin, time.max)
    (== fecha_fin 23:59:59.999999). Así un pedido del 2026-03-31 14:00 entra en un
    rango que termina el 2026-03-31.

    Nota: usamos datetime.combine en lugar de 'fecha_fin + 1 día' a propósito.
    Sumar un día desbordaría con fecha_fin = date.max (9999-12-31) —una fecha ISO
    válida que el cliente puede mandar— lanzando OverflowError (un 500). combine
    con time.max nunca desborda (da datetime.max) y mantiene la inclusividad.

    Los pedidos con fecha_recepcion NULL quedan FUERA cuando hay filtro de fechas
    (una comparación con NULL es falsa), lo cual es correcto: sin fecha no
    pertenecen a ningún periodo.
    """
    if fecha_inicio is not None:
        consulta = consulta.filter(Pedido.fecha_recepcion >= fecha_inicio)
    if fecha_fin is not None:
        consulta = consulta.filter(
            Pedido.fecha_recepcion <= datetime.combine(fecha_fin, time.max)
        )
    return consulta


# ============================================================
#  Reporte 1 — GET /reportes/ingresos
#  Suma de los 'total' por periodo (día/mes/año) dentro de un rango.
#  Ejemplo (agrupacion=mes): [{periodo:'2026-01', ingresos:5000.00}, ...]
# ============================================================
@router.get("/ingresos", response_model=list[IngresosPeriodoRespuesta])
def reporte_ingresos(
    fecha_inicio: date = Query(..., description="Inicio del rango (YYYY-MM-DD)"),
    fecha_fin: date = Query(..., description="Fin del rango, inclusivo (YYYY-MM-DD)"),
    agrupacion: Literal["dia", "mes", "anio"] = Query(
        default="mes", description="Cómo agrupar el periodo"
    ),
    db: Session = Depends(get_db),
):
    _validar_rango(fecha_inicio, fecha_fin)

    # Expresión del periodo: DATE_FORMAT(fecha_recepcion, formato). La usamos en
    # el SELECT, el GROUP BY y el ORDER BY (misma expresión = mismo grupo).
    formato = _FORMATOS_PERIODO[agrupacion]
    periodo = func.date_format(Pedido.fecha_recepcion, formato)

    try:
        consulta = db.query(
            periodo.label("periodo"),
            func.sum(Pedido.total).label("ingresos"),
        )
        consulta = _aplicar_rango(consulta, fecha_inicio, fecha_fin)
        # group_by junta los pedidos del mismo periodo; func.sum los agrega en la BD.
        filas = consulta.group_by(periodo).order_by(periodo).all()
    except SQLAlchemyError:
        logger.exception("Error de base de datos en el reporte de ingresos")
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Error al acceder a la base de datos",
        )

    # Si el rango no tiene pedidos, 'filas' viene vacío y devolvemos [] (sin romper).
    return [{"periodo": p, "ingresos": ingresos} for p, ingresos in filas]


# ============================================================
#  Reporte 2 — GET /reportes/pedidos-por-periodo
#  Cuántos pedidos hubo por periodo, dentro de un rango.
#  Ejemplo (agrupacion=mes): [{periodo:'2026-01', cantidad:45}, ...]
# ============================================================
@router.get("/pedidos-por-periodo", response_model=list[ConteoPeriodoRespuesta])
def reporte_pedidos_por_periodo(
    fecha_inicio: date = Query(..., description="Inicio del rango (YYYY-MM-DD)"),
    fecha_fin: date = Query(..., description="Fin del rango, inclusivo (YYYY-MM-DD)"),
    agrupacion: Literal["dia", "mes", "anio"] = Query(
        default="mes", description="Cómo agrupar el periodo"
    ),
    db: Session = Depends(get_db),
):
    _validar_rango(fecha_inicio, fecha_fin)

    formato = _FORMATOS_PERIODO[agrupacion]
    periodo = func.date_format(Pedido.fecha_recepcion, formato)

    try:
        consulta = db.query(
            periodo.label("periodo"),
            # count(Pedido.id): cuenta filas por grupo. Lo hace la BD, no Python.
            func.count(Pedido.id).label("cantidad"),
        )
        consulta = _aplicar_rango(consulta, fecha_inicio, fecha_fin)
        filas = consulta.group_by(periodo).order_by(periodo).all()
    except SQLAlchemyError:
        logger.exception("Error de base de datos en el reporte de pedidos por periodo")
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Error al acceder a la base de datos",
        )

    return [{"periodo": p, "cantidad": cantidad} for p, cantidad in filas]


# ============================================================
#  Reporte 3 — GET /reportes/pedidos-por-estado
#  Cuántos pedidos hay en cada estado. Rango de fechas OPCIONAL.
#  Ejemplo: [{estado:'entregado', cantidad:40}, {estado:'recibido', cantidad:15}]
# ============================================================
@router.get("/pedidos-por-estado", response_model=list[PedidosPorEstadoRespuesta])
def reporte_pedidos_por_estado(
    fecha_inicio: Optional[date] = Query(
        default=None, description="Inicio del rango, opcional (YYYY-MM-DD)"
    ),
    fecha_fin: Optional[date] = Query(
        default=None, description="Fin del rango, opcional e inclusivo (YYYY-MM-DD)"
    ),
    db: Session = Depends(get_db),
):
    _validar_rango(fecha_inicio, fecha_fin)

    try:
        consulta = db.query(
            Pedido.estado.label("estado"),
            func.count(Pedido.id).label("cantidad"),
        )
        consulta = _aplicar_rango(consulta, fecha_inicio, fecha_fin)
        # Agrupamos por el campo estado; ordenamos del estado más frecuente al menos.
        filas = (
            consulta.group_by(Pedido.estado)
            .order_by(func.count(Pedido.id).desc())
            .all()
        )
    except SQLAlchemyError:
        logger.exception("Error de base de datos en el reporte de pedidos por estado")
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Error al acceder a la base de datos",
        )

    return [{"estado": estado, "cantidad": cantidad} for estado, cantidad in filas]


# ============================================================
#  Reporte 4 — GET /reportes/pedidos-por-empleado
#  Cuántos pedidos registró cada usuario. Rango de fechas OPCIONAL.
#  Hace LEFT JOIN con usuarios para traer el nombre. Los pedidos sin
#  usuario_id (de antes del login) se agrupan como 'sin asignar'.
#  Ejemplo: [{usuario_id:2, nombre_completo:'María López', cantidad:45}, ...]
# ============================================================
@router.get("/pedidos-por-empleado", response_model=list[PedidosPorEmpleadoRespuesta])
def reporte_pedidos_por_empleado(
    fecha_inicio: Optional[date] = Query(
        default=None, description="Inicio del rango, opcional (YYYY-MM-DD)"
    ),
    fecha_fin: Optional[date] = Query(
        default=None, description="Fin del rango, opcional e inclusivo (YYYY-MM-DD)"
    ),
    db: Session = Depends(get_db),
):
    _validar_rango(fecha_inicio, fecha_fin)

    try:
        # outerjoin (LEFT JOIN): incluye también los pedidos cuyo usuario_id es
        # NULL (no tienen fila en usuarios). Para esos, nombre_* viene NULL y los
        # tratamos como 'sin asignar' más abajo. Un INNER join los descartaría.
        consulta = db.query(
            Pedido.usuario_id.label("usuario_id"),
            Usuario.nombre_completo.label("nombre_completo"),
            Usuario.nombre_usuario.label("nombre_usuario"),
            func.count(Pedido.id).label("cantidad"),
        ).outerjoin(Usuario, Pedido.usuario_id == Usuario.id)
        consulta = _aplicar_rango(consulta, fecha_inicio, fecha_fin)
        # Incluimos en el GROUP BY todas las columnas no agregadas (lo exige el
        # modo ONLY_FULL_GROUP_BY de MySQL). Ordenamos por cantidad descendente.
        filas = (
            consulta.group_by(
                Pedido.usuario_id,
                Usuario.nombre_completo,
                Usuario.nombre_usuario,
            )
            .order_by(func.count(Pedido.id).desc())
            .all()
        )
    except SQLAlchemyError:
        logger.exception("Error de base de datos en el reporte de pedidos por empleado")
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Error al acceder a la base de datos",
        )

    # Damos forma a la respuesta. La AGREGACIÓN ya la hizo la BD; aquí solo
    # decidimos el nombre a mostrar (no sumamos nada en Python):
    #   - usuario_id NULL  -> 'sin asignar'
    #   - usuario con nombre_completo -> ese nombre
    #   - usuario sin nombre_completo -> su nombre_usuario (para que no quede vacío)
    resultado = []
    for usuario_id, nombre_completo, nombre_usuario, cantidad in filas:
        if usuario_id is None:
            nombre = "sin asignar"
        else:
            nombre = nombre_completo or nombre_usuario
        resultado.append(
            {"usuario_id": usuario_id, "nombre_completo": nombre, "cantidad": cantidad}
        )
    return resultado
