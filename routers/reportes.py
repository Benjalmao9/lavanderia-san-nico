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

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
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

# ahora_utc: instante actual en UTC (naive). Lo usamos para calcular "hoy" al
# validar los límites de fecha de los reportes (ver _limites_validos).
from tiempo import ahora_utc

# Generador del archivo Excel (5 pestañas con tablas + gráficos nativos). Recibe
# los datos ya consultados; no toca la base (ver reporte_excel.py).
from reporte_excel import construir_reporte_excel

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


def _limites_validos(db) -> tuple[date, date]:
    """Rango de fechas con SENTIDO para un reporte: (fecha_min, fecha_max).

    - fecha_max = HOY: no tiene sentido un reporte "del futuro".
    - fecha_min = fecha del pedido MÁS ANTIGUO (MIN(fecha_recepcion)), o HOY si
      todavía no hay ningún pedido (fallback razonable). Así el límite inferior
      sale de datos REALES, sin un valor mágico hardcodeado que envejezca.

    'Hoy' se toma en UTC (ahora_utc), coherente con que las fechas se guardan en
    UTC. Como los usuarios están en México (UTC-6, DETRÁS de UTC), su 'hoy' local
    nunca es posterior a este 'hoy', así que no hay rechazos falsos por el límite
    del día. Puede lanzar SQLAlchemyError (el llamador lo traduce a 503).
    """
    hoy = ahora_utc().date()
    mas_antiguo = db.query(func.min(Pedido.fecha_recepcion)).scalar()
    fecha_min = mas_antiguo.date() if mas_antiguo is not None else hoy
    return fecha_min, hoy


