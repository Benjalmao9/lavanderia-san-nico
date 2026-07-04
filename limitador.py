# ============================================================
#  Limitador de peticiones (rate limiting) con slowapi.
#
#  Definimos UN solo Limiter compartido por toda la app (lo importan main.py y
#  los routers que quieran limitar). Lo usamos sobre todo en POST /login para
#  frenar la FUERZA BRUTA: sin un freno, un atacante puede probar miles de
#  contraseñas seguidas contra una cuenta. Con el límite, tras N intentos en una
#  ventana de tiempo el servidor responde 429 (Too Many Requests).
#
#  ------------------------------------------------------------------
#  LA CLAVE DEL LÍMITE ES LA IP DEL CLIENTE — Y HAY QUE OBTENERLA BIEN.
#
#  El límite cuenta intentos "por IP de origen". Pero detrás de un proxy (en
#  producción corremos detrás del edge de Railway/Render) la conexión llega
#  SIEMPRE desde la IP del proxy, no la del cliente. La IP real del cliente viaja
#  en la cabecera X-Forwarded-For (XFF).
#
#  ⚠️ POR QUÉ NO SE PUEDE CONFIAR EN CUALQUIER XFF (bug que esto corrige): el
#  formato de XFF es "cliente, proxy1, proxy2, ...", y cada proxy AGREGA al final
#  la IP de quien se conectó a él. La parte de la IZQUIERDA la puede inventar el
#  cliente (basta mandar el header a mano). Antes, uvicorn corría con
#  --forwarded-allow-ips="*", que confía en el XFF de cualquiera y toma el valor
#  MÁS A LA IZQUIERDA (falsificable) como IP del cliente. Un atacante rotaba esa
#  cabecera en cada intento (X-Forwarded-For: 1.2.3.4, luego 1.2.3.5, ...) y
#  obtenía un contador NUEVO por petición: el límite de fuerza bruta quedaba
#  anulado. (Ver el fix en Procfile: ya NO se usa ese wildcard.)
#
#  ✅ CÓMO SE OBTIENE BIEN: la ÚNICA entrada de XFF confiable es la que agrega
#  NUESTRO proxy (la de más a la DERECHA, contando 'PROXY_HOPS_CONFIABLES' saltos
#  desde el final): esa la pone la infraestructura, no el cliente, así que no se
#  puede falsificar. Todo lo de su izquierda es sospechoso. En producción usamos
#  esa entrada; en desarrollo (sin proxy) NO confiamos en XFF en absoluto y
#  usamos la IP del socket directo (mismo principio que el resto de blindajes:
#  se activan donde importan, sin estorbar el desarrollo).
# ============================================================

import os

from slowapi import Limiter
from slowapi.util import get_remote_address

from entorno import es_produccion


def _hops_confiables() -> int:
    """Cuántos proxies de CONFIANZA hay delante del backend (por defecto 1).

    Railway y Render presentan UN edge, así que la IP real del cliente es la
    última entrada de X-Forwarded-For (1 salto). Si algún día la plataforma
    agregara más saltos, se ajusta con la variable PROXY_HOPS_CONFIABLES sin
    tocar el código. Nunca es menor que 1.
    """
    try:
        n = int(os.getenv("PROXY_HOPS_CONFIABLES", "1"))
    except ValueError:
        return 1
    return n if n >= 1 else 1


def ip_cliente_real(request) -> str:
    """IP real del cliente, RESISTENTE a falsificación de X-Forwarded-For.

    - En PRODUCCIÓN: toma la entrada de XFF que agregó nuestro proxy de confianza
      (la que está 'PROXY_HOPS_CONFIABLES' posiciones desde la derecha). Esa IP
      la pone la infraestructura y el cliente no la puede inventar.
    - En DESARROLLO (o si el XFF no alcanza / no viene): usa la IP del socket
      directo (get_remote_address), sin confiar en ningún XFF.

    Se usa como clave del rate limiter Y como 'remoteip' hacia Cloudflare
    Turnstile (routers/auth.py), para que ambas vean la MISMA IP real.
    """
    if es_produccion():
        # getlist + join (NO .get): si el proxy agregara su valor como una LÍNEA
        # de cabecera SEPARADA en vez de anexarlo a la existente, request.headers
        # .get() devolvería solo la PRIMERA línea (la que pudo mandar el atacante)
        # y se perdería la entrada confiable. Uniendo TODAS las líneas en el orden
        # recibido, la que agrega nuestro proxy (la última) queda a la derecha
        # igual, sin depender de si el proxy anexó o agregó una línea aparte.
        xff = ", ".join(request.headers.getlist("x-forwarded-for"))
        if xff.strip():
            partes = [p.strip() for p in xff.split(",") if p.strip()]
            # El cliente real está 'hops' posiciones desde el final: con 1 proxy,
            # es la última entrada. Si la cadena es más corta de lo esperado
            # (menos saltos que los configurados), no podemos identificarlo con
            # seguridad: caemos al socket directo (conservador).
            idx = len(partes) - _hops_confiables()
            if 0 <= idx < len(partes):
                return partes[idx]
    return get_remote_address(request)


# key_func=ip_cliente_real: el límite se cuenta por la IP REAL del cliente,
# obtenida de forma resistente a spoofing (ver arriba).
#
# NOTA: el almacenamiento por defecto es EN MEMORIA (sirve para una sola
# instancia del backend). Si en producción se corre con varias instancias,
# conviene un backend compartido (p. ej. Redis) para un conteo global.
limiter = Limiter(key_func=ip_cliente_real)
