# ============================================================
#  CAPTCHA con Cloudflare Turnstile — SOLO EN PRODUCCIÓN.
#
#  ¿QUÉ PROBLEMA RESUELVE? El rate limiting de /login (10 intentos/minuto por
#  IP) frena la fuerza bruta desde UNA máquina, pero un atacante con muchas IPs
#  (una botnet) lo esquiva repartiendo los intentos. El CAPTCHA agrega la
#  barrera que a los bots les cuesta cruzar: demostrar que hay un humano.
#  Turnstile es la alternativa de Cloudflare a reCAPTCHA: casi siempre se
#  resuelve solo (sin acertijos) y no requiere cuenta de Google.
#
#  ¿POR QUÉ SOLO EN PRODUCCIÓN? Es el MISMO principio que ya usamos con /docs
#  (ver main.py): los blindajes se activan DONDE importan, sin estorbar el
#  desarrollo. En tu laptop no hay bots atacando el login, y obligarte a
#  resolver un CAPTCHA (o a tener claves de Cloudflare configuradas) en cada
#  prueba local sería pura fricción sin ganancia de seguridad. Por eso:
#    - ENTORNO=produccion  -> el login EXIGE y verifica el token de Turnstile.
#    - cualquier otro valor -> el CAPTCHA se omite POR COMPLETO (no se exige el
#      campo y jamás se llama a Cloudflare).
#
#  ¿CÓMO FUNCIONA EL FLUJO COMPLETO?
#    1) El frontend (con la clave PÚBLICA de sitio, VITE_TURNSTILE_SITE_KEY)
#       muestra el widget; Cloudflare evalúa al visitante y le entrega un
#       TOKEN de un solo uso.
#    2) El frontend manda ese token junto con usuario/contraseña al /login.
#    3) ESTE módulo verifica el token contra la API de Cloudflare (siteverify)
#       usando la clave SECRETA (TURNSTILE_SECRET_KEY). El token del navegador
#       no se puede confiar por sí solo: cualquiera podría inventarse uno; la
#       única fuente de verdad es preguntarle a Cloudflare desde el servidor.
#
#  COMPORTAMIENTO SEGURO ANTE FALLOS DE RED ("fail-closed"): si Cloudflare no
#  responde (caída, timeout, respuesta rara), RECHAZAMOS el login con 503 en
#  vez de dejarlo pasar sin CAPTCHA ("fail-open"). ¿Por qué? Porque el CAPTCHA
#  existe justo para los momentos de ataque: si un atacante lograra que las
#  llamadas a Cloudflare fallen (o coincidiera con una caída), un fail-open
#  apagaría la barrera exactamente cuando más se la necesita. El costo asumido
#  es que, durante una caída de Cloudflare, nadie puede iniciar sesión en
#  producción hasta que se recupere (las sesiones YA abiertas siguen andando:
#  esto solo afecta a logins nuevos). Preferimos esa molestia temporal antes
#  que un agujero silencioso.
# ============================================================

import logging
import os

# httpx: cliente HTTP para llamar a la API de Cloudflare desde el servidor.
import httpx

from fastapi import HTTPException, status

# es_produccion: fuente única del chequeo de entorno (ver entorno.py). El CAPTCHA
# solo se exige/verifica en producción, igual que /docs y el resto de blindajes.
from entorno import es_produccion

logger = logging.getLogger("lavanderia")

# La API oficial de verificación de Turnstile (server-side).
URL_SITEVERIFY = "https://challenges.cloudflare.com/turnstile/v0/siteverify"

# Tiempo máximo de espera de la llamada a Cloudflare. Sin timeout, una red
# colgada dejaría la petición de login esperando indefinidamente.
_TIMEOUT_SEGUNDOS = 5

# Largo máximo documentado de un token de Turnstile. Un "token" más largo es
# basura segura: lo rechazamos nosotros sin gastar una llamada a Cloudflare.
_MAX_LARGO_TOKEN = 2048


def _obtener_clave_secreta() -> str:
    """Lee TURNSTILE_SECRET_KEY del entorno. Es la clave SECRETA (server-side)
    del par que entrega Cloudflare al crear el widget; NUNCA va al frontend ni
    a Git (solo al panel de variables de Railway/Render y al .env local si
    quisieras probar el modo producción)."""
    clave = os.getenv("TURNSTILE_SECRET_KEY", "").strip()
    if not clave:
        raise RuntimeError(
            "Falta la variable de entorno TURNSTILE_SECRET_KEY. En producción "
            "el login exige el CAPTCHA de Cloudflare Turnstile y necesita esta "
            "clave para verificar los tokens. Configúrala en el panel de la "
            "plataforma (Railway/Render) con la clave secreta de tu widget."
        )
    return clave


