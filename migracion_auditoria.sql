-- ============================================================
--  MIGRACIÓN para una base de datos 'lavanderia' YA EXISTENTE (con datos).
--
--  El schema.sql usa CREATE TABLE IF NOT EXISTS, así que sobre una base que
--  ya tiene la tabla 'usuarios' NO le agrega el CHECK del rol. Este script
--  aplica solo los cambios nuevos del paso de auditoría + endurecimiento,
--  sin tocar tus datos. Ejecutalo una vez en MySQL Workbench.
-- ============================================================

USE lavanderia;

-- 1) Tabla de auditoría (bitácora de acciones). Si ya existe, no hace nada.
CREATE TABLE IF NOT EXISTS auditoria (
    id INT AUTO_INCREMENT PRIMARY KEY,
    usuario_id INT,
    accion VARCHAR(50) NOT NULL,
    entidad VARCHAR(50),
    entidad_id INT,
    detalle VARCHAR(255),
    fecha DATETIME NOT NULL,
    CONSTRAINT fk_auditoria_usuario
        FOREIGN KEY (usuario_id)
        REFERENCES usuarios(id)
        ON DELETE SET NULL
        ON UPDATE CASCADE
) ENGINE=InnoDB;

-- 2) Restricción de integridad del rol (MySQL 8.0.16+).
--    OJO: si tu tabla 'usuarios' tuviera hoy algún rol distinto de
--    'administrador'/'empleado', este ALTER fallará hasta que lo corrijas.
--    Si la restricción ya existe, MySQL avisará que el nombre está duplicado:
--    en ese caso, ignoralo (ya está aplicada).
ALTER TABLE usuarios
    ADD CONSTRAINT chk_usuarios_rol CHECK (rol IN ('administrador', 'empleado'));
