"""Gerçek hesap verilerini şifreler. Anahtar: OKX'te belirlenen şifre (OKX_API_PASSPHRASE).

Uygulama aynı şifreyle tarayıcıda çözer (PBKDF2-SHA256 + AES-GCM, WebCrypto ile uyumlu).
Şifre tanımlı değilse veri şifrelenmeden yazılır.
"""
import base64
import hashlib
import json
import os
import zlib

ITER = 150_000


def password():
    return os.environ.get("OKX_API_PASSPHRASE") or ""


def _key(pw, salt):
    return hashlib.pbkdf2_hmac("sha256", pw.encode(), salt, ITER, 32)


_SEAL = {}  # oturum boyunca aynı tuz ve anahtar: PBKDF2 (150 bin tur) her kayıtta yeniden hesaplanmaz


def seal(obj, pw=None, z=False):
    """z: veri şifrelenmeden önce sıkıştırılır (zlib). Şifreli metin sıkışmadığı için uygulamanın indirdiği özet ~4 kat
    küçülür. Yalnız uygulamanın okuduğu özet için kullanılır; botun kendi kaydı (state.json) eski biçimde kalır
    (eski bot koduna dönülürse de okunabilsin)."""
    pw = pw if pw is not None else password()
    if not pw:
        return obj
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM
    if pw not in _SEAL:
        salt = os.urandom(16)
        _SEAL[pw] = (salt, _key(pw, salt))
    salt, key = _SEAL[pw]
    iv = os.urandom(12)  # her kayıtta yeni IV (AES-GCM güvenliği için şart)
    raw = json.dumps(obj, ensure_ascii=False, separators=(",", ":")).encode()
    if z:
        raw = zlib.compress(raw, 6)
    ct = AESGCM(key).encrypt(iv, raw, None)
    b = lambda x: base64.b64encode(x).decode()
    box = {"enc": 1, "iter": ITER, "salt": b(salt), "iv": b(iv), "ct": b(ct)}
    if z:
        box["z"] = 1
    return box


def is_sealed(x):
    return isinstance(x, dict) and x.get("enc") == 1 and "ct" in x


_OPEN = {}


def unseal(box, pw=None):
    """Şifreli değilse olduğu gibi döner; çözülemezse ValueError."""
    if not is_sealed(box):
        return box
    pw = pw if pw is not None else password()
    if not pw:
        raise ValueError("Şifre yok")
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM
    d = lambda k: base64.b64decode(box[k])
    ck = (pw, box["salt"], box.get("iter", ITER))
    if ck not in _OPEN:  # aynı tuzla anahtar bir kez türetilir (her tur 150 bin PBKDF2 turu yapılmasın)
        _OPEN[ck] = hashlib.pbkdf2_hmac("sha256", pw.encode(), d("salt"), box.get("iter", ITER), 32)
    try:
        raw = AESGCM(_OPEN[ck]).decrypt(d("iv"), d("ct"), None)
    except Exception:
        raise ValueError("Şifre uyuşmuyor")
    if box.get("z"):
        raw = zlib.decompress(raw)
    return json.loads(raw)
