"""Para aktarımı (alıcı adı ve adresi OKX_ALICI / OKX_ALICI_ADRES gizli ayarlarından): OKX TR ↔ OKX Global ↔ KASA (soğuk cüzdan), USDT, Arbitrum One ağı.

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
import copy
import hashlib
import hmac
import json
import math
import os
import threading
import time
import urllib.request
from datetime import datetime, timezone, timedelta

KASA = "0x011354d853f6FE89D5780E912bDC5cE697607db7"   # Trust Wallet "KASA" (Arbitrum)
G_DEP = "0x74877903737257289dc07e7baf1f4b078c2a82a3"  # OKX Global USDT yatırma adresi (Arbitrum One)
TR_DEP = "0x1e194face9b26c78f75d854d741cf6547730b705"  # OKX TR USDT yatırma adresi (Arbitrum One)
ROUTES = {  # yön: (kaynak, hedef adres, hedef borsa ya da None)
    "tr2g": ("tr", G_DEP, "g"), "g2tr": ("g", TR_DEP, "tr"), "tr2k": ("tr", KASA, None), "g2k": ("g", KASA, None)}
NAMES = {"tr": "OKX TR", "g": "OKX Global", None: "KASA", "m": "MEME"}
MEME_DIRS = {"g2m": ("g", "m"), "m2g": ("m", "g")}  # SOL ile; ayrıntı meme_aktar.py
FUNDING, TRADING = "6", "18"
HARD_DAILY_MAX = 1000  # $: güvenlik tavanı — ayardan daha yükseği girilse de günlük aktarım bunu aşamaz
# Borsanın geçici "meşgul" cevapları: istek işlenmeden reddedilir, yeniden denemek güvenlidir
BUSY = {"50011", "50013", "50001", "50061"}
DEFAULT = {"daily_max": 1000, "sweep_on": True, "sweep_pct": 50, "sweep_days": 7, "sweep_min": 10, "use_bot": False}


class Ex:
    def __init__(self, base, pre):
        self.base = base
        self.key, self.sec, self.pas = (os.environ.get(pre + s, "") for s in ("_API_KEY", "_API_SECRET", "_API_PASSPHRASE"))

    @property
    def ok(self):
        return bool(self.key and self.sec and self.pas)

    def req(self, method, path, body=None, _try=0):
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
        if d.get("code") in BUSY and _try < 3:
            # borsa "çok fazla istek / meşgul" dedi: istek işlenmedi, kısa bekleyip yeniden denenir
            time.sleep(1.5 * (_try + 1))
            return self.req(method, path, body, _try + 1)
        if d.get("code") != "0":
            d0 = (d.get("data") or [{}])[0]
            raise RuntimeError(f"{d.get('code')}: {d.get('msg') or ''} {d0.get('sMsg', '')}".strip() + ("" if d.get("msg") else f" {json.dumps(d)[:200]}"))
        return d["data"]

    def trading(self, ccy):
        for x in self.req("GET", f"/api/v5/account/balance?ccy={ccy}")[0].get("details", []):
            if x["ccy"] == ccy:
                return float(x.get("availBal") or 0)
        return 0.0

    def funding(self, ccy, total=False):
        # OKX TR fon hesabında "availBal" çekilebilir parayı 0 gösterebiliyor (çekim yine de yapılabiliyor);
        # bu yüzden kullanılabilir = bakiye − dondurulan alınır
        d = self.req("GET", f"/api/v5/asset/balances?ccy={ccy}")
        if not d:
            return 0.0
        return float(d[0].get("bal") or 0) - (0 if total else float(d[0].get("frozenBal") or 0))

    def move(self, ccy, amt, frm, to, cid=None):
        if amt > 0:
            body = {"ccy": ccy, "amt": f"{math.floor(amt * 1e6) / 1e6:f}", "from": frm, "to": to, "type": "0"}
            if cid:
                body["clientId"] = cid  # kendi kimliğimiz: yanıt kaybolursa aktarım bu kimlikle sorulur (moved)
            self.req("POST", "/api/v5/asset/transfer", body)

    def moved(self, cid):
        """Bu kimlikle yapılmış hesaplar arası aktarım tamamlanmış mı? True: evet; None: bilinmiyor / kayıt yok."""
        try:
            rows = self.req("GET", f"/api/v5/asset/transfer-state?clientId={cid}&type=0")
        except Exception:
            return None
        return True if any(r.get("clientId") == cid and r.get("state") == "success" for r in rows or []) else None

    def chain(self):
        """USDT'nin Arbitrum One ağı: tam ağ adı, ücret, en az çekim."""
        for c in self.req("GET", "/api/v5/asset/currencies?ccy=USDT"):
            if "arbitrum" in c["chain"].lower() and c.get("canWd"):
                return c["chain"], float(c.get("fee") or c.get("minFee") or 0), float(c.get("minWd") or 0)
        raise RuntimeError("Arbitrum One ağında USDT çekimi şu an kapalı")

    def dep_addr(self):
        return {x["addr"].lower() for x in self.req("GET", "/api/v5/asset/deposit-address?ccy=USDT") if "arbitrum" in x["chain"].lower()}

    def market(self, inst, side, sz, quote=False, cl=None):
        body = {"instId": inst, "tdMode": "cash", "side": side, "ordType": "market", "sz": sz}
        if quote:
            body["tgtCcy"] = "quote_ccy"
        if cl:
            body["clOrdId"] = cl  # kendi emir kimliğimiz: yanıt kaybolursa emir bu kimlikle bulunur (iki kez verilmez)
        return self.req("POST", "/api/v5/trade/order", body)[0]

    def find_order(self, inst, cl):
        """clOrdId ile emri arar. Emir yoksa None; borsaya sorulamadıysa hata yükselir."""
        try:
            d = self.req("GET", f"/api/v5/trade/order?instId={inst}&clOrdId={cl}")
        except RuntimeError as e:
            if "51603" in str(e):  # emir yok
                return None
            raise
        return d[0] if d else None


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
    res = 0.0
    if side == "g" and job.get("src") != "kar":
        from . import gspot
        res = gspot.FUNDRES["v"]  # Global spot'un fon hesabında bekleyen parası elle aktarımda kullanılmaz
    f = ex.funding("USDT") - res
    if f >= need:
        return True
    if res and ex.funding("USDT") >= need:
        job["msg"] = f"Global fon hesabındaki {res:.2f} $ Global spot masasına ayrılmış; gönderilebilir {max(0.0, f):.2f} $ (masanın bütçesini düşürürsen açılır)"
        return False
    if ex.funding("USDT", total=True) >= need:
        # Para fon hesabında ama borsa henüz çekime açmamış (OKX TR'de yeni yatırılan TL ile alınanlarda bekleme süresi olur)
        job["msg"] = f"para {NAMES[side]} fon hesabında hazır; borsa çekim kilidi kalkınca otomatik gönderilecek"
        job["locked"] = True
        return False
    # Global'in işlem hesabındaki USDT gerçek kaldıraç masasının teminatıdır; aktarım ona dokunmaz
    t = ex.trading("USDT") if side == "tr" else 0.0
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


