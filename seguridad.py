# ============================================================
#  Funciones de seguridad: hashing de contraseñas.
#
#  ¿Por qué NUNCA se guarda la contraseña en texto plano?
#  Si guardáramos la contraseña tal cual y alguien accediera a la base
#  de datos (un atacante, una fuga, un backup robado), tendría las
#  contraseñas reales de TODOS los usuarios. Como la gente reutiliza
#  contraseñas, además comprometería sus cuentas en otros sitios.
#
#  La solución es guardar un "hash": una huella digital irreversible
#  de la contraseña. A partir del hash NO se puede recuperar la
#  contraseña original. Para verificar un login, no comparamos textos:
#  volvemos a hashear lo que el usuario escribió y comparamos hashes.
#
#  ¿Qué es bcrypt? Es un algoritmo de hashing diseñado ESPECÍFICAMENTE
#  para contraseñas. Tiene dos propiedades clave:
#   1) Es LENTO a propósito (factor de "coste"/rondas configurable):
#      hashear tarda lo justo para no molestar a un usuario real, pero
#      hace carísimo para un atacante probar millones de combinaciones.
#   2) Usa una "sal" (salt) aleatoria distinta por cada contraseña, que
#      se guarda dentro del propio hash. Así dos usuarios con la misma
#      contraseña tienen hashes DISTINTOS, y no sirven las tablas
#      precalculadas (rainbow tables).
# ============================================================

# CryptContext de passlib gestiona el algoritmo de hashing por nosotros:
# elige la sal, aplica bcrypt y produce/verifica el hash en un formato
# estándar (ej: "$2b$12$...." incluye algoritmo, coste, sal y hash).
from passlib.context import CryptContext

# logging: para registrar anomalías del lado del servidor (p. ej. un hash
# corrupto en la base) sin exponer el detalle técnico al cliente.
import logging

logger = logging.getLogger("lavanderia")

# Configuramos el contexto para usar bcrypt.
#  - schemes=["bcrypt"]   -> algoritmo a usar.
#  - deprecated="auto"    -> si en el futuro cambiamos de algoritmo,
#                            marca los hashes viejos como "a actualizar".
#
# NOTA DE COMPATIBILIDAD: passlib 1.7.4 solo funciona con bcrypt < 4.1.
# Por eso el proyecto fija bcrypt==4.0.1 (con bcrypt 4.1+/5.x el backend
# de passlib se rompe). Si actualizás bcrypt, el hashing dejará de andar.
#
# bcrypt__rounds=12: fijamos el coste (rondas) de forma EXPLÍCITA en vez de
# depender del valor por defecto de passlib. Hasta ahora el coste era 12
# (el default de passlib), que es justo lo verificado en los hashes
# "$2b$12$...". Declararlo aquí lo convierte en una decisión auditable y
# versionada del proyecto: si una versión distinta de passlib cambiara su
# default, nuestro coste no cambiaría sin que nadie lo note. Mantener 12
# preserva EXACTAMENTE el comportamiento ya verificado (mismo formato
# "$2b$12$..." y hashes compatibles con los existentes). No subir el coste
# sin medir antes la latencia de hashear/verificar.
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto", bcrypt__rounds=12)


def hashear_contrasena(contrasena: str) -> str:
    """Recibe una contraseña en texto plano y devuelve su hash bcrypt.

    El hash resultante (un str tipo "$2b$12$...") es lo ÚNICO que se
    guarda en la base de datos, en la columna contrasena_hash. Cada
    llamada genera una sal nueva, así que hashear la misma contraseña
    dos veces da hashes distintos (ambos válidos).
    """
    # Aviso: bcrypt solo usa los primeros 72 bytes de la contraseña;
    # por eso los esquemas limitan la contraseña a 72 caracteres, para
    # que el usuario sepa exactamente qué se está hasheando.
    return pwd_context.hash(contrasena)


def verificar_contrasena(contrasena_plana: str, hash_guardado: str) -> bool:
    """Compara una contraseña en texto plano contra un hash guardado.

    Devuelve True si coinciden y False si no. Internamente passlib
    extrae la sal del hash guardado, vuelve a hashear la contraseña
    plana con esa misma sal y compara de forma segura (en tiempo
    constante, para no filtrar información por el tiempo de respuesta).
    """
    try:
        return pwd_context.verify(contrasena_plana, hash_guardado)
    except (ValueError, TypeError):
        # passlib LANZA (no devuelve False) si el hash guardado no se puede
        # identificar como bcrypt: columna corrupta, cadena vacía, registro
        # migrado a mano desde texto plano o cualquier formato inesperado.
        # Tratamos ese caso como "no coincide" (False) por dos motivos:
        #  1) Robustez: un dato en mal estado no debe tumbar el login con un
        #     500. Sin esto, la excepción subiría al manejador global y
        #     respondería 500 "Ocurrió un error interno".
        #  2) Seguridad: ese 500 sería DISTINGUIBLE del 401 normal y delataría
        #     qué cuentas tienen el hash corrupto (canal de enumeración). Al
        #     devolver False, el login responde el MISMO 401 genérico.
        # Dejamos rastro en el log porque indica una anomalía de datos a revisar.
        logger.warning(
            "No se pudo verificar la contraseña: el hash guardado no es un "
            "bcrypt válido (posible dato corrupto en la base de datos)."
        )
        return False


