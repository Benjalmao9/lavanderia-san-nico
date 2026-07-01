# ============================================================
#  Rutas (endpoints) del CRUD de usuarios.
#
#  Mismo patrón que los otros routers. La diferencia clave: la
#  contraseña que llega en texto plano NUNCA se guarda tal cual;
#  se hashea con bcrypt (ver seguridad.py) y se guarda solo el hash
#  en la columna contrasena_hash. Las respuestas usan UsuarioRespuesta,
#  que NO incluye la contraseña ni el hash.
#
#  NOTA: por ahora NO hay control de permisos (cualquiera puede llamar
#  a estas rutas). La autorización (quién puede hacer qué) llega en el
#  paso de login/JWT. Aquí solo dejamos el CRUD con hashing funcionando.
# ============================================================

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

# IntegrityError: lo usamos como red de seguridad ante choques de la
# restricción UNIQUE de nombre_usuario o la FK RESTRICT de pedidos.
from sqlalchemy.exc import IntegrityError, SQLAlchemyError
import logging

logger = logging.getLogger("lavanderia")

from database import get_db
from models import Usuario
from schemas import UsuarioCrear, UsuarioActualizar, UsuarioRespuesta

# Las funciones de hashing. Solo necesitamos hashear al crear/editar;
# la verificación de la contraseña vive en el login.
from seguridad import hashear_contrasena

# Dependencia de AUTORIZACIÓN: exige que el usuario autenticado sea admin.
from dependencias import requerir_admin

# Registro de auditoría de las acciones de administración sobre usuarios.
# SEGURIDAD: en los logs registramos nombre_usuario y rol, NUNCA la contraseña.
from auditoria import registrar_auditoria


# dependencies=[Depends(requerir_admin)] a nivel de router: TODAS las rutas de
# usuarios exigen ser ADMINISTRADOR. requerir_admin primero autentica (token
# válido -> sabemos quién es) y luego autoriza (rol == administrador). Un
# empleado logueado recibe 403 (prohibido); sin token, 401 (no autenticado).
# Gestionar cuentas es una tarea administrativa, por eso es más restrictiva
# que pedidos/insumos.
router = APIRouter(
    prefix="/usuarios",
    tags=["usuarios"],
    dependencies=[Depends(requerir_admin)],
)


def _contar_admins_bloqueando(db: Session) -> int:
    """Cuenta los administradores BLOQUEANDO sus filas (SELECT ... FOR UPDATE)
    dentro de la transacción actual.

    ¿POR QUÉ EL BLOQUEO? La regla "el sistema no puede quedar sin administradores"
    se evalúa en dos pasos: primero se cuenta y luego se aplica el cambio que
    quita un admin (borrarlo o degradarlo a empleado). Sin bloqueo, dos peticiones
    concurrentes que quiten el rol a DOS admins distintos podrían leer ambas
    "quedan 2" (> 1), pasar el guard y confirmar las dos, dejando 0 administradores
    (condición de carrera TOCTOU). Al bloquear las filas de admins con FOR UPDATE,
    la segunda transacción ESPERA a que la primera confirme y recién entonces
    vuelve a contar, ya con el valor real. Requiere InnoDB (MySQL) y una
    transacción activa (la sesión de SQLAlchemy lo es).
    """
    admins = (
        db.query(Usuario)
        .filter(Usuario.rol == "administrador")
        .with_for_update()
        .all()
    )
    return len(admins)


