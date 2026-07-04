# Lavandería San Nico

Sistema de gestión para una lavandería: pedidos, inventario, usuarios, panel de
reportes y bitácora de auditoría.

**Stack:**
- **Backend:** FastAPI + SQLAlchemy + MySQL, autenticación con JWT (HS256) y bcrypt.
- **Frontend:** React + Vite + TypeScript + Tailwind v4 (modo oscuro, responsive).

---

## Estructura del repositorio

```
lavanderia/
├── main.py, database.py, models.py, schemas.py, ...   # Backend (FastAPI)
├── routers/                                            # Endpoints por entidad
├── schema.sql                                          # Crea las tablas (correr 1 vez)
├── crear_admin.py                                      # Crea el admin inicial
├── requirements.txt                                    # Dependencias de Python
├── Procfile                                            # Comando de arranque (uvicorn)
├── runtime.txt                                         # Versión de Python
├── .env.example                                        # Plantilla de variables del backend
└── frontend/                                           # Aplicación React + Vite
    ├── src/
    ├── .env.example                                    # Plantilla de variables del frontend
    ├── vercel.json                                     # Config para Vercel (SPA)
    └── netlify.toml                                    # Config para Netlify (SPA)
```

---

## Desarrollo local

### Requisitos
- Python 3.11+
- Node.js 18+ (incluye npm)
- MySQL 8 corriendo en tu máquina

### 1) Base de datos local
1. Crea la base de datos en MySQL (por ejemplo `lavanderia`).
2. Aplica el esquema (crea las tablas):
   ```
   mysql -u root -p lavanderia < schema.sql
   ```
   (o ábrelo en MySQL Workbench / DBeaver y ejecútalo).
3. **Si tu base YA existía de antes** (con datos), `schema.sql` usa
   `CREATE TABLE IF NOT EXISTS` y no le agrega columnas nuevas a una tabla que
   ya tenías. Corré, en orden, las migraciones que todavía no hayas aplicado
   (cada una avisa "Duplicate column/constraint" si ya está hecha; ignoralo):
   - `migracion_auditoria.sql` — tabla `auditoria` + `chk_usuarios_rol`.
   - `migracion_notas_pedidos.sql` — columna `pedidos.notas`.
   - `migracion_check_estado_pedidos.sql` — `chk_pedidos_estado`.
   - `migracion_sesion_valida_desde.sql` — columna `usuarios.sesion_valida_desde`.

   > **Importante para producción:** esto aplica IGUAL si tu base de Railway/
   > Render ya existía antes de que se agregaran estas columnas al `schema.sql`.
   > Una base de producción creada con una versión vieja de `schema.sql` necesita
   > estas mismas migraciones antes de desplegar el backend actualizado (si no,
   > el backend fallará al usar columnas que la tabla todavía no tiene). Una base
   > **nueva**, creada con el `schema.sql` actual, ya las incluye todas.

### 2) Backend
```powershell
# En la raíz del proyecto:
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
Copy-Item .env.example .env        # luego edita .env con tus valores reales
python crear_admin.py              # crea el administrador inicial (1 sola vez)
python -m uvicorn main:app --reload
```
El backend queda en `http://127.0.0.1:8000` (y la documentación interactiva en
`http://127.0.0.1:8000/docs` mientras `ENTORNO=desarrollo`).

### 3) Frontend
```powershell
cd frontend
npm install
Copy-Item .env.example .env        # VITE_API_URL ya apunta a localhost:8000
npm run dev
```
El frontend queda en `http://localhost:5173`.

---

## Variables de entorno

### Backend (raíz del proyecto)

