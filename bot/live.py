"""Gerçek para modu: OKX TR'de gerçek spot emirleri.

Güvenlik ilkeleri:
- Anahtarlar sadece GitHub Secrets'tan (ortam değişkeni) okunur, hiçbir dosyaya yazılmaz.
- Anahtarın sadece Okuma + Al-Sat izni olmalı; para çekme izni OLMAMALI.
- Bot, hesaptaki paranın tamamını değil, sadece belirlenen bütçeyi (MASAL_BUDGET) kullanır.
- MASAL_LIVE=1 değilse hiçbir gerçek emir gönderilmez (deneme modu: emirler sadece kayda yazılır).
"""
import base64
import hashlib
import hmac
import json
import math
import os
import time
import urllib.request
from datetime import datetime, timezone

from . import config, okx
from .engine import Portfolio


def quote_of(inst):
    return inst.split("-")[1]


_INST = {}
ALGO_CL = "mslp"  # botun koyduğu koruma emirlerinin kimlik öneki (algoClOrdId): yalnız bu önekli emirler botundur


class OrderUnsure(Exception):
    """Emir gönderildi ama sonucu öğrenilemedi (yanıt ağda kayboldu ve borsaya sorulamadı). Emir "olmadı" sayılmaz ve
    yeniden verilmez: kendi kimliğiyle (clOrdId) kayda alınır, borsaya ulaşılınca sonucu işlenir."""

    def __init__(self, cl, oid=None, cause=None):
        super().__init__(f"emrin sonucu doğrulanamadı ({cause})")
        self.cl, self.oid = cl, oid


class OkxPrivate:
    def __init__(self):
        self.key = os.environ.get("OKX_API_KEY", "")
        self.secret = os.environ.get("OKX_API_SECRET", "")
        self.passphrase = os.environ.get("OKX_API_PASSPHRASE", "")
        if not (self.key and self.secret and self.passphrase):
            raise RuntimeError("API anahtarları tanımlı değil (GitHub Secrets).")
        self._inst = _INST  # coin kuralları (adım, asgari miktar) oturum boyunca bir kez alınır

    def _req(self, method, path, body=None):
        now = datetime.now(timezone.utc)
        ts = now.strftime("%Y-%m-%dT%H:%M:%S.") + f"{now.microsecond // 1000:03d}Z"
        payload = json.dumps(body, separators=(",", ":")) if body else ""
        sign = base64.b64encode(hmac.new(self.secret.encode(), (ts + method + path + payload).encode(),
                                         hashlib.sha256).digest()).decode()
        req = urllib.request.Request(config.BASE_URL + path, data=payload.encode() if body else None, method=method,
                                     headers={"OK-ACCESS-KEY": self.key, "OK-ACCESS-SIGN": sign,
                                              "OK-ACCESS-TIMESTAMP": ts, "OK-ACCESS-PASSPHRASE": self.passphrase,
                                              "Content-Type": "application/json", "User-Agent": "masal/1.0"})
        with urllib.request.urlopen(req, timeout=15) as r:
            res = json.load(r)
        if res.get("code") != "0":
            d0 = res.get("data", [{}])[0] if res.get("data") else {}
            sc = f"/{d0.get('sCode')}" if d0.get("sCode") else ""
            raise RuntimeError(f"OKX {res.get('code')}{sc}: {res.get('msg')} {d0.get('sMsg', '')}".strip())
        return res["data"]

    def available(self, ccy):
        data = self._req("GET", f"/api/v5/account/balance?ccy={ccy}")
        for d in data[0].get("details", []):
            if d["ccy"] == ccy:
                return float(d.get("availBal") or 0)
        return 0.0

    def instrument(self, inst):
        if inst not in self._inst:
            from . import okx
            row = okx._get("/api/v5/public/instruments", {"instType": "SPOT", "instId": inst})[0]
            self._inst[inst] = (float(row["lotSz"]), float(row["minSz"]), float(row["tickSz"]))
        return self._inst[inst]

    def protect(self, inst, qty, tp=None, sl=None):
        """Borsa tarafında kâr al / zarar durdur emri. Tetiklenince piyasa fiyatından satar."""
        lot_sz, min_sz, tick = self.instrument(inst)
        sz = floor_to(qty, lot_sz)
        if sz < min_sz or not (tp or sl):
            return None
        body = {"instId": inst, "tdMode": "cash", "side": "sell", "sz": fmt(sz, lot_sz),
                "ordType": "oco" if tp and sl else "conditional"}
        if tp:
            body.update(tpTriggerPx=fmt(math.ceil(tp / tick) * tick, tick), tpOrdPx="-1")
        if sl:
            body.update(slTriggerPx=fmt(math.floor(sl / tick) * tick, tick), slOrdPx="-1")
        # Kendi kimliğimiz: kayıtta karşılığı kalmayan (sahipsiz) koruma emri bu önekle tanınıp iptal edilir;
        # kullanıcının OKX'ten elle koyduğu emirlerde bu önek olmaz, onlara dokunulmaz.
        body["algoClOrdId"] = ALGO_CL + os.urandom(12).hex()
        return self._req("POST", "/api/v5/trade/order-algo", body)[0]["algoId"]

    def algo(self, algo_id):
        return self._req("GET", f"/api/v5/trade/order-algo?algoId={algo_id}")[0]

    def pending_algo_ids(self):
        """Borsada bekleyen bütün koruma emirlerinin kimlikleri (tek istek). Liste eksik olabilirse None.
        Aynı yanıttaki botun kendi emirleri (ALGO_CL önekli) self.own_algos'a yazılır: {algoId: (instId, miktar)};
        liste eksikse None (sahipsiz emir aramasında yeniden istek atılmaz)."""
        rows = self._req("GET", "/api/v5/trade/orders-algo-pending?ordType=oco,conditional&limit=100")
        if len(rows) >= 100:
            self.own_algos = None
            return None
        self.own_algos = {r.get("algoId"): (r.get("instId"), float(r.get("sz") or 0)) for r in rows
                          if r.get("algoId") and str(r.get("algoClOrdId") or "").startswith(ALGO_CL)
                          and r.get("instType", "SPOT") == "SPOT" and r.get("side", "sell") == "sell"}
        return {r.get("algoId") for r in rows}

    def cancel_algos(self, items):
        if items:
            self._req("POST", "/api/v5/trade/cancel-algos", [{"algoId": a, "instId": i} for a, i in items])

    def order(self, inst, ord_id):
        return self._req("GET", f"/api/v5/trade/order?instId={inst}&ordId={ord_id}")[0]

    def market(self, inst, side, sz, quote=False):
        # Emre kendi kimliğimiz (clOrdId) verilir: gönderim yanıtı ağda kaybolursa emir bu kimlikle borsada aranır;
        # verilmiş bir emir "hata" sanılıp kayıtsız kalmaz, yeniden de gönderilmez.
        cl = "m" + os.urandom(12).hex()
        body = {"instId": inst, "tdMode": "cash", "side": side, "ordType": "market", "sz": sz,
                "tgtCcy": "quote_ccy" if quote else "base_ccy", "clOrdId": cl}
        try:
            oid = self._req("POST", "/api/v5/trade/order", body)[0]["ordId"]
        except RuntimeError:
            raise  # borsa emri açıkça reddetti
        except Exception as e:
            oid, gone = None, False
            for _ in range(4):
                time.sleep(0.7)
                try:
                    oid = self._req("GET", f"/api/v5/trade/order?instId={inst}&clOrdId={cl}")[0]["ordId"]
                    print("Emir yanıtı gelmedi ama emir borsada bulundu:", inst)
                    break
                except RuntimeError as e2:
                    if "51603" in str(e2):  # emir yok: borsaya ulaşmamış
                        gone = True
                        break
                except Exception:
                    continue
            if not oid:
                if gone:
                    raise e
                raise OrderUnsure(cl, None, e)  # borsaya sorulamadı: emir verilmiş olabilir
        o = {"ordId": oid, "state": "bilinmiyor"}
        for _ in range(20):  # piyasa emri genelde anında dolar; ağ hatasında da emri kaybetmeden ~12 sn sorulur
            time.sleep(0.6)
            try:
                o = self._req("GET", f"/api/v5/trade/order?instId={inst}&ordId={oid}")[0]
            except Exception as e:
                print("Emir durumu okunamadı, yeniden soruluyor:", inst, e)
                continue
            if o["state"] in ("filled", "canceled", "mmp_canceled"):
                break
        if o.get("state") == "bilinmiyor":
            raise OrderUnsure(cl, oid, "emir durumu okunamadı")  # emir borsada ama doldu mu bilinmiyor
        return o


