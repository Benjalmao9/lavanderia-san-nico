# Importamos la clase FastAPI desde la librería fastapi.
# FastAPI es el "framework" (las herramientas) que usamos para construir el servidor web.
# - HTTPException/status: para responder con códigos HTTP correctos ante fallos.
# - Request: tipo de la petición entrante, lo reciben los manejadores globales.
from fastapi import FastAPI, Depends, HTTPException, Request, status

# JSONResponse: respuesta JSON explícita que usan los manejadores globales de errores.
from fastapi.responses import JSONResponse

# RequestValidationError: la excepción que lanza FastAPI cuando la validación de
# Pydantic falla (422). La importamos para registrar nuestro propio manejador y
# poder sanitizar el valor ofensor antes de devolverlo al cliente.
from fastapi.exceptions import RequestValidationError

# jsonable_encoder: convierte los errores de Pydantic a tipos JSON serializables.
# Es lo que usa internamente el manejador por defecto de FastAPI; lo reutilizamos
# para mantener exactamente el mismo formato 422.
from fastapi.encoders import jsonable_encoder

# CORSMiddleware: permite que el frontend (que corre en OTRO origen, el servidor
# de Vite) pueda hacerle peticiones a este backend. Ver explicación más abajo.
from fastapi.middleware.cors import CORSMiddleware

# Session: el tipo de una sesión de base de datos (solo para indicar el tipo).
from sqlalchemy.orm import Session

# text: nos permite escribir una consulta SQL "a mano" de forma segura.
from sqlalchemy import text

# SQLAlchemyError: clase base de los errores de SQLAlchemy. La usamos para
# capturar de forma específica los fallos de base de datos en un manejador global.
from sqlalchemy.exc import SQLAlchemyError

# logging: librería estándar para registrar eventos del lado del servidor.
# Así el detalle técnico de los errores queda en los logs y NO se filtra al cliente.
import logging

# os: para leer variables de entorno (p. ej. ENTORNO, que decide si exponemos /docs).
import os

# Importamos la dependencia get_db que definimos en database.py.
from database import get_db

# Validación de la configuración JWT, para fallar al arrancar si la clave
# secreta no está bien configurada (ver más abajo).
from seguridad import validar_configuracion_jwt

# requerir_admin: dependencia de autorización para proteger /probar-db (solo admin).
from dependencias import requerir_admin

# Rate limiting (freno de fuerza bruta). El Limiter compartido vive en
# limitador.py; acá registramos su manejador del 429 y lo enchufamos a la app.
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from limitador import limiter

# Importamos los routers con las rutas de cada entidad.
# 'auth' contiene el login (POST /login) que devuelve el token JWT.
# 'auditoria' expone la consulta de la bitácora (solo admin).
# 'reportes' expone los reportes del negocio con agregaciones (solo admin).
# 'categorias' lista las categorías (desplegable de insumos) y permite crearlas
# (solo admin, desde la pantalla de Categorías del frontend).
from routers import pedidos, insumos, usuarios, auth, auditoria, reportes, categorias

# Creamos un logger propio de la aplicación. Aquí escribimos el detalle real de los
# errores (host, usuario, "Access denied", tracebacks, etc.) sin exponerlo al cliente.
logger = logging.getLogger("lavanderia")

# Creamos la aplicación. Esta variable "app" es el corazón del servidor:
# representa toda nuestra API y a partir de ella definimos las rutas.
#
# /docs, /redoc y /openapi.json exponen el MAPA COMPLETO de la API (todos los
# endpoints, parámetros y esquemas) SIN autenticación. Es comodísimo en
# desarrollo, pero en producción es regalarle la superficie de ataque y la
# estructura interna a cualquier anónimo. Por eso los servimos SOLO fuera de
# producción: con la variable de entorno ENTORNO=produccion quedan deshabilitados.
ENTORNO = os.getenv("ENTORNO", "desarrollo")
_ES_PRODUCCION = ENTORNO.strip().lower() in ("produccion", "production", "prod")
app = FastAPI(
    docs_url=None if _ES_PRODUCCION else "/docs",
    redoc_url=None if _ES_PRODUCCION else "/redoc",
    openapi_url=None if _ES_PRODUCCION else "/openapi.json",
)

