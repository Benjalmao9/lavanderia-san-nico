# ============================================================
#  Dependencias de AUTENTICACIÓN y AUTORIZACIÓN.
#
#  Conviene distinguir dos conceptos que suenan parecidos pero NO son lo mismo:
#
#   - AUTENTICACIÓN (authentication) = "¿QUIÉN sos?". Comprobar la identidad
#     del que hace la petición. Aquí se hace leyendo y validando el token JWT
#     que el usuario obtuvo al hacer login: si el token es válido, sabemos qué
#     usuario es. Lo resuelve obtener_usuario_actual.
#
#   - AUTORIZACIÓN (authorization) = "¿QUÉ podés hacer?". Una vez que sabemos
#     quién sos, decidir si tenés permiso para esta acción concreta. Aquí se
#     hace mirando el ROL del usuario (administrador/empleado). Lo resuelven
#     requerir_admin y requerir_rol.
#
#  ¿Por qué "dependencias"? En FastAPI, una dependencia es una función que se
#  ejecuta ANTES que la ruta. Si declara `usuario = Depends(obtener_usuario_actual)`,
#  FastAPI ejecuta primero esa función; si lanza una excepción (401/403), la
#  ruta NUNCA llega a ejecutarse. Así la regla de seguridad se aplica de forma
#  centralizada y declarativa, sin repetir el chequeo dentro de cada endpoint.
# ============================================================

import logging
from datetime import datetime, timezone

from fastapi import Depends, HTTPException, status
from sqlalchemy.orm import Session
from sqlalchemy.exc import SQLAlchemyError

from database import get_db
from models import Usuario

# oauth2_scheme: extrae el token de la cabecera "Authorization: Bearer <token>".
#   Si NO viene token, responde 401 automáticamente (auto_error por defecto).
#   Además, es lo que hace aparecer el candado y el botón "Authorize" en /docs.
# verificar_token: decodifica y valida el JWT (firma + expiración); devuelve la
#   carga útil (sub, id, rol, exp) o lanza 401 si es inválido/expiró.
from seguridad import oauth2_scheme, verificar_token

logger = logging.getLogger("lavanderia")


