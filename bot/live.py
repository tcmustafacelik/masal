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
            self._inst[inst] = (float(row["lotSz"]), float(row["minSz"]))
        return self._inst[inst]

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


def floor_to(x, step):
    return math.floor(x / step + 1e-9) * step


class LivePortfolio(Portfolio):
    """Strateji kararları sanal motorla aynı; alım-satım gerçek emirle yapılır."""

    def __init__(self, state, armed):
        super().__init__(state)
        self.armed = armed  # False ise emir gönderilmez, sadece kaydedilir
        self.api = OkxPrivate() if armed else None
        self.log = state.setdefault("log", [])

    def _note(self, ts, text):
        self.log.append([ts, text])
        del self.log[:-100]
        print(text)

    def _buy(self, ts, inst, price, amount, reason):
        amount = round(min(amount, self.s["cash"]), 2)
        if amount < 10:
            return False
        if not self.armed:
            self._note(ts, f"[deneme] AL {inst} {amount} TL ({reason})")
            return super()._buy(ts, inst, price, amount, reason + " · deneme")
        try:
            if self.api.available(config.QUOTE) < amount:
                self._note(ts, f"Yetersiz TL bakiyesi, {inst} alınmadı")
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
            pos["lots"].append({"qty": qty, "entry": avg, "cost": spent, "ts": ts, "ordId": o["ordId"]})
            self.s["trades"].append({"ts": ts, "inst": inst, "side": "AL", "price": avg, "qty": qty,
                                     "amount": round(spent, 2), "reason": reason, "real": True})
            self._note(ts, f"AL {inst} {spent:.2f} TL @ {avg}")
            return True
        except Exception as e:
            self._note(ts, f"HATA alım {inst}: {e}")
            return False

    def _sell_lots(self, ts, inst, price, lots, reason):
        if not self.armed:
            self._note(ts, f"[deneme] SAT {inst} ({reason})")
            return super()._sell_lots(ts, inst, price, lots, reason + " · deneme")
        pos = self.s["positions"][inst]
        base = inst.split("-")[0]
        try:
            want = sum(l["qty"] for l in lots)
            have = self.api.available(base)
            lot_sz, min_sz = self.api.instrument(inst)
            sz = floor_to(min(want, have), lot_sz)
            if sz < min_sz:
                self._note(ts, f"{inst} satılamadı: miktar asgari sınırın altında")
                pos["lots"] = [l for l in pos["lots"] if l not in lots]
                if not pos["lots"]:
                    del self.s["positions"][inst]
                return
            o = self.api.market(inst, "sell", f"{sz:.10f}".rstrip("0").rstrip("."))
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
            self._note(ts, f"SAT {inst} {proceeds:.2f} TL @ {avg} ({pnl:+.2f})")
        except Exception as e:
            self._note(ts, f"HATA satış {inst}: {e}")