# Rate limiting: registramos el Limiter compartido en la app y su manejador del
# 429 (Too Many Requests). Esto habilita usar @limiter.limit(...) en las rutas
# (lo aplicamos en POST /login para frenar la fuerza bruta de contraseñas).
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

# Validamos la configuración JWT al arrancar: si la clave secreta falta o es
# insegura (demasiado corta), preferimos que el servidor NO arranque (fallo
# ruidoso y temprano) antes que descubrirlo recién en el primer login. Nota:
# crear_admin.py NO pasa por aquí, así que puede correr sin tener JWT
# configurado (solo usa el hashing de contraseñas).
validar_configuracion_jwt()


# ------------------------------------------------------------
#  CORS (Cross-Origin Resource Sharing)
#
#  ¿Qué es? Por seguridad, el navegador BLOQUEA por defecto que una página web
#  servida desde un "origen" (la combinación protocolo+host+puerto, p. ej.
#  http://localhost:5173, que es el frontend de Vite) le haga peticiones por
#  JavaScript a OTRO origen distinto (http://127.0.0.1:8000, este backend).
#  Eso evita que una web maliciosa use tu sesión contra otra API.
#
#  Para que NUESTRO frontend sí pueda hablar con NUESTRO backend, el servidor
#  tiene que decir explícitamente "confío en este origen" mediante unas
#  cabeceras HTTP. Este middleware las agrega:
#   - allow_origins: la lista blanca de orígenes permitidos (el frontend de Vite,
#     en localhost y en 127.0.0.1 por las dudas).
#   - allow_methods=["*"]: permite GET/POST/PUT/DELETE y el "preflight" OPTIONS.
#   - allow_headers=["*"]: permite las cabeceras que mandamos, incluida
#     'Authorization' (donde viaja el token JWT) y 'Content-Type'.
#
#  CONFIGURABLE POR ENTORNO: los orígenes se leen de la variable CORS_ORIGINS
#  (una lista separada por comas). En desarrollo, si no está definida, usamos el
#  frontend de Vite (localhost). En PRODUCCIÓN, definí CORS_ORIGINS con el dominio
#  real del frontend desplegado, por ejemplo:
#      CORS_ORIGINS=https://mi-lavanderia.vercel.app
#  Podés listar varios separados por coma (p. ej. el dominio de producción y
#  localhost para pruebas). NUNCA uses "*" junto con allow_credentials=True.
# ------------------------------------------------------------
_CORS_ORIGINS_ENV = os.getenv("CORS_ORIGINS", "").strip()
if _CORS_ORIGINS_ENV:
    ORIGENES_PERMITIDOS = [o.strip() for o in _CORS_ORIGINS_ENV.split(",") if o.strip()]
else:
    ORIGENES_PERMITIDOS = [
        "http://localhost:5173",
        "http://127.0.0.1:5173",
    ]
app.add_middleware(
    CORSMiddleware,
    allow_origins=ORIGENES_PERMITIDOS,
    allow_credentials=True,
    # Restringidos a lo que la API REALMENTE usa, en vez de "*" (endurecimiento:
    # no abrimos más superficie de la necesaria). Los métodos cubren el CRUD y el
    # preflight OPTIONS; las cabeceras, el token (Authorization) y el JSON.
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type"],
)


