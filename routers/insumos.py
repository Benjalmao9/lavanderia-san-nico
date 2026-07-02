# ============================================================
#  Rutas (endpoints) del CRUD de insumos.
#
#  Mismo patrón que routers/pedidos.py: agrupamos las rutas en un
#  APIRouter y luego lo incluimos en main.py. Cada insumo es un
#  producto de la lavandería (detergente, suavizante...) con una
#  cantidad en stock y un stock mínimo deseado.
# ============================================================

import logging

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
# Importamos las excepciones de SQLAlchemy para poder capturar fallos
# en el commit (FK rota, dato que excede el VARCHAR, errores de conexión...)
# y responder con un error controlado en vez de un 500 con traceback.
from sqlalchemy.exc import IntegrityError, DataError, SQLAlchemyError

from database import get_db

# Logger del módulo para registrar fallos de base de datos sin exponer
# el detalle interno al cliente.
logger = logging.getLogger("lavanderia")

# Importamos Insumo y también Categoria, porque al crear un insumo
# necesitamos comprobar que la categoría indicada exista de verdad.
from models import Insumo, Categoria, Usuario
from schemas import InsumoCrear, InsumoActualizar, InsumoRespuesta

# Dependencia de AUTENTICACIÓN: exige un token válido (cualquier rol).
from dependencias import obtener_usuario_actual

# Registro de auditoría: dejamos constancia de crear/editar/borrar insumos.
from auditoria import registrar_auditoria


# dependencies=[Depends(obtener_usuario_actual)] a nivel de router: TODAS las
# rutas de insumos (incluida /insumos/alertas) exigen estar logueado, sin
# importar el rol. Sin token válido, FastAPI responde 401 y la ruta no corre.
router = APIRouter(
    prefix="/insumos",
    tags=["insumos"],
    dependencies=[Depends(obtener_usuario_actual)],
)


# ------------------------------------------------------------
#  Función auxiliar: validar que una categoría exista.
#  Si categoria_id viene con un valor, comprobamos que esa categoría
#  esté en la base. Si no existe, respondemos 400 (dato inválido del
#  cliente). El caso None quedó como defensa: hoy ninguna ruta llega
#  hasta acá con None (al crear es obligatorio; al editar, el router
#  rechaza el null antes de llamar a esta función), pero mantenemos el
#  early-return por robustez si alguien la reutiliza en otro contexto.
# ------------------------------------------------------------
def validar_categoria(categoria_id, db: Session):
    if categoria_id is None:
        return
    existe = db.query(Categoria).filter(Categoria.id == categoria_id).first()
    if existe is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"No existe una categoría con id {categoria_id}",
        )


# ============================================================
#  GET /insumos
#  Lista TODOS los insumos.
# ============================================================
@router.get("", response_model=list[InsumoRespuesta])
def listar_insumos(db: Session = Depends(get_db)):
    return db.query(Insumo).all()


# ============================================================
#  GET /insumos/alertas
#  Devuelve solo los insumos con stock BAJO, es decir, aquellos
#  cuya cantidad es menor O IGUAL a su stock mínimo (cantidad <= stock_minimo).
#  Sirve para saber qué hay que reponer.
#
#  ¡IMPORTANTE el ORDEN! Esta ruta se define ANTES que
#  /insumos/{insumo_id}. FastAPI evalúa las rutas de arriba hacia
#  abajo y usa la PRIMERA que coincide. Si /{insumo_id} estuviera
#  primero, al pedir /insumos/alertas el comodín {insumo_id}
#  capturaría el texto "alertas" e intentaría convertirlo a número
#  (fallando o dando 404). Poniendo /alertas antes, la dirección
#  exacta gana y nunca llega al comodín.
# ============================================================
@router.get("/alertas", response_model=list[InsumoRespuesta])
def insumos_en_alerta(db: Session = Depends(get_db)):
    # La condición usa <= para incluir también el caso de igualdad:
    # si la cantidad ya bajó justo hasta el mínimo, también es alerta.
    return db.query(Insumo).filter(Insumo.cantidad <= Insumo.stock_minimo).all()


# ============================================================
#  GET /insumos/{insumo_id}
#  Devuelve UN insumo por su id. Si no existe, error 404.
# ============================================================
@router.get("/{insumo_id}", response_model=InsumoRespuesta)
def obtener_insumo(insumo_id: int, db: Session = Depends(get_db)):
    insumo = db.query(Insumo).filter(Insumo.id == insumo_id).first()
    if insumo is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"No existe un insumo con id {insumo_id}",
        )
    return insumo


