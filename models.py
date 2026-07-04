# ============================================================
#  Modelos de SQLAlchemy de la lavandería.
#
#  Cada clase de este archivo es un "modelo": una clase de Python
#  que representa UNA tabla de la base de datos. Cada atributo de la
#  clase (Column) representa una columna de esa tabla.
#
#  Estos modelos se corresponden EXACTAMENTE con las tablas definidas
#  en schema.sql (categorias, usuarios, insumos, pedidos). No crean
#  las tablas (ya existen en MySQL); solo le dicen a SQLAlchemy cómo
#  están formadas para poder leerlas y escribirlas desde Python.
# ============================================================

# Tipos de columna y herramientas de SQLAlchemy.
#  - Integer  -> entero (INT en MySQL)
#  - String   -> texto de longitud limitada (VARCHAR en MySQL)
#  - DECIMAL  -> número con decimales exactos (DECIMAL en MySQL),
#                ideal para dinero y pesos (no pierde precisión).
#  - DateTime -> fecha + hora (DATETIME en MySQL)
#  - ForeignKey -> marca una columna como clave foránea (relación).
from sqlalchemy import Column, Integer, String, DECIMAL, DateTime, ForeignKey

# relationship crea el "puente" entre modelos a nivel de Python:
# nos deja navegar de un objeto a otro (ej: pedido.usuario) sin
# escribir consultas a mano.
from sqlalchemy.orm import relationship

# Importamos la base declarativa definida en database.py.
# Todos los modelos heredan de ella para quedar registrados.
from database import Base


# ============================================================
#  Modelo: Categoria  ->  tabla "categorias"
#  Clasifica los insumos (ej: limpieza, cortesía).
#  Es el lado "padre": una categoría puede tener muchos insumos.
# ============================================================
class Categoria(Base):
    # __tablename__ indica a qué tabla real corresponde esta clase.
    __tablename__ = "categorias"

    # id: entero, clave primaria, autoincremental.
    id = Column(Integer, primary_key=True, autoincrement=True)

    # nombre: VARCHAR(100), obligatorio (nullable=False) y único.
    nombre = Column(String(100), nullable=False, unique=True)

    # Relación inversa: lista de insumos que pertenecen a esta categoría.
    # No es una columna; es una "vista" en Python de los insumos asociados.
    # back_populates conecta este lado con Insumo.categoria (los mantiene
    # sincronizados en ambos sentidos).
    # passive_deletes=True: delegamos en la regla ON DELETE SET NULL de la BD
    # (definida en la FK y en schema.sql). Sin esto, al borrar una categoría
    # via ORM (db.delete(categoria)) SQLAlchemy intentaría gestionar él mismo
    # la FK de los insumos cargados (emitir UPDATE ... SET categoria_id=NULL),
    # duplicando trabajo y emitiendo SQL inesperado. Con passive_deletes=True
    # dejamos que MySQL aplique el SET NULL. (Latente hoy: no existe router de
    # categorías que ejecute db.delete sobre el lado padre.)
    insumos = relationship(
        "Insumo", back_populates="categoria", passive_deletes=True
    )