def spot_snapshot(api, algos, ccys=None):
    """Arka planda (yalnız okuma): borsadaki korumaların durumu ve istenirse coin bakiyeleri.
    algos: [(inst, algoId)]. Sonuç ana turda LivePortfolio.reconcile(snap=...) ile kayda işlenir; ana tur borsayı beklemez.
    Dönen kayıt: pending = bekleyen koruma kimlikleri (okunamadıysa None), algo = {algoId: (koruma, emir)} (yalnız
    bekleyenler dışındakiler), have = {coin: miktar} (istenmediyse/okunamadıysa None)."""
    snap = {"ts": int(time.time() * 1000), "pending": None if algos else set(), "algo": {}, "have": None, "own": None}
    # Önce bakiye, sonra korumalar: arada tetiklenen koruma "coin eksik" sanılmaz (bakiye tam, koruma tetiklenmiş görünür)
    if ccys:
        try:
            rows = api._req("GET", "/api/v5/account/balance?ccy=" + ",".join(ccys))
            snap["have"] = {d["ccy"]: float(d.get("cashBal") or d.get("eq") or 0) for d in (rows[0].get("details", []) if rows else [])}
        except Exception as e:
            print("Bakiye eşleştirme yapılamadı:", e)
    # Bekleyen korumalar kayıtta koruma olmasa da okunur: kayıtta karşılığı kalmayan (sahipsiz) koruma böyle bulunur
    try:
        api.own_algos = None
        pend = api.pending_algo_ids()
        snap["own"] = getattr(api, "own_algos", None)
        if algos or pend is not None:
            snap["pending"] = pend
    except Exception as e:
        print("Bekleyen korumalar alınamadı, tek tek bakılıyor:", e)
    known = {aid for _, aid in algos}
    extra = sorted({i.split("-")[0] for a, (i, _) in (snap["own"] or {}).items() if a not in known and i} - set(snap["have"] or {}))
    if extra:  # kayıtta olmayan koruma emri var: o coin hesapta duruyor mu (karar için gerekir; nadir durum, tek istek)
        try:
            rows = api._req("GET", "/api/v5/account/balance?ccy=" + ",".join(extra[:20]))
            got = {d["ccy"]: float(d.get("cashBal") or d.get("eq") or 0) for d in (rows[0].get("details", []) if rows else [])}
            snap["own_have"] = {c: got.get(c, 0.0) for c in extra[:20]}
        except Exception as e:
            print("Sahipsiz koruma için bakiye okunamadı:", e)
    if algos:
        for inst, aid in algos:
            if snap["pending"] is not None and aid in snap["pending"]:
                continue
            try:
                a = api.algo(aid)
                o = {}
                if a.get("state") in ("effective", "partially_effective"):
                    oid = a.get("ordId") or (a.get("ordIdList") or [""])[0]
                    o = api.order(inst, oid) if oid else {}
                snap["algo"][aid] = (a, o)
            except Exception as e:
                print("Koruma durumu okunamadı:", inst, e)
        if snap["pending"] is None and all(aid in snap["algo"] for _, aid in algos):
            # toplu liste alınamadı ama hepsi tek tek okundu: bekleyenler buradan bilinir
            snap["pending"] = {aid for aid, (a, _) in snap["algo"].items() if a.get("state") == "live"}
    return snap