def _validar_limites(db, fecha_inicio: Optional[date], fecha_fin: Optional[date]) -> None:
    """Rechaza (400) un rango fuera de los límites reales del negocio: una fecha
    FUTURA (posterior a hoy) o ANTERIOR al pedido más antiguo. Es la MISMA barrera
    que el frontend muestra en el selector, reforzada acá (el frontend nunca es la
    única barrera: el request se puede mandar directo por curl). Solo valida las
    fechas que vengan con valor; si el rango es totalmente abierto (ambas None,
    p. ej. el histórico de las tarjetas), no hay nada que validar y así evitamos
    una consulta innecesaria a la base."""
    if fecha_inicio is None and fecha_fin is None:
        return
    fecha_min, fecha_max = _limites_validos(db)
    for etiqueta, f in (("fecha_inicio", fecha_inicio), ("fecha_fin", fecha_fin)):
        if f is None:
            continue
        if f > fecha_max:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"{etiqueta} no puede ser una fecha futura (máximo {fecha_max.isoformat()}).",
            )
        if f < fecha_min:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=(
                    f"{etiqueta} no puede ser anterior al pedido más antiguo "
                    f"({fecha_min.isoformat()})."
                ),
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

    ZONA HORARIA: fecha_recepcion se guarda EN UTC (ver tiempo.py), así que
    estos rangos (y los agrupados por día/mes/año con date_format) cortan en la
    MEDIANOCHE UTC, no en la de México. La comparación es correcta y consistente
    (ambos lados en UTC); el matiz es que un pedido de las 19:00 de México
    (01:00 UTC del día siguiente) cuenta para el día UTC siguiente en el
    reporte. Es el mismo criterio que ya regía en producción. Si algún día se
    quiere cortar por el día LOCAL del usuario, habría que recibir su zona
    horaria como parámetro y convertir los límites aquí — no cambiarlo a medias.
    """
    if fecha_inicio is not None:
        consulta = consulta.filter(Pedido.fecha_recepcion >= fecha_inicio)
    if fecha_fin is not None:
        consulta = consulta.filter(
            Pedido.fecha_recepcion <= datetime.combine(fecha_fin, time.max)
        )
    return consulta


# ============================================================
#  CONSULTAS REUTILIZABLES (una sola fuente de verdad).
#
#  El cuerpo de cada reporte vive en una función _consultar_* para poder
#  REUTILIZARLO sin duplicar la lógica desde DOS lugares: (1) el endpoint JSON
#  que ya existía (lo consume la interfaz en vivo del Panel) y (2) el endpoint de
#  exportación a Excel. ¿Por qué no duplicar? Porque duplicar una consulta es el
#  foco de bug clásico: si mañana cambia una regla (cómo se resuelve el nombre
#  del empleado, el filtro de rango inclusivo, la agrupación...), habría que
#  acordarse de tocarla en dos sitios y tarde o temprano divergen; con una sola
#  fuente, la pantalla y el Excel SIEMPRE muestran exactamente los mismos números.
#
#  Estas funciones NO capturan SQLAlchemyError: lo dejan propagar para que cada
#  llamador (endpoint) lo traduzca a su 503 con su propio mensaje de log.
# ============================================================
def _consultar_ingresos(db, fecha_inicio, fecha_fin, agrupacion):
    # DATE_FORMAT(fecha_recepcion, formato): misma expresión en SELECT/GROUP/ORDER.
    formato = _FORMATOS_PERIODO[agrupacion]
    periodo = func.date_format(Pedido.fecha_recepcion, formato)
    consulta = db.query(
        periodo.label("periodo"),
        func.sum(Pedido.total).label("ingresos"),
    )
    consulta = _aplicar_rango(consulta, fecha_inicio, fecha_fin)
    filas = consulta.group_by(periodo).order_by(periodo).all()
    return [{"periodo": p, "ingresos": ingresos} for p, ingresos in filas]


def _consultar_pedidos_por_periodo(db, fecha_inicio, fecha_fin, agrupacion):
    formato = _FORMATOS_PERIODO[agrupacion]
    periodo = func.date_format(Pedido.fecha_recepcion, formato)
    consulta = db.query(
        periodo.label("periodo"),
        func.count(Pedido.id).label("cantidad"),
    )
    consulta = _aplicar_rango(consulta, fecha_inicio, fecha_fin)
    filas = consulta.group_by(periodo).order_by(periodo).all()
    return [{"periodo": p, "cantidad": cantidad} for p, cantidad in filas]


def _consultar_pedidos_por_estado(db, fecha_inicio, fecha_fin):
    consulta = db.query(
        Pedido.estado.label("estado"),
        func.count(Pedido.id).label("cantidad"),
    )
    consulta = _aplicar_rango(consulta, fecha_inicio, fecha_fin)
    filas = (
        consulta.group_by(Pedido.estado)
        .order_by(func.count(Pedido.id).desc())
        .all()
    )
    return [{"estado": estado, "cantidad": cantidad} for estado, cantidad in filas]


def _consultar_pedidos_por_empleado(db, fecha_inicio, fecha_fin):
    consulta = db.query(
        Pedido.usuario_id.label("usuario_id"),
        Usuario.nombre_completo.label("nombre_completo"),
        Usuario.nombre_usuario.label("nombre_usuario"),
        func.count(Pedido.id).label("cantidad"),
    ).outerjoin(Usuario, Pedido.usuario_id == Usuario.id)
    consulta = _aplicar_rango(consulta, fecha_inicio, fecha_fin)
    filas = (
        consulta.group_by(
            Pedido.usuario_id,
            Usuario.nombre_completo,
            Usuario.nombre_usuario,
        )
        .order_by(func.count(Pedido.id).desc())
        .all()
    )
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


def _consultar_detalle_pedidos(db, fecha_inicio, fecha_fin):
    """Todos los pedidos del rango, línea por línea, con el nombre del empleado.

    Lo usa SOLO la exportación a Excel (la interfaz en vivo no lista el detalle).
    outerjoin (LEFT JOIN) trae el nombre del usuario; los pedidos sin usuario
    (previos al login) quedan como 'sin asignar'. Ordenado por fecha de recepción
    y luego id. Las fechas van en UTC (se convierten a hora de México al escribir
    el Excel, ver reporte_excel.py).
    """
    consulta = db.query(
        Pedido,
        Usuario.nombre_completo.label("nombre_completo"),
        Usuario.nombre_usuario.label("nombre_usuario"),
    ).outerjoin(Usuario, Pedido.usuario_id == Usuario.id)
    consulta = _aplicar_rango(consulta, fecha_inicio, fecha_fin)
    filas = consulta.order_by(Pedido.fecha_recepcion.asc(), Pedido.id.asc()).all()

    resultado = []
    for pedido, nombre_completo, nombre_usuario in filas:
        if pedido.usuario_id is None:
            empleado = "sin asignar"
        else:
            empleado = nombre_completo or nombre_usuario or f"usuario #{pedido.usuario_id}"
        resultado.append({
            "id": pedido.id,
            "cliente": pedido.cliente,
            "telefono": pedido.telefono,
            "kilos": pedido.kilos,
            "precio_por_kilo": pedido.precio_por_kilo,
            "total": pedido.total,
            "estado": pedido.estado,
            "fecha_recepcion": pedido.fecha_recepcion,
            "fecha_entrega": pedido.fecha_entrega,
            "empleado": empleado,
            "notas": pedido.notas,
        })
    return resultado


# ============================================================
#  GET /reportes/rango-valido  (SOLO administradores)
#  Devuelve el rango de fechas con sentido para pedir reportes:
#      {"fecha_min": "YYYY-MM-DD", "fecha_max": "YYYY-MM-DD"}
#  El frontend lo usa para poner min/max en el selector de fechas del Panel, en
#  vez de adivinar o hardcodear un valor mágico. fecha_min = pedido más antiguo
#  (o hoy si no hay ninguno); fecha_max = hoy.
# ============================================================
@router.get("/rango-valido")
def rango_valido(db: Session = Depends(get_db)):
    try:
        fecha_min, fecha_max = _limites_validos(db)
    except SQLAlchemyError:
        logger.exception("Error de base de datos al calcular el rango válido de reportes")
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Error al acceder a la base de datos",
        )
    return {"fecha_min": fecha_min.isoformat(), "fecha_max": fecha_max.isoformat()}


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
    try:
        # Rechaza fechas futuras o anteriores al pedido más antiguo (400).
        _validar_limites(db, fecha_inicio, fecha_fin)
        # La consulta vive en _consultar_ingresos (la reutiliza también el export).
        # Si el rango no tiene pedidos, devuelve [] (sin romper).
        return _consultar_ingresos(db, fecha_inicio, fecha_fin, agrupacion)
    except SQLAlchemyError:
        logger.exception("Error de base de datos en el reporte de ingresos")
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Error al acceder a la base de datos",
        )


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
    try:
        _validar_limites(db, fecha_inicio, fecha_fin)
        return _consultar_pedidos_por_periodo(db, fecha_inicio, fecha_fin, agrupacion)
    except SQLAlchemyError:
        logger.exception("Error de base de datos en el reporte de pedidos por periodo")
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Error al acceder a la base de datos",
        )


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
        _validar_limites(db, fecha_inicio, fecha_fin)
        return _consultar_pedidos_por_estado(db, fecha_inicio, fecha_fin)
    except SQLAlchemyError:
        logger.exception("Error de base de datos en el reporte de pedidos por estado")
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Error al acceder a la base de datos",
        )


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
        _validar_limites(db, fecha_inicio, fecha_fin)
        # La consulta (con outerjoin a usuarios y el nombre a mostrar resuelto)
        # vive en _consultar_pedidos_por_empleado, reutilizada por el export.
        return _consultar_pedidos_por_empleado(db, fecha_inicio, fecha_fin)
    except SQLAlchemyError:
        logger.exception("Error de base de datos en el reporte de pedidos por empleado")
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Error al acceder a la base de datos",
        )


# ============================================================
#  GET /reportes/exportar  (SOLO administradores, como todo /reportes)
#  Genera y descarga UN archivo .xlsx con 5 pestañas: los 4 reportes (cada uno
#  con su gráfico nativo) + el detalle de pedidos línea por línea. Recibe los
#  MISMOS parámetros que los reportes (fecha_inicio, fecha_fin, agrupacion) y
#  REUTILIZA las consultas _consultar_* (no las duplica), así el Excel y la
#  pantalla en vivo muestran exactamente los mismos números.
# ============================================================
@router.get("/exportar")
def exportar_reportes(
    fecha_inicio: date = Query(..., description="Inicio del rango (YYYY-MM-DD)"),
    fecha_fin: date = Query(..., description="Fin del rango, inclusivo (YYYY-MM-DD)"),
    agrupacion: Literal["dia", "mes", "anio"] = Query(
        default="mes", description="Cómo agrupar el periodo"
    ),
    db: Session = Depends(get_db),
):
    _validar_rango(fecha_inicio, fecha_fin)

    # Reunimos los 5 conjuntos de datos con las MISMAS consultas que la interfaz.
    try:
        # Rechaza fechas futuras o anteriores al pedido más antiguo (400).
        _validar_limites(db, fecha_inicio, fecha_fin)
        ingresos = _consultar_ingresos(db, fecha_inicio, fecha_fin, agrupacion)
        por_periodo = _consultar_pedidos_por_periodo(
            db, fecha_inicio, fecha_fin, agrupacion
        )
        por_estado = _consultar_pedidos_por_estado(db, fecha_inicio, fecha_fin)
        por_empleado = _consultar_pedidos_por_empleado(db, fecha_inicio, fecha_fin)
        detalle = _consultar_detalle_pedidos(db, fecha_inicio, fecha_fin)
    except SQLAlchemyError:
        logger.exception("Error de base de datos al exportar reportes a Excel")
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Error al acceder a la base de datos",
        )

    # Armamos el .xlsx en memoria (openpyxl). La conversión de fechas UTC -> hora
    # de México ocurre dentro (ver reporte_excel.py).
    try:
        contenido = construir_reporte_excel(
            ingresos, por_periodo, por_estado, por_empleado, detalle
        )
    except Exception:
        # No filtramos el detalle técnico: lo dejamos en el log y respondemos 500.
        logger.exception("Error al generar el archivo Excel de reportes")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="No se pudo generar el archivo de Excel",
        )

    # Nombre de archivo con el rango. Solo lleva caracteres ASCII (fechas ISO), así
    # que no hay problema de codificación en la cabecera Content-Disposition.
    nombre = (
        f"reporte_lavanderia_{fecha_inicio.isoformat()}_a_{fecha_fin.isoformat()}.xlsx"
    )

    # Content-Type oficial de .xlsx + Content-Disposition: attachment para que el
    # navegador lo DESCARGUE (no intente abrirlo) con ese nombre.
    return Response(
        content=contenido,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{nombre}"'},
    )
