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

from datetime import date, datetime, timedelta, timezone


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


# ============================================================
#  "HOY" COMO DÍA CALENDARIO DEL NEGOCIO (no como día UTC).
#
#  Todo lo de arriba es sobre INSTANTES que se GUARDAN (siempre en UTC, sin
#  ambigüedad). Pero "hoy" —para decidir qué fecha es válida en un selector, p.
#  ej. "no se permiten fechas futuras"— es un concepto DISTINTO: es el DÍA
#  CALENDARIO que un humano del negocio reconoce, y ese negocio es una
#  lavandería en Ciudad de México. Offset FIJO UTC-6 porque México ya no
#  observa horario de verano (desde 2022); mismo criterio que ya usa
#  reporte_excel.py para el documento contable.
#
#  ¿POR QUÉ NO ALCANZA CON ahora_utc().date()? Porque UTC va SIEMPRE ADELANTE
#  del reloj de México (Ciudad de México = UTC menos 6 horas). Entre las 18:00
#  y las 23:59 hora de México, el reloj UTC YA marca el día calendario
#  SIGUIENTE. Si "hoy" se calculara con ahora_utc().date() a secas, durante esa
#  ventana el sistema consideraría "hoy" un día que, en México, todavía no
#  llegó — dejando elegir una fecha que para el negocio es del FUTURO (el bug
#  real: el selector "Hasta" dejaba elegir el día siguiente al actual, hora de
#  México). Es el mismo patrón que el desfase de 6 horas de las fechas de
#  pedidos, pero en la dirección de "hoy" en vez de en la de mostrar un
#  timestamp guardado.
# ============================================================

# Offset fijo de Ciudad de México (ver el porqué arriba).
ZONA_MEXICO = timezone(timedelta(hours=-6))


def a_zona_mexico(dt: datetime) -> datetime:
    """Convierte un datetime NAIVE-UTC (como se guarda en la BD) al "reloj de
    pared" de Ciudad de México, también naive. Es la conversión compartida que
    usa tanto el Excel contable (reporte_excel.py) como el cálculo de "hoy" de
    abajo, para no duplicar la zona horaria en dos archivos."""
    return dt.replace(tzinfo=timezone.utc).astimezone(ZONA_MEXICO).replace(tzinfo=None)


def hoy_mexico() -> date:
    """El DÍA CALENDARIO actual en Ciudad de México (no el día UTC).

    Úsala para cualquier límite tipo "no se permiten fechas futuras" (p. ej. el
    selector de rango de reportes). NO la uses para timestamps que se guardan
    (para eso, ahora_utc()): esta función es solo para decidir qué día
    considera "hoy" un humano del negocio.
    """
    return a_zona_mexico(ahora_utc()).date()
