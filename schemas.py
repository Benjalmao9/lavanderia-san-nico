# ============================================================
#  Esquemas de Pydantic (v2) de la lavandería.
#
#  Un "esquema" de Pydantic define la FORMA de los datos que entran
#  o salen por la API: qué campos hay, de qué tipo, cuáles son
#  obligatorios. Pydantic valida automáticamente y rechaza datos mal
#  formados antes de que lleguen a la base de datos.
#
#  Para cada entidad separamos los esquemas según su PROPÓSITO:
#    - ...Crear    -> datos que el cliente ENVÍA para crear un registro.
#                     No incluye campos que genera el servidor (id, total).
#    - ...Actualizar -> como Crear, pero con TODO opcional, para poder
#                     editar solo algunos campos (ediciones parciales).
#    - ...Respuesta -> datos que la API DEVUELVE. Incluye los campos
#                     generados por el servidor (id, fechas) y OMITE
#                     información sensible (como contraseñas).
#
#  ¿Por qué separarlos? Porque lo que el cliente puede mandar no es lo
#  mismo que lo que el servidor puede mostrar. Mezclarlos llevaría, por
#  ejemplo, a aceptar un "id" falso del cliente o a filtrar contraseñas.
# ============================================================

# Optional[X] significa "puede ser X o None" (campo opcional).
# Annotated permite adjuntar restricciones (StringConstraints) a un tipo
# sin cambiar el tipo base (el str sigue siendo str).
# Literal restringe un campo a un conjunto cerrado de valores (ej: el rol).
from typing import Optional, Annotated, Literal

# re para validar formatos con expresiones regulares (ej: nombre que no
# sea solo numeros).
import re

# datetime para fechas+hora; Decimal para montos exactos (sin errores
# de redondeo de los float), igual que el DECIMAL de MySQL.
from datetime import datetime
from decimal import Decimal

# BaseModel: clase base de todo esquema de Pydantic.
# ConfigDict: forma de configurar el esquema en Pydantic v2.
# Field: para declarar restricciones de valor (gt, ge, max_digits...).
# StringConstraints: restricciones de texto (strip, min_length, pattern).
# field_validator: validaciones personalizadas a nivel de campo.
from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    NaiveDatetime,
    StringConstraints,
    field_validator,
)


# ============================================================
#  CATEGORIA
#  Crear: solo el nombre (el id lo genera la base).
#  Respuesta: id + nombre (lo que devolvemos al cliente).
# ============================================================
class CategoriaCrear(BaseModel):
    # extra="forbid": si el cliente manda un campo que NO está declarado aquí,
    # Pydantic responde 422 en vez de ignorarlo en silencio. Es defensa en
    # profundidad contra la "inyección de campos" no previstos (p. ej. intentar
    # colar un 'id' o un campo interno). Lo aplicamos a TODOS los esquemas de
    # entrada (Crear/Actualizar); los de Respuesta no lo necesitan.
    model_config = ConfigDict(extra="forbid")

    # Mismas cotas que el resto de los nombres del proyecto: sin espacios al
    # borde, no vacío, y máximo alineado con la columna categorias.nombre
    # VARCHAR(100). Sin esto, '' / '   ' o un nombre de >100 chars pasarían el
    # esquema y recién fallarían en la BD con un DataError (400 genérico).
    nombre: Annotated[
        str, StringConstraints(strip_whitespace=True, min_length=1, max_length=100)
    ]


class CategoriaRespuesta(BaseModel):
    id: int
    nombre: str

    # from_attributes=True permite construir este esquema directamente
    # desde un objeto de SQLAlchemy (leyendo objeto.id, objeto.nombre...).
    # Sin esto, Pydantic solo aceptaría diccionarios.
    model_config = ConfigDict(from_attributes=True)


