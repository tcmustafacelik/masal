"""Kaldıraç masası (GERÇEK): deneme masasının kararlarını OKX Global'de gerçek parayla uygular.

Güvenlik kuralları (ayarla gevşetilemez):
  - Yalnız "real_budget" kadar USDT fon hesabından işlem hesabına geçer; teminat bundan alınır
  - İzole marjin, en fazla 3x (varsayılan 2x); her emirle birlikte borsaya zarar durdur + kâr al bağlanır
    (bot dursa bile pozisyon borsada korunur)
  - Teminat pozisyon başına kasanın en fazla 1/3'ü; işlem başına risk kasanın %risk_pct'si
  - Günlük zarar %daily_loss_pct'e ulaşırsa tüm pozisyonlar kapanır, o gün yeni işlem yok
  - Toplam zarar "max_loss" $'a ulaşırsa masa tamamen durur (ayarlardan yeniden başlatılana kadar)
  - Pozisyon yokken işlem hesabında bütçenin üstünde kalan kâr fon hesabına geri alınır (oradan KASA'ya süpürülür)
Ağ işleri arka planda tek bir işçi iş parçacığında yapılır; ana tur beklemez.
"""
import copy
import json
import math
import os
import queue
import re
import threading
import time

from . import config, transfer

DEFAULT = {"real": False, "real_budget": 30.0, "real_lev": 2, "max_loss": 10.0, "real_reset": 0}
TITLE = "Futures"
SYNC = 10
CL = "mslf"  # masanın açma emirlerinin kimlik öneki (clOrdId): emir ve ondan doğan pozisyon bu önekle tanınır
OPEN_WAIT = 20_000  # ms: yanıtı kaybolan açma emri borsada bu süre bulunamazsa "ulaşmamış" sayılır
_Q = queue.Queue()
_LOCK = threading.Lock()
_W = {"t": None, "R": None, "cfg": {}}


def _new(cfg):
    return {"funded": 0.0, "harvest": 0.0, "eq": 0.0, "avail": 0.0, "pos": {}, "trades": [], "log": [], "equity": [],
            "day": "", "day_eq": 0.0, "halt": "", "dead": "", "err": "", "sync": 0, "reset": cfg.get("real_reset", 0)}


def _note(R, kind, text):
    print("[" + __name__.split(".")[-1] + "]", text)  # günlükte izlemek için (anahtar/tutar dışı bilgi)
    R["log"].append([int(time.time() * 1000), kind, text])
    if kind in ("buy", "exit") or text.startswith(("MASA DURDU", "Günlük zarar")):
        R.setdefault("out", []).append([kind, text])  # telefona bildirim (ana turda gönderilir)
    R["log"] = R["log"][-80:]


def _fmt(x, step):
    d = max(0, -int(math.floor(math.log10(step)))) if step < 1 else 0
    return f"{round(x / step) * step:.{d}f}"