def _net_err(e):
    """Ağ/yanıt hatası mı (istek borsaya ulaşmış olabilir, sonucu bilinmiyor)? Borsanın açık reddi (RuntimeError) değildir."""
    import http.client
    return isinstance(e, (OSError, http.client.HTTPException, json.JSONDecodeError)) and not isinstance(e, RuntimeError)


def _uid(cl):
    return str(cl.req("GET", "/api/v5/account/config")[0].get("uid") or "")


def _already(ex, job, X):
    """Aynı istek daha önce gönderilmiş mi (bot yeniden başladıysa iki kez gönderilmesin)."""
    try:
        rows = ex.req("GET", f"/api/v5/asset/withdrawal-history?clientId={job['id'][:32]}")
    except Exception:
        return None  # bilinmiyor: bu tur gönderme
    rows = [r for r in rows if r.get("clientId") == job["id"][:32]]
    if not rows:
        return False
    job.update(stage="sent", wdId=rows[0].get("wdId"), sent_ts=int(rows[0].get("ts") or time.time() * 1000))
    if not job.get("link"):  # zincirin 2. adımı (MEME → Global → KASA/TR) aynı para: günlük sınıra bir kez sayılır
        X["day_sum"] = round(X.get("day_sum", 0) + job["amt"], 2)
    return True


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
        info = {"walletType": "exchange", "exchId": "did:ethr:0xd2cdd38f986924dc26850e6ff998304d398559bb"}  # OKX (borsa listesi)
        if len(nm) >= 2:
            info.update(rcvrFirstName=" ".join(nm[:-1]), rcvrLastName=nm[-1])
        # Türkiye kuralı: alıcı adresi de istenir. GitHub gizli ayarı OKX_ALICI_ADRES = "İl|İlçe|Mahalle ve sokak"
        ad = [x.strip() for x in os.environ.get("OKX_ALICI_ADRES", "").split("|")]
        if len(ad) >= 3 and all(ad[:3]):
            info.update(rcvrCountry="Turkey", rcvrCountrySubDivision=ad[0], rcvrTownName=ad[1], rcvrStreetName=ad[2])
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
        if dest and ("58207" in str(e) or "58380" in str(e)):
            # Borsalar arası (TR ↔ Global) yalnız OKX iç transferiyle (kullanıcı tercihi: zincir yok, ücret yok).
            # 58207: alıcı UID gönderen borsanın adres defterinde "OKX kullanıcısı (UID)" olarak doğrulanmış kayıtlı değil
            src_nm = "OKX TR" if dest == "g" else "OKX Global"
            raise RuntimeError(f"{src_nm} iç transferi kabul etmedi ({str(e)[:70]}). {src_nm} adres defterine {NAMES[dest]} UID'ni "
                               f"'OKX kullanıcısı · UID' olarak ekle ve API çekimi için doğrulamasız işaretle; sonra tekrar dene")
        raise
    job.update(stage="sent", wdId=res.get("wdId"), fee=fee, chain=chain, sent_ts=int(time.time() * 1000))
    if not job.get("link"):  # zincirin 2. adımı günlük sınıra ikinci kez sayılmaz
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
        if dest and "rcvrStreetName" in str(e) and "rcvrStreetName" not in info:
            raise RuntimeError("OKX TR alıcı adresi istiyor; GitHub'a OKX_ALICI_ADRES (İl|İlçe|Mahalle ve sokak) eklenmeli")
        body["rcvrInfo"] = info
        try:
            return ex.req("POST", "/api/v5/asset/withdrawal", body)[0]
        except RuntimeError as e2:
            if "58380" not in str(e2) or "rcvrCountry" not in info:
                raise
            # 58380 (açıklamasız): alıcı bilgisinin biçimi. Ülke kodu ve Türkçe harfsiz yazımla dene
            tr_ = str.maketrans("çğıöşüÇĞİÖŞÜ", "cgiosuCGIOSU")
            last = e2
            for country, fold in (("TR", False), ("TR", True), ("Turkey", True), ("Türkiye", False)):
                alt = {k: (v.translate(tr_) if fold and isinstance(v, str) else v) for k, v in info.items()}
                alt["rcvrCountry"] = country
                body["rcvrInfo"] = alt
                try:
                    r = ex.req("POST", "/api/v5/asset/withdrawal", body)[0]
                    print("Aktarım: alıcı bilgisi biçimi kabul edildi:", country, "harfsiz" if fold else "")
                    return r
                except RuntimeError as e3:
                    last = e3
                    if "58380" not in str(e3):
                        raise
            raise last


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
            raise RuntimeError(f"OKX çekimi reddetti ({job['msg']})")
        if st == "2" and dest is None:
            # KASA'ya: OKX "gönderildi" dese de işlem Arbitrum zincirinde onaylanınca tamamlandı sayılır
            ok = None
            if job.get("txId"):
                try:
                    rc = _rpc("eth_getTransactionReceipt", [job["txId"]])
                    ok = None if not rc else (rc.get("status") == "0x1", int(rc.get("blockNumber") or "0x0", 16))
                except Exception:
                    ok = None
            if ok is None:
                job["msg"] = "OKX gönderdi; Arbitrum zincirinde onay bekleniyor"
                return
            if not ok[0]:
                raise RuntimeError("Arbitrum zincirinde işlem başarısız göründü; işlem kodu " + str(job["txId"])[:20])
            job["stage"] = "done"
            job["msg"] = f"KASA'ya ulaştı · zincirde onaylandı (blok {ok[1]})"
            N.add("money", "KASA'ya ulaştı", f"{job['amt']} USDT soğuk cüzdana ulaştı; Arbitrum zincirinde onaylandı.", 4, ["lock"])
            _note(X, f"KASA'ya ulaştı: {job['amt']:.2f} USDT (zincirde onaylı)")
            return
        if st == "2":
            job["stage"] = "arriving"
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
            if dest == "tr":
                # OKX TR gelen parayı gönderici bilgisi (seyahat kuralı) verilene kadar kilitler; bunu yalnız kullanıcı yapabilir
                job["msg"] = "OKX TR gönderici bilgisi istiyor: OKX TR'de bildirime dokun, gönderici kendin (OKX Global) seç; onaylayınca bot TL'ye çevirir"
                if not job.get("tr_asked"):
                    job["tr_asked"] = 1
                    N.add("money", "OKX TR onayın gerekiyor", f"{float(hit.get('amt') or job['amt']):.2f} USDT OKX TR'ye ulaştı ama kilitli. OKX TR uygulamasında bildirime dokun, gönderici olarak kendini (OKX Global) seç.", 5, ["key"])
            else:
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


