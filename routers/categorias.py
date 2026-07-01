# ============================================================
#  Ruta para LISTAR categorías (solo lectura).
#
#  Endpoint simple que el frontend usa para llenar el desplegable de categorías
#  al crear/editar un insumo. Requiere estar logueado (cualquier rol), igual que
#  insumos. No incluye crear/editar/borrar categorías: por ahora solo se listan.
# ============================================================

import logging

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from sqlalchemy.exc import SQLAlchemyError

from database import get_db
from models import Categoria
from schemas import CategoriaRespuesta

# Dependencia de AUTENTICACIÓN: exige un token válido (cualquier rol).
from dependencias import obtener_usuario_actual

logger = logging.getLogger("lavanderia")

router = APIRouter(
    prefix="/categorias",
    tags=["categorias"],
    dependencies=[Depends(obtener_usuario_actual)],
)


# ============================================================
#  GET /categorias
#  Devuelve todas las categorías, ordenadas por nombre.
# ============================================================
@router.get("", response_model=list[CategoriaRespuesta])
def listar_categorias(db: Session = Depends(get_db)):
    try:
        return db.query(Categoria).order_by(Categoria.nombre).all()
    except SQLAlchemyError:
        # Mismo criterio que el resto del proyecto: no filtramos el detalle;
        # lo dejamos en el log y respondemos 503.
        logger.exception("Error de base de datos al listar categorías")
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Error al acceder a la base de datos",
        )
