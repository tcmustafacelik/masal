"""Para aktarımı (alıcı adı OKX_ALICI gizli ayarından): OKX TR ↔ OKX Global ↔ KASA (soğuk cüzdan), USDT, Arbitrum One ağı.

Güvenlik:
  * Para yalnızca aşağıdaki üç adrese gidebilir. Adresler kodda sabittir; uygulamadan ya da ayardan değiştirilemez.
  * Borsa adresleri her gönderimden önce karşı borsanın API'sinden tekrar okunur; tutmazsa gönderim yapılmaz.
  * Günlük toplam gönderim sınırı vardır (ayarlardan, varsayılan 1.000 $).
  * Soğuk cüzdanın anahtarı sistemde yoktur; bot oraya sadece gönderebilir, oradan bir şey çekemez.
Akış (uygulamadaki istekler `xfer_req` listesinde gelir; her biri bir kez işlenir):
  tr2g   TR → Global  : TR'deki boş TL/USDT (ya da bottan, bütçe uygulamada düşürülür) USDT'ye çevrilip gönderilir
  g2tr   Global → TR  : gelince USDT TL'ye çevrilip TR'de "Nakit"e (fon hesabı) konur; bankaya çekim kullanıcıdadır
  tr2k   TR → KASA     g2k   Global → KASA
Kâr süpürme: Global'deki değer, Global'e giren net paranın üstüne çıkınca, belirlenen aralıkla kârın bir kısmı KASA'ya gider.
"""
import base64
import hashlib
import hmac
import json
import math
import os
import time
import urllib.request
from datetime import datetime, timezone, timedelta

KASA = "0x011354d853f6FE89D5780E912bDC5cE697607db7"   # Trust Wallet "KASA" (Arbitrum)
G_DEP = "0x74877903737257289dc07e7baf1f4b078c2a82a3"  # OKX Global USDT yatırma adresi (Arbitrum One)
TR_DEP = "0x1e194face9b26c78f75d854d741cf6547730b705"  # OKX TR USDT yatırma adresi (Arbitrum One)
ROUTES = {  # yön: (kaynak, hedef adres, hedef borsa ya da None)
    "tr2g": ("tr", G_DEP, "g"), "g2tr": ("g", TR_DEP, "tr"), "tr2k": ("tr", KASA, None), "g2k": ("g", KASA, None)}
NAMES = {"tr": "OKX TR", "g": "OKX Global", None: "KASA"}
FUNDING, TRADING = "6", "18"
DEFAULT = {"daily_max": 1000, "sweep_on": True, "sweep_pct": 50, "sweep_days": 7, "sweep_min": 10}


class Ex:
    def __init__(self, base, pre):
        self.base = base
        self.key, self.sec, self.pas = (os.environ.get(pre + s, "") for s in ("_API_KEY", "_API_SECRET", "_API_PASSPHRASE"))

    @property
    def ok(self):
        return bool(self.key and self.sec and self.pas)

    def req(self, method, path, body=None):
        now = datetime.now(timezone.utc)
        ts = now.strftime("%Y-%m-%dT%H:%M:%S.") + f"{now.microsecond // 1000:03d}Z"
        payload = json.dumps(body, separators=(",", ":")) if body else ""
        sign = base64.b64encode(hmac.new(self.sec.encode(), (ts + method + path + payload).encode(), hashlib.sha256).digest()).decode()
        r = urllib.request.Request(self.base + path, data=payload.encode() if body else None, method=method, headers={
            "OK-ACCESS-KEY": self.key, "OK-ACCESS-SIGN": sign, "OK-ACCESS-TIMESTAMP": ts, "OK-ACCESS-PASSPHRASE": self.pas,
            "Content-Type": "application/json", "User-Agent": "masal/1.0"})
        try:
            with urllib.request.urlopen(r, timeout=15) as f:
                d = json.load(f)
        except urllib.error.HTTPError as e:
            d = json.loads(e.read() or b"{}")
        if d.get("code") != "0":
            d0 = (d.get("data") or [{}])[0]
            raise RuntimeError(f"{d.get('code')}: {d.get('msg') or ''} {d0.get('sMsg', '')}".strip())
        return d["data"]

    def trading(self, ccy):
        for x in self.req("GET", f"/api/v5/account/balance?ccy={ccy}")[0].get("details", []):
            if x["ccy"] == ccy:
                return float(x.get("availBal") or 0)
        return 0.0

    def funding(self, ccy, total=False):
        d = self.req("GET", f"/api/v5/asset/balances?ccy={ccy}")
        return float(d[0].get("bal" if total else "availBal") or 0) if d else 0.0

    def move(self, ccy, amt, frm, to):
        if amt > 0:
            self.req("POST", "/api/v5/asset/transfer", {"ccy": ccy, "amt": f"{math.floor(amt * 1e6) / 1e6:f}", "from": frm, "to": to, "type": "0"})

    def chain(self):
        """USDT'nin Arbitrum One ağı: tam ağ adı, ücret, en az çekim."""
        for c in self.req("GET", "/api/v5/asset/currencies?ccy=USDT"):
            if "arbitrum" in c["chain"].lower() and c.get("canWd"):
                return c["chain"], float(c.get("fee") or c.get("minFee") or 0), float(c.get("minWd") or 0)
        raise RuntimeError("Arbitrum One ağında USDT çekimi şu an kapalı")

    def dep_addr(self):
        return {x["addr"].lower() for x in self.req("GET", "/api/v5/asset/deposit-address?ccy=USDT") if "arbitrum" in x["chain"].lower()}

    def market(self, inst, side, sz, quote=False):
        body = {"instId": inst, "tdMode": "cash", "side": side, "ordType": "market", "sz": sz}
        if quote:
            body["tgtCcy"] = "quote_ccy"
        return self.req("POST", "/api/v5/trade/order", body)[0]