# ============================================================
#  USUARIO
#  Crear: el cliente envía la contraseña EN TEXTO PLANO; el servidor
#         la cifrará (hash) antes de guardarla. Por eso el campo se
#         llama "contrasena" y no "contrasena_hash".
#  Respuesta: NUNCA incluimos la contraseña ni su hash. Exponer
#         credenciales (aunque estén cifradas) es un riesgo de
#         seguridad: si la respuesta se filtra o se cachea, regalaríamos
#         material para atacar las cuentas. La API solo devuelve datos
#         públicos del usuario (id, nombre, rol, nombre completo).
# ============================================================
class UsuarioCrear(BaseModel):
    # Rechaza campos no esperados (ver explicación en CategoriaCrear).
    model_config = ConfigDict(extra="forbid")

    # nombre_usuario: 3-50 caracteres (alineado con VARCHAR(50)), sin
    # espacios al borde. Es el identificador de login, debe ser usable.
    nombre_usuario: Annotated[
        str, StringConstraints(strip_whitespace=True, min_length=3, max_length=50)
    ]
    # contrasena: texto plano de entrada; el servidor la cifra (hashea).
    # min_length=8 por seguridad básica. max_length=72 porque bcrypt solo
    # usa los primeros 72 bytes: limitarlo evita que el usuario crea que
    # una clave más larga aporta seguridad cuando en realidad se trunca.
    # OJO: no hacemos strip de la contraseña (un espacio puede ser parte
    # legítima de la clave).
    contrasena: Annotated[str, StringConstraints(min_length=8, max_length=72)]
    # rol: solo dos valores válidos. Literal lo restringe y devuelve 422
    # automáticamente ante cualquier otro valor (ej: 'jefe').
    rol: Literal["administrador", "empleado"]
    nombre_completo: Optional[
        Annotated[
            str, StringConstraints(strip_whitespace=True, min_length=1, max_length=150)
        ]
    ] = None

    # FIX (truncado silencioso de bcrypt): StringConstraints(max_length=72)
    # cuenta CARACTERES, pero bcrypt solo procesa los primeros 72 BYTES y
    # descarta el resto en SILENCIO. En UTF-8 los acentos/ñ ocupan 2 bytes y
    # muchos emojis 4, asi que una clave de <=72 caracteres puede superar 72
    # bytes y perder entropia sin aviso (dos claves que comparten los primeros
    # 72 bytes se verifican como iguales). Convertimos ese truncado silencioso
    # en un 422 explicito validando la longitud en BYTES UTF-8. No afecta el
    # comportamiento verificado (claves ASCII donde 1 char = 1 byte).
    @field_validator("contrasena")
    @classmethod
    def _contrasena_max_72_bytes(cls, v: str) -> str:
        if v is not None and len(v.encode("utf-8")) > 72:
            raise ValueError("la contrasena no puede superar 72 bytes")
        return v

    # FIX (defensa en profundidad sobre la calidad de la credencial): la unica
    # validacion previa era la longitud, asi que '12345678' o 'aaaaaaaa' pasaban.
    # Exigimos un minimo razonable de complejidad (al menos una letra y un
    # digito) sin tocar el min_length=8 verificado. Casos validos como
    # 'ClaveSegura1' siguen pasando (tienen letras y digito).
    @field_validator("contrasena")
    @classmethod
    def _contrasena_complejidad_minima(cls, v: str) -> str:
        if v is not None:
            if not re.search(r"[A-Za-z]", v) or not re.search(r"[0-9]", v):
                raise ValueError(
                    "la contrasena debe incluir al menos una letra y un numero"
                )
        return v