# ------------------------------------------------------------
#  Cabeceras de seguridad en TODAS las respuestas (defensa en profundidad):
#   - X-Content-Type-Options: nosniff  -> el navegador NO "adivina" el tipo de
#     contenido (evita que, por ejemplo, un JSON se interprete como HTML/JS).
#   - X-Frame-Options: DENY            -> nadie puede embeber la API en un <iframe>
#     (mitiga clickjacking).
#   - Referrer-Policy: no-referrer     -> no filtramos la URL de origen a terceros.
#  (La Content-Security-Policy del frontend conviene servirla desde el host del
#  SPA; estas cabeceras endurecen las respuestas del backend.)
# ------------------------------------------------------------
@app.middleware("http")
async def agregar_cabeceras_seguridad(request: Request, call_next):
    respuesta = await call_next(request)
    respuesta.headers["X-Content-Type-Options"] = "nosniff"
    respuesta.headers["X-Frame-Options"] = "DENY"
    respuesta.headers["Referrer-Policy"] = "no-referrer"
    # HSTS (Strict-Transport-Security): obliga al navegador a usar SIEMPRE HTTPS
    # con este dominio. Solo en producción (donde hay HTTPS real): en desarrollo
    # local corremos sobre http y esta cabecera rompería el acceso. max-age 1 año.
    if _ES_PRODUCCION:
        respuesta.headers["Strict-Transport-Security"] = (
            "max-age=31536000; includeSubDomains"
        )
    return respuesta


# Conectamos (incluimos) los routers en la aplicación. Gracias a esto,
# todas las rutas definidas en cada archivo de routers/ quedan activas.
app.include_router(pedidos.router)
app.include_router(insumos.router)
app.include_router(usuarios.router)
app.include_router(auth.router)
app.include_router(auditoria.router)
app.include_router(reportes.router)
app.include_router(categorias.router)


# ------------------------------------------------------------
#  Botón "Authorize" en /docs.
#
#  Ya NO hace falta registrar el esquema OAuth2 a mano. Ahora que las rutas
#  protegidas usan oauth2_scheme (a través de las dependencias obtener_usuario_actual
#  / requerir_admin), FastAPI detecta ese esquema de seguridad solo y:
#    - muestra el botón "Authorize" en /docs (password flow contra /login),
#    - dibuja un candado en cada ruta protegida,
#    - y, una vez autenticado ahí, envía el token automáticamente
#      ("Authorization: Bearer <token>") a esas rutas.
#  El login (/login) queda público porque NO depende de oauth2_scheme.
# ------------------------------------------------------------


# Manejadores globales de excepciones (red de seguridad / defensa en profundidad).
# No sustituyen los try/except ni los 404/400 de cada ruta: FastAPI ya tiene su
# propio manejador de HTTPException que cubre esos casos esperados. Estos solo
# atrapan lo INESPERADO para garantizar que nunca se filtre un traceback o un
# detalle interno al cliente, y que el código HTTP sea el correcto.
@app.exception_handler(SQLAlchemyError)
async def manejar_error_bd(request: Request, exc: SQLAlchemyError):
    # Cualquier fallo de base de datos no capturado en una ruta termina aquí.
    # Registramos el detalle real del lado del servidor (queda solo en los logs)...
    logger.exception("Error de base de datos no controlado")
    # ...y al cliente le respondemos 503 con un mensaje neutro, sin filtrar nada.
    return JSONResponse(
        status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
        content={"detail": "Error al acceder a la base de datos"},
    )


@app.exception_handler(Exception)
async def manejar_error_generico(request: Request, exc: Exception):
    # Última línea de defensa: cualquier excepción inesperada que no sea HTTPException
    # ni un error de base de datos. Logueamos el detalle y respondemos un 500 neutro.
    logger.exception("Error interno no controlado")
    return JSONResponse(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        content={"detail": "Ocurrió un error interno"},
    )


