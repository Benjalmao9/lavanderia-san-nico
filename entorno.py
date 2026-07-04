# ============================================================
#  Detección de entorno: ¿estamos en producción?
#
#  Fuente ÚNICA de verdad para la pregunta "¿ENTORNO=produccion?". Antes esta
#  misma normalización estaba repetida en main.py, turnstile.py y (haría falta
#  también en) limitador.py; centralizarla evita que una copia quede distinta
#  de las otras. Se lee la variable de entorno EN CADA llamada (lazy), no una
#  sola vez al importar, para que los tests puedan alternarla.
#
#  Acepta 'produccion', 'production' o 'prod' (sin distinguir mayúsculas ni
#  espacios). El valor por defecto es 'desarrollo'.
# ============================================================

import os


def es_produccion() -> bool:
    """True si ENTORNO indica producción; False en desarrollo (o si no está)."""
    return os.getenv("ENTORNO", "desarrollo").strip().lower() in (
        "produccion",
        "production",
        "prod",
    )
