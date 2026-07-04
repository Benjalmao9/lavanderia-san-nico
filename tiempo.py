# ============================================================
#  Manejo del tiempo del proyecto: TODO se guarda en UTC.
#
#  LA REGLA DE ORO: guardar en UTC, mostrar en hora local del que MIRA.
#
#  ¿Por qué guardar en UTC y no en la hora de México? Porque la hora "local"
#  depende de DÓNDE corre el servidor: en tu laptop es la de México, pero en
#  Railway el servidor vive en UTC. Si guardáramos "hora local del servidor"
#  (que es lo que hace datetime.now() sin argumentos), los datos cambiarían de
#  significado según dónde corra el backend — exactamente el bug que causó el
#  desfase de 6 horas: producción guardaba UTC pero lo enviaba SIN marcar, y el
#  navegador lo interpretaba como hora local ya convertida. UTC es el punto de
#  referencia universal: no tiene horario de verano, no depende del país del
#  servidor y permite comparar fechas entre sí sin ambigüedad.
#
#  ¿Y quién convierte a la hora de México (o de donde sea)? El NAVEGADOR del
#  usuario, al mostrarla. El backend manda la fecha marcada como UTC explícito
#  (terminada en "Z", ver FechaUTC en schemas.py) y el frontend usa las
#  utilidades estándar de JavaScript (new Date + toLocaleString, ver
#  frontend/src/utils/formato.ts), que convierten automáticamente a la zona
#  horaria del dispositivo. Así cada quien ve la hora en SU zona: tú en la de
#  México, y alguien que abriera la app desde otro país, en la suya.
#
#  ¿Por qué "naive" (sin tzinfo) si es UTC? Porque las columnas DATETIME de
#  MySQL no guardan zona horaria: siempre almacenan un valor "pelado". La
#  convención del proyecto es: TODO datetime naive que se guarda o se lee de la
#  base ES UTC (igual que ya hacía usuarios.sesion_valida_desde). La marca
#  explícita de UTC se agrega recién al SERIALIZAR hacia el frontend.
# ============================================================

from datetime import datetime, timezone


def ahora_utc() -> datetime:
    """El instante actual en UTC, como datetime naive (sin tzinfo).

    Es el reemplazo de datetime.now() para TODO timestamp que se persista
    (fecha de recepción/entrega de pedidos, auditoría, cierre de sesiones...).
    datetime.now() a secas devuelve la hora local DEL SERVIDOR, que cambia
    según dónde corra el backend; esta función devuelve siempre UTC, corra
    donde corra. El .replace(tzinfo=None) lo deja naive porque así se guarda
    en MySQL (ver el encabezado del módulo).
    """
    return datetime.now(timezone.utc).replace(tzinfo=None)
