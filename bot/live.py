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

from . import config
from .engine import Portfolio


class OkxPrivate:
    def __init__(self):
        self.key = os.environ.get("OKX_API_KEY", "")
        self.secret = os.environ.get("OKX_API_SECRET", "")
        self.passphrase = os.environ.get("OKX_API_PASSPHRASE", "")
        if not (self.key and self.secret and self.passphrase):
            raise RuntimeError("API anahtarları tanımlı değil (GitHub Secrets).")
        self._inst = {}

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
            detail = res.get("data", [{}])[0].get("sMsg", "") if res.get("data") else ""
            raise RuntimeError(f"OKX {res.get('code')}: {res.get('msg')} {detail}".strip())
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
        return self._req("POST", "/api/v5/trade/order-algo", body)[0]["algoId"]

    def algo(self, algo_id):
        return self._req("GET", f"/api/v5/trade/order-algo?algoId={algo_id}")[0]

    def cancel_algos(self, items):
        if items:
            self._req("POST", "/api/v5/trade/cancel-algos", [{"algoId": a, "instId": i} for a, i in items])

    def order(self, inst, ord_id):
        return self._req("GET", f"/api/v5/trade/order?instId={inst}&ordId={ord_id}")[0]

    def market(self, inst, side, sz, quote=False):
        body = {"instId": inst, "tdMode": "cash", "side": side, "ordType": "market", "sz": sz,
                "tgtCcy": "quote_ccy" if quote else "base_ccy"}
        oid = self._req("POST", "/api/v5/trade/order", body)[0]["ordId"]
        o = {}
        for _ in range(10):  # piyasa emri genelde anında dolar; en fazla ~6 sn bekle
            time.sleep(0.6)
            o = self._req("GET", f"/api/v5/trade/order?instId={inst}&ordId={oid}")[0]
            if o["state"] in ("filled", "canceled", "mmp_canceled"):
                break
        return o


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


