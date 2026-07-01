-- ============================================================
--  Script de creación de la base de datos de la lavandería
--  Para ejecutar en MySQL Workbench.
-- ============================================================

-- Creamos la base de datos solo si todavía no existe.
-- Usamos utf8mb4 para soportar tildes, ñ y emojis sin problemas.
CREATE DATABASE IF NOT EXISTS lavanderia
    CHARACTER SET utf8mb4
    COLLATE utf8mb4_unicode_ci;

-- A partir de aquí, todas las instrucciones se ejecutan
-- "dentro" de la base de datos lavanderia.
USE lavanderia;


-- ============================================================
--  Tabla: categorias
--  Sirve para clasificar los insumos (por ejemplo: limpieza,
--  cortesía). Es una tabla "padre": otros registros la referencian.
-- ============================================================
CREATE TABLE IF NOT EXISTS categorias (
    -- Identificador único de cada categoría. AUTO_INCREMENT hace
    -- que MySQL le asigne un número automáticamente (1, 2, 3...).
    id INT AUTO_INCREMENT PRIMARY KEY,

    -- Nombre de la categoría. NOT NULL = obligatorio.
    -- UNIQUE = no puede repetirse otra categoría con el mismo nombre.
    nombre VARCHAR(100) NOT NULL UNIQUE
) ENGINE=InnoDB;


-- ============================================================
--  Tabla: usuarios
--  Personas que usan el sistema (administradores y empleados).
--  La contraseña NUNCA se guarda en texto plano, solo su "hash"
--  (una versión cifrada de la que no se puede volver atrás).
-- ============================================================
CREATE TABLE IF NOT EXISTS usuarios (
    id INT AUTO_INCREMENT PRIMARY KEY,

    -- Nombre con el que la persona inicia sesión. Debe ser único.
    nombre_usuario VARCHAR(50) NOT NULL UNIQUE,

    -- Aquí se guarda la contraseña cifrada (hash), no la real.
    contrasena_hash VARCHAR(255) NOT NULL,

    -- Rol del usuario. Solo se permiten dos valores: 'administrador' o 'empleado'.
    rol VARCHAR(20) NOT NULL,

    -- Nombre y apellido de la persona (opcional).
    nombre_completo VARCHAR(150),

    -- Integridad del rol garantizada por la BD, no solo por la aplicación.
    -- MySQL 8.0.16+ hace cumplir este CHECK y rechaza cualquier rol que no sea
    -- 'administrador' o 'empleado'. Es defensa en profundidad: aunque algún día
    -- se inserte/actualice por fuera de la API (un script, una carga manual en
    -- MySQL), la base impide dejar un rol inválido que rompería los permisos.
    CONSTRAINT chk_usuarios_rol CHECK (rol IN ('administrador', 'empleado'))
) ENGINE=InnoDB;


-- ============================================================
--  Tabla: insumos
--  Productos que usa la lavandería (detergente, suavizante, etc.).
--  RELACIÓN: cada insumo pertenece a UNA categoría.
--  Por eso categoria_id es una clave foránea hacia categorias(id).
-- ============================================================
CREATE TABLE IF NOT EXISTS insumos (
    id INT AUTO_INCREMENT PRIMARY KEY,

    -- Nombre del insumo.
    nombre VARCHAR(150) NOT NULL,

    -- Categoría a la que pertenece este insumo.
    -- Puede ser NULL si todavía no se le asigna una categoría.
    categoria_id INT,

    -- Cantidad disponible en stock. Por defecto arranca en 0.
    cantidad INT NOT NULL DEFAULT 0,

    -- Stock mínimo deseado: si la cantidad baja de este número,
    -- conviene reponer. Por defecto 0.
    stock_minimo INT NOT NULL DEFAULT 0,

    -- Definición de la clave foránea (relación con categorias).
    -- ON DELETE SET NULL: si se borra una categoría, los insumos
    --   no se borran; su categoria_id simplemente queda en NULL.
    -- ON UPDATE CASCADE: si cambia el id de la categoría,
    --   se actualiza automáticamente aquí.
    CONSTRAINT fk_insumos_categoria
        FOREIGN KEY (categoria_id)
        REFERENCES categorias(id)
        ON DELETE SET NULL
        ON UPDATE CASCADE
) ENGINE=InnoDB;