class _Desk:
    def __init__(self):
        self.ex = transfer.Ex("https://www.okx.com", "OKXG")
        self.spec = {}
        self.lev_set = set()
        self.pos_mode = None

    def specs(self):
        if not self.spec:
            for x in self.ex.req("GET", "/api/v5/public/instruments?instType=SWAP"):
                if x["instId"].endswith("-USDT-SWAP"):
                    self.spec[x["instId"]] = {k: float(x[k]) for k in ("ctVal", "lotSz", "minSz", "tickSz")}
        return self.spec

    def mode(self):
        if self.pos_mode is None:
            self.pos_mode = self.ex.req("GET", "/api/v5/account/config")[0].get("posMode", "net_mode")
        return self.pos_mode

    def balance(self):
        for x in self.ex.req("GET", "/api/v5/account/balance?ccy=USDT")[0].get("details", []):
            if x["ccy"] == "USDT":
                # İşlem hesabındaki USDT'nin bir kısmı Global spot masasının: futures onu kendi parası saymaz
                from . import gspot
                g = gspot.PHYS["v"]
                return max(0.0, float(x.get("eq") or 0) - g), max(0.0, float(x.get("availBal") or 0) - g)
        return 0.0, 0.0

    def positions(self):
        out = {}
        for p in self.ex.req("GET", "/api/v5/account/positions?instType=SWAP"):
            if float(p.get("pos") or 0) != 0 and p["instId"].endswith("-USDT-SWAP") and p.get("mgnMode", "isolated") == "isolated":
                out[p["instId"].split("-")[0]] = p
        return out

    def _ps(self, side):
        return {"posSide": "long" if side > 0 else "short"} if self.mode() == "long_short_mode" else {}

    def lever(self, c, side, lev):
        """Kaldıracı ayarlar (emirden önce; burada hata olursa hiçbir emir gönderilmemiştir)."""
        inst = f"{c}-USDT-SWAP"
        lk = (inst, lev, side if self.mode() == "long_short_mode" else 0)
        if lk not in self.lev_set:
            self.ex.req("POST", "/api/v5/account/set-leverage",
                        {"instId": inst, "lever": str(lev), "mgnMode": "isolated", **self._ps(side)})
            self.lev_set.add(lk)

    def open(self, c, side, contracts, stop, tp, lev, cl=None):
        inst = f"{c}-USDT-SWAP"
        sp = self.specs()[inst]
        self.lever(c, side, lev)
        body = {
            "instId": inst, "tdMode": "isolated", "side": "buy" if side > 0 else "sell", "ordType": "market",
            "sz": _fmt(contracts, sp["lotSz"]), **self._ps(side),
            "attachAlgoOrds": [{"tpTriggerPx": _fmt(tp, sp["tickSz"]), "tpOrdPx": "-1", "tpTriggerPxType": "last",
                                "slTriggerPx": _fmt(stop, sp["tickSz"]), "slOrdPx": "-1", "slTriggerPxType": "last"}]}
        if cl:
            body["clOrdId"] = cl  # kendi emir kimliğimiz: yanıt kaybolursa emir (ve pozisyonu) bu kimlikle bulunur
        d = self.ex.req("POST", "/api/v5/trade/order", body)
        oid = d[0]["ordId"]
        for _ in range(5):
            time.sleep(0.6)
            o = self.ex.req("GET", f"/api/v5/trade/order?instId={inst}&ordId={oid}")[0]
            if o["state"] == "filled":
                return float(o["avgPx"]), float(o["accFillSz"])
        raise OSError(f"{c} emri dolmadı ({o['state']})")  # emir borsada: sonucu kimliğiyle izlenir (reddedilmiş sayılmaz)

    def find(self, c, cl):
        """Açma emrini kendi kimliğiyle arar. Emir yoksa None; borsaya sorulamadıysa hata yükselir."""
        try:
            d = self.ex.req("GET", f"/api/v5/trade/order?instId={c}-USDT-SWAP&clOrdId={cl}")
        except RuntimeError as e:
            if "51603" in str(e):
                return None
            raise
        return d[0] if d else None

    def ours(self, c, since):
        """Bu coinde masanın kendi kimliğiyle (CL) verilmiş, `since` (ms) sonrasında dolmuş açma emri var mı?
        Varsa emri döndürür. Kayıtta olmayan bir pozisyonun masaya ait olduğunu kanıtlamak için kullanılır."""
        for o in self.ex.req("GET", f"/api/v5/trade/orders-history?instType=SWAP&instId={c}-USDT-SWAP&ordType=market&state=filled&limit=20"):
            if (str(o.get("clOrdId") or "").startswith(CL) and float(o.get("accFillSz") or 0) > 0
                    and str(o.get("reduceOnly")) != "true" and int(o.get("fillTime") or o.get("uTime") or 0) >= since):
                return o
        return None

    def close(self, c, side):
        self.ex.req("POST", "/api/v5/trade/close-position",
                    {"instId": f"{c}-USDT-SWAP", "mgnMode": "isolated", "autoCxl": True, **self._ps(side)})

    def move_stop(self, c, stop):
        """Borsadaki bağlı zarar durdurmayı yeni seviyeye taşır (iz süren stop)."""
        inst = f"{c}-USDT-SWAP"
        sp = self.specs()[inst]
        for typ in ("oco", "conditional"):
            for a in self.ex.req("GET", f"/api/v5/trade/orders-algo-pending?instType=SWAP&instId={inst}&ordType={typ}"):
                if a.get("slTriggerPx"):
                    self.ex.req("POST", "/api/v5/trade/amend-algos",
                                {"instId": inst, "algoId": a["algoId"], "newSlTriggerPx": _fmt(stop, sp["tickSz"]), "newSlOrdPx": "-1"})
                    return True
        return False

    def has_stop(self, c):
        inst = f"{c}-USDT-SWAP"
        for typ in ("oco", "conditional"):
            for a in self.ex.req("GET", f"/api/v5/trade/orders-algo-pending?instType=SWAP&instId={inst}&ordType={typ}"):
                if a.get("slTriggerPx"):
                    return True
        return False

    def place_stop(self, c, side, stop):
        """Borsada zarar durdur yoksa ekler (pozisyonun tamamını kapatır)."""
        inst = f"{c}-USDT-SWAP"
        sp = self.specs()[inst]
        self.ex.req("POST", "/api/v5/trade/order-algo", {
            "instId": inst, "tdMode": "isolated", "side": "sell" if side > 0 else "buy", "ordType": "conditional",
            "closeFraction": "1", "reduceOnly": "true", "slTriggerPx": _fmt(stop, sp["tickSz"]), "slOrdPx": "-1",
            "slTriggerPxType": "last", **self._ps(side)})

    def last_closed(self, c):
        d = self.ex.req("GET", f"/api/v5/account/positions-history?instType=SWAP&instId={c}-USDT-SWAP&limit=1")
        return d[0] if d else None


