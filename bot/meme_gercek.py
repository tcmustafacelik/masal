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
import json
import os
import queue
import threading
import time
import unicodedata
import urllib.request

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

RPC = "https://api.mainnet-beta.solana.com"
JUP = "https://lite-api.jup.ag/ultra/v1"
SOL = "So11111111111111111111111111111111111111112"
TOKEN_PROGS = ("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA", "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb")
RESERVE = 0.02  # SOL; işlem ücreti ve token hesabı kirası için hep kalır
DEFAULT = {"real": False, "wallet": "", "max_loss": 10.0, "max_slip": 2.0, "real_reset": 0}
SYNC = 30
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
    r = _post(f"{JUP}/execute", {"signedTransaction": sign_tx(o["transaction"], key), "requestId": o["requestId"]})
    if r.get("status") != "Success":
        raise RuntimeError(f"işlem başarısız: {r.get('error') or r.get('code') or r}"[:160])
    return r


def _holdings(addr):
    out = {}
    for prog in TOKEN_PROGS:
        for a in _rpc("getTokenAccountsByOwner", [addr, {"programId": prog}, {"encoding": "jsonParsed"}])["value"]:
            info = a["account"]["data"]["parsed"]["info"]
            t = info["tokenAmount"]
            if int(t["amount"]) > 0:
                out[info["mint"]] = {"raw": int(t["amount"]), "dec": int(t["decimals"]), "ui": float(t["uiAmount"] or 0)}
    return out


def _sol(addr):
    return _rpc("getBalance", [addr])["value"] / 1e9


def _solpx():
    d = _get("https://www.okx.com/api/v5/market/ticker?instId=SOL-USDT")
    return float(d["data"][0]["last"])


def _new(cfg):
    return {"addr": "", "how": "", "sol": 0.0, "solpx": 0.0, "value": 0.0, "start": 0.0, "pos": {}, "trades": [], "log": [],
            "equity": [], "dead": "", "err": "", "sync": 0, "reset": cfg.get("real_reset", 0), "on": False}


def _note(R, kind, text):
    print("[" + __name__.split(".")[-1] + "]", text)  # günlükte izlemek için (anahtar/tutar dışı bilgi)
    R["log"].append([int(time.time() * 1000), kind, text])
    R["log"] = R["log"][-80:]


def _value(R, prices):
    v = R["sol"] * R["solpx"]
    for m, p in R["pos"].items():
        px = prices.get(m) or p.get("px") or 0
        p["px"] = px
        p["val"] = round(p.get("ui", 0) * px, 4)
        v += p["val"]
    return v


def _sell(key, R, m, reason, cfg):
    p = R["pos"][m]
    h = _holdings(R["addr"]).get(m)
    if not h:
        del R["pos"][m]
        _note(R, "info", f"{p['sym']} cüzdanda yok; kayıttan çıkarıldı")
        return
    o = _swap(key, R["addr"], m, SOL, h["raw"])
    r = _execute(key, o)
    got = int(r.get("outputAmountResult") or o.get("outAmount") or 0) / 1e9
    usd = got * R["solpx"]
    pnl = usd - p["cost"]
    R["trades"].append({"ts": int(time.time() * 1000), "sym": p["sym"], "mint": m, "side": "SAT", "usd": round(usd, 2),
                        "pnl": round(pnl, 2), "pct": round(pnl / p["cost"] * 100, 1) if p["cost"] else 0, "reason": reason,
                        "sig": r.get("signature"), "real": True})
    R["trades"] = R["trades"][-300:]
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
    R["solpx"] = _solpx()
    R["sol"] = _sol(R["addr"])
    h = _holdings(R["addr"])
    for m, p in list(R["pos"].items()):
        if m in h:
            p["ui"], p["raw"] = h[m]["ui"], h[m]["raw"]
        elif time.time() * 1000 - p["ts"] > 120000:
            del R["pos"][m]
    v = _value(R, prices)
    R["value"] = round(v, 2)
    if not R["start"] and v > 0:
        R["start"] = round(v, 2)
        _note(R, "info", f"MEME cüzdanı bağlandı ({R['how']}); başlangıç değeri ${v:.2f}")
    # deneme masasının tutmadığı ama gerçekte kalan token: satış yeniden denenir
    for m in list(R["pos"]):
        if m not in held_paper and time.time() * 1000 - R["pos"][m]["ts"] > 60000:
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
    _note(R, "info", f"Küçük token artıkları: {n} tanesi SOL'a çevrildi")


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
                if ev and ev[0] == "buy" and cfg.get("real"):
                    if time.time() - last > 5:
                        _sync(R, cfg, prices, held | {ev[1]}, key)
                        last = time.time()
                    _buy(key, R, ev, cfg)
                elif ev and ev[0] == "sell" and ev[1] in R["pos"]:
                    _sell(key, R, ev[1], ev[2], cfg)
                elif ev and ev[0] == "dust":
                    _dust(key, R, set(ev[1]) if len(ev) > 1 else None)
                elif ev and ev[0] == "kill":
                    for m in list(R["pos"]):
                        R["pos"][m]["closing"] = "masa kapatıldı"
                        _sell(key, R, m, "masa kapatıldı", cfg)
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
                elif ev and ev[0] == "sell" and ev[1] in R["pos"]:
                    R["pos"][ev[1]]["closing"] = ev[2]  # bir sonraki eşitlemede yeniden denenir
                    _note(R, "risk", f"GERÇEK {R['pos'][ev[1]]['sym']} satılamadı, yeniden denenecek: {str(e)[:100]}")


def step(state, S, paper_cfg):
    sm = S.get("meme") or {}
    cfg = {**paper_cfg, **DEFAULT, **{k: v for k, v in sm.items() if k in DEFAULT}}
    M = state.get("meme") or {}
    evs = M.pop("ev", [])
    if not cfg["wallet"] or not (os.environ.get("MEME_SOL_SEED") or os.environ.get("MEME_SOL_KEY")):
        return
    if _W["R"] is None:
        _W["R"] = state.get("memer") or _new(cfg)
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
    if cfg.get("real_reset", 0) != R.get("reset", 0):
        with _LOCK:
            R["reset"], R["dead"], R["start"] = cfg.get("real_reset", 0), "", R["value"]
            _note(R, "info", "Masa ayarlardan yeniden başlatıldı")
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
    with _LOCK:
        R["on"] = bool(cfg["real"])
        state["memer"] = json.loads(json.dumps(R))


def trim_log():
    with _LOCK:
        if _W["R"]:
            del _W["R"]["log"][:-5]


def public(state):
    R = state.get("memer")
    if not R:
        return None
    sells = [t for t in R["trades"] if t["side"] == "SAT"]
    wins = [t for t in sells if t["pnl"] > 0]
    return {"on": R.get("on"), "addr": R.get("addr"), "sol": round(R["sol"], 4), "solpx": R["solpx"], "value": R["value"],
            "start": R["start"], "pnl": round(R["value"] - R["start"], 2) if R["start"] else 0, "dead": R["dead"], "err": R["err"],
            "sync": R.get("sync"), "positions": [{"mint": m, "sym": p["sym"], "ts": p["ts"], "cost": round(p["cost"], 2),
                                                  "val": p.get("val", 0), "why": p["why"]} for m, p in R["pos"].items()],
            "trades": R["trades"][-40:][::-1], "log": R["log"][-40:][::-1], "equity_series": R["equity"][-200:],
            "sells": len(sells), "win_rate": round(len(wins) / len(sells) * 100) if sells else None}