| Variable | ¿Requerida? | Ejemplo | Para qué sirve |
|---|---|---|---|
| `ENTORNO` | En producción | `produccion` | `desarrollo` (por defecto) o `produccion`. En producción **deshabilita** `/docs`, `/redoc` y `/openapi.json`. |
| `DATABASE_URL` | En la nube | `mysql://usuario:clave@host:3306/basedatos` | URL **completa** de MySQL. Si está definida, tiene prioridad sobre las piezas `DB_*`. Acepta `mysql://` o `mysql+pymysql://`. |
| `DB_HOST` / `DB_PORT` / `DB_USER` / `DB_PASSWORD` / `DB_NAME` | Solo local | `localhost` / `3306` / `root` / `...` / `lavanderia` | Alternativa a `DATABASE_URL` para desarrollo local. |
| `JWT_SECRET_KEY` | **Siempre** | (64 caracteres aleatorios) | Firma los tokens de login. **Crítica.** Genera una con: `python -c "import secrets; print(secrets.token_urlsafe(64))"`. Usa una distinta en producción. |
| `JWT_EXPIRE_HOURS` | No (default `2`) | `2` | Horas de vida del token antes de tener que loguearse de nuevo. |
| `CORS_ORIGINS` | En producción | `https://mi-lavanderia.vercel.app` | Dominios del frontend autorizados (lista separada por comas). Si no está, se permite solo el Vite local. **Nunca uses `*`.** |
| `TURNSTILE_SECRET_KEY` | En producción | (clave secreta de Cloudflare) | Verifica el CAPTCHA del login (Cloudflare Turnstile). **Solo se usa si `ENTORNO=produccion`** (en desarrollo el CAPTCHA se omite por completo). En producción es obligatoria: sin ella el servidor no arranca. |
| `PROXY_HOPS_CONFIABLES` | No (default `1`) | `1` | Cuántos proxies de confianza hay delante del backend, para obtener la IP real del cliente (`X-Forwarded-For`) al contar el rate limit del login. Railway/Render = `1`. Solo cámbialo si tu plataforma pone más de un proxy delante. |

Solo para el script `crear_admin.py` (no las usa el servidor):
`ADMIN_USUARIO`, `ADMIN_CONTRASENA`, `ADMIN_NOMBRE_COMPLETO`.

### Frontend (`frontend/`)

| Variable | ¿Requerida? | Ejemplo | Para qué sirve |
|---|---|---|---|
| `VITE_API_URL` | Sí | `https://mi-backend.onrender.com` | URL pública del backend. En desarrollo apunta a `http://127.0.0.1:8000`. |
| `VITE_TURNSTILE_SITE_KEY` | En producción | (site key de Cloudflare) | Clave **pública** del widget de Turnstile: muestra el CAPTCHA en el login. Si no está definida (desarrollo), no se muestra ningún widget. Es la pareja de `TURNSTILE_SECRET_KEY` del backend. |

> Las variables `VITE_*` se incrustan en el build del frontend (son públicas, no
> secretas). Si cambias `VITE_API_URL`, hay que **volver a hacer el build**.

---

## Despliegue en producción

Son **tres piezas** y se despliegan en este **orden** (cada una necesita la anterior):

```
1) Base de datos MySQL  ──►  2) Backend (FastAPI)  ──►  3) Frontend (React)
```

> Sugerencia de plataformas (todas tienen plan gratuito para empezar):
> **Railway** (base de datos MySQL + backend), **Vercel** o **Netlify** (frontend).
> Render también sirve para el backend, pero su base gestionada es PostgreSQL, no
> MySQL; si usas Render para el backend, consigue el MySQL en Railway o Aiven.

### Paso 1 — Base de datos MySQL en la nube
1. Crea una base **MySQL** gestionada (p. ej. el plugin *MySQL* de **Railway**, o **Aiven**).
   Conviene un MySQL real (soporta claves foráneas, que este esquema usa).
2. Aplica el esquema **una vez**: ejecuta el contenido de `schema.sql` contra esa
   base (con MySQL Workbench, DBeaver, la consola del proveedor o el cliente `mysql`).
3. Copia la **connection URL** que te da el proveedor (será tu `DATABASE_URL`).