def _sweep(C, X, cfg, N, state):
    """Gerçek futures masasının fon hesabına aldığı kârın bir kısmını aralık dolunca KASA'ya gönderir.
    Kâr = futures masasının fona aldığı kâr − daha önce süpürülen; dışarıdan yatırılan para kâr sayılmaz."""
    if not cfg.get("sweep_on") or float(cfg.get("sweep_pct") or 0) <= 0 or not C["g"].ok:
        return
    now = time.time()
    if now - X.get("sweep_at", 0) < cfg["sweep_days"] * 86400:
        return
    X["sweep_at"] = now
    LR = state.get("levr") or {}
    if LR.get("reset", 0) != X.get("lev_reset", 0):  # masa yeniden başlatıldı: süpürülen kâr sayacı da sıfırlanır
        X["lev_reset"], X["swept"] = LR.get("reset", 0), 0.0
    harvest = float(LR.get("harvest") or 0)
    profit = harvest - float(X.get("swept", 0))
    if profit < cfg["sweep_min"]:
        _note(X, f"Kâr süpürme: futures'tan fona alınan yeni kâr {max(0, profit):.2f} $; gönderilecek kâr yok")
        return
    amt = math.floor(profit * cfg["sweep_pct"] / 100 * 100) / 100
    X["jobs"].append({"id": f"sweep{int(now)}", "dir": "g2k", "amt": amt, "src": "kar", "ts": int(now * 1000), "stage": "new", "msg": "kâr süpürme"})
    X["swept"] = round(float(X.get("swept", 0)) + profit, 4)  # kârın tamamı sayılır, yüzdesi gönderilir (aynı kâr iki kez süpürülmez)