# ============================================================
#  POST /usuarios
#  Crea un usuario. Hashea la contraseña antes de guardarla y valida
#  que el nombre_usuario no esté repetido. Responde 201 con
#  UsuarioRespuesta (sin contraseña).
# ============================================================
@router.post("", response_model=UsuarioRespuesta, status_code=status.HTTP_201_CREATED)
def crear_usuario(
    datos: UsuarioCrear,
    db: Session = Depends(get_db),
    # admin_actual: el administrador que ejecuta la acción (requerir_admin ya
    # corre a nivel de router; FastAPI la cachea, no se repite la consulta).
    admin_actual: Usuario = Depends(requerir_admin),
):
    # Validamos que el nombre de usuario no exista ya (debe ser único).
    existe = db.query(Usuario).filter(Usuario.nombre_usuario == datos.nombre_usuario).first()
    if existe is not None:
        # 409 Conflict: el recurso choca con uno ya existente.
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"El nombre de usuario '{datos.nombre_usuario}' ya está en uso",
        )

    # Hasheamos la contraseña en texto plano y guardamos SOLO el hash.
    # La contraseña plana (datos.contrasena) nunca se persiste.
    nuevo_usuario = Usuario(
        nombre_usuario=datos.nombre_usuario,
        contrasena_hash=hashear_contrasena(datos.contrasena),
        rol=datos.rol,
        nombre_completo=datos.nombre_completo,
    )

    db.add(nuevo_usuario)
    try:
        db.commit()
    except IntegrityError:
        # Red de seguridad ante una carrera: dos altas simultáneas del
        # mismo nombre_usuario (la UNIQUE de la base lo rechaza).
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"El nombre de usuario '{datos.nombre_usuario}' ya está en uso",
        )
    except SQLAlchemyError:
        db.rollback()
        logger.exception("Error de base de datos al crear usuario")
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="No se pudo guardar el usuario",
        )
    db.refresh(nuevo_usuario)

    # Auditoría del alta (commit hecho). Registramos nombre_usuario y rol, NUNCA
    # la contraseña ni el hash.
    registrar_auditoria(
        admin_actual,
        "crear_usuario",
        "usuario",
        nuevo_usuario.id,
        detalle=f"nombre_usuario={nuevo_usuario.nombre_usuario}, rol={nuevo_usuario.rol}",
    )
    return nuevo_usuario


# ============================================================
#  GET /usuarios
#  Lista todos los usuarios. UsuarioRespuesta garantiza que NO se
#  filtra ninguna contraseña ni hash.
# ============================================================
@router.get("", response_model=list[UsuarioRespuesta])
def listar_usuarios(db: Session = Depends(get_db)):
    return db.query(Usuario).all()


# ============================================================
#  GET /usuarios/{usuario_id}
#  Devuelve UN usuario por su id. 404 si no existe.
# ============================================================
@router.get("/{usuario_id}", response_model=UsuarioRespuesta)
def obtener_usuario(usuario_id: int, db: Session = Depends(get_db)):
    usuario = db.query(Usuario).filter(Usuario.id == usuario_id).first()
    if usuario is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"No existe un usuario con id {usuario_id}",
        )
    return usuario


# ============================================================
#  PUT /usuarios/{usuario_id}
#  Edición PARCIAL. Si se envía una contraseña nueva, se hashea antes
#  de guardarla. Si se cambia el nombre_usuario, se valida que no
#  choque con otro usuario. 404 si no existe.
# ============================================================
@router.put("/{usuario_id}", response_model=UsuarioRespuesta)
def actualizar_usuario(
    usuario_id: int,
    datos: UsuarioActualizar,
    db: Session = Depends(get_db),
    admin_actual: Usuario = Depends(requerir_admin),
):
    usuario = db.query(Usuario).filter(Usuario.id == usuario_id).first()
    if usuario is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"No existe un usuario con id {usuario_id}",
        )

    # Solo los campos que el cliente realmente envió.
    cambios = datos.model_dump(exclude_unset=True)

    # Para la auditoría guardamos solo los NOMBRES de los campos cambiados (no
    # sus valores). Así, si se cambió la contraseña, el log dirá "contrasena"
    # como campo modificado pero NUNCA el valor de la contraseña.
    campos_editados = list(cambios.keys())

    # La contraseña recibe trato especial: NO se guarda como viene (texto
    # plano) ni se asigna a un campo 'contrasena' (el modelo no lo tiene).
    # La sacamos de los cambios, la hasheamos y la ponemos en contrasena_hash.
    nueva_contrasena = cambios.pop("contrasena", None)
    if nueva_contrasena is not None:
        usuario.contrasena_hash = hashear_contrasena(nueva_contrasena)

    # nombre_usuario y rol son Optional[...]=None en el esquema, así que un
    # cliente podría enviarlos EXPLÍCITAMENTE como null. Con exclude_unset=True
    # esa clave SÍ aparece en 'cambios' con valor None, y el guard de unicidad
    # de abajo (nuevo_nombre is not None) se saltearía, haciendo
    # setattr(usuario, 'nombre_usuario'/'rol', None). Ambas columnas son NOT
    # NULL, así que el commit lanzaría IntegrityError y el handler respondería
    # un 409 'nombre de usuario ya en uso' engañoso (falso para rol). Por eso
    # rechazamos el null explícito con un 400 claro ANTES de aplicar cambios,
    # igual que hace pedidos.py. (nombre_completo se omite a propósito: su
    # columna es nullable y poner None ahí es legítimo.)
    for campo in ("nombre_usuario", "rol"):
        if campo in cambios and cambios[campo] is None:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"{campo} no puede ser null",
            )

    # Si cambia el nombre_usuario, validamos que no lo tenga OTRO usuario.
    nuevo_nombre = cambios.get("nombre_usuario")
    if nuevo_nombre is not None and nuevo_nombre != usuario.nombre_usuario:
        choca = (
            db.query(Usuario)
            .filter(Usuario.nombre_usuario == nuevo_nombre, Usuario.id != usuario_id)
            .first()
        )
        if choca is not None:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"El nombre de usuario '{nuevo_nombre}' ya está en uso",
            )

    # SEGURIDAD: no permitir que la EDICIÓN deje el sistema sin administradores.
    # Si el usuario que se edita ES administrador y el cambio lo DEGRADA a
    # 'empleado', verificamos (bloqueando las filas de admins) que no sea el
    # último. Sin este guard, el mismo desastre que el DELETE evita (quedar sin
    # ningún admin) se alcanzaría por otra vía: un PUT con {"rol": "empleado"}.
    if usuario.rol == "administrador" and cambios.get("rol") == "empleado":
        if _contar_admins_bloqueando(db) <= 1:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="No se puede quitar el rol de administrador al último administrador del sistema",
            )

    # Aplicamos el resto de los cambios (nombre_usuario, rol, nombre_completo).
    for campo, valor in cambios.items():
        setattr(usuario, campo, valor)

    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="No se pudo actualizar: el nombre de usuario ya está en uso",
        )
    except SQLAlchemyError:
        db.rollback()
        logger.exception("Error de base de datos al actualizar usuario")
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="No se pudo actualizar el usuario",
        )
    db.refresh(usuario)

    # Auditoría de la edición (commit hecho). En 'detalle' van solo los NOMBRES
    # de los campos modificados, nunca sus valores.
    registrar_auditoria(
        admin_actual,
        "editar_usuario",
        "usuario",
        usuario.id,
        detalle=f"campos modificados: {', '.join(campos_editados)}" if campos_editados else None,
    )
    return usuario


