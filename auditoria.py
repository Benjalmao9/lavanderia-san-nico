# ============================================================
#  Registro de auditoría (bitácora de acciones).
#
#  Aquí vive la función reutilizable registrar_auditoria, que escribe UNA
#  fila en la tabla auditoria cada vez que ocurre una acción importante
#  (crear/editar/borrar un pedido, un insumo, un usuario; login exitoso o
#  fallido). Sirve para responder después: ¿quién hizo qué, sobre qué y cuándo?
#
#  REGLA DE ORO (robustez): el registro del log NUNCA debe romper la acción
#  principal. Si guardar el log falla (la base se cayó, etc.), el pedido o el
#  insumo que el usuario quería guardar DEBE haberse guardado igual.
#
#  ¿POR QUÉ UNA SESIÓN PROPIA Y NO LA DEL REQUEST? Esta función abre su PROPIA
#  sesión de base de datos (independiente de la del endpoint) en vez de recibir
#  la del request. Lo hacemos así por una razón concreta de robustez detectada
#  en la revisión de seguridad: si usáramos la MISMA sesión del request, el
#  commit (o el rollback ante un fallo) del log EXPIRARÍA el objeto que el
#  endpoint está por devolver. Al serializar la respuesta, FastAPI lo recargaría
#  de la base FUERA del try/except del endpoint y, si la base fallara justo en
#  esa ventana, una operación YA EXITOSA terminaría devolviendo un 5xx. Con una
#  sesión propia, el commit/rollback del log no toca ni la sesión ni el objeto
#  de respuesta del endpoint: la auditoría queda 100% aislada de la acción real.
#
#  Además, esta función captura cualquier excepción, la registra en el log del
#  servidor y NO la propaga: la auditoría es importante, pero secundaria frente
#  a la operación real.
#
#  REGLA DE SEGURIDAD: en la auditoría NUNCA se guardan contraseñas ni hashes.
#  Quien llama es responsable de no pasar credenciales en 'detalle'.
# ============================================================

import logging
from datetime import datetime
from typing import Optional

# SessionLocal: la fábrica de sesiones. Abrimos una sesión EFÍMERA propia para
# escribir el log, aislada de la sesión del request (ver explicación arriba).
from database import SessionLocal
from models import Auditoria, Usuario

logger = logging.getLogger("lavanderia")

# Tope de longitud para el campo 'detalle'. La columna es VARCHAR(255); si
# recortamos nosotros, evitamos que un detalle largo haga fallar el INSERT por
# longitud (y perdamos el registro).
_MAX_DETALLE = 255


def registrar_auditoria(
    usuario: Optional[Usuario],
    accion: str,
    entidad: Optional[str] = None,
    entidad_id: Optional[int] = None,
    detalle: Optional[str] = None,
) -> None:
    """Registra una acción en la tabla de auditoría.

    Parámetros:
      - usuario: el Usuario que hizo la acción, o None si no hay uno
        identificado (p. ej. un login fallido).
      - accion: qué se hizo (ej: 'crear_pedido', 'login_fallido').
      - entidad: tipo de objeto afectado (ej: 'pedido'), o None.
      - entidad_id: id del objeto afectado, o None.
      - detalle: texto adicional (ej: nombre de usuario intentado), o None.
        NUNCA pasar contraseñas ni hashes aquí.

    No devuelve nada y NUNCA lanza: si el registro falla, lo deja anotado en el
    log del servidor pero no interrumpe la operación principal.

    IMPORTANTE: llamala DESPUÉS de confirmar (commit) la acción principal. Así,
    aunque el log no llegara a guardarse, la acción real ya está persistida.
    """
    # Leemos el id del usuario ANTES de abrir la sesión del log. Es un simple
    # int; si el objeto estuviera "expirado" por un commit previo del endpoint,
    # este acceso podría recargarlo, pero todo está dentro del try y un fallo se
    # captura sin romper nada.
    db = SessionLocal()
    try:
        usuario_id = usuario.id if usuario is not None else None

        # Recortamos el detalle por las dudas, para no exceder la columna.
        detalle_seguro = detalle[:_MAX_DETALLE] if detalle is not None else None

        log = Auditoria(
            usuario_id=usuario_id,
            accion=accion,
            entidad=entidad,
            entidad_id=entidad_id,
            detalle=detalle_seguro,
            fecha=datetime.now(),
        )
        db.add(log)
        db.commit()
    except Exception:
        # Pase lo que pase, NO rompemos la acción principal. Deshacemos el intento
        # de log en NUESTRA sesión (no afecta la del endpoint) y dejamos el detalle
        # técnico en el log del servidor para poder diagnosticarlo.
        try:
            db.rollback()
        except Exception:
            logger.exception("Falló el rollback tras un error de auditoría")
        logger.exception(
            "No se pudo registrar la auditoría (accion=%s, entidad=%s, entidad_id=%s)",
            accion,
            entidad,
            entidad_id,
        )
    finally:
        # Cerramos siempre nuestra sesión efímera para liberar la conexión.
        db.close()