def _sweep_meme(X, cfg, state):
    """Memecoin kârı: MEME cüzdanı başlangıç tutarının üstüne çıktıysa kârın yüzdesi Global üzerinden KASA'ya gider.
    Açık token varken yapılmaz (kâr henüz kesin değil)."""
    if not cfg.get("sweep_on") or float(cfg.get("sweep_pct") or 0) <= 0:
        return
    R = state.get("memer") or {}
    if not R.get("addr") or not R.get("start") or R.get("pos"):
        return
    if any(j["dir"] in MEME_DIRS and j["stage"] not in ("done", "failed") for j in X.get("jobs", [])):
        return  # yoldaki para kâr sanılmasın
    now = time.time()
    if now - X.get("msweep_at", 0) < cfg["sweep_days"] * 86400:
        return
    X["msweep_at"] = now
    if R.get("reset", 0) != X.get("meme_reset", 0):
        X["meme_reset"], X["mswept"] = R.get("reset", 0), 0.0
    profit = float(R.get("value") or 0) - float(R["start"]) - float(X.get("mswept", 0))
    if profit < cfg["sweep_min"]:
        _note(X, f"Memecoin kâr süpürme: yeni kâr {max(0, profit):.2f} $; gönderilecek kâr yok")
        return
    amt = math.floor(profit * cfg["sweep_pct"] / 100 * 100) / 100
    X["jobs"].append({"id": f"msweep{int(now)}", "dir": "m2g", "amt": amt, "src": "kar", "then": "k", "ts": int(now * 1000),
                      "stage": "new", "msg": "memecoin kâr süpürme (MEME → Global → KASA)"})
    X["mswept"] = round(float(X.get("mswept", 0)) + profit, 4)


_JOBS = {}


class _NoteQ:
    """Arka plandaki iş bildirimleri: ana turda gerçek bildirim kuyruğuna aktarılır."""
    def __init__(self):
        self.items = []

    def add(self, *a, **k):
        self.items.append((a, k))


