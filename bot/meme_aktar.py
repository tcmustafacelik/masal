"""OKX Global ↔ MEME sıcak cüzdanı (Solana) para aktarımı. Tutarlar USDT karşılığıdır; aktarılan varlık SOL'dur.

g2m: Global fon hesabındaki USDT ile SOL alınır, doğrulanmış MEME adresine (Solana ağı) çekilir.
     Global'in işlem hesabındaki USDT (futures teminatı) kullanılmaz.
m2g: MEME cüzdanından Global'in SOL yatırma adresine SOL gönderilir (bot imzalar); varınca SOL satılıp
     USDT fon hesabına konur. Ücretler için MEME'de en az 0.02 SOL hep kalır.
"""
import base64
import json
import math
import struct
import time
import urllib.request

from . import meme_gercek as G
from . import transfer

SYSTEM = b"\0" * 32


def _px():
    r = urllib.request.Request("https://www.okx.com/api/v5/market/ticker?instId=SOL-USDT", headers={"User-Agent": "masal/1.0"})
    with urllib.request.urlopen(r, timeout=10) as f:
        return float(json.load(f)["data"][0]["last"])


def _cu16(n):
    out = b""
    while True:
        b = n & 0x7F
        n >>= 7
        out += bytes([b | (0x80 if n else 0)])
        if not n:
            return out


def _sol_transfer(key, to, lamports):
    me = G._pub(key)
    bh = G.b58d(G._rpc("getLatestBlockhash", [{"commitment": "finalized"}])["value"]["blockhash"])
    msg = (bytes([1, 0, 1]) + _cu16(3) + me + G.b58d(to) + SYSTEM + bh + _cu16(1) +
           bytes([2]) + _cu16(2) + bytes([0, 1]) + _cu16(12) + struct.pack("<IQ", 2, int(lamports)))
    from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
    tx = _cu16(1) + Ed25519PrivateKey.from_private_bytes(key).sign(msg) + msg
    return G._rpc("sendTransaction", [base64.b64encode(tx).decode(), {"encoding": "base64", "preflightCommitment": "confirmed"}])


def _g_sol_chain(g):
    for c in g.req("GET", "/api/v5/asset/currencies?ccy=SOL"):
        if "solana" in c["chain"].lower():
            return c["chain"], float(c.get("fee") or c.get("minFee") or 0), float(c.get("minWd") or 0), bool(c.get("canWd")), bool(c.get("canDep"))
    raise RuntimeError("OKX Global'de SOL Solana ağı bulunamadı")


def run(job, X, C, N, note):
    g = C["g"]
    if not g.ok:
        raise RuntimeError("OKX Global anahtarı tanımlı değil")
    if job["dir"] == "g2m":
        _g2m(g, job, X, N, note)
    else:
        _m2g(g, job, X, N, note)


def _g2m(g, job, X, N, note):
    addr = (G._W.get("R") or {}).get("addr")
    if not addr:
        raise RuntimeError("MEME cüzdanı bağlı değil")
    cid = job["id"][:32]
    if job["stage"] == "new":
        for w in g.req("GET", "/api/v5/asset/withdrawal-history?ccy=SOL"):
            if w.get("clientId") == cid:
                job.update(stage="sent", wdId=w.get("wdId"), msg="gönderildi; ağda")
                return
        chain, fee, mn, can_wd, _ = _g_sol_chain(g)
        if not can_wd:
            job["msg"] = "OKX Global'de SOL çekimi şu an kapalı; bekleniyor"
            return
        if not job.get("bought"):
            usd = job["amt"]
            if g.funding("USDT") < usd - 0.01:
                raise RuntimeError(f"Global fon hesabında {usd:.2f} USDT yok (futures teminatına dokunulmaz)")
            g.move("USDT", usd, transfer.FUNDING, transfer.TRADING)
            o = g.market("SOL-USDT", "buy", f"{usd:.2f}", quote=True)
            time.sleep(2)
            d = g.req("GET", f"/api/v5/trade/order?instId=SOL-USDT&ordId={o['ordId']}")[0]
            got = float(d.get("accFillSz") or 0) - abs(float(d.get("fee") or 0) if d.get("feeCcy") == "SOL" else 0)
            if got <= 0:
                raise RuntimeError("SOL alınamadı")
            g.move("SOL", math.floor(got * 1e6) / 1e6, transfer.TRADING, transfer.FUNDING)
            job["bought"] = round(got, 6)
            time.sleep(1)
        amt = math.floor((min(job["bought"], g.funding("SOL")) - fee) * 1e6) / 1e6
        if amt < mn:
            raise RuntimeError(f"tutar en az çekimin ({mn} SOL) altında")
        body = {"ccy": "SOL", "amt": f"{amt:f}", "dest": "4", "toAddr": addr, "chain": chain,
                "fee": f"{fee:f}".rstrip("0").rstrip("."), "clientId": cid}
        try:
            r = g.req("POST", "/api/v5/asset/withdrawal", body)[0]
        except RuntimeError as e:
            if "58207" in str(e):
                raise RuntimeError("MEME adresi OKX Global adres defterinde doğrulanmış değil")
            body["rcvrInfo"] = {"walletType": "private"}
            r = g.req("POST", "/api/v5/asset/withdrawal", body)[0]
        job.update(stage="sent", wdId=r.get("wdId"), sol=amt, sent_ts=int(time.time() * 1000), msg=f"{amt:g} SOL gönderildi; ağda")
        X["day_sum"] = round(X.get("day_sum", 0) + job["amt"], 2)
        note(X, f"OKX Global → MEME: {amt:g} SOL (~{job['amt']:.2f} $) gönderildi")
    else:
        for w in g.req("GET", "/api/v5/asset/withdrawal-history?ccy=SOL"):
            if w.get("clientId") == cid:
                st = str(w.get("state"))
                if st == "2":
                    job.update(stage="done", msg="MEME cüzdanına ulaştı")
                    note(X, f"MEME'ye ulaştı: {job.get('sol', '')} SOL")
                    N.add("money", "MEME cüzdanına SOL ulaştı", f"~{job['amt']:.2f} $ değerinde SOL", 3, ["x"])
                elif st in ("-1", "-2", "-3"):
                    raise RuntimeError(f"OKX çekimi reddetti/iptal etti (durum {st})")
                else:
                    job["msg"] = "ağda; onay bekleniyor"
                return


