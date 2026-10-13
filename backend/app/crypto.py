"""Verschlüsselung & Hashing.

- Geheimnisse, die das Backend im Klartext wieder braucht (KUSSS-Passwort, privater
  iCal-Link), werden mit Fernet (AES-128-CBC + HMAC-SHA256) verschlüsselt. Der Schlüssel
  liegt NUR in der Umgebung (STUDO_MASTER_KEY), nie in der Datenbank. Wer nur die DB
  stiehlt (Backup, Laptop-Diebstahl), hat damit nichts Brauchbares.
- Für die App-Anmeldung wird das Passwort zusätzlich mit scrypt gehasht, damit das
  Login lokal geprüft werden kann, ohne jedes Mal die JKU anzufragen.
"""
import hashlib
import hmac
import secrets

from cryptography.fernet import Fernet, InvalidToken

from . import config


class CryptoError(RuntimeError):
    pass


def _fernet() -> Fernet:
    if not config.MASTER_KEY:
        raise CryptoError(
            "STUDO_MASTER_KEY fehlt. Erzeuge einen Schlüssel mit "
            "`python -c \"from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())\"`"
        )
    return Fernet(config.MASTER_KEY.encode())


def encrypt(plaintext: str) -> str:
    return _fernet().encrypt(plaintext.encode()).decode()


def decrypt(token: str) -> str:
    try:
        return _fernet().decrypt(token.encode()).decode()
    except InvalidToken as e:
        raise CryptoError("Entschlüsselung fehlgeschlagen (falscher Master-Key?)") from e


def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    dk = hashlib.scrypt(password.encode(), salt=salt, n=2**15, r=8, p=1, maxmem=64 * 1024 * 1024)
    return f"scrypt${salt.hex()}${dk.hex()}"


def verify_password(password: str, stored: str) -> bool:
    try:
        _, salt_hex, dk_hex = stored.split("$")
    except ValueError:
        return False
    dk = hashlib.scrypt(password.encode(), salt=bytes.fromhex(salt_hex), n=2**15, r=8, p=1,
                        maxmem=64 * 1024 * 1024)
    return hmac.compare_digest(dk.hex(), dk_hex)


def new_token(nbytes: int = 32) -> str:
    return secrets.token_urlsafe(nbytes)


def sha256(value: str) -> str:
    return hashlib.sha256(value.encode()).hexdigest()
