"""Memecoin masası (GERÇEK): deneme masasının al/sat kararlarını MEME sıcak cüzdanında gerçek parayla uygular.

Cüzdan: Trust Wallet'ta ayrı açılan MEME cüzdanı. Anahtar GitHub gizli ayarından gelir (MEME_SOL_SEED: 12 kelime
ya da MEME_SOL_KEY: özel anahtar); hiçbir yere yazılmaz, kaydedilmez. Kelimelerden üretilen adres ayarlardaki
meme.wallet adresiyle birebir tutmazsa masa HİÇBİR işlem yapmaz (yanlışlıkla KASA'nın kelimeleri girilse bile).

Alım-satım Jupiter Ultra üzerinden (SOL ↔ token). Kurallar:
  - Her girişte cüzdandaki boş SOL'un %size_pct'i; ücretler için en az 0.02 SOL hep bırakılır
  - Fiyat etkisi %max_slip'i aşan alım reddedilir (sebebiyle kaydedilir); satışta çıkış önceliklidir
  - Toplam zarar max_loss $'a ulaşırsa masa durur (açık tokenler satılır)
  - Deneme masası bir tokeni satınca gerçek masa da satar; satılamayan token her turda yeniden denenir
"""
import base64
import hashlib
import hmac
import copy
import json
import os
import queue
import threading
import time
import unicodedata
import urllib.request

from cryptography.hazmat.primitives import serialization

from . import config
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

RPC = "https://api.mainnet-beta.solana.com"
JUP = "https://lite-api.jup.ag/ultra/v1"
SOL = "So11111111111111111111111111111111111111112"
TOKEN_PROGS = ("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA", "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb")
RESERVE = 0.02  # SOL; işlem ücreti ve token hesabı kirası için hep kalır
DEFAULT = {"real": False, "wallet": "", "max_loss": 10.0, "max_slip": 2.0, "real_reset": 0}
TITLE = "Memecoin"
SYNC = 15
_A = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"
_Q = queue.Queue()
_LOCK = threading.Lock()
_W = {"t": None, "R": None, "cfg": {}, "key": None}


def b58e(b):
    n = int.from_bytes(b, "big")
    s = ""
    while n:
        n, r = divmod(n, 58)
        s = _A[r] + s
    return "1" * (len(b) - len(b.lstrip(b"\0"))) + s