def _day():
    return time.strftime("%Y-%m-%d", time.gmtime(time.time() + 3 * 3600))


def _record(R, c, p, pnl, px, reason):
    pct = pnl / p["margin"] * 100 if p.get("margin") else 0
    R["trades"].append({"ts": int(time.time() * 1000), "sym": c, "side": "UZUN" if p["side"] > 0 else "KISA",
                        "pnl": round(pnl, 2), "pct": round(pct, 1), "reason": reason, "open": p["ts"], "real": True})
    R["trades"] = R["trades"][-300:]
    R["realized"] = round(R.get("realized", 0.0) + pnl, 4)
    _note(R, "exit", f"GERÇEK KAPAT {c} · {'+' if pnl >= 0 else ''}{pnl:.2f}$ (teminata göre %{pct:+.0f}) · {reason}")


def _close_all(D, R, reason):
    for c, p in list(R["pos"].items()):
        try:
            D.close(c, p["side"])
            p["closing"] = reason
        except Exception as e:
            _note(R, "risk", f"{c} kapatılamadı: {e}")


def _sync(D, R, cfg):
    R["err"] = ""  # bu eşitlemede yeniden oluşmayan eski uyarı kalmasın
    eq, avail = D.balance()
    live = D.positions()
    R["eq"], R["avail"] = round(eq, 4), round(avail, 4)
    _opening(D, R, cfg, live)  # yanıtı kaybolan açma emirleri: önce onlar kayda geçer
    for c, p in list(R["pos"].items()):
        if c in live:
            x = live[c]
            if time.time() - p.get("stop_chk", 0) > 60 and not p.get("closing"):
                p["stop_chk"] = time.time()
                try:
                    if not D.has_stop(c):
                        avg = float(x.get("avgPx") or p["entry"])
                        st = cfg.get("_stops", {}).get(c) or (p["stop"] if p.get("stop") and p["stop"] != avg else avg * (1 - p["side"] * 0.03))
                        mark = float(x.get("markPx") or avg)
                        if p["side"] * (mark - st) <= 0:  # fiyat stopu zaten geçmiş: hemen kapat
                            D.close(c, p["side"])
                            p["closing"] = "borsada stop yoktu ve fiyat stopu geçti"
                        else:
                            D.place_stop(c, p["side"], st)
                            p["stop"] = st
                            _note(R, "risk", f"{c}: borsada zarar durdur yoktu; {st:.6g} seviyesine eklendi")
                except Exception as e:
                    R["err"] = f"{c} stop kontrolü: {e}"[:200]
            gone = c not in cfg.get("_held", [c]) and time.time() * 1000 - p["ts"] > 60000
            lockd = R["dead"].startswith("kayıt açılamadı")  # şifre değişti: pozisyonlar borsadaki stop/hedefle kalır
            if (gone or p.get("force") or R["halt"] or (R["dead"] and not lockd) or not cfg.get("real")) and time.time() - p.get("close_try", 0) > 30:
                p["close_try"] = time.time()
                try:
                    D.close(c, p["side"])
                    p["closing"] = p.get("closing") or ("deneme masası kapattı" if gone else "zarar sınırı")
                except Exception as e:
                    R["err"] = f"{c} kapatılamadı, yeniden denenecek: {e}"[:200]
            p.update(now=float(x.get("markPx") or x.get("last") or p["entry"]), upl=float(x.get("upl") or 0),
                     liq=float(x.get("liqPx") or 0) or p.get("liq"), margin=float(x.get("margin") or x.get("imr") or p["margin"]))
            continue
        if not p.get("closing") and time.time() * 1000 - p["ts"] < 15000:
            continue  # yeni açıldı, borsa listesi henüz güncellenmedi
        h, herr = None, False
        try:
            h = D.last_closed(c)
        except Exception:
            herr = True  # kapanış kaydı okunamadı (ağ): sonuç 0 yazılmaz, 10 dk boyunca yeniden sorulur
        if h and int(h.get("uTime") or 0) < p["ts"]:
            h = None  # eski bir pozisyonun kaydı
        if h is None and time.time() - p.setdefault("gone_ts", time.time()) < (600 if herr else 20):
            continue  # borsanın kapanış kaydı birkaç saniye gecikebilir; kâr/zarar 0 yazılmasın
        pnl = float(h.get("realizedPnl") or h.get("pnl") or 0) if h else 0.0
        reason = p.get("closing") or ("borsadaki zarar durdur / kâr al" if h else "borsada kapanmış")
        _record(R, c, p, pnl, float(h.get("closeAvgPx") or 0) if h else 0, reason)
        del R["pos"][c]
    # kayıtta olmayan pozisyon (ör. bot emir verdikten hemen sonra yeniden başladı): masa sahiplenir, yönetmeye devam eder
    for c, x in live.items():
        if (c not in R["pos"] and c in cfg.get("coins", []) and x.get("mgnMode", "isolated") == "isolated"
                and cfg.get("real") and c in cfg.get("_held", []) and c not in (R.get("opening") or {})):
            # yalnız masanın açmış olabileceği pozisyon sahiplenilir; elle açılan pozisyona dokunulmaz
            pos = float(x.get("pos") or 0)
            side = (1 if x.get("posSide") == "long" else -1) if x.get("posSide") in ("long", "short") else (1 if pos > 0 else -1)
            avg = float(x.get("avgPx") or 0)
            R["pos"][c] = {"side": side, "ts": int(float(x.get("cTime") or time.time() * 1000)), "entry": avg, "now": avg,
                           "qty": abs(pos), "contracts": abs(pos), "margin": float(x.get("margin") or x.get("imr") or 0),
                           "stop": avg, "tp": avg, "liq": float(x.get("liqPx") or 0), "upl": float(x.get("upl") or 0),
                           "why": "borsada bulundu, sahiplenildi", "lev": int(float(x.get("lever") or 2))}
            _note(R, "info", f"{c} pozisyonu borsada bulundu; masa yönetimine alındı")
    _orphans(D, R, cfg, live)
    # gün başı ve zarar sınırları
    total = eq + R["harvest"]
    want = float(cfg["real_budget"])
    if R["funded"] > 0 and not R["trades"] and not R["pos"] and not R["harvest"]:
        R["funded"] = round(eq, 4)  # ilk işlemden önce taban = hesaptaki gerçek tutar (artık küçük USDT kâr sayılmaz)
    if R["day"] != _day():
        R["day"], R["day_eq"], R["halt"] = _day(), eq, ""
    if R["pos"] and not R["halt"] and R["day_eq"] > 0 and eq <= R["day_eq"] * (1 - cfg["daily_loss_pct"] / 100):
        R["halt"] = R["day"]
        _note(R, "risk", f"Günlük zarar sınırı (%{cfg['daily_loss_pct']}) doldu; pozisyonlar kapatılıyor, bugün yeni işlem yok")
        _close_all(D, R, "günlük zarar sınırı")
    if R["funded"] > 0 and not R["dead"] and total - R["funded"] <= -abs(cfg["max_loss"]):
        R["dead"] = f"toplam zarar {cfg['max_loss']:g} $ sınırına ulaştı"
        _note(R, "risk", f"MASA DURDU: {R['dead']}. Ayarlardan yeniden başlatılana kadar işlem yok")
        _close_all(D, R, "toplam zarar sınırı")
    # bütçe: fon hesabından işlem hesabına (yalnız bir kez / bütçe artınca); kâr: pozisyon yokken fona geri
    ht = R.pop("harv_try", None)
    if ht and (R["pos"] or time.time() - ht.get("ts", 0) > 300):
        ht = None  # yalnız hemen sonraki eşitlemelerde ve pozisyon yokken geçerli (sonraki bir zarar "kâr alındı" sanılmasın)
    ft = R.pop("fund_try", None) if cfg.get("real") and not R["dead"] and R["funded"] < want else None
    if ft and eq >= ft["eq"] + ft["amt"] * 0.9:
        # Önceki bütçe aktarımının yanıtı ağda kaybolmuştu ama para işlem hesabına ulaşmış: ikinci kez gönderilmez
        R["funded"] = round(ft["base"] + ft["amt"], 4)
        _note(R, "info", f"{ft['amt']:.2f} USDT fon hesabından işlem hesabına geçmiş (doğrulandı; gerçek masa bütçesi {R['funded']:.2f} $)")
        if R["day_eq"]:
            R["day_eq"] += ft["amt"]
    elif cfg.get("real") and not R["dead"] and R["funded"] < want:
        free = D.ex.funding("USDT")
        base = eq if R["funded"] <= 0 else R["funded"]
        amt = min(max(0.0, want - base), free)
        if R["funded"] <= 0 and amt < 1 and base >= 1:
            R["funded"] = round(min(base, want), 4)
        if amt >= 1:
            R["funded"] = base
            R["fund_try"] = {"eq": eq, "amt": amt, "base": base}  # yanıt kaybolursa: bir sonraki eşitlemede bakiyeden doğrulanır
            try:
                D.ex.move("USDT", amt, transfer.FUNDING, transfer.TRADING)
            except RuntimeError:
                R.pop("fund_try", None)  # borsa açıkça reddetti: para gitmedi
                raise
            R.pop("fund_try", None)
            R["funded"] = round(R["funded"] + amt, 4)
            _note(R, "info", f"{amt:.2f} USDT fon hesabından işlem hesabına geçti (gerçek masa bütçesi {R['funded']:.2f} $)")
            R["eq"], R["avail"] = round(eq + amt, 4), round(avail + amt, 4)
            if R["day_eq"]:
                R["day_eq"] += amt
    elif ht and eq <= ht["eq"] - ht["amt"] * 0.9:
        # Önceki kâr aktarımının yanıtı kaybolmuştu ama para fona geçmiş: kâr sayılır (zarar sanılıp masa durmasın)
        amt = ht["amt"]
        R["harvest"] = round(R["harvest"] + amt, 4)
        _note(R, "info", f"Kâr {amt:.2f} USDT fon hesabına alınmış (doğrulandı; KASA süpürmesine dahil olur)")
        R["day_eq"] = max(0.0, R["day_eq"] - amt)
    elif not R["pos"] and R.get("realized", 0) - R["harvest"] >= 1 and eq > want + 1:
        amt = math.floor(min(eq - want, R.get("realized", 0) - R["harvest"]) * 100) / 100  # yalnız gerçekleşen kâr
        if amt >= 1 and avail >= amt:
            R["harv_try"] = {"eq": eq, "amt": amt, "ts": time.time()}
            try:
                D.ex.move("USDT", amt, transfer.TRADING, transfer.FUNDING)
            except RuntimeError:
                R.pop("harv_try", None)
                raise
            R.pop("harv_try", None)
            R["harvest"] = round(R["harvest"] + amt, 4)
            _note(R, "info", f"Kâr {amt:.2f} USDT fon hesabına alındı (KASA süpürmesine dahil olur)")
            R["eq"] = round(eq - amt, 4)
            R["day_eq"] = max(0.0, R["day_eq"] - amt)
    if not R["equity"] or time.time() * 1000 - R["equity"][-1][0] >= 15 * 60000:
        R["equity"].append([int(time.time() * 1000), round(R["eq"] + R["harvest"], 2)])
        R["equity"] = R["equity"][-700:]


