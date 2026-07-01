# ============================================================
#  Script para crear el usuario ADMINISTRADOR semilla.
#
#  Se ejecuta UNA sola vez, a mano, para tener un primer administrador
#  con el que empezar a usar el sistema (aún no hay login). Hashea la
#  contraseña con bcrypt y guarda el usuario con rol 'administrador'.
#  Si ya existe un administrador, avisa y NO crea otro (no duplica).
#
#  CÓMO EJECUTARLO (en PowerShell, dentro de la carpeta del proyecto,
#  con tu MySQL encendido):
#
#      python crear_admin.py
#
#  Podés definir las credenciales de dos formas:
#   1) (RECOMENDADO) Por variables de entorno, sin tocar el archivo, así el
#      secreto NO queda hardcodeado en el código fuente:
#        $env:ADMIN_USUARIO="jefa"; $env:ADMIN_CONTRASENA="MiClaveSegura123"
#        python crear_admin.py
#      También podés definir ADMIN_NOMBRE_COMPLETO de la misma manera.
#   2) Como fallback, editando el valor por defecto de os.getenv(...) de abajo.
#      Sirve para una prueba rápida, pero evitá dejar la contraseña real
#      escrita en el archivo.
# ============================================================

import os

# Sesión de base de datos y modelo de usuario del propio proyecto.
from database import SessionLocal
from models import Usuario

# La función de hashing (la misma que usa la API).
from seguridad import hashear_contrasena


# ------------------------------------------------------------
#  Credenciales del administrador inicial.
#  Vía recomendada: definir las variables de entorno ADMIN_USUARIO /
#  ADMIN_CONTRASENA / ADMIN_NOMBRE_COMPLETO (ver encabezado). Los literales
#  de abajo son sólo un default de fallback si esas variables no están.
# ------------------------------------------------------------
ADMIN_USUARIO = os.getenv("ADMIN_USUARIO", "admin")
ADMIN_CONTRASENA = os.getenv("ADMIN_CONTRASENA", "CAMBIA_ESTA_CONTRASENA")
ADMIN_NOMBRE_COMPLETO = os.getenv("ADMIN_NOMBRE_COMPLETO", "Administrador del sistema")


def crear_admin():
    # Abrimos una sesión de base de datos.
    db = SessionLocal()
    try:
        # 1) ¿Ya existe ALGÚN administrador? Si sí, no creamos otro.
        admin_existente = db.query(Usuario).filter(Usuario.rol == "administrador").first()
        if admin_existente is not None:
            print(
                f"[AVISO] Ya existe un administrador: '{admin_existente.nombre_usuario}'. "
                "No se crea otro."
            )
            return

        # 2) ¿El nombre de usuario elegido ya está tomado (por cualquier rol)?
        nombre_tomado = (
            db.query(Usuario).filter(Usuario.nombre_usuario == ADMIN_USUARIO).first()
        )
        if nombre_tomado is not None:
            print(
                f"[ERROR] El nombre de usuario '{ADMIN_USUARIO}' ya está en uso. "
                "Elegí otro (editá ADMIN_USUARIO)."
            )
            return

        # 3) Aviso si dejaste la contraseña de ejemplo sin cambiar.
        if ADMIN_CONTRASENA == "CAMBIA_ESTA_CONTRASENA":
            print(
                "[ERROR] Todavía tenés la contraseña de ejemplo. Editá ADMIN_CONTRASENA "
                "en crear_admin.py (o usá la variable de entorno) antes de continuar."
            )
            return

        # 4) Validamos la longitud de la contraseña replicando las cotas que la
        #    API exige vía Pydantic (UsuarioCrear.contrasena: 8-72). Este script
        #    NO pasa por esos esquemas, así que sin esta verificación el admin
        #    (la cuenta más privilegiada) podría quedar con una clave demasiado
        #    corta o tan larga que bcrypt la trunca silenciosamente a 72 bytes.
        #    Medimos en BYTES UTF-8 porque bcrypt trunca a 72 bytes, no caracteres.
        cantidad_bytes = len(ADMIN_CONTRASENA.encode("utf-8"))
        if not (8 <= cantidad_bytes <= 72):
            print(
                "[ERROR] La contraseña del administrador debe tener entre 8 y 72 bytes "
                f"(UTF-8); la actual tiene {cantidad_bytes}. Elegí otra."
            )
            return

        # 5) Creamos el administrador, guardando SOLO el hash de la contraseña.
        admin = Usuario(
            nombre_usuario=ADMIN_USUARIO,
            contrasena_hash=hashear_contrasena(ADMIN_CONTRASENA),
            rol="administrador",
            nombre_completo=ADMIN_NOMBRE_COMPLETO,
        )
        db.add(admin)
        db.commit()
        db.refresh(admin)
        print(
            f"[OK] Administrador '{admin.nombre_usuario}' creado con id {admin.id}. "
            "La contraseña se guardó hasheada (no en texto plano)."
        )
    except Exception as error:
        # Ante cualquier fallo, deshacemos para no dejar la sesión a medias.
        db.rollback()
        print(f"[ERROR] No se pudo crear el administrador: {error}")
    finally:
        # Cerramos siempre la sesión.
        db.close()


# Esto hace que crear_admin() se ejecute SOLO cuando corrés el archivo
# directamente (python crear_admin.py), no si se importa desde otro lado.
if __name__ == "__main__":
    crear_admin()
