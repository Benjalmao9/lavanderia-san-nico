-- ============================================================
--  MIGRACIÓN: agrega la columna 'notas' a la tabla 'pedidos' YA EXISTENTE.
--
--  Ejecutala UNA vez en MySQL Workbench. Las filas existentes quedan con
--  notas = NULL. Si la columna YA existe, MySQL avisa "Duplicate column name
--  'notas'": en ese caso ignoralo (ya está aplicada).
-- ============================================================

USE lavanderia;

ALTER TABLE pedidos
    ADD COLUMN notas VARCHAR(500) NULL;