def _open(D, R, cfg, ev):
    _, c, side, px, dist, tpd, why = ev
    name = "UZUN" if side > 0 else "KISA"
    bad = ("masa durdu" if R["dead"] else "günlük zarar sınırı dolu" if R["halt"] else
           "zaten açık" if c in R["pos"] else "önceki emrin sonucu doğrulanıyor" if c in (R.get("opening") or {})
           else "bütçe henüz aktarılmadı" if R["funded"] <= 0 else None)
    if bad:
        _note(R, "risk", f"GERÇEK ENGEL {c} {name}: {bad}")
        return
    lev = int(max(1, min(3, cfg["real_lev"])))
    sp = D.specs().get(f"{c}-USDT-SWAP")
    if not sp:
        _note(R, "risk", f"GERÇEK ENGEL {c}: sözleşme bilgisi yok")
        return
    eq = R["eq"] or R["funded"]
    cap = min(eq / 3, R["avail"]) * 0.97  # ücret ve yuvarlama payı
    risk = eq * cfg["risk_pct"] / 100
    qty = min(risk / dist, cap * lev / px)
    n = math.floor(qty / sp["ctVal"] / sp["lotSz"] + 1e-9) * sp["lotSz"]
    if n < sp["minSz"]:
        n = sp["minSz"]  # en küçük sözleşme: teminata sığıyor ve risk hedefin 3 katını aşmıyorsa kabul
        if n * sp["ctVal"] * px / lev > cap or n * sp["ctVal"] * dist > 3 * risk:
            _note(R, "risk", f"GERÇEK ENGEL {c} {name}: en küçük işlem bile bütçe/risk sınırını aşıyor")
            return
    stop, tp = px - side * dist, px + side * tpd
    D.lever(c, side, lev)  # burada hata olursa emir gönderilmemiştir (bekleyen kayıt açılmaz)
    cl = CL + os.urandom(12).hex()
    # Emir kimliği gönderimden ÖNCE kayda geçer: yanıt kaybolsa da (ya da bot o an yeniden başlasa da) emir ve
    # pozisyonu bu kimlikle bulunur; pozisyon sahipsiz kalmaz, emir ikinci kez verilmez.
    R.setdefault("opening", {})[c] = {"cl": cl, "side": side, "ts": int(time.time() * 1000), "stop": stop, "tp": tp,
                                      "lev": lev, "why": why, "ct": sp["ctVal"]}
    try:
        avg, filled = D.open(c, side, n, stop, tp, lev, cl)
    except Exception as e:
        if _rejected(e):
            R["opening"].pop(c, None)  # borsa emri açıkça reddetti: pozisyon yok
            raise
        _note(R, "risk", f"GERÇEK {c} {name}: açma emrinin sonucu öğrenilemedi (bağlantı); borsadan doğrulanacak, emir iki kez verilmez")
        return
    R["opening"].pop(c, None)
    _book(R, c, R_pos(side, avg, filled, sp["ctVal"], lev, stop, tp, why))