def _m2g(g, job, X, N, note):
    W = G._W
    key, addr = W.get("key"), (W.get("R") or {}).get("addr")
    if not key or not addr:
        raise RuntimeError("MEME cüzdanı bağlı değil")
    if job["stage"] == "new":
        px = _px()
        sol = job["amt"] / px
        free = G._sol(addr) - G.RESERVE
        if sol > free:
            raise RuntimeError(f"MEME'de boşta {max(0, free):.4f} SOL var (~{max(0, free) * px:.2f} $); daha fazlası gönderilemez")
        chain, _, _, _, can_dep = _g_sol_chain(g)
        if not can_dep:
            job["msg"] = "OKX Global'de SOL yatırma şu an kapalı; bekleniyor"
            return
        dep = next((x["addr"] for x in g.req("GET", "/api/v5/asset/deposit-address?ccy=SOL") if "solana" in x["chain"].lower()), None)
        if not dep:
            raise RuntimeError("Global SOL yatırma adresi alınamadı")
        sig = _sol_transfer(key, dep, round(sol * 1e9))
        job.update(stage="sent", txId=sig, sol=round(sol, 6), sent_ts=int(time.time() * 1000), msg=f"{sol:.4f} SOL gönderildi; ağda")
        X["day_sum"] = round(X.get("day_sum", 0) + job["amt"], 2)
        note(X, f"MEME → OKX Global: {sol:.4f} SOL (~{job['amt']:.2f} $) gönderildi")
    elif job["stage"] == "sent":
        for d in g.req("GET", "/api/v5/asset/deposit-history?ccy=SOL"):
            if d.get("txId") == job["txId"]:
                if str(d.get("state")) in ("1", "2"):  # 1: hesaba geçti (işlemde kullanılabilir), 2: tamam
                    amt = float(d.get("amt") or 0)
                    g.move("SOL", amt, transfer.FUNDING, transfer.TRADING)
                    o = g.market("SOL-USDT", "sell", f"{math.floor(amt * 1e6) / 1e6:f}")
                    time.sleep(2)
                    od = g.req("GET", f"/api/v5/trade/order?instId=SOL-USDT&ordId={o['ordId']}")[0]
                    usd = float(od.get("accFillSz") or 0) * float(od.get("avgPx") or 0) - abs(float(od.get("fee") or 0))
                    g.move("USDT", math.floor(usd * 100) / 100, transfer.TRADING, transfer.FUNDING)
                    job.update(stage="done", msg=f"Global'e ulaştı; {usd:.2f} USDT olarak fon hesabında")
                    X["g_base"] = round(X.get("g_base", 0) + usd, 2)
                    note(X, f"Global'e ulaştı: {usd:.2f} USDT")
                    N.add("money", "MEME'den Global'e ulaştı", f"{usd:.2f} USDT", 3, ["x"])
                return
        if time.time() * 1000 - job["sent_ts"] > 3 * 3600_000:
            raise RuntimeError("3 saattir Global'e ulaşmadı; işlem kodu: " + str(job["txId"])[:20])
        job["msg"] = "ağda; Global'e ulaşması bekleniyor"
