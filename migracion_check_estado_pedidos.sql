-- ============================================================
--  MIGRACIÓN: agrega el CHECK de 'estado' a la tabla 'pedidos' YA EXISTENTE.
--
--  Restringe pedidos.estado a los cuatro estados válidos, en la BD misma (defensa
--  en profundidad, en paralelo a chk_usuarios_rol). MySQL 8.0.16+ lo hace cumplir.
--
--  Ejecutalo UNA vez en MySQL Workbench. Si la restricción YA existe, MySQL avisa
--  "Duplicate check constraint name 'chk_pedidos_estado'": en ese caso ignoralo
--  (ya está aplicada). Es el mismo criterio que migracion_auditoria.sql.
--
--  OJO: si alguna fila tuviera hoy un estado distinto de los cuatro válidos, el
--  ALTER fallará hasta que corrijas ese dato. Para revisarlo:
--    SELECT DISTINCT estado FROM pedidos;
-- ============================================================

USE lavanderia;

ALTER TABLE pedidos
    ADD CONSTRAINT chk_pedidos_estado
    CHECK (estado IN ('recibido', 'en proceso', 'listo', 'entregado'));
