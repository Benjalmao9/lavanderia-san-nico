# ============================================================
#  Ruta de autenticación: inicio de sesión (login).
#
#  Aquí vive el endpoint POST /login. Recibe usuario y contraseña, los
#  verifica contra la base de datos y, si son correctos, devuelve un
#  token JWT con el que el cliente se identificará en el futuro.
#
#  Este paso es SOLO iniciar sesión y obtener el token. La protección de
#  rutas (exigir el token) y el control de permisos por rol llegan después.
# ============================================================

import logging

# Request: lo necesita slowapi (el limitador lo usa para identificar la IP de
# origen y contar los intentos por cliente).
from fastapi import APIRouter, Depends, HTTPException, Request, status

# OAuth2PasswordRequestForm: el formulario ESTÁNDAR de OAuth2. Hace que el
# login reciba los campos por formulario (username, password) en vez de JSON.
# Es lo que la página /docs sabe usar con el botón "Authorize". Requiere la
# librería python-multipart (por eso la instalamos).
from fastapi.security import OAuth2PasswordRequestForm

# El limitador compartido (rate limiting), para frenar la fuerza bruta en /login.
from limitador import limiter

from sqlalchemy.orm import Session

# SQLAlchemyError: para capturar fallos de base de datos durante el login
# y traducirlos a un error HTTP limpio (mismo criterio que los otros routers).
from sqlalchemy.exc import SQLAlchemyError

from database import get_db
from models import Usuario

# Funciones de seguridad: verificar la contraseña contra el hash guardado,
# crear el token JWT y (re)hashear para el "señuelo" de tiempo constante.
from seguridad import verificar_contrasena, crear_token_acceso, hashear_contrasena

# Registro de auditoría: dejamos constancia de cada intento de login
# (exitoso o fallido). NUNCA registramos la contraseña.
from auditoria import registrar_auditoria

logger = logging.getLogger("lavanderia")


# tags=["autenticación"] agrupa esta ruta bajo ese título en /docs.
# Sin prefix: la ruta queda en /login (la que espera el botón "Authorize").
router = APIRouter(tags=["autenticación"])


# Hash "señuelo": un hash bcrypt válido calculado UNA vez al arrancar.
#
# ¿Para qué? Para no filtrar por TIEMPO si un nombre de usuario existe o no.
# Verificar una contraseña con bcrypt es lento a propósito (~100 ms). Si
# cuando el usuario NO existe respondiéramos al instante (saltándonos bcrypt)
# y cuando SÍ existe tardáramos esos ~100 ms, un atacante mediría la
# diferencia y deduciría qué usuarios existen (enumeración de usuarios).
# Para evitarlo, si el usuario no existe igual ejecutamos una verificación
# bcrypt contra este hash señuelo: así el costo en tiempo es similar exista
# o no la cuenta. El valor concreto de la contraseña señuelo da igual: nunca
# coincidirá con lo que escriba el usuario.
_HASH_SENUELO = hashear_contrasena("senuelo-para-tiempo-constante")


# ============================================================
#  POST /login
#  Recibe nombre de usuario y contraseña (formulario OAuth2), los valida
#  y devuelve un token JWT en el formato estándar:
#      {"access_token": "...", "token_type": "bearer"}
#
#  SEGURIDAD: si el usuario no existe O la contraseña es incorrecta,
#  respondemos SIEMPRE el mismo 401 con un mensaje genérico que NO revela
#  cuál de los dos falló. Decir "el usuario no existe" le confirmaría a un
#  atacante qué nombres son válidos; un mensaje único no le da esa pista.
# ============================================================
# @limiter.limit acota los intentos de login POR IP (clave por defecto del
# limitador): tras 10 intentos en un minuto desde la misma IP, el servidor
# responde 429 (Too Many Requests) en vez de seguir verificando contraseñas. Es
# el freno principal contra la fuerza bruta. slowapi exige que el endpoint reciba
# 'request: Request' para poder identificar al cliente.
@router.post("/login")
@limiter.limit("10/minute")
def login(
    request: Request,
    form_data: OAuth2PasswordRequestForm = Depends(),
    db: Session = Depends(get_db),
):
    # 1) Buscamos al usuario por su nombre_usuario (lo que viene en 'username'
    #    del formulario OAuth2). Envolvemos la consulta para que un fallo de
    #    base de datos no se filtre como un 500 con traceback.
    try:
        usuario = (
            db.query(Usuario)
            .filter(Usuario.nombre_usuario == form_data.username)
            .first()
        )
    except SQLAlchemyError:
        logger.exception("Error de base de datos durante el login")
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Error al acceder a la base de datos",
        )

    # 2) Verificamos las credenciales. Calculamos un booleano único y, si algo
    #    falla (usuario inexistente o contraseña incorrecta), respondemos el
    #    MISMO error genérico. La verificación bcrypt se ejecuta siempre (con el
    #    hash real o con el señuelo) para no filtrar por tiempo qué usuarios
    #    existen (ver _HASH_SENUELO).
    if usuario is None:
        # Usuario inexistente: igualamos el tiempo verificando contra el señuelo
        # y descartamos el resultado (siempre será False).
        verificar_contrasena(form_data.password, _HASH_SENUELO)
        credenciales_ok = False
    else:
        credenciales_ok = verificar_contrasena(
            form_data.password, usuario.contrasena_hash
        )

    if not credenciales_ok:
        # Auditoría del intento FALLIDO. No hay usuario identificado (puede que
        # el nombre ni exista), así que usuario=None. En 'detalle' guardamos el
        # nombre de usuario INTENTADO (útil para detectar ataques de fuerza
        # bruta), pero JAMÁS la contraseña. Va antes del raise para que quede
        # registrado aun cuando respondamos el 401.
        registrar_auditoria(
            None,
            "login_fallido",
            # Acotamos el nombre intentado a 50 caracteres (el máximo válido de
            # nombre_usuario). Defensa extra: si alguien tipea por error su
            # contraseña en el campo de usuario, no la volcamos entera al log.
            detalle=f"nombre_usuario intentado: {form_data.username[:50]}",
        )
        # 401 Unauthorized + WWW-Authenticate: Bearer (cabecera estándar para
        # indicar que se espera un token). Mensaje genérico a propósito.
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Usuario o contraseña incorrectos",
            headers={"WWW-Authenticate": "Bearer"},
        )

    # 3) Credenciales correctas: generamos el token JWT. Incluimos el
    #    identificador (sub=nombre_usuario, id) y el rol, con expiración de 6h.
    token = crear_token_acceso(
        {
            "sub": usuario.nombre_usuario,
            "id": usuario.id,
            "rol": usuario.rol,
        }
    )

    # Auditoría del login EXITOSO: dejamos constancia de quién entró y cuándo.
    registrar_auditoria(usuario, "login_exitoso", "usuario", usuario.id)

    # 4) Respondemos en el formato estándar OAuth2/JWT. 'token_type': 'bearer'
    #    le indica al cliente que debe enviarlo como "Authorization: Bearer <token>".
    return {"access_token": token, "token_type": "bearer"}