-- ============================================================
--  Tabla: pedidos
--  Cada pedido de un cliente que trae ropa a lavar.
--  RELACIÓN: cada pedido fue registrado por UN usuario
--  (el empleado o administrador que lo atendió).
-- ============================================================
CREATE TABLE IF NOT EXISTS pedidos (
    id INT AUTO_INCREMENT PRIMARY KEY,

    -- Nombre del cliente.
    cliente VARCHAR(150) NOT NULL,

    -- Teléfono de contacto (opcional).
    telefono VARCHAR(30),

    -- Peso de la ropa en kilos. DECIMAL permite decimales (ej: 3.50).
    -- (6,2) significa: hasta 6 dígitos en total, 2 de ellos decimales.
    kilos DECIMAL(6,2) NOT NULL,

    -- Precio cobrado por cada kilo.
    precio_por_kilo DECIMAL(10,2) NOT NULL,

    -- Total a pagar (normalmente kilos * precio_por_kilo).
    total DECIMAL(10,2) NOT NULL,

    -- Estado del pedido. Por defecto arranca como 'recibido'.
    -- Otros valores podrían ser 'en proceso', 'listo', 'entregado'.
    estado VARCHAR(30) NOT NULL DEFAULT 'recibido',

    -- Momento en que se recibió el pedido.
    fecha_recepcion DATETIME,

    -- Momento de la entrega. Puede ser NULL porque al crear el
    -- pedido todavía no se ha entregado.
    fecha_entrega DATETIME,

    -- Usuario que registró el pedido.
    usuario_id INT,

    -- Notas / observaciones de texto libre sobre el pedido (opcional, hasta 500
    -- caracteres). Puede quedar en NULL si no hay observaciones.
    notas VARCHAR(500),

    -- Clave foránea hacia usuarios.
    -- ON DELETE RESTRICT: no deja borrar un usuario si tiene pedidos
    --   asociados (así no se pierde el historial de quién atendió).
    -- ON UPDATE CASCADE: si cambia el id del usuario, se actualiza aquí.
    CONSTRAINT fk_pedidos_usuario
        FOREIGN KEY (usuario_id)
        REFERENCES usuarios(id)
        ON DELETE RESTRICT
        ON UPDATE CASCADE,

    -- Integridad del estado garantizada por la BD (defensa en profundidad, en
    -- paralelo a chk_usuarios_rol). MySQL 8.0.16+ rechaza cualquier estado que no
    -- sea uno de los cuatro válidos, aunque se inserte/actualice por fuera de la API.
    CONSTRAINT chk_pedidos_estado
        CHECK (estado IN ('recibido', 'en proceso', 'listo', 'entregado'))
) ENGINE=InnoDB;


-- ============================================================
--  Tabla: auditoria
--  Bitácora de acciones importantes del sistema: QUIÉN hizo QUÉ, sobre
--  QUÉ objeto y CUÁNDO. Sirve para rastrear la actividad y para investigar
--  incidentes de seguridad. Es un registro de SOLO AGREGADO: se inserta una
--  fila por acción y normalmente no se edita ni se borra.
--  SEGURIDAD: en esta tabla NUNCA se guardan contraseñas ni hashes.
-- ============================================================
CREATE TABLE IF NOT EXISTS auditoria (
    id INT AUTO_INCREMENT PRIMARY KEY,

    -- Usuario que realizó la acción. Puede ser NULL para acciones sin usuario
    -- identificado (por ejemplo, un intento de login fallido).
    usuario_id INT,

    -- Qué acción se hizo (ej: 'crear_pedido', 'eliminar_insumo',
    -- 'login_exitoso', 'login_fallido').
    accion VARCHAR(50) NOT NULL,

    -- Sobre qué tipo de objeto (ej: 'pedido', 'insumo', 'usuario').
    -- NULL si la acción no aplica a una entidad concreta.
    entidad VARCHAR(50),

    -- Id del objeto afectado (ej: el id del pedido creado). NULL si no aplica.
    entidad_id INT,

    -- Información adicional en texto (ej: el nombre de usuario intentado en un
    -- login fallido). NUNCA contraseñas ni hashes.
    detalle VARCHAR(255),

    -- Momento exacto de la acción.
    fecha DATETIME NOT NULL,

    -- Relación con usuarios.
    -- ON DELETE SET NULL: si se borra el usuario, NO borramos su historial de
    --   auditoría (la bitácora debe preservarse); solo desvinculamos la fila
    --   dejando usuario_id en NULL.
    -- ON UPDATE CASCADE: si cambia el id del usuario, se actualiza aquí.
    CONSTRAINT fk_auditoria_usuario
        FOREIGN KEY (usuario_id)
        REFERENCES usuarios(id)
        ON DELETE SET NULL
        ON UPDATE CASCADE
) ENGINE=InnoDB;


-- ============================================================
--  Datos iniciales (semilla)
--  Cargamos las dos categorías básicas con las que arranca el sistema.
-- ============================================================
INSERT INTO categorias (nombre) VALUES
    ('limpieza'),
    ('cortesía');