# ============================================================
#  POST /insumos
#  Crea un insumo nuevo (código 201). Si el cliente manda categoria_id,
#  validamos que esa categoría exista antes de crear el insumo.
# ============================================================
@router.post("", response_model=InsumoRespuesta, status_code=status.HTTP_201_CREATED)
def crear_insumo(
    datos: InsumoCrear,
    db: Session = Depends(get_db),
    usuario_actual: Usuario = Depends(obtener_usuario_actual),
):
    # categoria_id ahora es obligatorio (lo garantiza InsumoCrear con un 422 si
    # falta o viene null). Acá comprobamos que esa categoría EXISTA de verdad.
    validar_categoria(datos.categoria_id, db)

    nuevo_insumo = Insumo(
        nombre=datos.nombre,
        categoria_id=datos.categoria_id,
        cantidad=datos.cantidad,
        stock_minimo=datos.stock_minimo,
    )
    db.add(nuevo_insumo)
    # Aunque validar_categoria ya devolvió 400 si la categoría no existía,
    # protegemos el commit como red de seguridad: entre el SELECT de
    # validación y este commit otra transacción podría haber borrado la
    # categoría (TOCTOU) y la FK rechazaría el insert. También cubre datos
    # que excedan el tamaño de columna u otros fallos de la base.
    try:
        db.commit()
    except (IntegrityError, DataError):
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Datos del insumo inválidos",
        )
    except SQLAlchemyError:
        db.rollback()
        logger.exception("Error de base de datos al crear insumo")
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="No se pudo guardar el insumo",
        )
    db.refresh(nuevo_insumo)

    # Auditoría del insumo ya creado (commit hecho).
    registrar_auditoria(
        usuario_actual,
        "crear_insumo",
        "insumo",
        nuevo_insumo.id,
        detalle=f"nombre={nuevo_insumo.nombre}, cantidad={nuevo_insumo.cantidad}",
    )
    return nuevo_insumo


# ============================================================
#  PUT /insumos/{insumo_id}
#  Edición PARCIAL: solo se cambian los campos enviados. 404 si no existe.
#  Si en la edición se cambia la categoría, también validamos que exista.
# ============================================================
@router.put("/{insumo_id}", response_model=InsumoRespuesta)
def actualizar_insumo(
    insumo_id: int,
    datos: InsumoActualizar,
    db: Session = Depends(get_db),
    usuario_actual: Usuario = Depends(obtener_usuario_actual),
):
    insumo = db.query(Insumo).filter(Insumo.id == insumo_id).first()
    if insumo is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"No existe un insumo con id {insumo_id}",
        )

    # Solo los campos que el cliente realmente envió.
    cambios = datos.model_dump(exclude_unset=True)

    # Si está cambiando la categoría, validamos la nueva categoría.
    if "categoria_id" in cambios:
        # NUEVA REGLA: un insumo ya no puede quedar "sin categoría". Si el cliente
        # envía categoria_id EXPLÍCITAMENTE como null, lo rechazamos con un 400
        # claro (mismo patrón que el guard de null de nombre_usuario/rol en
        # usuarios.py) ANTES de tocar nada. Distinguimos "omitido" (no está en
        # 'cambios' -> no se valida ni se toca) de "enviado como null" (sí está,
        # con valor None -> se rechaza). El frontend siempre manda una categoría
        # válida; este guard protege el endpoint ante llamadas directas (curl).
        if cambios["categoria_id"] is None:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="La categoría es obligatoria: no puede quedar vacía",
            )
        validar_categoria(cambios["categoria_id"], db)

    for campo, valor in cambios.items():
        setattr(insumo, campo, valor)

    # Igual que al crear: validar_categoria ya filtró la categoría
    # inexistente con un 400, pero protegemos el commit como red de
    # seguridad ante una carrera (TOCTOU) que borre la categoría o ante
    # datos que la base rechace al escribir.
    try:
        db.commit()
    except (IntegrityError, DataError):
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Datos del insumo inválidos",
        )
    except SQLAlchemyError:
        db.rollback()
        logger.exception("Error de base de datos al actualizar insumo")
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="No se pudo actualizar el insumo",
        )
    db.refresh(insumo)

    # Auditoría del insumo ya actualizado (commit hecho).
    registrar_auditoria(usuario_actual, "editar_insumo", "insumo", insumo.id)
    return insumo


# ============================================================
#  DELETE /insumos/{insumo_id}
#  Elimina un insumo. 404 si no existe. Devuelve confirmación.
# ============================================================
@router.delete("/{insumo_id}")
def eliminar_insumo(
    insumo_id: int,
    db: Session = Depends(get_db),
    usuario_actual: Usuario = Depends(obtener_usuario_actual),
):
    insumo = db.query(Insumo).filter(Insumo.id == insumo_id).first()
    if insumo is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"No existe un insumo con id {insumo_id}",
        )

    db.delete(insumo)
    # Protegemos también el borrado: si el commit falla (por ejemplo, una
    # restricción de la base o un error transitorio de conexión) hacemos
    # rollback para no dejar la sesión en estado inconsistente y devolvemos
    # un error controlado en vez de un 500 con traceback.
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        # 409 Conflict (igual que el DELETE de pedidos): el borrado choca con
        # una restricción de integridad (ej. una FK que lo referencia).
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="No se pudo eliminar el insumo por una restricción de datos",
        )
    except SQLAlchemyError:
        db.rollback()
        logger.exception("Error de base de datos al eliminar insumo")
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="No se pudo eliminar el insumo",
        )

    # Auditoría del borrado (ya confirmado). Usamos insumo_id porque el objeto
    # 'insumo' ya no existe en la base tras el commit del delete.
    registrar_auditoria(usuario_actual, "eliminar_insumo", "insumo", insumo_id)
    return {"mensaje": f"El insumo con id {insumo_id} fue eliminado correctamente"}
