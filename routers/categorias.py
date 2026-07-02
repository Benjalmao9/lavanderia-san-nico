# ============================================================
#  Rutas de categorías: LISTAR (cualquier rol) y CREAR (solo admin).
#
#  - GET /categorias: lo usa el frontend para llenar el desplegable de categorías
#    al crear/editar un insumo. Requiere estar logueado (cualquier rol), igual que
#    insumos, porque todos necesitan verlas al gestionar el inventario.
#  - POST /categorias: alta de una categoría nueva. Es una tarea administrativa,
#    así que se restringe a administradores (con un Depends(requerir_admin) en la
#    propia ruta, ADEMÁS de la autenticación de router). Por ahora no hay
#    editar/borrar: solo se listan y se crean.
# ============================================================

import logging

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
# IntegrityError: red de seguridad ante una carrera contra la restricción UNIQUE
# de categorias.nombre (dos altas simultáneas del mismo nombre).
from sqlalchemy.exc import IntegrityError, SQLAlchemyError

from database import get_db
from models import Categoria, Usuario
from schemas import CategoriaCrear, CategoriaRespuesta

# Dependencias de seguridad:
#  - obtener_usuario_actual: AUTENTICACIÓN (token válido, cualquier rol) a nivel
#    de router (cubre el GET y precede al chequeo de rol del POST).
#  - requerir_admin: AUTORIZACIÓN, se aplica SOLO al POST para exigir admin.
from dependencias import obtener_usuario_actual, requerir_admin

# Registro de auditoría: dejamos constancia del alta de categorías, como el resto
# de las acciones administrativas (crear/editar/borrar usuarios, insumos, etc.).
from auditoria import registrar_auditoria

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


# ============================================================
#  POST /categorias  (SOLO ADMINISTRADORES)
#  Crea una categoría nueva. El esquema CategoriaCrear ya valida el nombre
#  (recorta espacios, no vacío, máximo 100 = VARCHAR(100)). Como la columna
#  categorias.nombre es UNIQUE, un nombre repetido se traduce a un 409 con
#  mensaje claro en lugar de un 500 genérico del servidor.
#
#  dependencies=[Depends(requerir_admin)] a nivel de RUTA: además de la
#  autenticación del router (obtener_usuario_actual), exige rol administrador.
#  Un empleado logueado recibe 403; sin token, 401. FastAPI cachea la
#  dependencia, así que no repite la consulta del usuario.
# ============================================================
@router.post(
    "",
    response_model=CategoriaRespuesta,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(requerir_admin)],
)
def crear_categoria(
    datos: CategoriaCrear,
    db: Session = Depends(get_db),
    # admin_actual: el administrador que ejecuta el alta (para la auditoría).
    admin_actual: Usuario = Depends(requerir_admin),
):
    # Pre-chequeo amable: si ya existe una categoría con ese nombre, devolvemos
    # 409 sin siquiera intentar el INSERT. La barrera REAL es el UNIQUE de la BD
    # (ver el except IntegrityError); esto solo da un mensaje más claro en el
    # caso común. Nota: la comparación usa la collation de la columna, que en
    # MySQL suele ser case-insensitive, así que 'Limpieza' y 'limpieza' se tratan
    # como el mismo nombre (coherente con lo que hará el UNIQUE al confirmar).
    existe = db.query(Categoria).filter(Categoria.nombre == datos.nombre).first()
    if existe is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Ya existe una categoría con ese nombre",
        )

    nueva = Categoria(nombre=datos.nombre)
    db.add(nueva)
    try:
        db.commit()
    except IntegrityError:
        # Red de seguridad ante una carrera: dos altas simultáneas del mismo
        # nombre pasan ambas el pre-chequeo, pero el UNIQUE de la BD rechaza la
        # segunda. La traducimos al mismo 409 claro en vez de un 500.
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Ya existe una categoría con ese nombre",
        )
    except SQLAlchemyError:
        db.rollback()
        logger.exception("Error de base de datos al crear categoría")
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="No se pudo guardar la categoría",
        )
    db.refresh(nueva)

    # Auditoría del alta (commit ya hecho), como el resto de acciones
    # administrativas. El nombre de una categoría no es dato sensible.
    registrar_auditoria(
        admin_actual,
        "crear_categoria",
        "categoria",
        nueva.id,
        detalle=f"nombre={nueva.nombre}",
    )
    return nueva