def _jobs_thread(Xc, C, cfg, state, now):
    q = _NoteQ()
    try:
        _run_jobs(Xc, C, cfg, state, q, now)
    except Exception as e:
        print("Aktarım işleri:", e)
    _JOBS["out"] = (Xc, q.items)


def quiesce(timeout=90):
    """Yeniden başlamadan önce: süren aktarım işi bitsin (yarım kalan SOL/USDT gönderimi tekrar edilmesin)."""
    th = _JOBS.get("t")
    if th and th.is_alive():
        th.join(timeout)


def _track(X):
    """Her aktarımın aşama geçmişi: aşama ya da durum yazısı her değiştiğinde zamanıyla eklenir (uygulamada adım adım
    görünür). Bütün yönler (TR, Global, KASA, MEME) için aynı yerden tutulur."""
    now = int(time.time() * 1000)
    for j in X.get("jobs", []):
        st = j.setdefault("steps", [])
        if not st:
            st.append([j.get("ts") or now, "req", "istek alındı"])
        cur = [j.get("stage"), str(j.get("msg") or "")]
        if st[-1][1:] != cur:
            st.append([now] + cur)
            del st[:-20]


def _bot_withdrawn(X, state):
    """Spot botunun nakdinden gönderilen kısım: gönderim yapılınca botun bütçesinden düşülür (bir kez)."""
    L = state.get("live")
    if not L:
        return
    done = L.setdefault("wd_ids", [])
    for j in X["jobs"]:
        if j.get("bot_tl", 0) > 0 and j["stage"] in ("sent", "arriving", "done") and j["id"] not in done:
            L["wd_off"] = round(L.get("wd_off", 0.0) + j["bot_tl"], 2)
            done.append(j["id"])
            del done[:-50]


def _merge_jobs(X, N):
    out = _JOBS.pop("out", None)
    if not out:
        return
    Xc, notes = out
    base = _JOBS.get("base") or {}
    ids = _JOBS.get("ids") or set()
    cur = {j["id"]: j for j in X["jobs"]}
    for j in Xc["jobs"]:
        old = cur.get(j["id"])
        if old is None:
            if j["id"] not in ids:  # yalnız iş parçacığının yeni açtığı iş (ör. kâr süpürmenin KASA adımı); budananlar geri gelmez
                X["jobs"].append(j)
        elif not (old["stage"] == "failed" and j["stage"] == "new"):  # bu arada iptal edildiyse iptal geçerli
            st = list(old.get("steps") or [])
            old.clear()
            old.update(j)
            have = {tuple(x[1:]) for x in st}
            old["steps"] = sorted(st + [x for x in (j.get("steps") or []) if tuple(x[1:]) not in have], key=lambda x: x[0])[-20:]
    seen = {tuple(x) for x in X.get("log", [])}
    new = [x for x in Xc.get("log", []) if tuple(x) not in seen]
    X["log"] = (new + X.get("log", []))[:60]
    for k in ("day_sum", "g_base"):
        X[k] = round(float(X.get(k, 0)) + float(Xc.get(k, 0)) - float(base.get(k, 0)), 2)
    if Xc.get("used_dep"):
        X["used_dep"] = list(dict.fromkeys(list(X.get("used_dep", [])) + list(Xc["used_dep"])))[-50:]
    for a, k in notes:
        N.add(*a, **k)