class LivePortfolio(Portfolio):
    """Strateji kararları sanal motorla aynı; alım-satım gerçek emirle yapılır."""

    def __init__(self, state, armed):
        super().__init__(state)
        self.armed = armed  # False ise emir gönderilmez, sadece kaydedilir
        self.api = OkxPrivate() if armed else None
        self.log = state.setdefault("log", [])
        self.notifier = None

    def _emit(self, cat, title, msg, priority=3, tags=None):
        if self.notifier:
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
        amount = round(min(amount, self.s["cash"]), 2)
        if amount < 10:
            return False
        if not self.armed:
            self._note(ts, f"[deneme] AL {inst.split('-')[0]} {para(amount)} TL · {reason}")
            return super()._buy(ts, inst, price, amount, reason + " · deneme")
        try:
            if self.api.available(config.QUOTE) < amount:
                self._note(ts, f"Yetersiz TL bakiyesi, {inst} alınmadı")
                if self._once_per_day("funds"):
                    self._emit("alerts", "Hesapta yeterli TL yok",
                               "Bot alım yapmak istedi ama alım-satım hesabında yeterli TL görünmüyor. "
                               "Fonlama hesabından transfer gerekebilir.", 4, ["warning"])
                return False
            o = self.api.market(inst, "buy", f"{amount:.2f}", quote=True)
            filled = float(o.get("accFillSz") or 0)
            if filled <= 0:
                self._note(ts, f"{inst} alım emri dolmadı ({o['state']})")
                return False
            base = inst.split("-")[0]
            fee = float(o.get("fee") or 0)
            qty = filled + (fee if o.get("feeCcy") == base else 0)  # alım komisyonu coin cinsinden düşülür
            avg = float(o["avgPx"])
            spent = filled * avg
            self.s["cash"] -= spent
            pos = self.s["positions"].setdefault(inst, {"lots": [], "peak": avg, "bars": 0})
            lot = {"qty": qty, "entry": avg, "cost": spent, "ts": ts, "ordId": o["ordId"]}
            pos["lots"].append(lot)
            self.s["trades"].append({"ts": ts, "inst": inst, "side": "AL", "price": avg, "qty": qty,
                                     "amount": round(spent, 2), "reason": reason, "real": True})
            self._note(ts, f"AL {inst.split('-')[0]} {para(spent)} TL · fiyat {fiyat(avg)}")
            self._protect(ts, inst, lot)
            self._emit("trades", f"Alındı: {inst.split('-')[0]}", f"{para(spent)} TL · fiyat {fiyat(avg)} · {reason}", 3, ["shopping_cart"])
            return True
        except Exception as e:
            self._note(ts, f"HATA alım {inst}: {e}")
            if self._once_per_day("err_buy"):
                self._emit("alerts", "Alım hatası", f"{inst}: {e}", 4, ["warning"])
            return False

    def _targets(self, entry):
        k, c, r = self.s["key"], self.cfg, self.risk
        if k == "grid":
            return entry * (1 + c["lot_tp"]), entry * (1 - c["stop"])
        if k == "dip":
            return entry * (1 + c["take_profit"]), entry * (1 - r["stop_loss"])
        return None, entry * (1 - r["stop_loss"])

    def _protect(self, ts, inst, lot):
        try:
            tp, sl = self._targets(lot["entry"])
            lot["algo"] = self.api.protect(inst, lot["qty"], tp, sl)
            lot["tp"], lot["sl"] = tp, sl
            if lot["algo"]:
                self._note(ts, f"Borsa koruması kuruldu: {inst.split('-')[0]} · "
                               + (f"kâr al {fiyat(tp)} · " if tp else "") + f"zarar durdur {fiyat(sl)}")
        except Exception as e:
            lot["algo"] = None
            self._note(ts, f"HATA borsa koruması {inst}: {e}")
            self._emit("alerts", "Borsa koruması kurulamadı", f"{inst}: {e}. Bot saatlik kontrolle korumaya devam eder.",
                       4, ["warning"])

    def reconcile(self):
        """Borsada tetiklenen kâr al / zarar durdur emirlerini kayda geçirir, eksik korumaları yeniden kurar."""
        if not self.armed:
            return
        now = int(time.time() * 1000)
        for inst in list(self.s["positions"]):
            pos = self.s["positions"][inst]
            for lot in list(pos["lots"]):
                if not lot.get("algo"):
                    self._protect(now, inst, lot)
                    continue
                try:
                    a = self.api.algo(lot["algo"])
                except Exception as e:
                    self._note(now, f"Koruma durumu okunamadı {inst}: {e}")
                    continue
                st = a.get("state")
                if st in ("effective", "partially_effective"):
                    oid = a.get("ordId") or (a.get("ordIdList") or [""])[0]
                    o = self.api.order(inst, oid) if oid else {}
                    filled = float(o.get("accFillSz") or a.get("actualSz") or 0)
                    avg = float(o.get("avgPx") or a.get("actualPx") or 0)
                    fee = float(o.get("fee") or 0)
                    proceeds = filled * avg + (fee if o.get("feeCcy") == config.QUOTE else 0)
                    share = min(1.0, filled / lot["qty"]) if lot["qty"] else 1.0
                    cost = lot["cost"] * share
                    pnl = proceeds - cost
                    reason = "Borsada kâr alındı" if avg >= lot["entry"] else "Borsada zarar durduruldu"
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
        if self.armed:  # bot kendisi satacaksa önce borsadaki korumaları iptal et
            try:
                items = [(l["algo"], inst) for l in lots if l.get("algo")]
                if items:
                    self.api.cancel_algos(items)
                    time.sleep(0.5)
            except Exception as e:
                self._note(ts, f"Koruma iptali uyarısı {inst}: {e}")
        if not self.armed:
            self._note(ts, f"[deneme] SAT {inst.split('-')[0]} · {reason}")
            return super()._sell_lots(ts, inst, price, lots, reason + " · deneme")
        pos = self.s["positions"][inst]
        base = inst.split("-")[0]
        try:
            want = sum(l["qty"] for l in lots)
            have = self.api.available(base)
            lot_sz, min_sz, _ = self.api.instrument(inst)
            sz = floor_to(min(want, have), lot_sz)
            if sz < min_sz:
                self._note(ts, f"{inst} satılamadı: miktar asgari sınırın altında")
                pos["lots"] = [l for l in pos["lots"] if l not in lots]
                if not pos["lots"]:
                    del self.s["positions"][inst]
                return
            o = self.api.market(inst, "sell", fmt(sz, lot_sz))
            filled = float(o.get("accFillSz") or 0)
            if filled <= 0:
                self._note(ts, f"{inst} satış emri dolmadı ({o['state']})")
                return
            avg = float(o["avgPx"])
            fee = float(o.get("fee") or 0)
            proceeds = filled * avg + (fee if o.get("feeCcy") == config.QUOTE else 0)
            cost = sum(l["cost"] for l in lots) * (filled / want if want else 1)
            self.s["cash"] += proceeds
            pnl = proceeds - cost
            self.s["trades"].append({"ts": ts, "inst": inst, "side": "SAT", "price": avg, "qty": filled,
                                     "amount": round(proceeds, 2), "pnl": round(pnl, 2),
                                     "pnl_pct": round(pnl / cost * 100, 2) if cost else 0,
                                     "reason": reason, "real": True})
            pos["lots"] = [l for l in pos["lots"] if l not in lots]
            if not pos["lots"]:
                del self.s["positions"][inst]
            sign = "+" if pnl >= 0 else "−"
            self._note(ts, f"SAT {inst.split('-')[0]} {para(proceeds)} TL · fiyat {fiyat(avg)} · sonuç {sign}{para(abs(pnl))} TL")
            self._emit("trades", f"Satıldı: {inst.split('-')[0]} ({sign}{para(abs(pnl))} TL)",
                       f"{para(proceeds)} TL · fiyat {fiyat(avg)} · {reason}", 4 if reason == "Acil fren" else 3,
                       ["chart_with_upwards_trend" if pnl >= 0 else "chart_with_downwards_trend"])
        except Exception as e:
            self._note(ts, f"HATA satış {inst}: {e}")
            self._emit("alerts", "Satış hatası", f"{inst}: {e}", 5, ["rotating_light"])