def tr_err(e):
    """Borsanın İngilizce hata mesajını kullanıcıya gösterilecek Türkçe açıklamaya çevirir
    (asıl metin sadece çalışma kaydına yazılır)."""
    t = str(e)
    low = t.lower()
    code = t.split(":")[0].replace("OKX", "").strip() if t.startswith("OKX") else ""
    rules = [
        (("doğrulanamadı",), "emrin sonucu borsadan doğrulanamadı (bağlantı)"),
        (("compliance", "51155", "51087"), "OKX TR bu coinde bu hesaba işlem izni vermiyor (yerel düzenleme kısıtı)"),
        (("insufficient", "51008", "51131"), "hesapta yeterli bakiye yok"),
        (("minimum", "51020", "order amount", "order size"), "emir tutarı borsanın alt sınırının altında"),
        (("too many", "50011", "rate limit"), "borsa çok sık istek uyarısı verdi, biraz sonra yeniden denenecek"),
        (("timed out", "timeout", "veri alınamadı", "urlopen", "connection", "remote end", "incompleteread", "name resolution", "eof occurred", "reset by peer"), "borsaya bağlanılamadı"),
        (("50113", "50111", "50110", "api key", "passphrase", "sign"), "API anahtarı kabul edilmedi"),
        (("suspend", "51001", "51015", "instrument"), "bu coin borsada şu an işleme kapalı"),
    ]
    for keys, msg in rules:
        if any(k in low for k in keys):
            return msg
    return f"borsa isteği reddetti (kod {code or '?'})"


def para(v):
    return f"{v:,.2f}".replace(",", "X").replace(".", ",").replace("X", ".")


def fiyat(v):
    if v >= 1000:
        return f"{v:,.0f}".replace(",", ".")
    s = f"{v:.6g}" if v < 1 else f"{v:.4f}".rstrip("0").rstrip(".")
    return s.replace(".", ",")


def fmt(x, step):
    """Adım hassasiyetinde, bilimsel gösterim olmadan sayı metni."""
    dec = max(0, -int(math.floor(math.log10(step)))) if step < 1 else 0
    return f"{x:.{dec}f}"


def floor_to(x, step):
    return math.floor(x / step + 1e-9) * step


def _lot_id(l):
    """Kademenin kimliği (alım emrinin numarası; yoksa alım zamanı)."""
    return l.get("ordId") or l.get("ts")


_MIN = {}


def min_order_try(inst, price):
    """OKX'in bu coin için kabul ettiği en küçük emrin TL karşılığı (%3 pay ile)."""
    if inst not in _MIN:
        try:
            from . import okx
            _MIN[inst] = float(okx._get("/api/v5/public/instruments", {"instType": "SPOT", "instId": inst})[0]["minSz"])
        except Exception:
            _MIN[inst] = 0.0
    return _MIN[inst] * price * 1.03