def _run_jobs(X, C, cfg, state, N, now):
    """Aktarım işleri (arka planda, durumun kopyası üzerinde çalışır; sonuç ana turda birleştirilir)."""
    for job in X["jobs"]:
        if job["stage"] in ("done", "failed"):
            continue
        if job["dir"] in MEME_DIRS:
            try:
                from . import meme_aktar
                if job["stage"] == "new" and X.get("day_sum", 0) + job["amt"] > float(cfg["daily_max"]):
                    job["msg"] = f"günlük sınır ({cfg['daily_max']} $) dolu; yarın gönderilecek"
                    continue
                if job["stage"] == "new":
                    # "hepsini gönder"de tutar cüzdandaki SOL'a göre sonradan belirlenir: günlük sınırdan kalan pay
                    # işe yazılır, gönderim onu aşamaz
                    job["cap"] = round(float(cfg["daily_max"]) - float(X.get("day_sum", 0)), 2)
                meme_aktar.run(job, X, C, N, _note)
            except Exception as e:
                if ((job["stage"] == "sent" and "reddetti" not in str(e) and "ulaşmadı" not in str(e))
                        or ((job.get("ordId") or job.get("clOrd") or job.get("mv")) and not isinstance(e, RuntimeError))):
                    # ağ hatası: SOL alındıysa, alım emri ya da hesap içi aktarım gönderilmiş olabilirse iş bırakılmaz, tekrar denenir
                    job["msg"] = f"kontrol edilemedi, tekrar denenecek: {str(e)[:120]}"
                else:
                    job.update(stage="failed", msg=str(e)[:300])
                    _note(X, f"Aktarım başarısız: {job['msg']}")
                    N.add("money", "Aktarım başarısız", job["msg"][:200], 4, ["warning"])
            continue
        src, addr, dest = ROUTES[job["dir"]]
        ex = C[src]
        try:
            if not ex.ok:
                raise RuntimeError(f"{NAMES[src]} anahtarı tanımlı değil")
            if job["stage"] == "new":
                if job["amt"] < 1:
                    raise RuntimeError("tutar çok küçük")
                if not job.get("link") and X.get("day_sum", 0) + job["amt"] > float(cfg["daily_max"]):
                    job["msg"] = f"günlük sınır ({cfg['daily_max']} $) dolu; yarın gönderilecek"
                    if now * 1000 - job["ts"] > 3 * 86400_000:
                        raise RuntimeError("3 gün içinde günlük sınır açılmadı")
                    continue
                if src == "tr" and cfg.get("use_bot") and "bot_tl" not in job:
                    # Ayarlar → Aktarım → "Botun parasını kullan": boş para yetmezse eksik kısım Spot botunun nakdinden
                    # alınır; gönderilince botun bütçesi o kadar düşer (kâr/zarar sayılmaz)
                    job["bot_tl"] = round(max(0.0, job["amt"] * _rate() - max(0.0, _free_tr(ex, state))), 2)
                if (src == "tr" and job["src"] != "bot" and not cfg.get("use_bot") and ex.funding("USDT", total=True) < job["amt"] - 0.01
                        and _free_tr(ex, state) < job["amt"] * _rate() * 0.97):
                    job["msg"] = "TR'de boşta yeterli para yok (botun parasına dokunulmaz); bekleniyor"
                    if now * 1000 - job["ts"] > 86400_000:
                        raise RuntimeError("24 saat içinde boş para oluşmadı")
                    continue
                done = _already(ex, job, X)
                if done is None:
                    job["msg"] = "gönderim kontrolü yapılamadı; tekrar denenecek"
                    continue
                if done:
                    continue
                need = job["amt"] + (ex.chain()[1] if dest is None else 0)
                if not _prepare(ex, src, need, job):
                    if now * 1000 - job["ts"] > (7 if job.get("locked") else 1) * 86400_000:
                        raise RuntimeError(job["msg"])
                    continue
                _send(ex, src, addr, dest, job["amt"], job, X)
            else:
                _poll(C, job, X, N)
        except Exception as e:
            if job["stage"] in ("sent", "arriving") and "reddetti" not in str(e):
                job["msg"] = f"kontrol edilemedi, tekrar denenecek: {str(e)[:120]}"  # para yolda; iş bırakılmaz
                continue
            if job["stage"] == "new" and (_net_err(e) or str(e)[:5] in BUSY) and now * 1000 - job["ts"] < 86400_000:
                # Bağlantı hatası: gönderim isteği borsaya ulaşmış olabilir. İş "başarısız" sayılmaz (kullanıcı yeniden
                # isteyip iki kez göndermesin); bir sonraki kontrolde borsadaki kayıtla (clientId) karşılaştırılır:
                # gönderildiyse "gönderildi" olur, gönderilmediyse yeniden denenir.
                job["msg"] = f"bağlantı hatası; gönderim kontrol edilip tekrar denenecek: {str(e)[:100]}"
                continue
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