class UsuarioActualizar(BaseModel):
    # Rechaza campos no esperados (ver explicación en CategoriaCrear).
    model_config = ConfigDict(extra="forbid")

    # Edición PARCIAL: todos los campos opcionales (default None). Con
    # exclude_unset, omitir un campo NO lo valida; solo se valida cuando
    # el cliente envía un valor. Mismas cotas que en UsuarioCrear para que
    # el PUT no sea una puerta trasera (ej: poner una contraseña de 2
    # caracteres o un rol inventado).
    nombre_usuario: Optional[
        Annotated[
            str, StringConstraints(strip_whitespace=True, min_length=3, max_length=50)
        ]
    ] = None
    contrasena: Optional[Annotated[str, StringConstraints(min_length=8, max_length=72)]] = None
    rol: Optional[Literal["administrador", "empleado"]] = None
    nombre_completo: Optional[
        Annotated[
            str, StringConstraints(strip_whitespace=True, min_length=1, max_length=150)
        ]
    ] = None

    # Mismo FIX que en UsuarioCrear: el limite real de bcrypt es 72 BYTES, no
    # 72 caracteres. En edicion parcial 'contrasena' puede ser None (no se
    # envia), por eso contemplamos v is None y no validamos en ese caso.
    @field_validator("contrasena")
    @classmethod
    def _contrasena_max_72_bytes(cls, v: Optional[str]) -> Optional[str]:
        if v is not None and len(v.encode("utf-8")) > 72:
            raise ValueError("la contrasena no puede superar 72 bytes")
        return v

    # Misma exigencia de complejidad que en UsuarioCrear, pero solo cuando el
    # campo viene con valor (en edicion parcial contrasena puede ser None y no
    # se valida). Casos validos como 'ClaveSegura1' siguen pasando.
    @field_validator("contrasena")
    @classmethod
    def _contrasena_complejidad_minima(cls, v: Optional[str]) -> Optional[str]:
        if v is not None:
            if not re.search(r"[A-Za-z]", v) or not re.search(r"[0-9]", v):
                raise ValueError(
                    "la contrasena debe incluir al menos una letra y un numero"
                )
        return v


class UsuarioRespuesta(BaseModel):
    id: int
    nombre_usuario: str
    rol: str
    nombre_completo: Optional[str] = None
    # OJO: aquí NO hay 'contrasena' ni 'contrasena_hash', a propósito.

    model_config = ConfigDict(from_attributes=True)


# ============================================================
#  INSUMO
#  Crear: nombre + categoría + cantidades. categoria_id ES OBLIGATORIO:
#         todo insumo nuevo nace clasificado (regla de negocio a nivel de app;
#         la columna en la BD sigue admitiendo NULL, pero la API ya no). cantidad
#         y stock_minimo arrancan en 0 si no se especifican.
#  Actualizar: los mismos campos, pero TODOS opcionales, para poder editar solo
#         lo que cambia (ej: solo la cantidad). categoria_id se puede OMITIR (no
#         se toca), pero si se envía no puede ser null (ver el guard en el router).
#  Respuesta: incluye el id que asignó la base.
# ============================================================
class InsumoCrear(BaseModel):
    # Rechaza campos no esperados (ver explicación en CategoriaCrear).
    model_config = ConfigDict(extra="forbid")

    # Un insumo sin nombre es inidentificable. strip_whitespace convierte
    # '   ' en '' y min_length=1 lo rechaza con 422; max_length=150 alinea
    # con el VARCHAR(150) de insumos.nombre.
    nombre: Annotated[
        str, StringConstraints(strip_whitespace=True, min_length=1, max_length=150)
    ]
    # categoria_id AHORA es OBLIGATORIO (antes era Optional con default None).
    # Regla de negocio: un insumo nuevo debe nacer con categoría. Al no tener
    # default, omitirlo o enviarlo como null produce un 422 claro de Pydantic. Que
    # el id EXISTA de verdad lo valida el router (validar_categoria -> 400 si no).
    # gt=0: los ids autoincrementales arrancan en 1, así un 0/negativo se descarta
    # de entrada con un 422 en vez de llegar como un 400 más tardío.
    categoria_id: int = Field(gt=0)
    # ge=0 (no gt) porque 0 es el valor por defecto legitimo, pero un
    # stock negativo no tiene sentido fisico y distorsiona /insumos/alertas.
    # le=2147483647: tope = maximo de un INT signed de MySQL (la columna es INT).
    # Sin este tope, un valor mayor pasaria Pydantic y recien fallaria en la BD
    # con un DataError -> 400 generico; con le, el backend responde un 422 claro.
    cantidad: int = Field(default=0, ge=0, le=2147483647)
    stock_minimo: int = Field(default=0, ge=0, le=2147483647)