class LivePortfolio(Portfolio):
    """Strateji kararları sanal motorla aynı; alım-satım gerçek emirle yapılır."""

    def __init__(self, state, armed):
        super().__init__(state)
        self.armed = armed  # False ise emir gönderilmez, sadece kaydedilir
        self.api = OkxPrivate() if armed else None
        self.log = state.setdefault("log", [])
        self.notifier = None

    def equity(self):
        return super().equity() - self.s.get("pending_cut", 0.0)

    def _emit(self, cat, title, msg, priority=3, tags=None):
        if self.notifier:
            if not self.armed:
                if cat != "trades":
                    return  # deneme modunda sadece al-sat bildirimleri gelir
                title, priority = "Deneme · " + title, 2
            self.notifier.add(cat, title, msg, priority, tags)

    def _once_per_day(self, key):
        from datetime import datetime, timedelta, timezone
        today = datetime.now(timezone(timedelta(hours=config.TZ_OFFSET_HOURS))).strftime("%Y-%m-%d")
        w = self.s.setdefault("warned", {})
        if w.get(key) == today:
            return False
        w[key] = today
        return True

    def _note(self, ts, text):
        self.log.append([int(time.time() * 1000), text])
        del self.log[:-100]
        print(text)

    def _buy(self, ts, inst, price, amount, reason):
        if inst in self.s.get("blocked", {}):
            return False
        if self.armed and self._is_unsure(inst):
            return False  # bu coinde sonucu doğrulanmamış emir var: ikinci emir verilmez
        amount = round(min(amount, self.s["cash"]), 2)
        if amount < 10:
            return False
        need = min_order_try(inst, price)
        if amount < need:
            # Kademe, borsanın bu coin için en küçük emrine yetmiyor: kullanıcı tercihi gereği
            # parası yetiyorsa ve kademenin 4 katını geçmiyorsa alt sınır kadar alınır, yoksa atlanır.
            if need <= self.s["cash"] and need <= amount * 4:
                self._note(ts, f"{inst.split('-')[0]}: kademe {para(amount)} TL borsanın alt sınırına yetmiyor, {para(need)} TL alınıyor")
                amount = round(need + 0.5, 2)
            else:
                if self._once_per_day("min_" + inst):
                    self._note(ts, f"{inst.split('-')[0]} atlandı: OKX bu coinde en az {para(need)} TL emir istiyor, botta yeterli para yok")
                return False
        if not self.armed:
            self._note(ts, f"[deneme] AL {inst.split('-')[0]} {para(amount)} TL · {reason}")
            ok = super()._buy(ts, inst, price, amount, reason + " · deneme")
            if ok is not False:
                self._emit("trades", f"Alındı: {inst.split('-')[0]}", f"{para(amount)} TL · fiyat {fiyat(price)} · {reason}", 3, ["shopping_cart"])
            return ok
        try:
            q = quote_of(inst)
            k = okx.tl_factor(inst)  # 1 TL paritesinde, USDT kuru USDT paritesinde
            spend = amount / k  # paritenin kendi para biriminde harcanacak tutar
            if q in ("USDT", "USDC", "EUR"):
                have_q = self.api.available(q)
                if have_q < spend and not self._fund(ts, q, spend - have_q):
                    return self._no_funds(ts, inst)
                spend = min(spend, self.api.available(q))
                if spend * k < 10:
                    return self._no_funds(ts, inst)
            elif self.api.available(q) < spend:  # TL paritesinde TL yetmezse boştaki USDT'den çevrilir
                need_usdt = (spend - self.api.available(q)) / okx.rate("USDT") * 1.004 + 0.2
                if self.api.available("USDT") < need_usdt:
                    return self._no_funds(ts, inst)
                self.api.market("USDT-TRY", "sell", f"{math.ceil(need_usdt * 100) / 100:.2f}")
                self._note(ts, f"{need_usdt:.2f} USDT → TL çevrildi")
                spend = min(spend, self.api.available(q))
            try:
                o = self.api.market(inst, "buy", f"{math.floor(spend * 100) / 100:.2f}", quote=True)
            except OrderUnsure as u:
                self._unsure_add(ts, inst, "buy", u, {"reason": reason})
                return False
            if float(o.get("accFillSz") or 0) <= 0:
                self._note(ts, f"{inst} alım emri dolmadı ({o['state']})")
                return False
            self._book_buy(ts, inst, o, k, reason)
            return True
        except Exception as e:
            print("Alım hatası:", inst, e)
            why = tr_err(e)
            sym = inst.split("-")[0]
            if "yerel düzenleme" in why or "işleme kapalı" in why:
                # bu coin bu hesapta alınamıyor: listeden çıkarılır, bir daha denenmez
                self.s.setdefault("blocked", {})[inst] = ts
                self._note(ts, f"{sym} alınamıyor: {why}. Listeden çıkarıldı.")
                self._emit("alerts", f"{sym} listeden çıkarıldı", f"{why}. Bot bu coini bir daha denemez.", 3, ["warning"])
                return False
            self._note(ts, f"HATA alım {sym}: {why}")
            if self._once_per_day("err_buy"):
                self._emit("alerts", "Alım yapılamadı", f"{sym}: {why}", 4, ["warning"])
            return False

    def _book_buy(self, ts, inst, o, k, reason):
        """Dolmuş alım emrini kayda geçirir (nakit, kademe, işlem, borsa koruması, bildirim)."""
        filled = float(o.get("accFillSz") or 0)
        base = inst.split("-")[0]
        fee = float(o.get("fee") or 0)
        qty = filled + (fee if o.get("feeCcy") == base else 0)  # alım komisyonu coin cinsinden düşülür
        avg_q = float(o["avgPx"])  # paritenin kendi fiyatı (USDT ya da TL)
        avg = avg_q * k  # TL karşılığı
        spent = filled * avg
        self.s["cash"] -= spent
        pos = self.s["positions"].setdefault(inst, {"lots": [], "peak": avg, "bars": 0})
        lot = {"qty": qty, "entry": avg, "entry_q": avg_q, "cost": spent, "ts": ts, "ordId": o["ordId"]}
        pos["lots"].append(lot)
        self.s["last_prices"].setdefault(inst, avg)  # mumu henüz gelmemiş coin (elle alım) değeri 0 sayılmasın
        self.s["trades"].append({"ts": ts, "inst": inst, "side": "AL", "price": avg, "qty": qty,
                                 "amount": round(spent, 2), "reason": reason, "real": True})
        self._note(ts, f"AL {inst.split('-')[0]} {para(spent)} TL · fiyat {fiyat(avg)}")
        self._protect(ts, inst, lot)
        self._emit("trades", f"Alındı: {inst.split('-')[0]}", f"{para(spent)} TL · fiyat {fiyat(avg)} · {reason}", 3, ["shopping_cart"])

    # ---------- sonucu öğrenilemeyen emirler ----------
    def _is_unsure(self, inst):
        return any(u.get("inst") == inst for u in self.s.get("unsure") or [])

    def _unsure_add(self, ts, inst, side, u, extra):
        self.s.setdefault("unsure", []).append({"cl": u.cl, "oid": u.oid, "inst": inst, "side": side, "ts": ts, **extra})
        sym, what = inst.split("-")[0], ("alım" if side == "buy" else "satış")
        self._note(ts, f"{sym}: {what} emrinin sonucu öğrenilemedi (bağlantı); borsadan doğrulanana kadar bu coinde yeni emir verilmez")
        self._emit("alerts", "Emir sonucu doğrulanamadı",
                   f"{sym}: {what} emri gönderildi ama borsanın yanıtı alınamadı. Bot emri borsadan kendisi doğrulayıp kayda geçirecek; emir iki kez verilmez.",
                   4, ["warning"])

    def resolve_unsure(self, every=5):
        """Sonucu öğrenilemeyen emirleri kendi kimliğiyle borsaya sorar: dolduysa kayda geçirir, borsaya hiç
        ulaşmadıysa bırakır. Borsaya ulaşılamıyorsa kayıt bekler (o coinde yeni emir verilmez)."""
        if not self.armed or not self.s.get("unsure"):
            return
        now = int(time.time() * 1000)
        if now - self.s.get("unsure_ck", 0) < every * 1000:
            return
        self.s["unsure_ck"] = now
        keep = []
        for u in self.s["unsure"]:
            inst = u["inst"]
            sym, what = inst.split("-")[0], ("alım" if u["side"] == "buy" else "satış")
            try:
                q = f"ordId={u['oid']}" if u.get("oid") else f"clOrdId={u['cl']}"
                o = self.api._req("GET", f"/api/v5/trade/order?instId={inst}&{q}")[0]
                k = okx.tl_factor(inst)
            except RuntimeError as e:
                if "51603" in str(e):  # emir borsada yok: hiç ulaşmamış
                    self._note(now, f"{sym}: {what} emri borsaya ulaşmamış (doğrulandı); bot normal devam ediyor")
                else:
                    keep.append(u)
                continue
            except Exception:
                keep.append(u)
                continue
            if o.get("state") not in ("filled", "canceled", "mmp_canceled"):
                keep.append(u)
                continue
            if float(o.get("accFillSz") or 0) <= 0:
                self._note(now, f"{sym}: {what} emri dolmadan iptal olmuş (doğrulandı)")
            elif u["side"] == "buy":
                self._note(now, f"{sym}: alım emri borsada dolmuş (doğrulandı); kayda geçiriliyor")
                self._book_buy(now, inst, o, k, u.get("reason") or "doğrulanan emir")
            else:
                ids = set(u.get("lots") or [])
                pos = self.s["positions"].get(inst)
                lots = [l for l in (pos or {}).get("lots", []) if _lot_id(l) in ids]
                if lots:
                    self._note(now, f"{sym}: satış emri borsada dolmuş (doğrulandı); kayda geçiriliyor")
                    self._book_sell(now, inst, o, lots, u.get("want") or sum(l["qty"] for l in lots), u.get("reason") or "doğrulanan emir")
                else:
                    self._note(now, f"{sym}: satış emri borsada dolmuş ama kademesi kayıtta bulunamadı; OKX'ten kontrol et")
        if keep:
            self.s["unsure"] = keep
        else:
            self.s.pop("unsure", None)

    def _usdt(self, ts, amount):
        """En az `amount` USDT olsun: önce boştaki USDC, yetmezse TL çevrilir."""
        have = self.api.available("USDT")
        if have >= amount:
            return True
        usdc = self.api.available("USDC")
        if usdc >= 1:  # parite değiştirilince kalan USDC önce kullanılır
            c = self.api.market("USDC-USDT", "sell", f"{math.floor(min(usdc, (amount - have) * 1.003 + 0.5) * 100) / 100:.2f}")
            self._note(ts, f"{float(c.get('accFillSz') or 0):.2f} USDC → USDT çevrildi")
            have = self.api.available("USDT")
            if have >= amount:
                return True
        need_tl = round((amount - have) * okx.rate("USDT") * 1.004 + 1, 2)
        if self.api.available(config.CASH) < need_tl:
            return False
        c = self.api.market("USDT-TRY", "buy", f"{need_tl:.2f}", quote=True)
        self._note(ts, f"{para(need_tl)} TL → {float(c.get('accFillSz') or 0):.2f} USDT çevrildi")
        return True

    def _fund(self, ts, q, short):
        """Alım için eksik `short` kadar USDT/USDC'yi hazırlar."""
        if q == "USDT":
            return self._usdt(ts, self.api.available("USDT") + short)
        if q == "EUR":  # EUR, USDT satılarak alınır
            need_usdt = short / okx.usdt_eur() * 1.003 + 0.2
            if not self._usdt(ts, need_usdt):
                return False
            c = self.api.market("USDT-EUR", "sell", f"{math.ceil(need_usdt * 100) / 100:.2f}")
            self._note(ts, f"{need_usdt:.2f} USDT → EUR çevrildi")
            return True
        need_usdt = short * okx.usdc_usdt() * 1.003 + 0.2  # USDC, USDT ile alınır (fark çok düşük)
        if not self._usdt(ts, need_usdt):
            return False
        c = self.api.market("USDC-USDT", "buy", f"{math.ceil(need_usdt * 100) / 100:.2f}", quote=True)
        self._note(ts, f"{need_usdt:.2f} USDT → {float(c.get('accFillSz') or 0):.2f} USDC çevrildi")
        return True

    def convert_all(self, ts):
        """Alım-satım hesabındaki boş TL'nin tamamını seçili pariteye (USDT/USDC/EUR) çevirir."""
        q = config.QUOTE
        if q == config.CASH:
            return 0.0
        tl = math.floor((self.api.available(config.CASH) - 1) * 100) / 100  # kuruş farkları için 1 TL bırakılır
        if tl < 20:
            return 0.0
        c = self.api.market("USDT-TRY", "buy", f"{tl:.2f}", quote=True)
        got = float(c.get("accFillSz") or 0)
        self._note(ts, f"{para(tl)} TL → {got:.2f} USDT çevrildi (hepsini çevir)")
        if q != "USDT" and got > 1:
            self._fund(ts, q, got / (okx.usdc_usdt() if q == "USDC" else 1 / okx.usdt_eur()) * 0.995)
        return tl

    def _no_funds(self, ts, inst):
        self._note(ts, f"Yetersiz bakiye, {inst} alınmadı")
        if self._once_per_day("funds"):
            self._emit("alerts", "Hesapta yeterli TL yok",
                       "Bot alım yapmak istedi ama alım-satım hesabında yeterli TL/USDT görünmüyor. "
                       "Fonlama hesabından transfer gerekebilir.", 4, ["warning"])
        return False

    def _targets(self, entry):
        k, c, r = self.s["key"], self.cfg, self.risk
        if k == "grid":
            # Toplu kâr al açıkken borsaya kademe başına kâr al emri konmaz (yalnız zarar durdur); kâr, ortalamaya göre bot satar
            return (None if (c.get("pos_tp") or 0) > 0 else entry * (1 + c["lot_tp"])), entry * (1 - c["stop"])
        if k == "dip":
            return entry * (1 + c["take_profit"]), entry * (1 - r["stop_loss"])
        return None, entry * (1 - r["stop_loss"])

    def _protect(self, ts, inst, lot):
        try:
            eq_ = lot.get("entry_q") or lot["entry"]  # borsa emri paritenin kendi fiyatıyla kurulur
            tp, sl = self._targets(eq_)
            lot["algo"] = self.api.protect(inst, lot["qty"], tp, sl)
            k = lot["entry"] / eq_ if eq_ else 1  # gösterim için TL karşılığı
            lot["tp"], lot["sl"] = (tp * k if tp else None), (sl * k if sl else None)
            if lot["algo"]:
                self._note(ts, f"Borsa koruması kuruldu: {inst.split('-')[0]} · "
                               + (f"kâr al {fiyat(lot['tp'])} TL · " if tp else "") + f"zarar durdur {fiyat(lot['sl'])} TL")
        except Exception as e:
            lot["algo"] = None
            self._note(ts, f"HATA borsa koruması {inst}: {tr_err(e)}")
            if self._once_per_day("err_protect"):  # her 5 sn'de bildirim yağmasın
                self._emit("alerts", "Borsa koruması kurulamadı", f"{inst}: {tr_err(e)}. Bot her kontrolde yeniden dener.",
                           4, ["warning"])

    def check_holdings(self, every=60, have=None, base=None, pending=None):
        """Kayıttaki coin miktarını OKX'teki gerçek miktarla karşılaştırır (dakikada bir).
        OKX'te daha az coin varsa (ör. elle satıldıysa) kayıt düzeltilir; bot hiçbir şey satmaz.
        have: arka planda okunmuş bakiyeler (spot_snapshot); verilirse burada borsaya istek atılmaz.
        base: o okuma başlarken kayıttaki miktarlar; arada kaydı değişen coin (alım/satım) bu turda karşılaştırılmaz.
        pending: aynı okumada borsada bekleyen korumalar; koruması tetiklenmiş/sonuçlanmamış coin karşılaştırılmaz
        (satış geliri önce reconcile ile kayda geçmeli)."""
        if not self.armed or not self.s["positions"]:
            return
        now = int(time.time() * 1000)
        pre = have is not None
        if not pre:
            if now - self.s.get("hold_ck", 0) < every * 1000:
                return
            self.s["hold_ck"] = now
            ccys = [i.split("-")[0] for i in self.s["positions"]]
            rows = self.api._req("GET", "/api/v5/account/balance?ccy=" + ",".join(ccys))
            have = {d["ccy"]: float(d.get("cashBal") or d.get("eq") or 0) for d in (rows[0].get("details", []) if rows else [])}
        miss = self.s.setdefault("missing", {})
        for inst in list(self.s["positions"]):
            pos = self.s["positions"][inst]
            if self._is_unsure(inst):
                continue  # sonucu doğrulanmamış emir var: önce o kayda geçmeli (satış geliri kaybolmasın)
            if pre and (base is None or abs(sum(l["qty"] for l in pos["lots"]) - base.get(inst, -1.0)) > 1e-12):
                continue  # ölçümden sonra kayıt değişti (ya da ölçümde bu coin yoktu): bir sonraki ölçümde bakılır
            if pre and (pending is None or any(l.get("algo") and l["algo"] not in pending for l in pos["lots"])):
                continue  # koruma durumu belirsiz ya da tetiklenmiş: önce o işlenir
            base_ccy = inst.split("-")[0]
            got = have.get(base_ccy, 0.0)
            if not pre and sum(l["qty"] for l in pos["lots"]) > got * 1.03:
                # Coin eksik: büyük ihtimalle borsadaki kâr al / zarar durdur az önce çalıştı. Önce onu kayda geçir
                # (satış geliri kasaya eklensin); kayıt hâlâ tutmuyorsa bir sonraki kontrolde düzelt.
                self.reconcile(only=inst)
                if inst not in self.s["positions"]:
                    miss.pop(inst, None)
                    continue
                pos = self.s["positions"][inst]
            rec = sum(l["qty"] for l in pos["lots"])
            if rec <= 0 or got >= rec * 0.97:
                miss.pop(inst, None)
                continue
            if now - miss.setdefault(inst, now) < 50_000:
                continue  # ilk görüşte bekle: borsadaki emir henüz sonuçlanmamış olabilir
            miss.pop(inst, None)
            ratio = max(0.0, got / rec)
            items = [(l["algo"], inst) for l in pos["lots"] if l.get("algo")]
            try:
                if items:
                    self.cancel_items(items)
            except Exception as e:
                self._note(now, f"Koruma iptali uyarısı {inst}: {tr_err(e)}")
            if ratio < 0.05:
                del self.s["positions"][inst]
                msg = f"OKX'te {base_ccy} kalmamış (kayıtta {rec:.6g}); pozisyon kayıttan çıkarıldı."
            else:
                for l in pos["lots"]:
                    l["qty"] *= ratio
                    l["cost"] *= ratio
                    l["algo"] = None
                    self._protect(now, inst, l)
                msg = f"OKX'te {base_ccy} {got:.6g}, kayıtta {rec:.6g} görünüyordu; kayıt OKX'e göre düzeltildi ve korumalar yeniden kuruldu."
            self._note(now, msg)
            self._emit("alerts", f"Kayıt düzeltildi: {base_ccy}", msg + " Elle işlem yaptıysan bu normaldir.", 4, ["mag"])

    def cancel_items(self, items):
        self.api.cancel_algos(items)

    def cancel_orphans(self, own, have=None):
        """Sahipsiz koruma emirleri: borsada bekleyen, botun kendi kimliğini taşıyan (ALGO_CL) ama kayıttaki hiçbir
        kademeye bağlı olmayan kâr al / zarar durdur emirleri iptal edilir (ör. koruma iptali başarısız olup satış
        kısmi dolduysa ya da koruma kurulurken yanıt kaybolduysa geride kalan emir). Böyle bir emir, kalan kademenin
        yeni korumasını engeller ya da ileride aynı coinden yapılacak alımı beklenmedik fiyattan satardı.
        own: {algoId: (instId, miktar)} — yalnız botun koyduğu emirler; kullanıcının elle koyduğu emirler bu listede
        olmaz, onlara hiç bakılmaz. have: {coin: hesaptaki miktar}.
        Coin botun kaydında yoksa ama hesapta emrin miktarı kadar duruyorsa emir İPTAL EDİLMEZ (o coinin tek koruması
        olabilir: kayıt sıfırlanmış olabilir); kullanıcı bir kez uyarılır."""
        if not self.armed or not own:
            return 0
        have = have or {}
        mine = {l["algo"] for p in self.s["positions"].values() for l in p["lots"] if l.get("algo")}
        items, kept = [], []
        for a, (inst, sz) in own.items():
            if a in mine or not inst or self._is_unsure(inst):
                continue  # kayıtta karşılığı var / sonucu doğrulanmamış emir var (kayıt birazdan değişecek)
            if inst not in self.s["positions"]:
                bal = have.get(inst.split("-")[0])
                if bal is None:
                    continue  # bakiye okunamadı: bir sonraki okumada
                if sz > 0 and bal >= sz * 0.5:
                    kept.append(inst)
                    continue
            items.append((a, inst))
        now = int(time.time() * 1000)
        for inst in sorted(set(kept)):
            if self._once_per_day("orphan_" + inst):
                sym = inst.split("-")[0]
                self._note(now, f"{sym}: botun eski bir koruma emri borsada duruyor ama coin botun kaydında yok; coin hesapta olduğu için emre dokunulmadı (OKX'ten kontrol et)")
                self._emit("alerts", f"Eski koruma emri: {sym}",
                           f"{sym} için botun koyduğu bir kâr al / zarar durdur emri borsada duruyor ama coin botun kaydında yok. Coin hesapta durduğu için bot emre dokunmadı; OKX'ten kontrol et.", 4, ["mag"])
        items = items[:10]  # OKX tek istekte en fazla 10 iptal kabul eder; kalanı bir sonraki okumada
        if not items:
            return 0
        try:
            self.api.cancel_algos(items)
        except Exception as e:
            # emir bu arada tetiklenmiş/iptal olmuş olabilir: bir sonraki okumada listede yoksa sorun kalmamıştır
            print("Sahipsiz koruma iptali:", tr_err(e))
            return 0
        syms = sorted({i.split("-")[0] for _, i in items})
        self._note(now, f"Sahipsiz koruma emri iptal edildi: {', '.join(syms)} ({len(items)} emir; kayıtta karşılığı yoktu)")
        return len(items)

    def reconcile(self, only=None, snap=None):
        """Borsada tetiklenen kâr al / zarar durdur emirlerini kayda geçirir, eksik korumaları yeniden kurar.
        snap verilirse (spot_snapshot, arka planda okunmuş) borsaya durum sorulmaz: yalnız o okumada sonucu belli olan
        korumalar işlenir; okumadan sonra kurulan ya da okunamayan koruma bir sonraki okumayı bekler.
        Sonuçlar koruma kimliğiyle eşleşir ve kesindir (tetiklendi / iptal edildi), bu yüzden gecikmeli işlenmesi güvenlidir."""
        if not self.armed:
            return
        now = int(time.time() * 1000)
        pre = snap is not None
        if pre:
            pending, known = snap.get("pending"), snap.get("algo") or {}
        else:
            # Hız: bekleyen korumalar tek istekle alınır; sadece listede olmayan (tetiklenmiş/iptal) emirler tek tek sorulur
            try:
                pending = self.api.pending_algo_ids() if any(l.get("algo") for p in self.s["positions"].values() for l in p["lots"]) else set()
            except Exception as e:
                print("Bekleyen korumalar alınamadı, tek tek bakılıyor:", e)
                pending = None
        for inst in ([only] if only else list(self.s["positions"])):
            if inst not in self.s["positions"] or self._is_unsure(inst):
                continue  # sonucu doğrulanmamış emri olan coin: önce emir kayda geçer, koruma sonra kurulur
            pos = self.s["positions"][inst]
            want_tp = self.s.get("key") != "grid" or not ((self.cfg.get("pos_tp") or 0) > 0)
            for lot in list(pos["lots"]):
                if not lot.get("algo"):
                    self._protect(now, inst, lot)
                    continue
                if (pending is not None and lot["algo"] in pending and self.s.get("key") == "grid"
                        and (lot.get("tp") is not None) != want_tp):
                    # Toplu kâr al açıldı/kapandı: borsadaki koruma yeni kurala göre (kâr al'lı ya da kâr al'sız) yeniden kurulur
                    try:
                        self.cancel_items([(lot["algo"], inst)])
                    except Exception as e:
                        self._note(now, f"Koruma güncellenemedi {inst}: {tr_err(e)}")
                        continue
                    lot["algo"] = None
                    self._protect(now, inst, lot)
                    continue
                if pending is not None and lot["algo"] in pending:
                    continue  # koruma borsada bekliyor, değişiklik yok
                if pre:
                    if lot["algo"] not in known:
                        continue  # bu okumada sonucu yok: bir sonraki okumada
                    a, o = known[lot["algo"]]
                else:
                    try:
                        a = self.api.algo(lot["algo"])
                    except Exception as e:
                        self._note(now, f"Koruma durumu okunamadı {inst}: {tr_err(e)}")
                        continue
                    o = None
                st = a.get("state")
                if st in ("effective", "partially_effective"):
                    oid = a.get("ordId") or (a.get("ordIdList") or [""])[0]
                    if o is None:
                        o = self.api.order(inst, oid) if oid else {}
                    if oid and o.get("state") in ("live", "partially_filled"):
                        continue  # tetiklenen emir henüz dolmadı: dolunca işlenir (yarım sonuç yazılmaz)
                    if oid and not o:
                        continue  # emrin sonucu okunamadı: bir sonraki okumada
                    filled = float(o.get("accFillSz") or a.get("actualSz") or 0)
                    avg_q = float(o.get("avgPx") or a.get("actualPx") or 0)
                    fee = float(o.get("fee") or 0)
                    k = okx.tl_factor(inst)
                    proceeds = (filled * avg_q + (fee if o.get("feeCcy") == quote_of(inst) else 0)) * k
                    avg = avg_q * k
                    share = min(1.0, filled / lot["qty"]) if lot["qty"] else 1.0
                    cost = lot["cost"] * share
                    pnl = proceeds - cost
                    reason = "Borsada kâr alındı" if avg_q >= (lot.get("entry_q") or lot["entry"]) else "Borsada zarar durduruldu"
                    self.s["cash"] += proceeds
                    self.s["trades"].append({"ts": now, "inst": inst, "side": "SAT", "price": avg, "qty": filled,
                                             "amount": round(proceeds, 2), "pnl": round(pnl, 2),
                                             "pnl_pct": round(pnl / cost * 100, 2) if cost else 0,
                                             "reason": reason, "real": True})
                    pos["lots"].remove(lot)
                    sign = "+" if pnl >= 0 else "−"
                    self._note(now, f"{reason}: {inst.split('-')[0]} {para(proceeds)} TL · sonuç {sign}{para(abs(pnl))} TL")
                    self._emit("trades", f"{reason}: {inst.split('-')[0]} ({sign}{para(abs(pnl))} TL)",
                               f"{para(proceeds)} TL · fiyat {fiyat(avg)}", 4, ["zap"])
                elif st in ("canceled", "order_failed"):
                    lot["algo"] = None
                    self._protect(now, inst, lot)
            if not pos["lots"]:
                del self.s["positions"][inst]

    def _sell_lots(self, ts, inst, price, lots, reason):
        if self.armed and self._is_unsure(inst):
            return  # sonucu doğrulanmamış emir var: doğrulanınca (birkaç sn) satış yeniden denenir
        if self.armed:  # bot kendisi satacaksa önce borsadaki korumaları iptal et
            try:
                items = [(l["algo"], inst) for l in lots if l.get("algo")]
                if items:
                    self.api.cancel_algos(items)
                    time.sleep(0.5)
            except Exception as e:
                self._note(ts, f"Koruma iptali uyarısı {inst}: {tr_err(e)}")
        if not self.armed:
            self._note(ts, f"[deneme] SAT {inst.split('-')[0]} · {reason}")
            n0 = len(self.s["trades"])
            r = super()._sell_lots(ts, inst, price, lots, reason + " · deneme")
            t = self.s["trades"][-1] if len(self.s["trades"]) > n0 else None
            if t and t["side"] == "SAT":
                pnl = t.get("pnl", 0); sign = "+" if pnl >= 0 else "−"
                self._emit("trades", f"Satıldı: {inst.split('-')[0]} ({sign}{para(abs(pnl))} TL)",
                           f"{para(t['amount'])} TL · fiyat {fiyat(price)} · {reason}", 3,
                           ["chart_with_upwards_trend" if pnl >= 0 else "chart_with_downwards_trend"])
            return r
        pos = self.s["positions"][inst]
        base = inst.split("-")[0]
        try:
            want = sum(l["qty"] for l in lots)
            have = self.api.available(base)
            lot_sz, min_sz, _ = self.api.instrument(inst)
            sz = floor_to(min(want, have), lot_sz)
            if sz < min_sz:
                if floor_to(want, lot_sz) >= min_sz:
                    # coin kayıtta var ama borsada serbest değil (koruma emri yeni tetiklenmiş ya da iptali bitmemiş):
                    # kayıt silinmez; borsadaki sonuç bir sonraki kontrolde işlenir ya da satış yeniden denenir
                    self._note(ts, f"{inst.split('-')[0]}: borsada serbest bakiye yok, tekrar denenecek")
                    return  # iptal edilen koruma, kontrolde "iptal" görülünce yeniden kurulur
                self._note(ts, f"{inst} satılamadı: miktar asgari sınırın altında (küsurat)")
                pos["lots"] = [l for l in pos["lots"] if l not in lots]
                if not pos["lots"]:
                    del self.s["positions"][inst]
                return
            try:
                o = self.api.market(inst, "sell", fmt(sz, lot_sz))
            except OrderUnsure as u:
                self._unsure_add(ts, inst, "sell", u, {"reason": reason, "lots": [_lot_id(l) for l in lots], "want": want})
                return
            if float(o.get("accFillSz") or 0) <= 0:
                self._note(ts, f"{inst} satış emri dolmadı ({o['state']})")
                return
            self._book_sell(ts, inst, o, lots, want, reason)
        except Exception as e:
            self._note(ts, f"HATA satış {inst}: {tr_err(e)}")
            self._emit("alerts", "Satış hatası", f"{inst}: {tr_err(e)}", 5, ["rotating_light"])

    def _book_sell(self, ts, inst, o, lots, want, reason):
        """Dolmuş satış emrini kayda geçirir (nakit, işlem, kısmi dolumda kalan kademe, bildirim)."""
        pos = self.s["positions"][inst]
        filled = float(o.get("accFillSz") or 0)
        k = okx.tl_factor(inst)
        avg = float(o["avgPx"]) * k
        fee = float(o.get("fee") or 0)
        proceeds = (filled * float(o["avgPx"]) + (fee if o.get("feeCcy") == quote_of(inst) else 0)) * k
        cost = sum(l["cost"] for l in lots) * (filled / want if want else 1)
        self.s["cash"] += proceeds
        pnl = proceeds - cost
        self.s["trades"].append({"ts": ts, "inst": inst, "side": "SAT", "price": avg, "qty": filled,
                                 "amount": round(proceeds, 2), "pnl": round(pnl, 2),
                                 "pnl_pct": round(pnl / cost * 100, 2) if cost else 0,
                                 "reason": reason, "real": True})
        share = filled / want if want else 1
        if share < 0.995:
            # kısmi dolum: satılmayan kısım kayıtta kalır (oranla küçültülür) ve yeniden korunur
            for l in lots:
                l["qty"] *= (1 - share)
                l["cost"] *= (1 - share)
                l["algo"] = None
        else:
            pos["lots"] = [l for l in pos["lots"] if l not in lots]
        if not pos["lots"]:
            del self.s["positions"][inst]
        sign = "+" if pnl >= 0 else "−"
        self._note(ts, f"SAT {inst.split('-')[0]} {para(proceeds)} TL · fiyat {fiyat(avg)} · sonuç {sign}{para(abs(pnl))} TL")
        self._emit("trades", f"Satıldı: {inst.split('-')[0]} ({sign}{para(abs(pnl))} TL)",
                   f"{para(proceeds)} TL · fiyat {fiyat(avg)} · {reason}", 4 if reason == "Acil fren" else 3,
                   ["chart_with_upwards_trend" if pnl >= 0 else "chart_with_downwards_trend"])
