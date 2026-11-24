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


def _sol_sign(key, to, lamports):
    """SOL gönderim işlemini hazırlar ve imzalar (göndermez). (işlem, işlem kodu) döner: kod gönderimden önce bilinir."""
    me = G._pub(key)
    bh = G.b58d(G._rpc("getLatestBlockhash", [{"commitment": "finalized"}])["value"]["blockhash"])
    msg = (bytes([1, 0, 1]) + _cu16(3) + me + G.b58d(to) + SYSTEM + bh + _cu16(1) +
           bytes([2]) + _cu16(2) + bytes([0, 1]) + _cu16(12) + struct.pack("<IQ", 2, int(lamports)))
    from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
    sig = Ed25519PrivateKey.from_private_bytes(key).sign(msg)
    return base64.b64encode(_cu16(1) + sig + msg).decode(), G.b58e(sig)


def _sol_transfer(key, to, lamports):
    tx, _ = _sol_sign(key, to, lamports)
    return G._rpc("sendTransaction", [tx, {"encoding": "base64", "preflightCommitment": "confirmed"}])


UNSURE_MS = 300_000  # imzalanan işlem ~1-2 dk geçerlidir; 5 dk sonra ağda hâlâ yoksa artık giremez


def _g_sol_chain(g):
    for c in g.req("GET", "/api/v5/asset/currencies?ccy=SOL"):
        if "solana" in c["chain"].lower():
            return c["chain"], float(c.get("fee") or c.get("minFee") or 0), float(c.get("minWd") or 0), bool(c.get("canWd")), bool(c.get("canDep"))
    raise RuntimeError("OKX Global'de SOL Solana ağı bulunamadı")