# ============================================================
#  Autenticación con JWT (JSON Web Tokens).
#
#  ¿Qué es un JWT? Es un "carnet" digital que el servidor le entrega al
#  usuario cuando inicia sesión correctamente. En cada petición siguiente
#  el usuario presenta ese carnet (en la cabecera Authorization) y el
#  servidor confía en él SIN volver a pedir la contraseña. El token va
#  FIRMADO por el servidor: si alguien le cambia una sola letra (por
#  ejemplo, para ascenderse a 'administrador'), la firma deja de coincidir
#  y el token se rechaza. OJO: el contenido NO está cifrado, solo firmado;
#  cualquiera puede leer lo que hay dentro, así que NUNCA metemos datos
#  secretos (como la contraseña) en el token.
#
#  ¿Qué es la CLAVE SECRETA (JWT_SECRET_KEY)? Es la "llave" con la que el
#  servidor FIRMA los tokens y luego comprueba esa firma. Es el corazón de
#  todo el esquema: cualquiera que la conozca puede fabricar tokens válidos
#  y hacerse pasar por cualquier usuario (incluido un administrador). Por
#  eso:
#    - Debe ser larga y aleatoria (imposible de adivinar).
#    - NO se escribe en el código fuente: va en el .env, que está en
#      .gitignore y por tanto NO se sube a Git. Así el secreto no queda
#      grabado en el historial del repositorio ni se comparte sin querer.
#    - Si se filtra, se "rota" (se genera una nueva); al cambiarla, todos
#      los tokens viejos quedan invalidados automáticamente.
# ============================================================

import os
from datetime import datetime, timedelta, timezone

# load_dotenv carga las variables del archivo .env como variables de
# entorno. database.py también lo llama, pero lo invocamos aquí también
# para no depender del orden de importación: así JWT_SECRET_KEY está
# disponible aunque seguridad.py se importe antes que database.py.
from dotenv import load_dotenv

# jwt: funciones para crear (encode) y validar (decode) tokens.
# JWTError: error base de python-jose (firma inválida, token corrupto...).
# ExpiredSignatureError: subclase de JWTError, específica de token expirado.
from jose import jwt
from jose.exceptions import JWTError, ExpiredSignatureError

# HTTPException/status: para responder con el código HTTP correcto (401)
# cuando un token es inválido o expiró. OAuth2PasswordBearer: el "esquema"
# de seguridad que FastAPI usa para leer el token de la cabecera
# Authorization y, en /docs, para mostrar el botón "Authorize".
from fastapi import HTTPException, status
from fastapi.security import OAuth2PasswordBearer

load_dotenv()

# Leemos la clave secreta desde el entorno (.env). NO ponemos un valor por
# defecto a propósito: un default conocido permitiría a cualquiera forjar
# tokens válidos y hacerse pasar por cualquier usuario.
JWT_SECRET_KEY = os.getenv("JWT_SECRET_KEY")

# Longitud mínima exigida a la clave. En HS256 (HMAC-SHA256) toda la seguridad
# depende del secreto: con una clave corta o de baja entropía un atacante que
# tenga un token puede romperla por fuerza bruta offline y forjar tokens de
# cualquier usuario. 32 caracteres es el mínimo razonable (256 bits, el tamaño
# de salida de SHA-256); con token_urlsafe(64) sobra holgadamente.
JWT_LONGITUD_MINIMA_CLAVE = 32


def _obtener_clave_secreta() -> str:
    """Devuelve la clave secreta ya validada, o lanza un error claro si falta
    o es demasiado corta/insegura.

    La validación es PEREZOSA (se hace al firmar/verificar, no al importar el
    módulo) a propósito: así otras tareas que solo usan el hashing de
    contraseñas —p. ej. el script crear_admin.py, que prepara la base antes de
    que JWT esté configurado— pueden importar seguridad.py sin necesidad de
    tener la clave JWT lista. El servidor web, en cambio, la valida al arrancar
    con validar_configuracion_jwt() para fallar de forma ruidosa y temprana.
    """
    if not JWT_SECRET_KEY or len(JWT_SECRET_KEY) < JWT_LONGITUD_MINIMA_CLAVE:
        raise RuntimeError(
            "JWT_SECRET_KEY ausente o demasiado corta. Debe tener al menos "
            f"{JWT_LONGITUD_MINIMA_CLAVE} caracteres aleatorios. Generá una con: "
            "python -c \"import secrets; print(secrets.token_urlsafe(64))\" "
            "y ponela como JWT_SECRET_KEY en tu archivo .env."
        )
    return JWT_SECRET_KEY