# ============================================================
#  Modelo: Usuario  ->  tabla "usuarios"
#  Personas que usan el sistema (administrador o empleado).
#  Es el lado "padre": un usuario puede registrar muchos pedidos.
# ============================================================
class Usuario(Base):
    __tablename__ = "usuarios"

    # id: entero, clave primaria, autoincremental.
    id = Column(Integer, primary_key=True, autoincrement=True)

    # nombre_usuario: VARCHAR(50), obligatorio y único (para iniciar sesión).
    nombre_usuario = Column(String(50), nullable=False, unique=True)

    # contrasena_hash: VARCHAR(255), obligatorio.
    # Guarda la contraseña cifrada (hash), nunca en texto plano.
    contrasena_hash = Column(String(255), nullable=False)

    # rol: VARCHAR(20), obligatorio. Solo dos valores válidos:
    # 'administrador' o 'empleado'. Además de validarlo la app (Pydantic),
    # la BD lo hace cumplir con un CHECK (ver schema.sql: chk_usuarios_rol),
    # como defensa en profundidad. Igual que los ondelete, el enforcement real
    # vive en schema.sql; este modelo solo lo documenta.
    rol = Column(String(20), nullable=False)

    # nombre_completo: VARCHAR(150), opcional (puede ser NULL).
    nombre_completo = Column(String(150), nullable=True)

    # sesion_valida_desde: DATETIME(6), OPCIONAL (NULL = nunca se forzó un cierre
    # de sesión). Es la "fecha de corte" para invalidar sesiones sin poder revocar
    # JWTs directamente (ver la explicación grande en seguridad.py:crear_token_
    # acceso). Cuando un admin cierra las sesiones de este usuario (POST
    # /usuarios/{id}/cerrar-sesiones), acá se guarda el instante actual (en UTC,
    # sin tzinfo -> "naive-UTC", para poder compararlo directo contra el 'iat' del
    # token, que también viaja en UTC). Cualquier token emitido ANTES de esta
    # marca queda rechazado en la próxima petición (dependencias.py).
    # OJO: la columna real en la BD es DATETIME(6) (con microsegundos; ver
    # schema.sql y migracion_sesion_valida_desde.sql). El tipo genérico DateTime
    # de SQLAlchemy de acá NO trunca esa precisión al leer/escribir (el límite de
    # microsegundos es 100% una propiedad de la columna en MySQL, no de este tipo
    # de Python); si la columna NO tuviera microsegundos, un login y un cierre de
    # sesión en el MISMO segundo de reloj podrían colisionar y dejar pasar un
    # token que debería haberse invalidado.
    sesion_valida_desde = Column(DateTime, nullable=True)

    # Relación inversa: lista de pedidos registrados por este usuario.
    # passive_deletes='all': delegamos por completo en la regla ON DELETE
    # RESTRICT de la BD (definida en la FK y en schema.sql). Usamos 'all'
    # (no True) en el lado RESTRICT para que SQLAlchemy NO intente poner la
    # FK de los pedidos a NULL ni interferir: deja que MySQL aplique el
    # RESTRICT y rechace borrar un usuario con pedidos asociados. (Latente
    # hoy: no existe router de usuarios que ejecute db.delete sobre el padre.)
    pedidos = relationship(
        "Pedido", back_populates="usuario", passive_deletes="all"
    )


# ============================================================
#  Modelo: Insumo  ->  tabla "insumos"
#  Productos que usa la lavandería (detergente, suavizante, etc.).
#  RELACIÓN: cada insumo pertenece a UNA categoría (lado "hijo").
# ============================================================
class Insumo(Base):
    __tablename__ = "insumos"

    # id: entero, clave primaria, autoincremental.
    id = Column(Integer, primary_key=True, autoincrement=True)

    # nombre: VARCHAR(150), obligatorio.
    nombre = Column(String(150), nullable=False)

    # categoria_id: clave foránea hacia categorias(id). Puede ser NULL
    # (un insumo puede no tener categoría asignada todavía).
    # ondelete="SET NULL" refleja la regla del schema: si se borra la
    # categoría, este campo queda en NULL (el insumo no se borra).
    # NOTA (fuente de verdad): el enforcement real de esta regla ON DELETE
    # vive en schema.sql, no aquí. El parámetro ondelete de ForeignKey solo
    # afecta al DDL que GENERA SQLAlchemy, y este proyecto NO llama a
    # Base.metadata.create_all (las tablas se crean con schema.sql). Por eso
    # cambiar este ondelete NO altera la BD: cualquier cambio de regla debe
    # hacerse con ALTER TABLE en MySQL y reflejarse aquí por consistencia.
    categoria_id = Column(
        Integer,
        ForeignKey("categorias.id", ondelete="SET NULL"),
        nullable=True,
    )

    # cantidad: entero, obligatorio, por defecto 0.
    cantidad = Column(Integer, nullable=False, default=0)

    # stock_minimo: entero, obligatorio, por defecto 0.
    stock_minimo = Column(Integer, nullable=False, default=0)

    # Relación: desde un insumo accedemos a su categoría (insumo.categoria).
    # back_populates conecta con Categoria.insumos.
    categoria = relationship("Categoria", back_populates="insumos")