# Conjunto de nombres de campos cuyo valor NUNCA debe devolverse al cliente.
# Hoy solo la contraseña en texto plano: cuando UsuarioCrear/UsuarioActualizar
# validan su longitud (8-72) y falla, Pydantic v2 incluye en el error el campo
# 'input' con la contraseña plana, que el manejador 422 por defecto de FastAPI
# reflejaría en la respuesta (y de ahí pasaría a logs de proxy/gateway y a
# herramientas de observabilidad). Eso contradice el principio del proyecto de
# no exponer jamás la credencial.
_CAMPOS_SENSIBLES = {"contrasena"}


@app.exception_handler(RequestValidationError)
async def manejar_error_validacion(request: Request, exc: RequestValidationError):
    # Reemplazamos el manejador 422 por defecto de FastAPI por uno que sanitiza el
    # valor ofensor de los campos sensibles. Mantenemos el MISMO formato 422
    # ({"detail": [...]}) y los mismos mensajes (p. ej. "String should have at
    # least 8 characters"), solo eliminamos el valor para no filtrar la contraseña.
    errores = []
    for err in exc.errors():
        # Copiamos el error para no mutar la estructura interna de la excepción.
        e = dict(err)
        # Si el 'loc' del error apunta a un campo sensible, quitamos el valor.
        if any(c in _CAMPOS_SENSIBLES for c in e.get("loc", ())):
            e.pop("input", None)  # 'input' trae la contraseña en texto plano.
            e.pop("ctx", None)    # 'ctx' puede arrastrar el valor en otros errores.
        errores.append(e)
    return JSONResponse(
        status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
        content={"detail": jsonable_encoder(errores)},
    )


# Esto de abajo (@app.get("/")) se llama "decorador".
# Un decorador le dice a FastAPI: "cuando alguien visite esta dirección con
# este método, ejecuta la función que está justo debajo".
#
#  - "/" es la ruta raíz: la dirección principal del servidor (la página de inicio).
#  - .get significa que responde al método GET, que es el que usa el navegador
#    cuando simplemente quieres VER o LEER algo (no enviar ni modificar datos).
@app.get("/")
def leer_raiz():
    # Una "ruta" es una función asociada a una dirección. Cuando alguien entra a "/",
    # FastAPI ejecuta esta función y le devuelve al visitante lo que retornamos aquí.
    #
    # Devolvemos un diccionario de Python. FastAPI lo convierte automáticamente
    # en un JSON (el formato de texto que usan las APIs para comunicarse).
    return {"mensaje": "Servidor de la lavandería funcionando"}


# Ruta de prueba para verificar la conexión con la base de datos.
#  - Depends(get_db) le pide a FastAPI una sesión de base de datos
#    usando la dependencia que definimos en database.py.
#    FastAPI la crea, nos la pasa como parámetro "db" y la cierra al final.
#  - dependencies=[Depends(requerir_admin)]: esta ruta revela el ESTADO de la
#    base de datos, así que dejó de ser pública. Ahora solo un administrador
#    puede usarla (sin token -> 401; empleado -> 403). Es endurecimiento: el
#    estado interno de la infraestructura no debería exponerse a cualquiera.
@app.get("/probar-db", dependencies=[Depends(requerir_admin)])
def probar_db(db: Session = Depends(get_db)):
    try:
        # Ejecutamos una consulta mínima ("SELECT 1") solo para
        # comprobar que la base responde. Si falla, saltará al except.
        db.execute(text("SELECT 1"))
        return {"conexion": "exitosa", "mensaje": "La base de datos respondió correctamente"}
    except Exception:
        # Si algo sale mal (credenciales, base apagada, etc.) NO devolvemos el
        # detalle al cliente: str(error) expone datos internos del driver
        # (host, puerto, usuario, "Access denied", rutas...), lo cual es una fuga
        # de información sensible. Además, responder 200 ante un fallo confunde a
        # monitores y clientes (lo leerían como éxito).
        # Por eso registramos el detalle real solo en los logs del servidor...
        logger.exception("Fallo al probar la conexión con la base de datos")
        # ...y al cliente le respondemos 503 con un mensaje genérico y neutro.
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="No se pudo conectar con la base de datos",
        )