def _adj_start(usd):
    """Masanın başlangıç değeri, masa işçisinin kendi turunda düzeltilir (kilit beklenmez, düzeltme kaybolmaz)."""
    G._ADJ.append(float(usd))


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
            if not job.get("ordId"):
                cl = job.get("clOrd")
                if cl:
                    # önceki denemede alım emri gönderildi ama yanıtı alınamadı: önce borsada aranır (ikinci kez SOL alınmaz)
                    try:
                        o = g.find_order("SOL-USDT", cl)
                    except RuntimeError as e:
                        job["msg"] = f"alım emri kontrol edilemedi; tekrar denenecek: {str(e)[:80]}"
                        return
                    if o:
                        job["ordId"] = o["ordId"]
            if not job.get("ordId"):
                if not job.get("moved"):
                    if g.funding("USDT") < usd - 0.01:
                        if job.get("wait") and time.time() * 1000 - job["ts"] < 3 * 3600_000:
                            job["msg"] = f"{ {'k': 'KASA', 'tr': 'OKX TR'}.get(job.get('via'), 'kaynak')}'dan Global'e gelmesi bekleniyor"
                            return
                        raise RuntimeError(f"Global fon hesabında {usd:.2f} USDT yok (futures teminatına dokunulmaz)")
                    g.move("USDT", usd, transfer.FUNDING, transfer.TRADING)
                    job["moved"] = True
                import hashlib
                job["clOrd"] = cl = "g" + hashlib.md5(job["id"].encode()).hexdigest()[:30]  # iş başına tek emir kimliği
                try:
                    o = g.market("SOL-USDT", "buy", f"{usd:.2f}", quote=True, cl=cl)
                except RuntimeError:
                    # borsa emri açıkça reddetti (alım olmadı): para fona geri. Ağ hatasında geri alınmaz;
                    # emir verilmiş olabilir, bir sonraki kontrolde clOrd ile aranır.
                    job.pop("clOrd", None)
                    try:
                        g.move("USDT", usd, transfer.TRADING, transfer.FUNDING)
                        job.pop("moved", None)
                    except Exception as e2:
                        print("Aktarım: USDT fona geri alınamadı:", str(e2)[:120])
                    raise
                job["ordId"] = o["ordId"]
                time.sleep(2)
            d = g.req("GET", f"/api/v5/trade/order?instId=SOL-USDT&ordId={job['ordId']}")[0]
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
                    _adj_start(job["amt"])  # yatırılan para masanın kârı sayılmasın
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
        if job.get("all"):
            # "hepsini gönder" (memecoin kapatılırken): önce masadaki tokenler satılmış olmalı
            if (W.get("R") or {}).get("pos") and time.time() * 1000 - job["ts"] < 30 * 60_000:
                job["msg"] = "MEME'deki tokenler satılıyor; bekleniyor"
                return  # 30 dk içinde satılamayan token kalırsa eldeki SOL yine gönderilir
            free = G._sol(addr) - 0.002  # yalnız ağ ücreti payı kalır (masa kapalı, yedek gerekmez)
            if free * px < 1:
                raise RuntimeError(f"MEME'de gönderilecek SOL kalmadı ({max(0, free):.4f} SOL)")
            job["amt"] = math.floor(free * px * 100) / 100
            sol = free
        else:
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
        tx, sig = _sol_sign(key, dep, round(sol * 1e9))  # burada hata olursa hiçbir şey gönderilmemiştir
        _adj_start(-job["amt"])  # çıkan para masanın zararı sayılmasın (göndermeden önce: arada eşitleme zarar sanmasın)
        # İşlem kodu gönderimden ÖNCE kayda geçer: yanıt gelmese de (zaman aşımı) işlem ağa çıkmış olabilir.
        # O durumda taban geri eklenmez, iş "başarısız" sayılmaz; sonuç ağdan işlem koduyla öğrenilir.
        job.update(stage="sent", txId=sig, sol=round(sol, 6), sent_ts=int(time.time() * 1000), unsure=True,
                   msg=f"{sol:.4f} SOL gönderiliyor")
        X["day_sum"] = round(X.get("day_sum", 0) + job["amt"], 2)
        try:
            G._rpc("sendTransaction", [tx, {"encoding": "base64", "preflightCommitment": "confirmed"}])
            job.pop("unsure", None)
            job["msg"] = f"{sol:.4f} SOL gönderildi; ağda"
            note(X, f"MEME → OKX Global: {sol:.4f} SOL (~{job['amt']:.2f} $) gönderildi")
        except Exception as e:
            job["msg"] = "gönderim yanıtı alınamadı; işlem ağda kontrol ediliyor"
            note(X, f"MEME → OKX Global: {sol:.4f} SOL gönderim yanıtı alınamadı ({str(e)[:80]}); ağda kontrol edilecek")
    elif job["stage"] == "sent" and job.get("unsure"):
        st = (G._rpc("getSignatureStatuses", [[job["txId"]], {"searchTransactionHistory": True}]).get("value") or [None])[0]
        if st is None:
            if time.time() * 1000 - job["sent_ts"] > UNSURE_MS:
                _adj_start(job["amt"])  # işlem ağa hiç girmedi: SOL cüzdanda, taban geri alınır
                raise RuntimeError("SOL gönderimi ağa ulaşmadı; para MEME cüzdanında duruyor")
            job["msg"] = "gönderim yanıtı alınamadı; işlem ağda kontrol ediliyor"
            return
        if st.get("err"):
            _adj_start(job["amt"])  # işlem ağda reddedildi: SOL cüzdanda
            raise RuntimeError("SOL gönderimi ağa ulaşmadı (işlem reddedildi); para MEME cüzdanında duruyor")
        job.pop("unsure", None)  # işlem ağda: bundan sonra Global'e ulaşması beklenir
        job["msg"] = "ağda; Global'e ulaşması bekleniyor"
        note(X, f"MEME → OKX Global: {job.get('sol', 0):.4f} SOL (~{job['amt']:.2f} $) gönderildi")
    elif job["stage"] == "sent":
        for d in g.req("GET", "/api/v5/asset/deposit-history?ccy=SOL"):
            if d.get("txId") == job["txId"]:
                if str(d.get("state")) in ("1", "2"):  # 1: hesaba geçti (işlemde kullanılabilir), 2: tamam
                    amt = float(d.get("amt") or 0)
                    if not job.get("sold"):
                        if not job.get("in_trading"):
                            g.move("SOL", amt, transfer.FUNDING, transfer.TRADING)
                            job["in_trading"] = True
                        o = g.market("SOL-USDT", "sell", f"{math.floor(amt * 1e6) / 1e6:f}")
                        job["sold"] = o["ordId"]
                        time.sleep(2)
                    if not job.get("usd"):
                        od = g.req("GET", f"/api/v5/trade/order?instId=SOL-USDT&ordId={job['sold']}")[0]
                        job["usd"] = float(od.get("accFillSz") or 0) * float(od.get("avgPx") or 0) - abs(float(od.get("fee") or 0))
                    if job["usd"] <= 0:  # satış henüz dolmadı: bir sonraki kontrolde tekrar bakılır
                        job.pop("usd")
                        job["msg"] = "SOL satışı bekleniyor"
                        return
                    usd = job["usd"]
                    g.move("USDT", math.floor(usd * 100) / 100, transfer.TRADING, transfer.FUNDING)
                    job.update(stage="done", msg=f"Global'e ulaştı; {usd:.2f} USDT olarak fon hesabında")
                    try:
                        k_fee = float(g.chain()[1])
                    except Exception:
                        k_fee = 1.0
                    k_amt = math.floor((usd - k_fee) * 100) / 100  # zincir ücreti Global fonundan düşer
                    if job.get("then") == "k" and k_amt >= 1:  # Global'den KASA'ya devam (kâr süpürme ya da elle MEME → KASA)
                        X["jobs"].append({"id": job["id"] + "k", "dir": "g2k", "amt": k_amt, "src": "kar",
                                          "ts": int(time.time() * 1000), "stage": "new", "msg": "memecoin kârı KASA'ya" if job.get("src") == "kar" and not job.get("all") else "MEME'den gelen para KASA'ya"})
                    tr_amt = math.floor(usd * 100) / 100  # Global → TR iç transfer ücretsiz
                    if job.get("then") == "tr" and tr_amt >= 1:
                        X["jobs"].append({"id": job["id"] + "t", "dir": "g2tr", "amt": tr_amt, "src": "bos",
                                          "ts": int(time.time() * 1000), "stage": "new", "msg": "MEME'den gelen para OKX TR'ye"})
                    X["g_base"] = round(X.get("g_base", 0) + usd, 2)
                    note(X, f"Global'e ulaştı: {usd:.2f} USDT")
                    N.add("money", "MEME'den Global'e ulaştı", f"{usd:.2f} USDT", 3, ["x"])
                return
        if time.time() * 1000 - job["sent_ts"] > 3 * 3600_000:
            raise RuntimeError("3 saattir Global'e ulaşmadı; işlem kodu: " + str(job["txId"])[:20])
        job["msg"] = "ağda; Global'e ulaşması bekleniyor"
