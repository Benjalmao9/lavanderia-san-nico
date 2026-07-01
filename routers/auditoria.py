# ============================================================
#  Ruta para CONSULTAR la auditoría (bitácora de acciones).
#
#  Expone GET /auditoria, SOLO para administradores. Devuelve los registros
#  ordenados del más reciente al más antiguo. Ver quién hizo qué y cuándo es
#  información sensible (revela actividad y nombres de usuario intentados en
#  logins fallidos), por eso es una vista de administración.
#
#  Acá NO se registra auditoría de la propia consulta (sería ruido); la
#  ESCRITURA de logs vive en auditoria.py (registrar_auditoria), que llaman
#  las acciones de pedidos/insumos/usuarios/login.
# ============================================================

import logging

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session
from sqlalchemy.exc import SQLAlchemyError

from database import get_db
from models import Auditoria
from schemas import AuditoriaRespuesta

# Dependencia de AUTORIZACIÓN: exige que el usuario sea administrador.
from dependencias import requerir_admin

logger = logging.getLogger("lavanderia")


# dependencies=[Depends(requerir_admin)] a nivel de router: la ruta exige ser
# administrador (un empleado logueado recibe 403; sin token, 401).
router = APIRouter(
    prefix="/auditoria",
    tags=["auditoría"],
    dependencies=[Depends(requerir_admin)],
)


# ============================================================
#  GET /auditoria
#  Devuelve los registros de auditoría, del más reciente al más antiguo.
#
#  'limite' acota cuántas filas se devuelven (la bitácora puede crecer mucho;
#  traerla entera sería lento y pesado). Por defecto 100, con un máximo de 500
#  para que ni siquiera un cliente que pida de más sature la respuesta.
# ============================================================
@router.get("", response_model=list[AuditoriaRespuesta])
def listar_auditoria(
    db: Session = Depends(get_db),
    limite: int = Query(default=100, ge=1, le=500),
):
    try:
        # order_by fecha DESC (más reciente primero); id DESC como desempate
        # cuando dos filas comparten el mismo instante. limit acota el resultado.
        registros = (
            db.query(Auditoria)
            .order_by(Auditoria.fecha.desc(), Auditoria.id.desc())
            .limit(limite)
            .all()
        )
    except SQLAlchemyError:
        # Mismo criterio que el resto del proyecto: no filtramos el detalle al
        # cliente; lo dejamos en el log y respondemos 503.
        logger.exception("Error de base de datos al listar la auditoría")
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Error al acceder a la base de datos",
        )
    return registros
