# ============================================================
#  Configuración de la conexión a la base de datos con SQLAlchemy.
#  Aquí preparamos el "engine" (motor de conexión), la sesión
#  (con la que hablamos con la base) y la dependencia get_db
#  que usaremos en las rutas de FastAPI.
# ============================================================

import os

# quote_plus codifica un texto para que sea seguro dentro de una URL
# (convierte caracteres especiales en su forma "escapada", ej: @ -> %40).
from urllib.parse import quote_plus

# load_dotenv lee el archivo .env y carga sus valores como
# variables de entorno, para poder leerlas con os.getenv().
from dotenv import load_dotenv

# create_engine: crea el motor que se conecta a la base de datos.
from sqlalchemy import create_engine

# sessionmaker: fábrica de sesiones (cada sesión es una "conversación"
# con la base de datos para hacer consultas o cambios).
from sqlalchemy.orm import sessionmaker

# declarative_base: crea la clase "Base" de la que heredarán
# nuestros modelos (las clases de Python que representan las tablas).
from sqlalchemy.orm import declarative_base


# Cargamos las variables definidas en el archivo .env.
load_dotenv()

# ------------------------------------------------------------
#  De dónde sale la URL de conexión.
#
#  En la NUBE (Railway, Render, una base MySQL gestionada...) lo habitual es
#  recibir la URL de conexión COMPLETA en una sola variable: DATABASE_URL. Si
#  está definida, la usamos tal cual (solo normalizamos el "driver"). Si NO está
#  (desarrollo local), construimos la URL a partir de las piezas sueltas
#  DB_HOST/DB_PORT/DB_USER/DB_PASSWORD/DB_NAME. Así el mismo código sirve para
#  local y para producción sin tocar nada: solo cambian las variables de entorno.
# ------------------------------------------------------------
_DATABASE_URL_ENV = os.getenv("DATABASE_URL")

if _DATABASE_URL_ENV:
    url = _DATABASE_URL_ENV.strip()
    # Muchos proveedores entregan el esquema 'mysql://...', pero SQLAlchemy
    # necesita el DRIVER explícito 'mysql+pymysql://...'. Normalizamos el esquema
    # sin tocar usuario/clave/host (así no hay que editar la URL a mano).
    if url.startswith("mysql://"):
        url = "mysql+pymysql://" + url[len("mysql://") :]
    # Aseguramos utf8mb4 (tildes, ñ y emojis) si la URL no trae ya un charset.
    if "charset=" not in url:
        url += ("&" if "?" in url else "?") + "charset=utf8mb4"
    DATABASE_URL = url
else:
    # Modo local: leemos cada credencial por separado, con valores por defecto
    # cómodos para desarrollo (el segundo argumento de os.getenv).
    DB_HOST = os.getenv("DB_HOST", "localhost")
    DB_PORT = os.getenv("DB_PORT", "3306")
    DB_USER = os.getenv("DB_USER", "root")
    DB_PASSWORD = os.getenv("DB_PASSWORD", "")
    DB_NAME = os.getenv("DB_NAME", "lavanderia")

    # La URL usa ":", "@" y "/" como SEPARADORES. Si la contraseña (o el usuario)
    # contiene alguno de esos caracteres, SQLAlchemy se confunde y la conexión
    # falla con "Access denied". quote_plus los escapa (@ -> %40, : -> %3A...) para
    # que dejen de interpretarse como separadores, sin tocar la contraseña real.
    DB_USER_ENC = quote_plus(DB_USER)
    DB_PASSWORD_ENC = quote_plus(DB_PASSWORD)

    # Formato: dialecto+driver://usuario:contraseña@host:puerto/base_de_datos
    #  - mysql+pymysql -> MySQL con el driver PyMySQL.   - utf8mb4 -> tildes/ñ/emojis.
    DATABASE_URL = (
        f"mysql+pymysql://{DB_USER_ENC}:{DB_PASSWORD_ENC}@{DB_HOST}:{DB_PORT}/{DB_NAME}?charset=utf8mb4"
    )

# Creamos el engine: el objeto central que gestiona la conexión real.
#  - pool_pre_ping=True revisa que la conexión siga viva antes de usarla
#    (evita errores si la base cerró una conexión inactiva).
engine = create_engine(DATABASE_URL, pool_pre_ping=True)

# Creamos la fábrica de sesiones. Cada vez que la llamemos,
# nos dará una sesión nueva para trabajar con la base de datos.
#  - autocommit=False y autoflush=False son los valores recomendados:
#    nos dan control de cuándo se guardan los cambios (commit).
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

# Base de la que heredarán todos los modelos (tablas) del proyecto.
Base = declarative_base()


# ------------------------------------------------------------
#  Dependencia get_db
#  FastAPI la usará para entregarle a cada ruta una sesión de
#  base de datos, y cerrarla automáticamente al terminar.
# ------------------------------------------------------------
def get_db():
    # Abrimos una sesión nueva.
    db = SessionLocal()
    try:
        # "yield" entrega la sesión a la ruta que la pidió.
        # La ruta la usa y, cuando termina, el código sigue abajo.
        yield db
    finally:
        # Pase lo que pase (haya error o no), cerramos la sesión
        # para liberar la conexión.
        db.close()