def obtener_usuario_actual(
    token: str = Depends(oauth2_scheme),
    db: Session = Depends(get_db),
) -> Usuario:
    """AUTENTICACIÓN: averigua QUIÉN hace la petición a partir del token JWT.

    Pasos:
      1) oauth2_scheme saca el token de la cabecera Authorization. Si falta,
         FastAPI ya respondió 401 antes de entrar aquí.
      2) verificar_token valida firma y expiración. Si el token es inválido o
         expiró, lanza 401 (no seguimos).
      3) Buscamos en la BD al usuario que identifica el token (por su id) y lo
         devolvemos. Quien dependa de esta función recibirá el objeto Usuario.

    Importante (seguridad): si el usuario del token YA NO existe en la base
    (fue borrado, p. ej.), el token es técnicamente válido pero no debe dar
    acceso: respondemos 401. Nunca confiamos en los datos del token (rol, etc.)
    sin contrastarlos con la BD, que es la fuente de verdad.
    """
    # 2) Validar el token. verificar_token lanza HTTPException 401 si algo falla.
    carga = verificar_token(token)

    # Encabezado estándar para indicar que se espera un token Bearer. Lo
    # reutilizamos en los 401 de esta función para mantener la coherencia.
    cabecera_bearer = {"WWW-Authenticate": "Bearer"}

    # 3) Sacar el identificador del usuario del token. Pusimos su id en el claim
    #    "id" al crear el token (ver crear_token_acceso). Si por lo que sea no
    #    está o no es un entero, el token no nos sirve para identificar a nadie.
    usuario_id = carga.get("id")
    if not isinstance(usuario_id, int):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token inválido",
            headers=cabecera_bearer,
        )

    # Buscamos al usuario en la base. Envolvemos la consulta para que un fallo
    # de BD no se filtre como un 500 con traceback (mismo criterio que el login
    # y el resto de routers): respondemos 503 y dejamos el detalle en el log.
    try:
        usuario = db.query(Usuario).filter(Usuario.id == usuario_id).first()
    except SQLAlchemyError:
        logger.exception("Error de base de datos al obtener el usuario actual")
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Error al acceder a la base de datos",
        )

    # El usuario del token ya no existe en la BD -> el token no debe dar acceso.
    if usuario is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="El usuario del token ya no existe",
            headers=cabecera_bearer,
        )

    # ------------------------------------------------------------------
    # 4) SESIONES FORZADAMENTE CERRADAS: un JWT no se puede "revocar" a mitad
    #    de camino (es autocontenido: su sola firma alcanza para validarlo, sin
    #    consultar ninguna lista de tokens vigentes). La forma de lograr el
    #    mismo efecto es una marca de tiempo por usuario (sesion_valida_desde,
    #    ver models.py y la explicación grande en seguridad.py:crear_token_
    #    acceso): si NO es NULL, cualquier token con 'iat' (instante en que se
    #    emitió) ANTERIOR a esa marca quedó invalidado, aunque su firma siga
    #    siendo válida y todavía no haya expirado. Aprovechamos que esta
    #    función YA consulta la fila del usuario en la BD (la fuente de verdad
    #    de su rol, etc.) para sumar esta comparación sin una consulta extra.
    if usuario.sesion_valida_desde is not None:
        iat = carga.get("iat")
        # iat viaja como entero (segundos desde época UNIX en UTC, SIN fracción:
        # el estándar JWT y python-jose truncan 'iat' al segundo entero al
        # firmar). Lo reconstruimos como datetime "naive-UTC" para compararlo con
        # sesion_valida_desde (guardada con microsegundos completos, ver models.py).
        iat_valido = isinstance(iat, (int, float))
        if iat_valido:
            iat_dt = datetime.fromtimestamp(iat, tz=timezone.utc).replace(tzinfo=None)
        # Si el token no trae 'iat' (no debería pasar con los que emite esta
        # app, pero sí podría con un token viejo de antes de este cambio) no
        # podemos demostrar que se emitió DESPUÉS del cierre de sesión: por las
        # dudas, lo tratamos como inválido (fail-safe: ante la duda, exigimos
        # volver a loguearse en vez de arriesgarnos a dejar pasar una sesión
        # que debería estar cerrada).
        #
        # ¿POR QUÉ "<=" Y NO "<"? Como 'iat' pierde su fracción de segundo (ver
        # arriba), un login y un cierre de sesión que caigan en el MISMO segundo
        # de reloj podrían compararse como "iguales" del lado del token. Con "<"
        # estricto, ese empate se leería como "el token es posterior" y LO
        # DEJARÍA PASAR, aunque en la realidad (con microsegundos) el login haya
        # sido antes del cierre: exactamente el hueco de seguridad que este
        # chequeo existe para tapar. Con "<=" el empate se resuelve del lado
        # seguro (se rechaza). El costo es simétrico pero mucho menos grave: en
        # el caso límite de volver a loguearse en el MISMISIMO segundo en que un
        # admin cierra esa sesión, ese login nuevo también podría rechazarse una
        # vez, y bastaría con reintentarlo (un segundo después dejará de
        # coincidir). Preferimos ese costo mínimo y autocorregible antes que
        # dejar un hueco de seguridad real.
        if not iat_valido or iat_dt <= usuario.sesion_valida_desde:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Tu sesión fue cerrada. Inicia sesión de nuevo.",
                headers=cabecera_bearer,
            )

    return usuario


def requerir_admin(
    usuario: Usuario = Depends(obtener_usuario_actual),
) -> Usuario:
    """AUTORIZACIÓN: exige que el usuario autenticado sea ADMINISTRADOR.

    Reutiliza obtener_usuario_actual (primero autentica: sabemos quién es) y
    encima comprueba el rol (autoriza: vemos si puede). Comparamos contra el rol
    guardado en la BD (usuario.rol), no contra el del token, porque la BD es la
    fuente de verdad: si a alguien se le quitó el rol admin, deja de poder
    aunque su token viejo todavía dijera 'administrador'.

    Diferencia 401 vs 403:
      - 401 (no autenticado): no sabemos quién sos (token ausente/ inválido).
      - 403 (prohibido): sabemos quién sos, pero NO tenés permiso para esto.
    """
    if usuario.rol != "administrador":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="No tenés permisos para esta acción (se requiere administrador)",
        )
    return usuario


def requerir_rol(*roles_permitidos: str):
    """AUTORIZACIÓN genérica: fábrica de dependencias que exige uno de varios roles.

    Uso: `Depends(requerir_rol("administrador", "empleado"))`. Devuelve una
    dependencia que autentica y luego comprueba que el rol del usuario esté
    entre los permitidos; si no, responde 403. Es la versión flexible de
    requerir_admin (que es el caso particular de exigir solo 'administrador').
    """
    def verificador(
        usuario: Usuario = Depends(obtener_usuario_actual),
    ) -> Usuario:
        if usuario.rol not in roles_permitidos:
            permitidos = ", ".join(roles_permitidos)
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"No tenés permisos para esta acción (se requiere: {permitidos})",
            )
        return usuario

    return verificador