### Paso 2 — Backend (Railway o Render)
1. Sube el código a un repositorio de **GitHub** (la plataforma despliega desde ahí).
2. Crea un proyecto/servicio apuntando a ese repo. La **raíz** del servicio es la
   raíz del repo (donde están `requirements.txt`, `Procfile` y `main.py`).
3. Configura las **variables de entorno** del servicio:
   - `ENTORNO=produccion`
   - `DATABASE_URL=` (la del Paso 1)
   - `JWT_SECRET_KEY=` (genera una nueva, larga y aleatoria)
   - `CORS_ORIGINS=` (lo completas en el Paso 4, cuando tengas la URL del frontend)
   - `TURNSTILE_SECRET_KEY=` (clave **secreta** del widget de Cloudflare Turnstile:
     créalo en [dash.cloudflare.com](https://dash.cloudflare.com) → *Turnstile* →
     *Add widget*, con el dominio del frontend; te da un par site key / secret key.
     El CAPTCHA del login solo se activa con `ENTORNO=produccion`, y sin esta
     variable el servidor no arranca en producción.)
4. Arranque:
   - **Railway:** detecta Python e instala `requirements.txt`; usa el `Procfile`.
   - **Render:** *Build command* `pip install -r requirements.txt`; *Start command*
     `uvicorn main:app --host 0.0.0.0 --port $PORT`. La versión de Python sale de
     `runtime.txt`.
   - **IP real del cliente detrás del proxy (rate limiting):** en Railway/Render la
     app corre detrás de un proxy, así que la conexión llega desde la IP del proxy y
     la del cliente viaja en la cabecera `X-Forwarded-For`. El backend la resuelve
     **él mismo** de forma resistente a falsificación (toma la última entrada, la que
     agrega el proxy de confianza; ver `limitador.py`). Por eso el `Procfile` ya **no**
     usa `--proxy-headers --forwarded-allow-ips="*"`: ese wildcard confiaba en el
     `X-Forwarded-For` de cualquiera y permitía evadir el límite de fuerza bruta del
     login rotando la cabecera. Si tu plataforma pusiera más de un proxy delante,
     ajusta `PROXY_HOPS_CONFIABLES` (por defecto `1`).
   - El `$PORT` lo asigna la plataforma; el `Procfile` ya lo usa.
5. Crea el administrador en la base de la nube (una vez). Lo más simple desde tu
   laptop, apuntando a la base remota:
   ```powershell
   $env:DATABASE_URL="mysql://usuario:clave@host:3306/basedatos"
   $env:ADMIN_USUARIO="tu_usuario_admin"
   $env:ADMIN_CONTRASENA="UnaClaveSegura123"
   python crear_admin.py
   ```
   (o usa la consola/*shell* que ofrece la plataforma).
6. Anota la **URL pública del backend** (p. ej. `https://lavanderia-api.up.railway.app`).

### Paso 3 — Frontend (Vercel o Netlify)
1. Crea un proyecto desde el **mismo repo de GitHub**.
2. Configura el **directorio raíz / base** del proyecto = `frontend`.
3. Build: comando `npm run build`, salida `dist`. (Vercel autodetecta Vite;
   Netlify lee `netlify.toml`. El *fallback* de rutas SPA ya está configurado en
   `vercel.json` / `netlify.toml`.)
4. Variables de entorno:
   - `VITE_API_URL=` (la URL del backend del Paso 2).
   - `VITE_TURNSTILE_SITE_KEY=` (la **site key** pública del widget de Turnstile,
     la pareja de la `TURNSTILE_SECRET_KEY` del Paso 2; con ella el login muestra
     el CAPTCHA).
5. Despliega y anota la **URL pública del frontend** (p. ej. `https://mi-lavanderia.vercel.app`).

### Paso 4 — Conectar CORS (cerrar el círculo)
1. Vuelve al backend y pon `CORS_ORIGINS=` con la URL del frontend (Paso 3).
2. **Redeploy** del backend para que tome el cambio.
3. Abre el frontend e inicia sesión con el administrador del Paso 2. Listo.

---

## Checklist de despliegue

**Cuentas que necesitas crear:**
- [ ] GitHub (para alojar el código).
- [ ] Una plataforma de base de datos MySQL (Railway o Aiven).
- [ ] Una plataforma para el backend (Railway o Render).
- [ ] Una plataforma para el frontend (Vercel o Netlify).

**Antes de desplegar:**
- [ ] `git init`, commit y `git push` del repo a GitHub (verifica que `.env` **no**
      se haya subido; ya está en `.gitignore`).
- [ ] Genera una `JWT_SECRET_KEY` nueva para producción.

**Paso 1 — Base de datos:**
- [ ] Crear la base MySQL en la nube.
- [ ] Ejecutar `schema.sql` contra ella.
- [ ] Copiar la `DATABASE_URL`.

**Paso 2 — Backend:**
- [ ] Crear el servicio apuntando al repo (raíz = raíz del repo).
- [ ] Crear el widget de **Cloudflare Turnstile** (dash.cloudflare.com → Turnstile)
      con el dominio del frontend; copiar el par site key / secret key.
- [ ] Variables: `ENTORNO=produccion`, `DATABASE_URL`, `JWT_SECRET_KEY`,
      `TURNSTILE_SECRET_KEY`.
- [ ] Esperar el deploy y verificar que arranca (los logs no deben mostrar errores
      de `JWT_SECRET_KEY` ni de conexión a la base).
- [ ] Crear el administrador (`crear_admin.py` contra la base de la nube).
- [ ] Copiar la URL pública del backend.

**Paso 3 — Frontend:**
- [ ] Crear el proyecto con **directorio raíz = `frontend`**.
- [ ] Variables: `VITE_API_URL` = URL del backend; `VITE_TURNSTILE_SITE_KEY` =
      site key del widget de Turnstile.
- [ ] Desplegar y copiar la URL pública del frontend.

**Paso 4 — Conectar:**
- [ ] En el backend, poner `CORS_ORIGINS` = URL del frontend y **redeploy**.
- [ ] Probar el login y un par de pantallas en el sitio en producción.

---

## Notas y advertencias

- **Seguridad ya incluida:** en producción (`ENTORNO=produccion`) se ocultan
  `/docs`/`/redoc`/`/openapi.json`; el backend manda cabeceras de seguridad
  (`X-Frame-Options`, `nosniff`, `Referrer-Policy`); el login tiene *rate limiting*
  (10 intentos por minuto por IP) **y CAPTCHA de Cloudflare Turnstile** (solo en
  producción; si Cloudflare no responde, el login se rechaza —*fail-closed*— en
  vez de dejar pasar sin verificación). El token JWT se firma con `JWT_SECRET_KEY`.
- **El backend no crea las tablas solo:** hay que aplicar `schema.sql` una vez (Paso 1).
- **Si actualizas `VITE_API_URL`,** vuelve a desplegar el frontend (la URL se
  incrusta en el build).
- **Rate limiting en memoria:** el límite del login se cuenta por instancia. Si en
  el futuro corres el backend con varias instancias, conviene un backend
  compartido (Redis) para el contador.
- **HTTPS:** las plataformas sugeridas dan HTTPS automático. Usa siempre `https://`
  en `VITE_API_URL` y en `CORS_ORIGINS` en producción.
- **No subas secretos:** los `.env` reales nunca se suben a Git (están en
  `.gitignore`); en producción las variables se cargan en el panel de cada plataforma.
- **SSL de la base:** algunos proveedores de MySQL exigen conexión cifrada. Si la
  conexión falla por SSL, revisa la documentación del proveedor (suele bastar con
  añadir parámetros a la `DATABASE_URL`).