def validar_configuracion_jwt() -> None:
    """Valida la configuración JWT de forma explícita.

    La aplicación la llama al arrancar (ver main.py) para fallar de forma
    ruidosa y temprana si la clave no está bien configurada, en vez de
    descubrirlo recién en el primer intento de login.
    """
    _obtener_clave_secreta()

# Algoritmo de firma. HS256 = HMAC con SHA-256: firma simétrica (la MISMA
# clave secreta firma y verifica). Es el estándar simple y seguro cuando el
# mismo servidor emite y valida los tokens (nuestro caso).
JWT_ALGORITHM = "HS256"

# Tiempo de vida del token: 6 horas. Pasado ese plazo, el token expira y el
# usuario debe volver a iniciar sesión. Un plazo acotado limita el daño si
# un token se filtra (deja de servir solo).
JWT_HORAS_EXPIRACION = 6

# Esquema OAuth2 "password flow". tokenUrl="login" le dice a FastAPI (y a la
# página /docs) que el token se obtiene haciendo POST a /login. Se usa como
# dependencia (ver dependencias.py: obtener_usuario_actual) para exigir y leer
# el token en cada petición a una ruta protegida; además hace aparecer el botón
# "Authorize" y el candado en /docs.
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="login")


def crear_token_acceso(datos: dict) -> str:
    """Genera un token JWT firmado a partir de los `datos` recibidos.

    `datos` es un diccionario con la información del usuario que queremos
    incrustar en el token (su "carga útil" o payload). Como mínimo incluirá
    el identificador del usuario y su rol; por ejemplo:
        {"sub": "admin", "id": 1, "rol": "administrador"}

    QUÉ CONTIENE EL TOKEN que devolvemos:
      - sub: el "subject", convención JWT para el identificador del usuario
        (aquí, su nombre_usuario).
      - id y rol: datos del usuario para saber quién es y qué puede hacer.
        El id se usa para reidentificar al usuario en la BD en cada petición
        (ver obtener_usuario_actual). El rol del token es informativo: la
        autorización compara contra el rol guardado en la BD (fuente de verdad).
      - exp: fecha/hora de expiración (ahora + 6 horas). python-jose la
        valida sola al decodificar y rechaza el token si ya pasó.
    Recordá: estos datos van firmados pero NO cifrados, así que no se debe
    incluir nada secreto.
    """
    # Copiamos para no modificar el diccionario original del que llama.
    a_codificar = datos.copy()
    # Calculamos la expiración en UTC (timezone-aware) y la añadimos como 'exp'.
    expira = datetime.now(timezone.utc) + timedelta(hours=JWT_HORAS_EXPIRACION)
    a_codificar.update({"exp": expira})
    # Firmamos con la clave secreta y el algoritmo elegido. El resultado es
    # el token en formato compacto "xxxxx.yyyyy.zzzzz".
    return jwt.encode(a_codificar, _obtener_clave_secreta(), algorithm=JWT_ALGORITHM)


def verificar_token(token: str) -> dict:
    """Decodifica y valida un token JWT.

    Si el token es válido, devuelve su carga útil (el diccionario con sub,
    id, rol, exp...). Si la firma no coincide, el token está corrupto o ya
    expiró, lanza HTTPException 401 (no autorizado) con un mensaje claro.
    """
    try:
        # algorithms=[JWT_ALGORITHM] es OBLIGATORIO por seguridad: fija qué
        # algoritmo aceptamos. Sin esta lista, un atacante podría presentar un
        # token con alg="none" (sin firma) o forzar otro algoritmo para saltarse
        # la verificación (ataque de "confusión de algoritmo"). decode también
        # comprueba automáticamente la expiración (exp).
        carga = jwt.decode(token, _obtener_clave_secreta(), algorithms=[JWT_ALGORITHM])
        return carga
    except ExpiredSignatureError:
        # El token era válido pero ya pasó su fecha de expiración (6 horas).
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="El token expiró, iniciá sesión de nuevo",
            headers={"WWW-Authenticate": "Bearer"},
        )
    except JWTError:
        # Firma inválida, token manipulado o con formato incorrecto.
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token inválido",
            headers={"WWW-Authenticate": "Bearer"},
        )