USDT_ARB = "0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9"  # Arbitrum'daki USDT (USDT0) sözleşmesi
RPC = "https://arb1.arbitrum.io/rpc"


def _rpc(method, params):
    body = json.dumps({"jsonrpc": "2.0", "id": 1, "method": method, "params": params}).encode()
    r = urllib.request.Request(RPC, data=body, headers={"Content-Type": "application/json", "User-Agent": "masal/1.0"})
    with urllib.request.urlopen(r, timeout=10) as f:
        return json.load(f)["result"]


def kasa_balance():
    """Soğuk cüzdandaki USDT ve ETH (Arbitrum). Sadece okunur; cüzdanın anahtarı sistemde yoktur."""
    data = "0x70a08231" + KASA[2:].lower().rjust(64, "0")
    usdt = int(_rpc("eth_call", [{"to": USDT_ARB, "data": data}, "latest"]), 16) / 1e6
    eth = int(_rpc("eth_getBalance", [KASA, "latest"]), 16) / 1e18
    try:
        r = urllib.request.Request("https://www.okx.com/api/v5/market/ticker?instId=ETH-USDT", headers={"User-Agent": "masal/1.0"})
        with urllib.request.urlopen(r, timeout=10) as f:
            px = float(json.load(f)["data"][0]["last"])
    except Exception:
        px = 0.0
    return {"usdt": round(usdt, 2), "eth": round(eth, 6), "usd": round(usdt + eth * px, 2), "ts": int(time.time() * 1000)}


def _clients():
    return {"tr": Ex("https://tr.okx.com", "OKX"), "g": Ex("https://www.okx.com", "OKXG")}


def _day():
    return datetime.now(timezone(timedelta(hours=3))).strftime("%Y-%m-%d")


def _note(X, text):
    X["log"] = ([[int(time.time() * 1000), text]] + X.get("log", []))[:60]
    print("Aktarım:", text)


def _rate():
    from . import okx
    return okx.rate("USDT")


def _free_tr(ex, state):
    """TR'de bota ait olmayan boş para (TL karşılığı): TL + USDT (işlem + fon hesabı) − botun nakdi."""
    r = _rate()
    have = (ex.trading("TRY") + ex.funding("TRY")) + (ex.trading("USDT") + ex.funding("USDT")) * r
    bot = max(0.0, float((state.get("live") or {}).get("cash") or 0))
    return have - bot