def R_pos(side, avg, filled, ct, lev, stop, tp, why, ts=None):
    qty = filled * ct
    return {"side": side, "ts": int(ts or time.time() * 1000), "entry": avg, "now": avg, "qty": qty, "contracts": filled,
            "margin": qty * avg / lev, "stop": stop, "tp": tp, "liq": avg * (1 - side * (1 / lev - 0.005)),
            "upl": 0.0, "why": why, "lev": lev}


def _book(R, c, p, extra=""):
    R["pos"][c] = p
    _note(R, "buy", f"GERÇEK AÇ {c} {'UZUN' if p['side'] > 0 else 'KISA'} {p['lev']}x · {p['contracts']:g} sözleşme · teminat ${p['margin']:.2f} · "
                    f"borsada zarar durdur {p['stop']:.6g} / kâr al {p['tp']:.6g}{extra}")


def _rejected(e):
    """Borsa emri açıkça reddetti mi (emir kesinlikle yok)? Ağ hatası, zaman aşımı, bozuk yanıt ve borsanın
    "sonuç belirsiz" kodları (50xxx: sistem meşgul / zaman aşımı) ret sayılmaz."""
    m = re.match(r"(\d+):", str(e)) if isinstance(e, RuntimeError) else None
    return bool(m) and not m.group(1).startswith("50")