def validar_configuracion_turnstile() -> None:
    """Validación al ARRANCAR (la llama main.py, igual que validar_configuracion_jwt):
    si el entorno es producción, exigimos que TURNSTILE_SECRET_KEY exista. Mejor
    que el servidor NO arranque (fallo ruidoso y temprano) a descubrir en el
    primer login real que el CAPTCHA no se puede verificar. En desarrollo no se
    exige nada: el CAPTCHA está apagado y la clave no se usa."""
    if es_produccion():
        _obtener_clave_secreta()


def verificar_turnstile(token, ip_cliente=None) -> None:
    """Verifica un token de Turnstile contra Cloudflare. SOLO debe llamarse en
    producción (el caller decide con es_produccion(), ver routers/auth.py).

    No devuelve nada si el token es válido. Si algo falla, lanza HTTPException:
      - 400 si el token falta, es demasiado largo o Cloudflare lo rechaza
        (expirado, ya usado, inventado...): el CLIENTE debe reintentar el CAPTCHA.
      - 503 si no se pudo hablar con Cloudflare (fail-closed, ver el encabezado):
        error NUESTRO/de red, el cliente puede reintentar en unos momentos.

    SEGURIDAD: acá nunca se loguea ni el token ni la clave secreta; ante un
    rechazo solo registramos los 'error-codes' de Cloudflare (códigos genéricos
    tipo 'timeout-or-duplicate', sin datos sensibles).
    """
    # 1) El token debe venir. En producción el frontend siempre lo manda; si no
    #    está, o alguien llama al endpoint directo (curl) sin resolver el
    #    CAPTCHA, se rechaza con un mensaje claro.
    if not token or not token.strip():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Completa la verificación de seguridad (CAPTCHA) para iniciar sesión.",
        )
    if len(token) > _MAX_LARGO_TOKEN:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="La verificación de seguridad no es válida. Recarga la página e intenta de nuevo.",
        )

    # 2) Preguntarle a Cloudflare si el token es legítimo. Mandamos también la
    #    IP del cliente (opcional): le da a Cloudflare una señal extra para
    #    detectar tokens robados/reutilizados desde otra máquina.
    datos = {"secret": _obtener_clave_secreta(), "response": token}
    if ip_cliente:
        datos["remoteip"] = ip_cliente

    try:
        respuesta = httpx.post(URL_SITEVERIFY, data=datos, timeout=_TIMEOUT_SEGUNDOS)
        # Un status HTTP raro (5xx de Cloudflare, etc.) se trata igual que un
        # fallo de red: raise_for_status lo convierte en excepción httpx.
        respuesta.raise_for_status()
        resultado = respuesta.json()
    except httpx.HTTPError:
        # FAIL-CLOSED: sin respuesta confiable de Cloudflare NO dejamos pasar
        # el login (ver la explicación completa en el encabezado del módulo).
        # El detalle técnico queda en el log del servidor, no se filtra.
        logger.exception("No se pudo verificar el CAPTCHA contra Cloudflare Turnstile")
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="No se pudo validar la verificación de seguridad. Intenta de nuevo en unos momentos.",
        )
    except ValueError:
        # El cuerpo no era JSON (respuesta corrupta/inesperada): mismo criterio
        # fail-closed que un fallo de red.
        logger.exception("Respuesta inesperada (no JSON) de Cloudflare Turnstile")
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="No se pudo validar la verificación de seguridad. Intenta de nuevo en unos momentos.",
        )

    # Defensa extra (mismo criterio fail-closed): 'null', una lista o un texto
    # son JSON válido pero NO son la respuesta de siteverify (siempre es un
    # objeto). Ante cualquier forma inesperada, tratamos la respuesta como
    # corrupta en vez de dejar que reviente más abajo.
    if not isinstance(resultado, dict):
        logger.error(
            "Respuesta inesperada de Cloudflare Turnstile (JSON no-objeto: %s)",
            type(resultado).__name__,
        )
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="No se pudo validar la verificación de seguridad. Intenta de nuevo en unos momentos.",
        )

    # 3) Cloudflare respondió: ¿el token pasó? Los tokens son de UN SOLO USO y
    #    expiran a los pocos minutos, así que un rechazo típico es un token
    #    vencido o repetido (el frontend reinicia el widget tras cada intento
    #    fallido justamente por esto).
    if not resultado.get("success"):
        logger.warning(
            "Turnstile rechazó un token de CAPTCHA (error-codes=%s)",
            resultado.get("error-codes"),
        )
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="La verificación de seguridad no fue superada. Recarga la página e intenta de nuevo.",
        )
    # Token válido: no devolvemos nada y el login sigue con las credenciales.