def b58d(s):
    n = 0
    for c in s:
        n = n * 58 + _A.index(c)
    b = n.to_bytes((n.bit_length() + 7) // 8, "big")
    return b"\0" * (len(s) - len(s.lstrip("1"))) + b


def _pub(k):
    return Ed25519PrivateKey.from_private_bytes(k).public_key().public_bytes(serialization.Encoding.Raw, serialization.PublicFormat.Raw)


def _slip10(seed, path):
    i = hmac.new(b"ed25519 seed", seed, hashlib.sha512).digest()
    k, c = i[:32], i[32:]
    for x in path:
        i = hmac.new(c, b"\0" + k + (x | 0x80000000).to_bytes(4, "big"), hashlib.sha512).digest()
        k, c = i[:32], i[32:]
    return k


def load_key(want):
    """Gizli ayardan anahtarı bulur; adres `want` ile tutmazsa None. (anahtar, adres, açıklama) döner."""
    raw = (os.environ.get("MEME_SOL_KEY") or "").strip()
    words = " ".join((os.environ.get("MEME_SOL_SEED") or "").lower().split())
    cands = []
    if raw:
        try:
            b = bytes(json.loads(raw)) if raw.startswith("[") else bytes.fromhex(raw) if len(raw) in (64, 128) else b58d(raw)
            cands.append((b[:32], "özel anahtar"))
        except Exception:
            pass
    if words:
        seed = hashlib.pbkdf2_hmac("sha512", unicodedata.normalize("NFKD", words).encode(), b"mnemonic", 2048)
        for p in ((44, 501, 0, 0), (44, 501, 0), (44, 501)):
            cands.append((_slip10(seed, p), "12 kelime m/" + "'/".join(map(str, p)) + "'"))
    if not cands:
        return None, "", "gizli ayar yok (MEME_SOL_SEED)"
    for k, how in cands:
        a = b58e(_pub(k))
        if want and a == want:
            return k, a, how
    return None, "", "cüzdan adresi tutmadı; işlem yapılmaz (girilen kelimeler MEME cüzdanının mı?)"


def _post(url, body):
    r = urllib.request.Request(url, data=json.dumps(body).encode(), headers={"Content-Type": "application/json", "User-Agent": "masal/1.0"})
    with urllib.request.urlopen(r, timeout=20) as f:
        return json.load(f)


def _get(url):
    r = urllib.request.Request(url, headers={"User-Agent": "masal/1.0", "Accept": "application/json"})
    with urllib.request.urlopen(r, timeout=20) as f:
        return json.load(f)


def _rpc(method, params):
    d = _post(RPC, {"jsonrpc": "2.0", "id": 1, "method": method, "params": params})
    if "error" in d:
        raise RuntimeError(f"RPC {method}: {d['error'].get('message')}")
    return d["result"]


def _cu16(b, i):
    n = s = 0
    while True:
        x = b[i]
        i += 1
        n |= (x & 0x7F) << s
        s += 7
        if not x & 0x80:
            return n, i


def sign_tx(tx_b64, key):
    """Jupiter'in verdiği imzasız işlemi MEME anahtarıyla imzalar (yalnız kendi imza yerine yazar)."""
    tx = bytearray(base64.b64decode(tx_b64))
    nsig, i = _cu16(tx, 0)
    msg = bytes(tx[i + 64 * nsig:])
    j = 1 if msg[0] & 0x80 else 0  # v0 iletisi sürüm baytıyla başlar
    j += 3  # başlık
    nkeys, j = _cu16(msg, j)
    keys = [msg[j + 32 * x: j + 32 * x + 32] for x in range(nkeys)]
    me = _pub(key)
    if me not in keys[:nsig]:
        raise RuntimeError("işlem bu cüzdan için değil; imzalanmadı")
    pos = keys.index(me)
    tx[i + 64 * pos: i + 64 * pos + 64] = Ed25519PrivateKey.from_private_bytes(key).sign(msg)
    return base64.b64encode(bytes(tx)).decode()


def _swap(key, addr, inp, out, amount):
    o = _get(f"{JUP}/order?inputMint={inp}&outputMint={out}&amount={int(amount)}&taker={addr}")
    if not o.get("transaction"):
        raise RuntimeError(o.get("errorMessage") or o.get("error") or "Jupiter işlem vermedi")
    return o


def _execute(key, o):
    body = {"signedTransaction": sign_tx(o["transaction"], key), "requestId": o["requestId"]}
    for i in range(3):
        try:
            r = _post(f"{JUP}/execute", body)
            break
        except Exception:
            # Yanıt gelmedi: işlem zincire gitmiş olabilir. Aynı imzalı işlem yeniden sorulur (aynı imza zincirde iki kez
            # gerçekleşemez); böylece alınan/satılan token "olmadı" sanılıp kayıtsız kalmaz.
            if i == 2:
                raise
            time.sleep(2)
    if r.get("status") != "Success":
        raise RuntimeError(f"işlem başarısız: {r.get('error') or r.get('code') or r}"[:160])
    return r


def _holdings(addr):
    out = {}
    for prog in TOKEN_PROGS:
        for a in _rpc("getTokenAccountsByOwner", [addr, {"programId": prog}, {"encoding": "jsonParsed", "commitment": "confirmed"}])["value"]:
            info = a["account"]["data"]["parsed"]["info"]
            t = info["tokenAmount"]
            if int(t["amount"]) > 0:
                out[info["mint"]] = {"raw": int(t["amount"]), "dec": int(t["decimals"]), "ui": float(t["uiAmount"] or 0)}
    return out


def _cu16e(n):
    out = b""
    while True:
        b = n & 0x7F
        n >>= 7
        out += bytes([b | (0x80 if n else 0)])
        if not n:
            return out


def close_empty(key, addr):
    """Boşalan token hesaplarını kapatır; her birinin kirası (~0.002 SOL) cüzdana geri döner."""
    me = _pub(key)
    got = 0
    for prog in TOKEN_PROGS:
        accs = [a["pubkey"] for a in _rpc("getTokenAccountsByOwner", [addr, {"programId": prog}, {"encoding": "jsonParsed", "commitment": "confirmed"}])["value"]
                if int(a["account"]["data"]["parsed"]["info"]["tokenAmount"]["amount"]) == 0]
        for i in range(0, len(accs), 8):
            part = accs[i:i + 8]
            keys = [me] + [b58d(a) for a in part] + [b58d(prog)]
            bh = b58d(_rpc("getLatestBlockhash", [{"commitment": "finalized"}])["value"]["blockhash"])
            pi = len(keys) - 1
            ins = b"".join(bytes([pi]) + _cu16e(3) + bytes([j + 1, 0, 0]) + _cu16e(1) + bytes([9]) for j in range(len(part)))
            msg = bytes([1, 0, 1]) + _cu16e(len(keys)) + b"".join(keys) + bh + _cu16e(len(part)) + ins
            tx = _cu16e(1) + Ed25519PrivateKey.from_private_bytes(key).sign(msg) + msg
            try:
                _rpc("sendTransaction", [base64.b64encode(tx).decode(), {"encoding": "base64"}])
                got += len(part)
            except Exception as e:
                print("Token hesabı kapatılamadı:", str(e)[:120])
    return got


def _sol(addr):
    return _rpc("getBalance", [addr, {"commitment": "confirmed"}])["value"] / 1e9


def _solpx():
    d = _get("https://www.okx.com/api/v5/market/ticker?instId=SOL-USDT")
    return float(d["data"][0]["last"])


def _jup_prices(mints):
    """DexScreener'da olmayan tokenler için yedek fiyat (Jupiter)."""
    if not mints:
        return {}
    try:
        d = _get("https://lite-api.jup.ag/price/v3?ids=" + ",".join(mints))
        return {m: float(v.get("usdPrice") or 0) for m, v in (d or {}).items() if v}
    except Exception:
        return {}


def _new(cfg):
    return {"addr": "", "how": "", "sol": 0.0, "solpx": 0.0, "value": 0.0, "start": 0.0, "pos": {}, "trades": [], "log": [],
            "equity": [], "dead": "", "err": "", "sync": 0, "reset": cfg.get("real_reset", 0), "on": False}


def _note(R, kind, text):
    print("[" + __name__.split(".")[-1] + "]", text)  # günlükte izlemek için (anahtar/tutar dışı bilgi)
    R["log"].append([int(time.time() * 1000), kind, text])
    if kind in ("buy", "exit") or text.startswith(("MASA DURDU", "Günlük zarar")):
        R.setdefault("out", []).append([kind, text])  # telefona bildirim (ana turda gönderilir)
    R["log"] = R["log"][-80:]


def _value(R, prices):
    v = R["sol"] * R["solpx"]
    for m, p in R["pos"].items():
        px = prices.get(m) or p.get("px") or 0
        p["px"] = px
        p["val"] = round(p["ui"] * px, 4) if p.get("ui") and px else round(p.get("cost", 0), 4)
        v += p["val"]
    return v


def _sell(key, R, m, reason, cfg, frac=1.0):
    p = R["pos"][m]
    frac = 1.0 if not frac or frac >= 0.999 else max(0.01, float(frac))
    try:
        h = _holdings(R["addr"]).get(m)
    except Exception:
        h = {"raw": p["raw"]} if p.get("raw") else None
    if not h:
        if time.time() * 1000 - p["ts"] < 120000 or p.get("raw"):
            raise RuntimeError("token cüzdanda henüz görünmüyor; yeniden denenecek")
        del R["pos"][m]
        _note(R, "info", f"{p['sym']} cüzdanda yok; kayıttan çıkarıldı")
        return
    if frac < 1 and p.get("val") and p["val"] * (1 - frac) < 1:
        frac = 1.0  # kalan 1 $'ın altında kalacaksa hepsi satılır (küçük artık satılamaz)
    amt = int(h["raw"]) if frac >= 1 else int(int(h["raw"]) * frac)
    if amt <= 0:
        return
    o = _swap(key, R["addr"], m, SOL, amt)
    r = _execute(key, o)
    got = int(r.get("outputAmountResult") or o.get("outAmount") or 0) / 1e9
    usd = got * R["solpx"]
    cost = p["cost"] * frac
    pnl = usd - cost
    R["trades"].append({"ts": int(time.time() * 1000), "sym": p["sym"], "mint": m, "side": "SAT", "usd": round(usd, 2),
                        "pnl": round(pnl, 2), "pct": round(pnl / cost * 100, 1) if cost else 0, "reason": reason,
                        "sig": r.get("signature"), "real": True})
    R["trades"] = R["trades"][-300:]
    if frac < 1:  # kademeli kâr al: kalan token tutulmaya devam eder
        p["cost"] -= cost
        p["sol_in"] = p.get("sol_in", 0) * (1 - frac)
        p["raw"] = int(h["raw"]) - amt
        p["part"] = True
        p["ui"] = p.get("ui", 0) * (1 - frac)
        p["val"] = p.get("val", 0) * (1 - frac)
        _note(R, "exit", f"GERÇEK SAT %{frac * 100:.0f} {p['sym']} {got:.4f} SOL (${usd:.2f}) · {'+' if pnl >= 0 else ''}{pnl:.2f}$ · {reason}")
        return
    try:
        time.sleep(2)
        close_empty(key, R["addr"])  # boşalan token hesabının kirası geri alınır
    except Exception:
        pass
    _note(R, "exit", f"GERÇEK SAT {p['sym']} {got:.4f} SOL (${usd:.2f}) · {'+' if pnl >= 0 else ''}{pnl:.2f}$ · {reason}")
    del R["pos"][m]


def _buy(key, R, ev, cfg):
    _, m, sym, why = ev[:4]
    bad = ("masa durdu" if R["dead"] else "zaten var" if m in R["pos"] else None)
    free = R["sol"] - RESERVE
    amt = free * cfg["size_pct"] / 100
    if not bad and amt * R["solpx"] < 1:
        bad = f"boş SOL yetersiz ({max(0, free):.3f} SOL)"
    if not bad and len(R["pos"]) >= cfg["max_pos"]:
        bad = f"en fazla {cfg['max_pos']} token"
    if bad:
        _note(R, "risk", f"GERÇEK ENGEL {sym}: {bad}")
        return
    o = _swap(key, R["addr"], SOL, m, amt * 1e9)
    imp = abs(float(o.get("priceImpactPct") or 0)) * 100
    if imp > cfg["max_slip"]:
        _note(R, "risk", f"GERÇEK ENGEL {sym}: fiyat etkisi %{imp:.1f}, sınır %{cfg['max_slip']:g}")
        return
    r = _execute(key, o)
    raw = int(r.get("outputAmountResult") or o.get("outAmount") or 0)
    R["pos"][m] = {"sym": sym, "ts": int(time.time() * 1000), "sol_in": amt, "cost": amt * R["solpx"], "raw": raw,
                   "ui": 0.0, "px": 0.0, "val": 0.0, "why": why}
    R["sol"] -= amt
    _note(R, "buy", f"GERÇEK AL {sym} {amt:.4f} SOL (${amt * R['solpx']:.2f}) · etki %{imp:.1f} · {why}")


def _sync(R, cfg, prices, held_paper, key):
    try:
        R["solpx"] = _solpx()
    except Exception:
        if not R.get("solpx"):
            raise  # SOL fiyatı hiç okunamadıysa değer hesaplanamaz; okunmuşsa son fiyatla devam (satışlar beklemesin)
    R["sol"] = _sol(R["addr"])
    h = _holdings(R["addr"])
    for m, p in list(R["pos"].items()):
        if m in h:
            if p.get("raw") and h[m]["raw"] < p["raw"] * 0.9 and h[m]["raw"] > 0:
                # cüzdanda beklenenden az token: kısmi satış borsada gerçekleşmiş (kayda geçmeden yeniden başladı ya da yanıt gelmedi)
                k = h[m]["raw"] / p["raw"]
                p["cost"] *= k
                p["sol_in"] = p.get("sol_in", 0) * k
                p["part"] = True
                p.pop("tp_due", None)
            p["ui"], p["raw"] = h[m]["ui"], h[m]["raw"]
        elif p.get("ui") or time.time() * 1000 - p["ts"] > 600000:
            _note(R, "info", f"{p['sym']} artık cüzdanda yok; kayıttan çıkarıldı")
            del R["pos"][m]  # görülmüştü ve artık yok ya da 10 dk'dır hiç görünmedi
    for m in held_paper:  # cüzdanda olup kayıtta olmayan (ör. yanıt gelmeden yeniden başladı): sahiplen
        if m in h and m not in R["pos"] and cfg.get("real"):
            px = prices.get(m, 0)
            R["pos"][m] = {"sym": m[:4] + "…", "ts": int(time.time() * 1000), "sol_in": 0, "cost": h[m]["ui"] * px,
                           "raw": h[m]["raw"], "ui": h[m]["ui"], "px": px, "val": 0.0, "why": "cüzdanda bulundu"}
            _note(R, "info", f"{m[:6]}… tokeni cüzdanda bulundu; masa yönetimine alındı")
    for m, p in list(R["pos"].items()):  # deneme masası çalışmasa bile en uzun tutma süresi aşılırsa satılır
        if time.time() * 1000 - p["ts"] > cfg.get("max_hold_h", 4) * 3600_000 + 600_000:
            p["closing"] = "süre doldu (yedek)"
            held_paper = set(held_paper) - {m}
    miss = [m for m in R["pos"] if not prices.get(m)]
    if miss:
        prices = {**prices, **_jup_prices(miss)}
    v = _value(R, prices)
    # yedek çıkış: deneme masası ya da DexScreener çalışmasa da zarar kes / kâr al kendi fiyatıyla uygulanır
    for m, p in list(R["pos"].items()):
        if p.get("ui") and p.get("val") and p.get("cost") and time.time() * 1000 - p["ts"] > 60000:
            g = (p["val"] / p["cost"] - 1) * 100
            if g <= -(cfg.get("sl_pct", 15) + 5) or (g >= cfg.get("tp_pct", 100) + 20 and not p.get("part")):
                p["closing"] = f"{'zarar kes' if g < 0 else 'kâr al'} (yedek, %{g:+.0f})"
                held_paper = set(held_paper) - {m}
    R["value"] = round(v, 2)
    if not R["start"] and v > 0:
        R["start"] = round(v, 2)
        _note(R, "info", f"MEME cüzdanı bağlandı ({R['how']}); başlangıç değeri ${v:.2f}")
    for m, p in list(R["pos"].items()):  # yarım kalan kısmi kâr al
        if p.get("tp_due") and not p.get("closing") and not p.get("part"):
            try:
                _sell(key, R, m, "kâr al (yeniden deneme)", cfg, p["tp_due"])
                p.pop("tp_due", None)
            except Exception as e:
                R["err"] = f"{p['sym']} kısmi satış: {e}"[:160]
    # deneme masasının tutmadığı ama gerçekte kalan token: satış yeniden denenir
    for m in list(R["pos"]):
        if (m not in held_paper or R["pos"][m].get("closing")) and time.time() * 1000 - R["pos"][m]["ts"] > 60000:
            try:
                _sell(key, R, m, R["pos"][m].get("closing") or "deneme masası sattı", cfg)
            except Exception as e:
                R["err"] = f"{R['pos'].get(m, {}).get('sym', m[:4])} satılamadı: {e}"[:160]
    if R["start"] and not R["dead"] and v - R["start"] <= -abs(cfg["max_loss"]):
        R["dead"] = f"toplam zarar {cfg['max_loss']:g} $ sınırına ulaştı"
        _note(R, "risk", f"MASA DURDU: {R['dead']}. Açık tokenler satılıyor")
        for m in list(R["pos"]):
            try:
                _sell(key, R, m, "toplam zarar sınırı", cfg)
            except Exception as e:
                R["err"] = str(e)[:160]
    if not R["equity"] or time.time() * 1000 - R["equity"][-1][0] >= 15 * 60000:
        R["equity"].append([int(time.time() * 1000), round(R["value"], 2)])
        R["equity"] = R["equity"][-700:]


def _dust(key, R, only=None):
    """Masanın tutmadığı token artıklarını SOL'a satar (çok küçükse Jupiter yol bulamaz; atlanır)."""
    n = 0
    for m, h in _holdings(R["addr"]).items():
        if m in R["pos"] or m == SOL or (only is not None and m not in only):
            continue
        try:
            _execute(key, _swap(key, R["addr"], m, SOL, h["raw"]))
            n += 1
        except Exception as e:
            _note(R, "info", f"Artık {m[:4]}… satılamadı: {str(e)[:60]}")
    try:
        time.sleep(2)
        k = close_empty(key, R["addr"])
    except Exception:
        k = 0
    t = f"Küçük token artıkları: {n} tanesi SOL'a çevrildi" + (f"; {k} boş hesap kapatılıp kirası geri alındı" if k else "")
    _note(R, "info", t)
    R.setdefault("out", []).append(["dust", t])


def _loop():
    last = 0.0
    while True:
        try:
            ev = _Q.get(timeout=1)
        except queue.Empty:
            ev = None
        R, cfg, key = _W["R"], _W["cfg"], _W["key"]
        try:
            from . import meme
            with meme._LOCK:
                prices = {m: float(p.get("priceUsd") or 0) for m, p in (meme._SNAP.get("pairs") or {}).items()}
            held = set(cfg.get("_held") or [])
            with _LOCK:
                while _ADJ:  # MEME'ye gelen/çıkan para: masanın kâr-zararı sayılmasın (aktarım iş parçacığından)
                    if R.get("start"):
                        R["start"] = round(max(0.0, R["start"] + _ADJ.pop(0)), 2)
                    else:
                        _ADJ.pop(0)
                if ev and ev[0] == "buy" and cfg.get("real"):
                    if time.time() - last > 5:
                        _sync(R, cfg, prices, held | {ev[1]}, key)
                        last = time.time()
                    _buy(key, R, ev, cfg)
                elif ev and ev[0] == "sell" and ev[1] in R["pos"]:
                    _sell(key, R, ev[1], ev[2], cfg, ev[3] if len(ev) > 3 else 1.0)
                elif ev and ev[0] == "dust":
                    _dust(key, R, set(ev[1]) if len(ev) > 1 else None)
                elif ev and ev[0] == "kill":
                    for m in list(R["pos"]):  # önce hepsi işaretlenir: biri satılamazsa kalanlar da eşitlemede yeniden denenir
                        R["pos"][m]["closing"] = "masa kapatıldı"
                    for m in list(R["pos"]):
                        try:
                            _sell(key, R, m, "masa kapatıldı", cfg)
                        except Exception as e:
                            R["err"] = f"{R['pos'].get(m, {}).get('sym', m[:4])} satılamadı: {e}"[:160]
                if time.time() - last >= SYNC:
                    _sync(R, cfg, prices, held, key)
                    last = time.time()
                    R["sync"] = int(time.time() * 1000)
                    R["err"] = ""
        except Exception as e:
            with _LOCK:
                R["err"] = str(e)[:160]
                if ev and ev[0] == "buy":
                    _note(R, "risk", f"GERÇEK {ev[2]} alınamadı: {str(e)[:100]}")
                elif ev and ev[0] == "sell" and ev[1] in R["pos"] and len(ev) > 3 and ev[3] < 1:
                    R["pos"][ev[1]]["tp_due"] = ev[3]  # kısmi kâr al yeniden denenir (hepsi satılmaz)
                    _note(R, "risk", f"GERÇEK {R['pos'][ev[1]]['sym']} kısmi satış yapılamadı, yeniden denenecek: {str(e)[:100]}")
                elif ev and ev[0] == "sell" and ev[1] in R["pos"]:
                    R["pos"][ev[1]]["closing"] = ev[2]  # bir sonraki eşitlemede yeniden denenir
                    _note(R, "risk", f"GERÇEK {R['pos'][ev[1]]['sym']} satılamadı, yeniden denenecek: {str(e)[:100]}")


def step(state, S, paper_cfg, N=None):
    sm = S.get("meme") or {}
    cfg = {**paper_cfg, **DEFAULT, **{k: v for k, v in sm.items() if k in DEFAULT}}
    M = state.get("meme") or {}
    evs = M.pop("ev", [])
    if not cfg["wallet"] or not (os.environ.get("MEME_SOL_SEED") or os.environ.get("MEME_SOL_KEY")):
        return
    if _W["R"] is None:
        _W["R"] = copy.deepcopy(state.get("memer")) or _new(cfg)
        if (state.get("locked") or {}).get("memer") and not state.get("memer"):
            _W["R"]["dead"] = "kayıt açılamadı (şifre değişmiş olabilir); ayarlardan yeniden başlat"
        k, a, how = load_key(cfg["wallet"])
        _W["key"] = k
        R = _W["R"]
        R["addr"], R["how"] = (a, how) if k else ("", "")
        if not k:
            R["err"] = how
        print("MEME cüzdanı:", f"eşleşti ({how})" if k else how)
    R = _W["R"]
    if not _W["key"]:
        state["memer"] = {**R, "on": False}
        return
    if cfg.get("real_reset", 0) != R.get("reset", 0) and _LOCK.acquire(False):
        (state.get("locked") or {}).pop("memer", None)
        try:
            R["reset"], R["dead"], R["start"] = cfg.get("real_reset", 0), "", R["value"]
            _note(R, "info", "Masa ayarlardan yeniden başlatıldı")
        finally:
            _LOCK.release()
    cfg["_held"] = list(M.get("positions") or {})
    _W["cfg"] = cfg
    if _W["t"] is None or not _W["t"].is_alive():
        _W["t"] = threading.Thread(target=_loop, daemon=True)
        _W["t"].start()
    if R.get("on") and not cfg["real"] and R["pos"]:
        _Q.put(["kill"])
    for e in evs:
        if cfg["real"] or e[0] == "sell":
            _Q.put(e)
    if not _LOCK.acquire(False):
        return  # işçi borsayla konuşuyor: bu tur bir önceki kayıt geçerli
    try:
        R["on"] = bool(cfg["real"])
        for kind, text in R.pop("out", []):
            if N:
                t = text.replace("GERÇEK ", "")
                N.add("money" if kind == "dust" else "trades" if kind != "risk" else "alerts",
                      f"{TITLE} · küçük bakiyeler" if kind == "dust" else f"{TITLE} · {t.split(' ')[0].capitalize()}", t, 4,
                      ["chart_with_upwards_trend" if kind == "buy" else "moneybag" if "+" in t else "warning"])
        state["memer"] = json.loads(json.dumps(R))
    finally:
        _LOCK.release()


def trim_log():
    if _LOCK.acquire(timeout=1):
        try:
            if _W["R"]:
                del _W["R"]["log"][:-5]
        finally:
            _LOCK.release()


_ADJ = []


def quiesce(timeout=20):
    """Yeniden başlamadan önce: sıradaki emirler bitsin, işçi yeni emir başlatmasın; son kayıt döner."""
    t = time.time()
    while not _Q.empty() and time.time() - t < timeout:
        time.sleep(0.2)
    if _W["R"] is None:
        return None
    if not _LOCK.acquire(timeout=timeout):  # işçi meşgul: yarım kayıt yazılmaz, son tur kaydı geçerli
        return None
    _W["held"] = True  # bırakılmaz: süreç birazdan yeniden başlıyor (başlamazsa resume())
    R = _W["R"]
    while _ADJ:  # bekleyen taban düzeltmeleri kayda geçsin (yeniden başlayınca zarar/kâr sanılmasın)
        a = _ADJ.pop(0)
        if R.get("start"):
            R["start"] = round(max(0.0, R["start"] + a), 2)
    return json.loads(json.dumps(R))


def resume():
    """Yeniden başlama olmadıysa masa çalışmaya devam etsin."""
    if _W.pop("held", None):
        _LOCK.release()


def public(state):
    R = state.get("memer")
    if not R:
        return None
    sells = [t for t in R["trades"] if t["side"] == "SAT"]
    wins = [t for t in sells if t["pnl"] > 0]
    return {"on": R.get("on"), "addr": R.get("addr"), "sol": round(R["sol"], 4), "solpx": R["solpx"], "value": R["value"],
            "start": R["start"], "pnl": round(R["value"] - R["start"], 2) if R["start"] else 0, "dead": R["dead"], "err": R["err"],
            "sync": R.get("sync"), "positions": [{"mint": m, "sym": p["sym"], "ts": p["ts"], "cost": round(p["cost"], 2),
                                                  "val": p.get("val", 0), "why": p["why"], "part": bool(p.get("part"))} for m, p in R["pos"].items()],
            "trades": R["trades"][-40:][::-1], "log": R["log"][-40:][::-1], "equity_series": R["equity"][-200:], "fav": config.top_earners(R["trades"]),
            "sells": len(sells), "win_rate": round(len(wins) / len(sells) * 100) if sells else None}