def _opening(D, R, cfg, live):
    """Sonucu öğrenilemeyen açma emirlerini kendi kimliğiyle borsaya sorar. Dolmuşsa pozisyon masaya alınır; deneme
    masası o pozisyonu bu arada kapattıysa (ya da masa durduysa) borsadaki pozisyon da hemen kapatılır. Emir borsaya
    hiç ulaşmamışsa kayıt bırakılır. Borsaya sorulamıyorsa kayıt bekler (o coinde yeni emir verilmez)."""
    for c, w in list((R.get("opening") or {}).items()):
        try:
            o = D.find(c, w["cl"])
        except Exception:
            continue
        age = time.time() * 1000 - w["ts"]
        if o is None:
            if age > OPEN_WAIT:
                del R["opening"][c]
                _note(R, "info", f"{c}: açma emri borsaya ulaşmamış (doğrulandı)")
            continue
        filled = float(o.get("accFillSz") or 0)
        if o.get("state") not in ("filled", "canceled", "mmp_canceled"):
            continue  # emir henüz sonuçlanmadı
        del R["opening"][c]
        if filled <= 0:
            _note(R, "info", f"{c}: açma emri dolmadan iptal olmuş (doğrulandı)")
            continue
        if c in R["pos"]:
            continue  # pozisyon zaten masada
        p = R_pos(w["side"], float(o.get("avgPx") or 0), filled, w.get("ct") or 1, w.get("lev") or 2, w["stop"], w["tp"],
                  w.get("why") or "", ts=w["ts"])
        _book(R, c, p, " · emir borsadan doğrulandı")
        why = (w.get("close") or ("deneme masası kapattı" if c not in cfg.get("_held", [c]) else "")
               or ("masa kapalı" if not cfg.get("real") else "") or ("zarar sınırı" if R["halt"] or R["dead"] else ""))
        if why:
            _shut(D, R, c, why, c in live)


def _shut(D, R, c, why, now=True):
    """Pozisyonu kapatılacak diye işaretler ve (borsa listesinde görünüyorsa) kapatma emrini hemen gönderir.
    Emir gitmezse ya da pozisyon listede henüz görünmüyorsa eşitleme yeniden dener (force)."""
    p = R["pos"][c]
    p["closing"] = why
    p["force"] = True
    if not now:
        return
    try:
        p["close_try"] = time.time()
        D.close(c, p["side"])
        _note(R, "info", f"GERÇEK kapatma emri {c} · {why}")
    except Exception as e:
        R["err"] = f"{c} kapatılamadı, yeniden denenecek: {e}"[:200]