def _prepare(ex, side, amt, job):
    """Kaynakta `amt` USDT'yi fon hesabında hazırlar (TR'de gerekirse TL → USDT çevirir)."""
    need = amt
    f = ex.funding("USDT")
    if f >= need:
        return True
    if ex.funding("USDT", total=True) >= need:
        # Para fon hesabında ama borsa henüz çekime açmamış (OKX TR'de yeni yatırılan TL ile alınanlarda bekleme süresi olur)
        job["msg"] = f"para {NAMES[side]} fon hesabında hazır; borsa çekim kilidi kalkınca otomatik gönderilecek"
        job["locked"] = True
        return False
    t = ex.trading("USDT")
    if f + t < need and side == "tr":
        short = need - f - t
        tl_need = round(short * _rate() * 1.006 + 1, 2)
        tl_f = ex.funding("TRY")
        if ex.trading("TRY") < tl_need and tl_f > 0:
            ex.move("TRY", min(tl_f, tl_need), FUNDING, TRADING)
        if ex.trading("TRY") < tl_need:
            job["msg"] = "TR'de yeterli boş TL/USDT yok; bekleniyor (bot coin sattıkça açılır)"
            return False
        ex.market("USDT-TRY", "buy", f"{tl_need:.2f}", quote=True)
        time.sleep(1)
        t = ex.trading("USDT")
    if f + t < need:
        job["msg"] = f"{NAMES[side]}'de yeterli USDT yok ({f + t:.2f} / {need:.2f}); bekleniyor"
        return False
    ex.move("USDT", min(t, need - f + 0.000001), TRADING, FUNDING)
    return True


def _uid(cl):
    return str(cl.req("GET", "/api/v5/account/config")[0].get("uid") or "")


def _send(ex, side, addr, dest, amt, job, X):
    """Borsalar arası (TR ↔ Global): OKX iç transferi, ücretsiz ve anında; alıcı UID'si karşı hesabın kendi anahtarıyla okunur.
    KASA: Arbitrum One ağıyla, sabit adrese."""
    nm = os.environ.get("OKX_ALICI", "").split()
    if dest:
        cl = _clients()[dest]
        if not cl.ok:
            raise RuntimeError(f"{NAMES[dest]} anahtarı tanımlı değil")
        uid = _uid(cl)
        if not uid or uid == _uid(ex):
            raise RuntimeError(f"{NAMES[dest]} hesap numarası okunamadı; güvenlik için gönderilmedi")
        body = {"ccy": "USDT", "amt": f"{amt:.2f}", "dest": "3", "toAddr": uid, "toAddrType": "2", "clientId": job["id"][:32]}
        fee, chain = 0.0, "OKX iç transfer"
        info = {"walletType": "exchange", "exchId": "okx"}
        if len(nm) >= 2:
            info.update(rcvrFirstName=" ".join(nm[:-1]), rcvrLastName=nm[-1])
    else:
        chain, fee, min_wd = ex.chain()
        if amt < min_wd:
            raise RuntimeError(f"en az {min_wd} USDT gönderilebilir")
        body = {"ccy": "USDT", "amt": f"{amt:.2f}", "dest": "4", "toAddr": addr, "chain": chain,
                "fee": f"{fee:f}".rstrip("0").rstrip(".") or "0", "clientId": job["id"][:32]}
        info = {"walletType": "private"}
    try:
        res = _wd(ex, body, info, nm, dest)
    except RuntimeError as e:
        if not (dest and "58207" in str(e)):
            raise
        # Alıcı hesap (UID) adres defterinde "OKX kullanıcısı" olarak kayıtlı değil: doğrulanmış Arbitrum adresine zincirden gönder
        addr = ROUTES[job["dir"]][1]
        if addr.lower() not in _clients()[dest].dep_addr():
            raise RuntimeError(f"{NAMES[dest]} yatırma adresi kayıtlı adresle tutmuyor; güvenlik için gönderilmedi")
        chain, fee, min_wd = ex.chain()
        body = {"ccy": "USDT", "amt": f"{amt:.2f}", "dest": "4", "toAddr": addr, "chain": chain,
                "fee": f"{fee:f}".rstrip("0").rstrip(".") or "0", "clientId": job["id"][:32]}
        res = _wd(ex, body, info, nm, dest)
    job.update(stage="sent", wdId=res.get("wdId"), fee=fee, chain=chain, sent_ts=int(time.time() * 1000))
    X["day_sum"] = round(X.get("day_sum", 0) + amt, 2)
    _note(X, f"{NAMES[side]} → {NAMES[dest]}: {amt:.2f} USDT gönderildi ({chain}, ücret {fee:g})")


