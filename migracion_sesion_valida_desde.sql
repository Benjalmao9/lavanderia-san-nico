-- ============================================================
--  MIGRACIÓN: agrega la columna 'sesion_valida_desde' a la tabla 'usuarios'
--  YA EXISTENTE. Sirve para poder forzar el cierre de sesión de un usuario en
--  todos sus dispositivos (ver POST /usuarios/{id}/cerrar-sesiones).
--
--  DATETIME(6) (con microsegundos), NO DATETIME a secas: sin la fracción de
--  segundo, si un login y un cierre de sesión caen dentro del MISMO segundo de
--  reloj, un token emitido en realidad ANTES del cierre podría no rechazarse
--  (colisión de precisión). Con microsegundos completos, la comparación en
--  dependencias.py queda exacta de este lado.
--
--  Ejecutala UNA vez en MySQL Workbench. Las filas existentes quedan con
--  sesion_valida_desde = NULL (nadie tiene sesiones forzadamente cerradas). Si
--  la columna YA existe, MySQL avisa "Duplicate column name
--  'sesion_valida_desde'": en ese caso ignoralo (ya está aplicada).
-- ============================================================

USE lavanderia;

ALTER TABLE usuarios
    ADD COLUMN sesion_valida_desde DATETIME(6) NULL;