def step(state, S, N):
    cfg = {**DEFAULT, **(S.get("xfer") or {})}
    cfg["daily_max"] = min(float(cfg.get("daily_max") or HARD_DAILY_MAX), HARD_DAILY_MAX)
    X = state.setdefault("xfer", {"jobs": [], "seen": [], "log": [], "g_base": 0})
    C = _clients()
    if not C["tr"].ok:
        return
    now = time.time()
    if X.get("day") != _day():
        X["day"], X["day_sum"] = _day(), 0
    # yeni istekler
    for r in (S.get("xfer_req") or []):
        if not isinstance(r, dict):
            continue
        rid = str(r.get("id") or "")
        if not rid or rid in X["seen"] or (r.get("dir") not in ROUTES and r.get("dir") not in MEME_DIRS):
            continue
        X["seen"] = (X["seen"] + [rid])[-100:]
        try:
            if now * 1000 - float(r.get("ts") or 0) > 3600_000:
                continue  # bir saatten eski istek (bot kapalıyken kalmış) işlenmez
            amt = round(float(r.get("amt") or 0), 2)
        except (TypeError, ValueError):
            continue
        if not (1 <= amt <= 1e6):
            continue
        job = {"id": rid, "dir": r["dir"], "amt": amt, "src": r.get("src") or "bos", "ts": int(float(r.get("ts") or now * 1000)),
               "stage": "new", "msg": "sırada"}
        if r["dir"] == "m2g" and r.get("all"):
            job["all"] = True  # MEME'deki bütün SOL (tokenler satıldıktan sonra)
        if r["dir"] == "m2g" and r.get("then") in ("k", "tr"):
            job["then"] = r["then"]  # Global'e gelince satılıp KASA'ya / OKX TR'ye devam eder
        if r["dir"] == "g2m" and r.get("wait") and r.get("via") in ("k", "tr"):
            job.update(wait=True, via=r["via"], msg=f"{ {'k': 'KASA', 'tr': 'OKX TR'}[r['via']]}'dan Global'e gelmesi bekleniyor")  # elle gönderilen para gelince MEME'ye geçer
        X["jobs"].append(job)
        a, b = MEME_DIRS.get(r["dir"]) or (ROUTES[r["dir"]][0], ROUTES[r["dir"]][2])
        _note(X, f"İstek: {NAMES[a]} → {NAMES[b]} {amt:.2f} USDT")
    # iptal istekleri: henüz gönderilmemiş işler durdurulur, fon hesabına ayrılan para alım-satım hesabına geri döner
    _th = _JOBS.get("t")
    busy = bool(_th and _th.is_alive())  # iş parçacığı gönderim yaparken iptal edilmez (sonraki turda yeniden bakılır)
    if not busy:
        _merge_jobs(X, N)  # biten işin sonucu önce işlenir (gönderilmiş iş iptal sanılmasın)
    for rid in ([] if busy else (S.get("xfer_cancel") or [])):
        job = next((j for j in X["jobs"] if j["id"] == str(rid) and j["stage"] == "new"), None)
        if not job:
            continue
        if job["dir"] in MEME_DIRS:
            job.update(stage="failed", msg="iptal edildi")
            _note(X, f"İptal: {job['dir']} {job['amt']} USDT")
            continue
        src = ROUTES[job["dir"]][0]
        try:
            ex = C[src]
            back = min(job["amt"], ex.funding("USDT", total=True)) if src == "tr" else 0.0
            if back > 0 and ex.ok:
                ex.move("USDT", back, FUNDING, TRADING)
            job.update(stage="failed", msg=f"iptal edildi; {back:.2f} USDT alım-satım hesabına geri kondu")
        except Exception as e:
            job.update(stage="failed", msg=f"iptal edildi; para fon hesabında kaldı ({str(e)[:80]})")
        _note(X, f"İptal: {NAMES[src]} {job['amt']} USDT · {job['msg']}")
        N.add("money", "Aktarım iptal edildi", job["msg"], 3, ["x"])
    try:
        _sweep(C, X, cfg, N, state)
        _sweep_meme(X, cfg, state)
    except Exception as e:
        print("Kâr süpürme hatası:", e)
    # işler (en fazla 15 sn'de bir; arka planda: borsa istekleri ana turu bekletmez)
    th = _JOBS.get("t")
    alive = bool(th and th.is_alive())  # önce bakılır: iş parçacığı bu arada biterse sonucu aşağıda birleşir, ikinci kez başlamaz
    _merge_jobs(X, N)
    _track(X)
    _bot_withdrawn(X, state)
    if now - X.get("tick", 0) >= 15 and not alive and any(j["stage"] not in ("done", "failed") for j in X["jobs"]):
        X["tick"] = now
        snap = copy.deepcopy(X)
        _JOBS["base"] = {k: snap.get(k, 0) for k in ("day_sum", "g_base")}
        _JOBS["ids"] = {j["id"] for j in snap["jobs"]}
        _JOBS["t"] = threading.Thread(target=_jobs_thread, args=(snap, C, cfg, state, now), daemon=True)
        _JOBS["t"].start()
        X["jobs"] = [j for j in X["jobs"] if j["stage"] not in ("done", "failed") or now * 1000 - j["ts"] < 7 * 86400_000][-30:]
    # uygulama için bakiye özeti (dakikada bir, arka planda: ana turu bekletmez)
    if now - X.get("bal_at", 0) >= (60 if X.get("dust_at", 1) else 5) and not (_BAL.get("t") and _BAL["t"].is_alive()):
        X["bal_at"], X["dust_at"] = now, 1
        o = state.get("okx") or {}
        bot_cash = float((state.get("live") or {}).get("cash") or 0)
        _BAL["t"] = threading.Thread(target=_balances, args=(C, o, bot_cash), daemon=True)
        _BAL["t"].start()
    if _BAL.get("out"):
        X.update(_BAL.pop("out"))