class InsumoActualizar(BaseModel):
    # Rechaza campos no esperados (ver explicación en CategoriaCrear).
    model_config = ConfigDict(extra="forbid")

    # Mismas cotas que en InsumoCrear, pero opcionales: con default None y
    # exclude_unset, omitir el campo NO valida (edicion parcial intacta);
    # solo se valida cuando el cliente envia un valor. Asi el PUT no es una
    # puerta trasera para reintroducir nombre vacio o cantidades negativas.
    nombre: Optional[
        Annotated[
            str,
            StringConstraints(strip_whitespace=True, min_length=1, max_length=150),
        ]
    ] = None
    # categoria_id OMITIBLE (si no se envía, no se toca). PERO ya no se admite
    # dejar un insumo "sin categoría": si el cliente lo ENVÍA, debe ser un id de
    # categoría existente y NUNCA null. Se mantiene Optional[int]=None SOLO para
    # permitir omitirlo; el rechazo del null explícito y la comprobación de que la
    # categoría exista viven en el router (actualizar_insumo), igual que el guard
    # de null de nombre_usuario/rol en usuarios.py.
    categoria_id: Optional[int] = None
    # Mismo tope que en InsumoCrear (máximo de un INT de MySQL).
    cantidad: Optional[int] = Field(default=None, ge=0, le=2147483647)
    stock_minimo: Optional[int] = Field(default=None, ge=0, le=2147483647)


class InsumoRespuesta(BaseModel):
    id: int
    nombre: str
    categoria_id: Optional[int] = None
    cantidad: int
    stock_minimo: int

    model_config = ConfigDict(from_attributes=True)


# ============================================================
#  PEDIDO
#  Crear: solo lo que aporta el cliente (cliente, teléfono, kilos,
#         precio por kilo). NO incluye:
#           - id    -> lo asigna la base de datos.
#           - total -> lo calcula el servidor (kilos * precio_por_kilo).
#         El estado arranca por defecto en 'recibido'.
#  Actualizar: campos opcionales para editar el pedido y, sobre todo,
#         hacer avanzar su 'estado' (recibido -> en proceso -> ...).
#         No incluimos 'total' porque el servidor lo recalcula solo.
#  Respuesta: el pedido COMPLETO, con todo lo que generó el servidor
#         (id, total, fechas, usuario_id).
# ============================================================
class PedidoCrear(BaseModel):
    # Rechaza campos no esperados (ver explicación en CategoriaCrear). Aquí
    # tiene un valor extra: refuerza que el cliente NO pueda colar campos como
    # 'total' o 'usuario_id', que el servidor calcula/asigna por su cuenta.
    model_config = ConfigDict(extra="forbid")

    # Un pedido sin nombre de cliente real es inutilizable. strip_whitespace
    # convierte '   ' en '' y min_length=1 lo rechaza con 422; max_length=150
    # alinea con el VARCHAR(150) de pedidos.cliente.
    cliente: Annotated[
        str, StringConstraints(strip_whitespace=True, min_length=1, max_length=150)
    ]
    # Telefono opcional, pero si viene con valor debe parecer un telefono:
    # digitos, +, (), guiones y espacios, longitud 6-30 (alineado con
    # VARCHAR(30)). Asi 'no-es-un-tel!!' se rechaza con 422.
    telefono: Optional[
        Annotated[
            str,
            StringConstraints(
                strip_whitespace=True, pattern=r"^[0-9+()\-\s]{6,30}$"
            ),
        ]
    ] = None
    # gt=0: kilos<=0 no tiene sentido fisico y produciria un total<=0.
    # max_digits=6/decimal_places=2 reflejan el DECIMAL(6,2) de la BD, asi
    # un valor que excede el rango es un 422 temprano y no un 500 al hacer
    # commit. kilos=3.5 (gt=0, 2 decimales) sigue pasando.
    kilos: Decimal = Field(gt=0, max_digits=6, decimal_places=2)
    # gt=0: un precio 0 o negativo produce un cobro invalido. max_digits=10
    # /decimal_places=2 trasladan el limite de la BD a un 422 temprano.
    # precio=2.00 sigue pasando.
    precio_por_kilo: Decimal = Field(gt=0, max_digits=10, decimal_places=2)
    # notas: observaciones de texto libre, OPCIONAL. strip_whitespace limpia los
    # bordes; max_length=500 alinea con la columna pedidos.notas VARCHAR(500). Sin
    # min_length: puede venir vacía (o como null). El servidor NO la calcula: la
    # aporta el usuario al crear el pedido.
    notas: Optional[
        Annotated[str, StringConstraints(strip_whitespace=True, max_length=500)]
    ] = None
    # NOTA: se elimino el campo 'estado'. El estado inicial lo fija el
    # servidor (crear_pedido hardcodea 'recibido' e ignora datos.estado),
    # asi que aceptarlo aqui era enganoso: el esquema prometia algo que la
    # API no respeta. Sacarlo hace que el esquema refleje la realidad.

    # Un nombre de cliente compuesto solo por digitos es casi seguro un
    # error de carga (telefono o id mal puesto en el campo nombre).
    @field_validator("cliente")
    @classmethod
    def _cliente_no_solo_numeros(cls, v: str) -> str:
        if re.fullmatch(r"[0-9]+", v):
            raise ValueError("el nombre del cliente no puede ser solo numeros")
        return v

    # notas vacia -> None: StringConstraints ya hizo strip, asi que '   ' llega
    # como ''. Guardamos NULL (no un string vacio) para que "sin notas" sea siempre
    # el mismo valor, sin importar si vino omitido, null o solo espacios.
    @field_validator("notas")
    @classmethod
    def _notas_vacia_a_none(cls, v: Optional[str]) -> Optional[str]:
        return None if v == "" else v


