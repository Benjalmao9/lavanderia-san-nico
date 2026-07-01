# ============================================================
#  Script para RESETEAR la contraseña del usuario ADMINISTRADOR.
#
#  Úsalo cuando olvidaste la contraseña del admin semilla y el login te da 401.
#  Busca el administrador por su nombre de usuario, valida la contraseña nueva
#  con las MISMAS reglas que la API (8-72 bytes, al menos una letra y un dígito),
#  la hashea con bcrypt y guarda SOLO ese cambio (no toca nada más del usuario).
#
#  CÓMO EJECUTARLO (en PowerShell, dentro de la carpeta del proyecto, con tu
#  MySQL encendido). Igual que crear_admin.py, las credenciales se pasan por
#  variables de entorno para NO dejar la contraseña escrita en el código:
#
#      $env:ADMIN_USUARIO="admin"
#      $env:ADMIN_NUEVA_CONTRASENA="MiNuevaClave123"
#      python resetear_admin.py
#
#   - ADMIN_USUARIO: nombre de usuario del admin a resetear (por defecto "admin").
#   - ADMIN_NUEVA_CONTRASENA: la contraseña nueva (obligatoria).
#
#  Si no recordás el nombre de usuario, el script te listará los administradores
#  existentes para que reintentes con el correcto.
# ============================================================

import os
import re

# SQLAlchemyError: para capturar fallos de base de datos y avisar con claridad.
from sqlalchemy.exc import SQLAlchemyError

# Sesión de base de datos, modelo de usuario y funciones de hashing del proyecto
# (las mismas que usa la API, así la contraseña queda en el formato esperado).
from database import SessionLocal
from models import Usuario
from seguridad import hashear_contrasena, verificar_contrasena


# ------------------------------------------------------------
#  Credenciales por variables de entorno (vía recomendada, sin hardcodear).
#  ADMIN_NUEVA_CONTRASENA arranca con un placeholder: si no lo cambiás, el
#  script se niega a continuar (no querés resetear a un valor de ejemplo).
# ------------------------------------------------------------
ADMIN_USUARIO = os.getenv("ADMIN_USUARIO", "admin")
ADMIN_NUEVA_CONTRASENA = os.getenv("ADMIN_NUEVA_CONTRASENA", "CAMBIA_ESTA_CONTRASENA")


def _validar_contrasena(contrasena: str) -> str | None:
    """Replica las reglas de la API (UsuarioCrear) para la contraseña.

    Como este script NO pasa por los esquemas de Pydantic, validamos a mano:
      - Entre 8 y 72 BYTES (UTF-8). Medimos en bytes porque bcrypt trunca a 72
        bytes, no a 72 caracteres (un acento o ñ ocupan 2 bytes).
      - Al menos una letra y un dígito (misma exigencia de complejidad mínima).
    Devuelve el mensaje de error si NO cumple, o None si es válida.
    """
    cantidad_bytes = len(contrasena.encode("utf-8"))
    if not (8 <= cantidad_bytes <= 72):
        return (
            "La contraseña nueva debe tener entre 8 y 72 bytes (UTF-8); "
            f"la actual tiene {cantidad_bytes}."
        )
    if not re.search(r"[A-Za-z]", contrasena) or not re.search(r"[0-9]", contrasena):
        return "La contraseña nueva debe incluir al menos una letra y un número."
    return None


def resetear_admin():
    # Abrimos una sesión de base de datos.
    db = SessionLocal()
    try:
        # 1) ¿Definiste la contraseña nueva? Si quedó el placeholder, paramos.
        if ADMIN_NUEVA_CONTRASENA == "CAMBIA_ESTA_CONTRASENA":
            print(
                "[ERROR] Definí la contraseña nueva en la variable de entorno "
                "ADMIN_NUEVA_CONTRASENA antes de ejecutar el script."
            )
            return

        # 2) Validamos la contraseña nueva con las mismas reglas que la API.
        error_validacion = _validar_contrasena(ADMIN_NUEVA_CONTRASENA)
        if error_validacion is not None:
            print(f"[ERROR] {error_validacion}")
            return

        # 3) Buscamos al usuario por su nombre de usuario.
        usuario = (
            db.query(Usuario).filter(Usuario.nombre_usuario == ADMIN_USUARIO).first()
        )

        # 3a) Si no existe, ayudamos: listamos los administradores que SÍ hay.
        if usuario is None:
            print(f"[ERROR] No existe un usuario con el nombre '{ADMIN_USUARIO}'.")
            admins = db.query(Usuario).filter(Usuario.rol == "administrador").all()
            if admins:
                nombres = ", ".join(a.nombre_usuario for a in admins)
                print(f"        Administradores existentes: {nombres}")
                print(
                    "        Reintentá poniendo ADMIN_USUARIO con uno de esos nombres."
                )
            else:
                print(
                    "        No hay ningún administrador en la base. "
                    "Creá uno con: python crear_admin.py"
                )
            return

        # 4) Confirmamos que sea un administrador (este script es solo para el admin).
        if usuario.rol != "administrador":
            print(
                f"[ERROR] El usuario '{ADMIN_USUARIO}' existe, pero su rol es "
                f"'{usuario.rol}', no 'administrador'. No lo reseteo con este script."
            )
            return

        # 5) Asignamos el NUEVO hash. La contraseña en texto plano nunca se guarda:
        #    solo persistimos su hash bcrypt en contrasena_hash.
        usuario.contrasena_hash = hashear_contrasena(ADMIN_NUEVA_CONTRASENA)
        db.commit()
        db.refresh(usuario)

        # 6) Confirmamos el cambio: la contraseña nueva debe validar contra el
        #    hash recién guardado (verificación de extremo a extremo).
        if verificar_contrasena(ADMIN_NUEVA_CONTRASENA, usuario.contrasena_hash):
            print(
                f"[OK] Contraseña del administrador '{usuario.nombre_usuario}' "
                f"(id {usuario.id}) actualizada correctamente. "
                "Ya podés iniciar sesión con la contraseña nueva."
            )
        else:
            # No debería ocurrir; si ocurre, hay algo raro con el hashing.
            print(
                "[ERROR] Se guardó el cambio pero la verificación falló. "
                "Revisá la configuración de hashing en seguridad.py."
            )

    except SQLAlchemyError as error:
        # Fallo de la base de datos: deshacemos para no dejar la sesión a medias.
        db.rollback()
        print(f"[ERROR] Error de base de datos al resetear la contraseña: {error}")
    except Exception as error:
        # Cualquier otro fallo inesperado.
        db.rollback()
        print(f"[ERROR] No se pudo resetear la contraseña: {error}")
    finally:
        # Cerramos siempre la sesión.
        db.close()


# Se ejecuta solo cuando corrés el archivo directamente (python resetear_admin.py).
if __name__ == "__main__":
    resetear_admin()
