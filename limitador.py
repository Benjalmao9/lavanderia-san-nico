# ============================================================
#  Limitador de peticiones (rate limiting) con slowapi.
#
#  Definimos UN solo Limiter compartido por toda la app (lo importan main.py y
#  los routers que quieran limitar). La "clave" por defecto es la IP del cliente
#  (get_remote_address), así el límite se cuenta por dirección de origen.
#
#  Lo usamos sobre todo en POST /login para frenar la FUERZA BRUTA: sin un freno,
#  un atacante puede probar miles de contraseñas seguidas contra una cuenta. Con
#  el límite, tras N intentos en una ventana de tiempo el servidor responde 429
#  (Too Many Requests) en vez de seguir verificando.
#
#  NOTA: el almacenamiento por defecto es EN MEMORIA (sirve para una sola
#  instancia del backend). Si en producción se corre con varias instancias/procesos,
#  conviene configurar un backend compartido (p. ej. Redis) para que el conteo sea
#  global. Para el desarrollo actual, en memoria es suficiente.
# ============================================================

from slowapi import Limiter
from slowapi.util import get_remote_address

limiter = Limiter(key_func=get_remote_address)
