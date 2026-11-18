"""Gerçek hesap verilerini şifreler. Anahtar: OKX'te belirlenen şifre (OKX_API_PASSPHRASE).

Uygulama aynı şifreyle tarayıcıda çözer (PBKDF2-SHA256 + AES-GCM, WebCrypto ile uyumlu).
Şifre tanımlı değilse veri şifrelenmeden yazılır.
"""
import base64
import hashlib
import json
import os

ITER = 150_000


def password():
    return os.environ.get("OKX_API_PASSPHRASE") or ""


def _key(pw, salt):
    return hashlib.pbkdf2_hmac("sha256", pw.encode(), salt, ITER, 32)


def seal(obj, pw=None):
    pw = pw if pw is not None else password()
    if not pw:
        return obj
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM
    salt, iv = os.urandom(16), os.urandom(12)
    ct = AESGCM(_key(pw, salt)).encrypt(iv, json.dumps(obj, ensure_ascii=False, separators=(",", ":")).encode(), None)
    b = lambda x: base64.b64encode(x).decode()
    return {"enc": 1, "iter": ITER, "salt": b(salt), "iv": b(iv), "ct": b(ct)}


def is_sealed(x):
    return isinstance(x, dict) and x.get("enc") == 1 and "ct" in x


def unseal(box, pw=None):
    """Şifreli değilse olduğu gibi döner; çözülemezse ValueError."""
    if not is_sealed(box):
        return box
    pw = pw if pw is not None else password()
    if not pw:
        raise ValueError("Şifre yok")
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM
    d = lambda k: base64.b64decode(box[k])
    try:
        raw = AESGCM(hashlib.pbkdf2_hmac("sha256", pw.encode(), d("salt"), box.get("iter", ITER), 32)).decrypt(d("iv"), d("ct"), None)
    except Exception:
        raise ValueError("Şifre uyuşmuyor")
    return json.loads(raw)