class PedidoActualizar(BaseModel):
    # Rechaza campos no esperados (ver explicación en CategoriaCrear). Refuerza
    # que no se pueda sobrescribir 'total' ni 'usuario_id' por el body.
    model_config = ConfigDict(extra="forbid")

    # Mismas cotas que en PedidoCrear pero opcionales: con default None y
    # exclude_unset, omitir el campo NO valida (edicion parcial intacta);
    # la cota solo aplica cuando el campo viene con valor. Asi el PUT no es
    # una puerta trasera para reintroducir basura (kilos<=0, cliente vacio).
    cliente: Optional[
        Annotated[
            str,
            StringConstraints(strip_whitespace=True, min_length=1, max_length=150),
        ]
    ] = None
    telefono: Optional[
        Annotated[
            str,
            StringConstraints(
                strip_whitespace=True, pattern=r"^[0-9+()\-\s]{6,30}$"
            ),
        ]
    ] = None
    # gt=0 + rango de la BD: un PUT con kilos=0/precio=-1 recalcularia un
    # total invalido, asi que lo rechazamos con 422 cuando el valor esta
    # presente. Con default None la edicion parcial sigue intacta.
    kilos: Optional[Decimal] = Field(
        default=None, gt=0, max_digits=6, decimal_places=2
    )
    precio_por_kilo: Optional[Decimal] = Field(
        default=None, gt=0, max_digits=10, decimal_places=2
    )
    # estado restringido a los valores válidos del negocio (igual que 'rol' usa
    # Literal). Antes era Optional[str] libre: cualquier autenticado podía hacer
    # PUT /pedidos/{id} con {"estado":"basura"} y corromper el flujo y el reporte
    # por estado (el <select> del frontend NO protege: el endpoint es accesible
    # por curl). Con Literal, Pydantic devuelve 422 ante cualquier otro valor. La
    # validación de TRANSICIONES válidas (no saltar/retroceder) vive en el router.
    estado: Optional[Literal["recibido", "en proceso", "listo", "entregado"]] = None
    # NaiveDatetime (sin zona horaria): las fechas del proyecto se guardan naive
    # (fecha_recepcion la fija el servidor con datetime.now()). Si el cliente
    # enviara una fecha CON zona horaria (tz-aware), compararla contra una naive en
    # el router lanzaría TypeError -> 500. Con NaiveDatetime, un valor tz-aware se
    # rechaza con un 422 claro en vez de reventar. (El frontend no envía esta fecha.)
    fecha_entrega: Optional[NaiveDatetime] = None
    # notas: igual que en PedidoCrear (opcional, hasta 500). Con default None y
    # exclude_unset, omitirla NO la toca (edición parcial); enviarla la cambia, y
    # mandar null la BORRA (deja la columna en NULL).
    notas: Optional[
        Annotated[str, StringConstraints(strip_whitespace=True, max_length=500)]
    ] = None

    # Mismo criterio que en PedidoCrear, pero solo si el campo viene con
    # valor (en edicion parcial cliente puede ser None y no se valida).
    @field_validator("cliente")
    @classmethod
    def _cliente_no_solo_numeros(cls, v: Optional[str]) -> Optional[str]:
        if v is not None and re.fullmatch(r"[0-9]+", v):
            raise ValueError("el nombre del cliente no puede ser solo numeros")
        return v

    # Igual que en PedidoCrear: notas '' (o solo espacios, ya recortada) -> None,
    # para que borrar las notas (mandar vacio) deje la columna en NULL, no en ''.
    @field_validator("notas")
    @classmethod
    def _notas_vacia_a_none(cls, v: Optional[str]) -> Optional[str]:
        return None if v == "" else v