def _wd(ex, body, info, nm, dest):
    try:
        return ex.req("POST", "/api/v5/asset/withdrawal", body)[0]
    except RuntimeError as e:
        s = str(e).lower()
        if not any(k in s for k in ("rcvr", "travel", "receiver", "recipient", "beneficiary", "wallet type", "local laws")):
            raise
        # Seyahat kuralı: alıcı bilgisiyle tekrar dene
        if dest and len(nm) < 2:
            raise RuntimeError(f"OKX alıcı adı istiyor; GitHub'a OKX_ALICI (ad soyad) eklenmeli · {e}")
        body["rcvrInfo"] = info
        return ex.req("POST", "/api/v5/asset/withdrawal", body)[0]


WD_STATE = {"-3": "iptal ediliyor", "-2": "iptal edildi", "-1": "başarısız", "0": "sırada", "1": "zincire gönderiliyor",
            "2": "gönderildi", "7": "onaylandı", "10": "aktarım bekliyor", "4": "inceleniyor", "5": "inceleniyor",
            "6": "inceleniyor", "8": "inceleniyor", "9": "inceleniyor", "12": "inceleniyor", "15": "inceleniyor", "16": "inceleniyor"}


def _poll(C, job, X, N):
    src, addr, dest = ROUTES[job["dir"]]
    ex = C[src]
    if job["stage"] == "sent":
        rows = ex.req("GET", f"/api/v5/asset/withdrawal-history?wdId={job['wdId']}")
        if not rows:
            return
        w = rows[0]
        st = str(w.get("state"))
        job["msg"] = WD_STATE.get(st, f"durum {st}")
        job["txId"] = w.get("txId") or job.get("txId")
        if st in ("-1", "-2"):
            job["stage"] = "failed"
            N.add("alerts", "Aktarım yapılamadı", f"{NAMES[src]} → {NAMES[dest]} {job['amt']} USDT: {job['msg']}", 5, ["warning"])
            return
        if st == "2":
            job["stage"] = "done" if dest is None else "arriving"
            if dest is None:
                N.add("money", "KASA'ya gönderildi", f"{job['amt']} USDT soğuk cüzdana gönderildi (Arbitrum).", 4, ["lock"])
    if job["stage"] == "arriving":
        dex = C[dest]
        rows = dex.req("GET", "/api/v5/asset/deposit-history?ccy=USDT")
        hit = next((d for d in rows if job.get("txId") and d.get("txId") == job["txId"]), None)
        if not hit:  # iç transferde zincir kaydı olmaz: tutar ve zamanla eşleştirilir
            used = set(X.get("used_dep", []))
            hit = next((d for d in rows if d.get("depId") not in used and abs(float(d.get("amt") or 0) - job["amt"]) < 0.02
                        and int(d.get("ts") or 0) >= job.get("sent_ts", 0) - 120_000), None)
            if hit:
                X["used_dep"] = (X.get("used_dep", []) + [hit.get("depId")])[-50:]
        if not hit:
            job["msg"] = f"{NAMES[dest]}'e ulaşması bekleniyor"
            return
        if str(hit.get("state")) not in ("1", "2"):
            job["msg"] = f"{NAMES[dest]} onayı bekleniyor"
            return
        got = float(hit.get("amt") or 0)
        job["got"] = got
        if dest == "g":
            X["g_base"] = round(X.get("g_base", 0) + got, 2)
            job["stage"] = "done"
            N.add("money", "OKX Global'e ulaştı", f"{got:.2f} USDT OKX Global'e geçti.", 4, ["globe_with_meridians"])
        else:  # TR'ye geldi: TL'ye çevrilip "Nakit"e konur
            X["g_base"] = round(max(0.0, X.get("g_base", 0) - job["amt"]), 2)
            try:
                dex.move("USDT", got, FUNDING, TRADING)
                time.sleep(0.5)
                usdt = min(got, dex.trading("USDT"))
                dex.market("USDT-TRY", "sell", f"{math.floor(usdt * 100) / 100:.2f}")
                time.sleep(1)
                tl = dex.trading("TRY")
                tl_got = min(tl, usdt * _rate() * 1.01)
                dex.move("TRY", tl_got, TRADING, FUNDING)
                job["tl"] = round(tl_got, 2)
                N.add("money", "OKX TR'ye ulaştı", f"{got:.2f} USDT geldi, ~{tl_got:,.0f} TL'ye çevrilip Nakit'e kondu. Bankaya çekebilirsin.".replace(",", "."), 4, ["moneybag"])
            except Exception as e:
                N.add("alerts", "TR'ye geldi ama TL'ye çevrilemedi", f"{got:.2f} USDT TR'de duruyor: {e}", 4, ["warning"])
            job["stage"] = "done"
        job["msg"] = "tamamlandı"
        _note(X, f"{NAMES[dest]}'e ulaştı: {got:.2f} USDT")