# ============================================================
#  DELETE /usuarios/{usuario_id}
#  Elimina un usuario. 404 si no existe. Si el usuario tiene pedidos
#  asociados, la regla ON DELETE RESTRICT de la base lo impide: lo
#  traducimos a un 409 Conflict claro (no se pierde el historial).
# ============================================================
@router.delete("/{usuario_id}")
def eliminar_usuario(
    usuario_id: int,
    db: Session = Depends(get_db),
    admin_actual: Usuario = Depends(requerir_admin),
):
    usuario = db.query(Usuario).filter(Usuario.id == usuario_id).first()
    if usuario is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"No existe un usuario con id {usuario_id}",
        )

    # SEGURIDAD (guard 1): un administrador NO puede borrar su PROPIA cuenta.
    # Borrarse a sí mismo dejaría la sesión activa apuntando a un usuario
    # inexistente y, si fuera el único admin, bloquearía la gestión. El frontend
    # ya lo previene deshabilitando el botón, pero la barrera REAL es esta: el
    # endpoint es accesible directamente (curl, etc.), así que el frontend solo
    # no alcanza.
    if usuario.id == admin_actual.id:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="No podés eliminar tu propia cuenta",
        )

    # SEGURIDAD (guard 2): no permitir borrar al ÚLTIMO administrador. Si se
    # eliminara, el sistema quedaría SIN ningún admin y nadie podría volver a
    # crear usuarios ni gestionar cuentas (las rutas de /usuarios exigen admin).
    # El conteo se hace BLOQUEANDO las filas de admins para que dos borrados
    # concurrentes no puedan dejar el sistema sin ninguno (ver el helper).
    if usuario.rol == "administrador":
        if _contar_admins_bloqueando(db) <= 1:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="No se puede eliminar el último administrador del sistema",
            )

    # Guardamos el nombre antes de borrar: tras el commit el objeto ya no
    # existe y no podríamos leerlo para el detalle de auditoría.
    nombre_borrado = usuario.nombre_usuario

    db.delete(usuario)
    try:
        db.commit()
    except IntegrityError:
        # FK RESTRICT: el usuario tiene pedidos registrados.
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="No se puede eliminar el usuario: tiene pedidos asociados",
        )
    except SQLAlchemyError:
        db.rollback()
        logger.exception("Error de base de datos al eliminar usuario")
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="No se pudo eliminar el usuario",
        )

    # Auditoría del borrado (ya confirmado).
    registrar_auditoria(
        admin_actual,
        "eliminar_usuario",
        "usuario",
        usuario_id,
        detalle=f"nombre_usuario={nombre_borrado}",
    )
    return {"mensaje": f"El usuario con id {usuario_id} fue eliminado correctamente"}