_BAL = {}


_GUID = {}


def _balances(C, o, bot_cash):
    out = {}
    if "v" not in _GUID and C["g"].ok:
        try:  # OKX Global hesap numarası (UID): uygulamada OKX TR'den iç transferde alıcı olarak kopyalanır
            _GUID["v"] = _uid(C["g"])
        except Exception as e:
            print("Global UID okunamadı:", e)
    if "tr" not in _GUID and C["tr"].ok:
        try:
            _GUID["tr"] = _uid(C["tr"])
        except Exception as e:
            print("TR UID okunamadı:", e)
    if _GUID.get("v"):
        out["g_uid"] = _GUID["v"]
    if _GUID.get("tr"):
        out["tr_uid"] = _GUID["tr"]
    try:
        r = _rate()
        out["usdtry"] = round(r, 4)
        # botun okuduğu hesap bilgisi tekrar istenmez: işlem hesabı boş TL+USDT (check_okx) + fon hesabı
        cash = float(o.get("try") or 0) + float(o.get("usdt_tl") or 0) + float(o.get("fund_tl") or 0)
        out["free_tl"] = round(cash - bot_cash, 2) if o.get("ok") else None
        if o.get("total_tl") and r:
            out["tr_total"] = round(float(o["total_tl"]) / r, 2)
    except Exception as e:
        print("TR bakiye özeti:", e)
    if C["g"].ok:
        try:
            out["g_val"] = round(float(C["g"].req("GET", "/api/v5/asset/asset-valuation?ccy=USDT")[0].get("totalBal") or 0), 2)
            from . import gspot
            out["g_fund"] = round(max(0.0, C["g"].funding("USDT") - gspot.FUNDRES["v"]), 2)  # gönderilebilir: fon hesabındaki boş USDT (futures teminatı hariç)
        except Exception as e:
            print("Global bakiye okunamadı:", e)
    try:
        from . import dust
        out["dust"] = dust.scan(C)
    except Exception as e:
        print("Küçük bakiyeler okunamadı:", e)
    try:
        out["kasa"] = kasa_balance()
    except Exception as e:
        print("KASA bakiyesi okunamadı:", e)
    _BAL["out"] = out


def public(state, S=None):
    X = state.get("xfer")
    if not X:
        return None
    cfg = {**DEFAULT, **((S or {}).get("xfer") or {})}
    cfg["daily_max"] = min(float(cfg.get("daily_max") or HARD_DAILY_MAX), HARD_DAILY_MAX)
    return {"jobs": [{k: j.get(k) for k in ("id", "dir", "amt", "src", "ts", "stage", "msg", "got", "tl", "then", "wait", "via", "steps", "txId", "chain", "fee", "sol")}
                     for j in X["jobs"]][::-1][:10],
            "log": X.get("log", [])[:20], "free_tl": X.get("free_tl"), "g_val": X.get("g_val"), "kasa": X.get("kasa"),
            "tr_total": X.get("tr_total"), "usdtry": X.get("usdtry"), "g_uid": X.get("g_uid"), "tr_uid": X.get("tr_uid"), "g_base": X.get("g_base", 0),
            "day_sum": X.get("day_sum", 0), "daily_max": cfg["daily_max"], "sweep": {k: cfg[k] for k in ("sweep_on", "sweep_pct", "sweep_days")},
            "sweep_at": int(X.get("sweep_at", 0) * 1000), "dust": X.get("dust")}