def _sweep(C, X, cfg, N):
    """Global kârının bir kısmını KASA'ya gönderir (aralık dolunca)."""
    if not cfg.get("sweep_on") or not C["g"].ok:
        return
    now = time.time()
    if now - X.get("sweep_at", 0) < cfg["sweep_days"] * 86400:
        return
    X["sweep_at"] = now
    val = float(C["g"].req("GET", "/api/v5/asset/asset-valuation?ccy=USDT")[0].get("totalBal") or 0)
    base = X.get("g_base", 0)
    profit = val - base
    X["g_val"] = round(val, 2)
    if base <= 0 or profit < cfg["sweep_min"]:
        _note(X, f"Kâr süpürme: Global {val:.2f} $ · giren {base:.2f} $ · gönderilecek kâr yok")
        return
    amt = math.floor(profit * cfg["sweep_pct"] / 100 * 100) / 100
    X["jobs"].append({"id": f"sweep{int(now)}", "dir": "g2k", "amt": amt, "src": "kar", "ts": int(now * 1000), "stage": "new", "msg": "kâr süpürme"})
    X["g_base"] = round(val - amt, 2)  # kalan kâr yeni taban olur (aynı kâr iki kez süpürülmez)


def step(state, S, N):
    cfg = {**DEFAULT, **(S.get("xfer") or {})}
    X = state.setdefault("xfer", {"jobs": [], "seen": [], "log": [], "g_base": 0})
    C = _clients()
    if not C["tr"].ok:
        return
    now = time.time()
    if X.get("day") != _day():
        X["day"], X["day_sum"] = _day(), 0
    # yeni istekler
    for r in (S.get("xfer_req") or []):
        rid = str(r.get("id") or "")
        if not rid or rid in X["seen"] or r.get("dir") not in ROUTES:
            continue
        X["seen"] = (X["seen"] + [rid])[-100:]
        if now * 1000 - float(r.get("ts") or 0) > 3600_000:
            continue  # bir saatten eski istek (bot kapalıyken kalmış) işlenmez
        amt = round(float(r.get("amt") or 0), 2)
        X["jobs"].append({"id": rid, "dir": r["dir"], "amt": amt, "src": r.get("src") or "bos", "ts": int(r.get("ts") or now * 1000),
                          "stage": "new", "msg": "sırada"})
        _note(X, f"İstek: {NAMES[ROUTES[r['dir']][0]]} → {NAMES[ROUTES[r['dir']][2]]} {amt:.2f} USDT")
    # iptal istekleri: henüz gönderilmemiş işler durdurulur, fon hesabına ayrılan para alım-satım hesabına geri döner
    for rid in (S.get("xfer_cancel") or []):
        job = next((j for j in X["jobs"] if j["id"] == str(rid) and j["stage"] == "new"), None)
        if not job:
            continue
        src = ROUTES[job["dir"]][0]
        try:
            ex = C[src]
            back = min(job["amt"], ex.funding("USDT", total=True))
            if back > 0 and ex.ok:
                ex.move("USDT", back, FUNDING, TRADING)
            job.update(stage="failed", msg=f"iptal edildi; {back:.2f} USDT alım-satım hesabına geri kondu")
        except Exception as e:
            job.update(stage="failed", msg=f"iptal edildi; para fon hesabında kaldı ({str(e)[:80]})")
        _note(X, f"İptal: {NAMES[src]} {job['amt']} USDT · {job['msg']}")
        N.add("money", "Aktarım iptal edildi", job["msg"], 3, ["x"])
    try:
        _sweep(C, X, cfg, N)
    except Exception as e:
        print("Kâr süpürme hatası:", e)
    # işler (en fazla 15 sn'de bir dokunulur)
    if now - X.get("tick", 0) >= 15:
        X["tick"] = now
        for job in X["jobs"]:
            if job["stage"] in ("done", "failed"):
                continue
            src, addr, dest = ROUTES[job["dir"]]
            ex = C[src]
            try:
                if not ex.ok:
                    raise RuntimeError(f"{NAMES[src]} anahtarı tanımlı değil")
                if job["stage"] == "new":
                    if job["amt"] < 1:
                        raise RuntimeError("tutar çok küçük")
                    if X.get("day_sum", 0) + job["amt"] > float(cfg["daily_max"]):
                        job["msg"] = f"günlük sınır ({cfg['daily_max']} $) dolu; yarın gönderilecek"
                        continue
                    if (src == "tr" and job["src"] != "bot" and ex.funding("USDT", total=True) < job["amt"] - 0.01
                            and _free_tr(ex, state) < job["amt"] * _rate() * 0.97):
                        job["msg"] = "TR'de boşta yeterli para yok (botun parasına dokunulmaz); bekleniyor"
                        if now * 1000 - job["ts"] > 86400_000:
                            raise RuntimeError("24 saat içinde boş para oluşmadı")
                        continue
                    if not _prepare(ex, src, job["amt"], job):
                        if now * 1000 - job["ts"] > (7 if job.get("locked") else 1) * 86400_000:
                            raise RuntimeError(job["msg"])
                        continue
                    _send(ex, src, addr, dest, job["amt"], job, X)
                else:
                    _poll(C, job, X, N)
            except Exception as e:
                job.update(stage="failed", msg=str(e)[:300])
                if job["stage"] == "failed" and src == "tr" and ex.ok:  # hazırlanan para fon hesabında kalmasın
                    try:
                        back = min(job["amt"], ex.funding("USDT", total=True))
                        if back > 0.01:
                            ex.move("USDT", back, FUNDING, TRADING)
                            job["msg"] += f" · {back:.2f} USDT alım-satım hesabına geri kondu"
                    except Exception:
                        pass
                _note(X, f"HATA {NAMES[src]} → {NAMES[dest]} {job['amt']} USDT: {job['msg']}")
                N.add("alerts", "Aktarım yapılamadı", f"{NAMES[src]} → {NAMES[dest]} {job['amt']} USDT: {job['msg']}", 5, ["warning"])
        X["jobs"] = [j for j in X["jobs"] if j["stage"] not in ("done", "failed") or now * 1000 - j["ts"] < 7 * 86400_000][-30:]
    # uygulama için bakiye özeti (dakikada bir)
    if now - X.get("bal_at", 0) >= 60:
        X["bal_at"] = now
        try:
            X["free_tl"] = round(_free_tr(C["tr"], state), 2)
        except Exception as e:
            X["free_tl"] = None
            print("TR boş bakiye okunamadı:", e)
        if C["g"].ok:
            try:
                X["g_val"] = round(float(C["g"].req("GET", "/api/v5/asset/asset-valuation?ccy=USDT")[0].get("totalBal") or 0), 2)
            except Exception as e:
                print("Global bakiye okunamadı:", e)
        try:
            X["kasa"] = kasa_balance()
        except Exception as e:
            print("KASA bakiyesi okunamadı:", e)
        try:
            X["tr_total"] = round(float(C["tr"].req("GET", "/api/v5/asset/asset-valuation?ccy=USDT")[0].get("totalBal") or 0), 2)
        except Exception as e:
            print("TR toplamı okunamadı:", e)
        X["usdtry"] = round(_rate(), 4)


def public(state, S=None):
    X = state.get("xfer")
    if not X:
        return None
    cfg = {**DEFAULT, **((S or {}).get("xfer") or {})}
    return {"jobs": [{k: j.get(k) for k in ("id", "dir", "amt", "src", "ts", "stage", "msg", "got", "tl")} for j in X["jobs"]][::-1][:10],
            "log": X.get("log", [])[:20], "free_tl": X.get("free_tl"), "g_val": X.get("g_val"), "kasa": X.get("kasa"),
            "tr_total": X.get("tr_total"), "usdtry": X.get("usdtry"), "g_base": X.get("g_base", 0),
            "day_sum": X.get("day_sum", 0), "daily_max": cfg["daily_max"], "sweep": {k: cfg[k] for k in ("sweep_on", "sweep_pct", "sweep_days")},
            "sweep_at": int(X.get("sweep_at", 0) * 1000)}