# ============================================================
#  Modelo: Pedido  ->  tabla "pedidos"
#  Cada pedido de un cliente que trae ropa a lavar.
#  RELACIÓN: cada pedido fue registrado por UN usuario (lado "hijo").
# ============================================================
class Pedido(Base):
    __tablename__ = "pedidos"

    # id: entero, clave primaria, autoincremental.
    id = Column(Integer, primary_key=True, autoincrement=True)

    # cliente: VARCHAR(150), obligatorio.
    cliente = Column(String(150), nullable=False)

    # telefono: VARCHAR(30), opcional.
    telefono = Column(String(30), nullable=True)

    # kilos: DECIMAL(6,2), obligatorio. Hasta 6 dígitos, 2 decimales
    # (ej: 9999.99). DECIMAL evita errores de redondeo de los float.
    kilos = Column(DECIMAL(6, 2), nullable=False)

    # precio_por_kilo: DECIMAL(10,2), obligatorio.
    precio_por_kilo = Column(DECIMAL(10, 2), nullable=False)

    # total: DECIMAL(10,2), obligatorio.
    total = Column(DECIMAL(10, 2), nullable=False)

    # estado: VARCHAR(30), obligatorio, por defecto 'recibido'.
    estado = Column(String(30), nullable=False, default="recibido")

    # fecha_recepcion: DATETIME, opcional. Se guarda EN UTC (naive), como todo
    # timestamp del proyecto (ver tiempo.py); el frontend la muestra en la hora
    # local del usuario.
    fecha_recepcion = Column(DateTime, nullable=True)

    # fecha_entrega: DATETIME, opcional (NULL hasta que se entrega). En UTC.
    fecha_entrega = Column(DateTime, nullable=True)

    # usuario_id: clave foránea hacia usuarios(id). Puede ser NULL.
    # ondelete="RESTRICT" refleja la regla del schema: MySQL no deja
    # borrar un usuario que tenga pedidos asociados.
    # NOTA (fuente de verdad): igual que en insumos.categoria_id, el
    # enforcement real de esta regla ON DELETE vive en schema.sql. Como no se
    # llama a Base.metadata.create_all, este ondelete es solo documental:
    # cualquier cambio de regla debe hacerse con ALTER TABLE en MySQL y
    # reflejarse aquí por consistencia (si se adopta Alembic, derivar las
    # migraciones desde models.py para que ambos no diverjan).
    usuario_id = Column(
        Integer,
        ForeignKey("usuarios.id", ondelete="RESTRICT"),
        nullable=True,
    )

    # notas: VARCHAR(500), OPCIONAL (nullable). Observaciones de texto libre sobre
    # el pedido (instrucciones especiales, detalles de la prenda, etc.). Puede ser
    # NULL o vacío. La columna se crea en schema.sql y, para una BD que ya tiene
    # datos, se agrega con migracion_notas_pedidos.sql (ALTER TABLE).
    notas = Column(String(500), nullable=True)

    # Relación: desde un pedido accedemos a su usuario (pedido.usuario).
    # back_populates conecta con Usuario.pedidos.
    usuario = relationship("Usuario", back_populates="pedidos")


# ============================================================
#  Modelo: Auditoria  ->  tabla "auditoria"
#  Bitácora de acciones del sistema: QUIÉN hizo QUÉ, sobre QUÉ objeto y
#  CUÁNDO. Es un registro de solo agregado (se inserta una fila por acción).
#  SEGURIDAD: nunca guarda contraseñas ni hashes.
# ============================================================
class Auditoria(Base):
    __tablename__ = "auditoria"

    # id: entero, clave primaria, autoincremental.
    id = Column(Integer, primary_key=True, autoincrement=True)

    # usuario_id: quién hizo la acción. Clave foránea hacia usuarios(id).
    # Puede ser NULL para acciones sin usuario identificado (p. ej. un login
    # fallido). ondelete="SET NULL" refleja la regla del schema: si se borra el
    # usuario, su historial de auditoría se conserva (solo se desvincula).
    usuario_id = Column(
        Integer,
        ForeignKey("usuarios.id", ondelete="SET NULL"),
        nullable=True,
    )

    # accion: qué se hizo (ej: 'crear_pedido', 'login_fallido'). Obligatorio.
    accion = Column(String(50), nullable=False)

    # entidad: sobre qué tipo de objeto (ej: 'pedido'). NULL si no aplica.
    entidad = Column(String(50), nullable=True)

    # entidad_id: id del objeto afectado (ej: el id del pedido). NULL si no aplica.
    entidad_id = Column(Integer, nullable=True)

    # detalle: texto adicional (ej: el nombre de usuario intentado en un login
    # fallido). NUNCA contraseñas ni hashes. Opcional.
    detalle = Column(String(255), nullable=True)

    # fecha: momento exacto de la acción. Obligatorio. Se guarda EN UTC (naive),
    # como todo timestamp del proyecto (ver tiempo.py).
    fecha = Column(DateTime, nullable=False)