_ORPH = {}  # coin -> son sorgu zamanı (kayıtta olmayan pozisyon için emir geçmişi dakikada bir sorulur)


def _orphans(D, R, cfg, live):
    """Borsada olup masanın kaydında olmayan izole pozisyon. Deneme masası o coini tutuyorsa `_sync` sahiplenir
    (değişmedi). Tutmuyorsa pozisyona yalnız, masanın kendi emir kimliğiyle (CL) açıldığı borsanın emir geçmişinden
    kanıtlanırsa dokunulur: masaya alınıp hemen kapatılır. Elle açılan pozisyonun böyle bir emri olmaz; dokunulmaz."""
    if R["dead"].startswith("kayıt açılamadı"):
        return  # şifre değişti: pozisyonlar borsadaki stop/hedefle kalır
    chk = _ORPH
    for c in [c for c in chk if c not in live]:
        del chk[c]
    for c, x in live.items():
        if c in R["pos"] or c in (R.get("opening") or {}) or (cfg.get("real") and c in cfg.get("_held", [])):
            continue
        if time.time() - chk.get(c, 0) < 60:
            continue  # coin başına dakikada bir sorulur
        chk[c] = time.time()
        ct = int(float(x.get("cTime") or 0))
        try:
            o = D.ours(c, ct - 10_000) if ct else None
        except Exception:
            chk[c] = time.time() - 50  # sorulamadı: 10 sn sonra yeniden
            continue
        if not o:
            continue
        pos = float(x.get("pos") or 0)
        side = (1 if x.get("posSide") == "long" else -1) if x.get("posSide") in ("long", "short") else (1 if pos > 0 else -1)
        avg = float(x.get("avgPx") or 0)
        R["pos"][c] = {"side": side, "ts": ct, "entry": avg, "now": avg, "qty": abs(pos), "contracts": abs(pos),
                       "margin": float(x.get("margin") or x.get("imr") or 0), "stop": avg, "tp": avg,
                       "liq": float(x.get("liqPx") or 0), "upl": float(x.get("upl") or 0),
                       "why": "masanın emriyle açılmış, kayıtta yoktu", "lev": int(float(x.get("lever") or 2))}
        _note(R, "risk", f"{c}: masanın açtığı pozisyon kayıtta yoktu (emir kimliğiyle doğrulandı); kapatılıyor")
        _shut(D, R, c, "sahipsiz pozisyon (kayıtta yoktu)")
        del chk[c]


def _loop():
    D = _Desk()
    last = 0.0
    while True:
        try:
            ev = _Q.get(timeout=1)
        except queue.Empty:
            ev = None
        R, cfg = _W["R"], _W["cfg"]
        try:
            with _LOCK:
                if ev and ev[0] == "open" and cfg.get("real"):
                    if time.time() - last >= 3:
                        _sync(D, R, cfg)
                        last = time.time()
                    _open(D, R, cfg, ev)
                elif ev and ev[0] == "close" and ev[1] in R["pos"]:
                    p = R["pos"][ev[1]]
                    D.close(ev[1], p["side"])
                    p["closing"] = ev[2]
                    _note(R, "info", f"GERÇEK kapatma emri {ev[1]} · {ev[2]}")
                elif ev and ev[0] == "close" and ev[1] in (R.get("opening") or {}):
                    # açma emrinin sonucu henüz bilinmiyor: pozisyon doğrulanınca hemen kapatılır (sahipsiz kalmaz)
                    R["opening"][ev[1]]["close"] = ev[2]
                    _note(R, "info", f"GERÇEK {ev[1]}: kapatma isteği alındı; açma emri doğrulanınca kapatılacak · {ev[2]}")
                elif ev and ev[0] == "trail" and ev[1] in R["pos"]:
                    p = R["pos"][ev[1]]
                    if p["side"] * (ev[2] - p["stop"]) > abs(p["stop"]) * 0.002:  # anlamlı ilerleme varsa
                        if D.move_stop(ev[1], ev[2]):
                            p["stop"], p["trailed"] = ev[2], True
                            _note(R, "info", f"{ev[1]} borsadaki stop {ev[2]:.6g} seviyesine taşındı (iz süren)")
                elif ev and ev[0] == "kill":
                    for w in (R.get("opening") or {}).values():
                        w["close"] = w.get("close") or "masa kapatıldı"
                    _close_all(D, R, "masa kapatıldı")
                if time.time() - last >= SYNC or (ev and ev[0] in ("close", "kill")):
                    _sync(D, R, cfg)
                    last = time.time()
                    R["sync"] = int(time.time() * 1000)
                R["err"] = "" if not R["err"].startswith(tuple(cfg.get("coins", []))) else R["err"]
        except Exception as e:
            with _LOCK:
                R["err"] = str(e)[:200]
                if ev and ev[0] == "open":
                    _note(R, "risk", f"GERÇEK {ev[1]} açılamadı: {e}")