class PedidoRespuesta(BaseModel):
    id: int
    cliente: str
    telefono: Optional[str] = None
    kilos: Decimal
    precio_por_kilo: Decimal
    total: Decimal
    estado: str
    fecha_recepcion: Optional[datetime] = None
    fecha_entrega: Optional[datetime] = None
    usuario_id: Optional[int] = None
    notas: Optional[str] = None

    model_config = ConfigDict(from_attributes=True)


# ============================================================
#  AUDITORIA
#  Solo esquema de Respuesta: las filas de auditoría las genera el servidor
#  (no las envía el cliente), por eso no hay AuditoriaCrear. Devuelve quién
#  (usuario_id), qué (accion/entidad/entidad_id), detalle y cuándo (fecha).
#  Nunca incluye contraseñas ni hashes (la tabla tampoco los guarda).
# ============================================================
class AuditoriaRespuesta(BaseModel):
    id: int
    usuario_id: Optional[int] = None
    accion: str
    entidad: Optional[str] = None
    entidad_id: Optional[int] = None
    detalle: Optional[str] = None
    fecha: datetime

    model_config = ConfigDict(from_attributes=True)


# ============================================================
#  REPORTES (Etapa 4)
#  Esquemas de RESPUESTA de los reportes del negocio. Son solo de SALIDA: la
#  API los calcula con agregaciones SQL (func.sum/func.count + group_by) y
#  devuelve listas ya resumidas. No hay esquema de entrada porque los
#  parámetros (rango de fechas, agrupación) viajan como query params y los
#  valida el propio router.
# ============================================================
class IngresosPeriodoRespuesta(BaseModel):
    # periodo: etiqueta del periodo según la agrupación pedida:
    #   anio -> '2026', mes -> '2026-03', dia -> '2026-03-15'.
    periodo: str
    # ingresos: suma de los 'total' de los pedidos de ese periodo (Decimal,
    # igual que pedidos.total, para no perder centavos).
    ingresos: Decimal


class ConteoPeriodoRespuesta(BaseModel):
    # Mismo 'periodo' que arriba, pero con el CONTEO de pedidos en vez de la suma.
    periodo: str
    cantidad: int


class PedidosPorEstadoRespuesta(BaseModel):
    # estado: el valor del campo pedidos.estado ('recibido', 'entregado', ...).
    estado: str
    cantidad: int


class PedidosPorEmpleadoRespuesta(BaseModel):
    # usuario_id puede ser None: agrupa los pedidos SIN usuario asignado (los
    # creados antes de que existiera el login). En ese caso nombre_completo
    # viene como 'sin asignar'.
    usuario_id: Optional[int] = None
    nombre_completo: str
    cantidad: int