def step(state, S, paper_cfg, N=None):
    cfg = {**paper_cfg, **DEFAULT, **{k: v for k, v in (S.get("lev") or {}).items() if k in DEFAULT}}
    L = state.get("lev") or {}
    evs = L.pop("ev", [])
    if not cfg["real"] and not state.get("levr"):
        return
    if not transfer.Ex("https://www.okx.com", "OKXG").ok:
        return
    if _W["R"] is None:
        _W["R"] = copy.deepcopy(state.get("levr")) or _new(cfg)
        if (state.get("locked") or {}).get("levr") and not state.get("levr"):
            _W["R"]["dead"] = "kayıt açılamadı (şifre değişmiş olabilir); ayarlardan yeniden başlat"
    R = _W["R"]
    if cfg.get("real_reset", 0) != R.get("reset", 0) and _LOCK.acquire(False):  # ayarlardan yeniden başlat: durma kaldırılır
        (state.get("locked") or {}).pop("levr", None)
        try:
            R["reset"], R["dead"], R["halt"] = cfg.get("real_reset", 0), "", ""
            R["funded"], R["harvest"], R["realized"] = R["eq"], 0.0, 0.0
            _note(R, "info", "Masa ayarlardan yeniden başlatıldı")
        finally:
            _LOCK.release()
    cfg["_held"] = list(L.get("positions") or {})
    cfg["_stops"] = {c: p.get("stop") for c, p in (L.get("positions") or {}).items()}
    _W["cfg"] = cfg
    if _W["t"] is None or not _W["t"].is_alive():
        _W["t"] = threading.Thread(target=_loop, daemon=True)
        _W["t"].start()
    was = state.get("levr", {}).get("on")
    if was and not cfg["real"] and R["pos"]:
        _Q.put(["kill"])
    for e in evs:
        if cfg["real"] or e[0] in ("close", "trail"):
            _Q.put(e)
    if not _LOCK.acquire(False):
        return  # işçi borsayla konuşuyor: bu tur bir önceki kayıt geçerli
    try:
        R["on"] = bool(cfg["real"])
        for kind, text in R.pop("out", []):
            if N:
                t = text.replace("GERÇEK ", "")
                N.add("trades" if kind != "risk" else "alerts", f"{TITLE} · {t.split(' ')[0].capitalize()}", t, 4,
                      ["chart_with_upwards_trend" if kind == "buy" else "moneybag" if "+" in t else "warning"])
        state["levr"] = json.loads(json.dumps(R))
    finally:
        _LOCK.release()


def trim_log():
    if _LOCK.acquire(timeout=1):
        try:
            if _W["R"]:
                del _W["R"]["log"][:-5]
        finally:
            _LOCK.release()


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
    return json.loads(json.dumps(_W["R"]))


def resume():
    """Yeniden başlama olmadıysa masa çalışmaya devam etsin."""
    if _W.pop("held", None):
        _LOCK.release()


def public(state):
    R = state.get("levr")
    if not R:
        return None
    done = R["trades"]
    wins = [t for t in done if t["pnl"] > 0]
    upl = sum(p.get("upl", 0) for p in R["pos"].values())
    return {"on": R.get("on"), "equity": round(R["eq"] + R["harvest"], 2), "funded": R["funded"], "harvest": R["harvest"],
            "pnl": round(R["eq"] + R["harvest"] - R["funded"], 2) if R["funded"] else 0, "upl": round(upl, 2),
            "halt": R["halt"], "dead": R["dead"], "err": R["err"], "sync": R.get("sync"),
            "positions": [{"sym": c, "side": "UZUN" if p["side"] > 0 else "KISA", "ts": p["ts"], "entry": p["entry"],
                           "now": p["now"], "stop": p["stop"], "tp": p["tp"], "liq": p["liq"], "margin": round(p["margin"], 2),
                           "pnl": round(p.get("upl", 0), 2), "why": p["why"], "lev": p.get("lev")} for c, p in R["pos"].items()],
            "trades": done[-40:][::-1], "log": R["log"][-40:][::-1], "equity_series": R["equity"][-200:], "fav": config.top_earners(done),
            "closed": len(done), "win_rate": round(len(wins) / len(done) * 100) if done else None}
