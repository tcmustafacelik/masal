"""Sanal portföy, stratejiler ve risk kuralları. Canlı çalışma ve geçmiş test aynı motoru kullanır."""
from datetime import datetime, timedelta, timezone

from . import config

TZ = timezone(timedelta(hours=config.TZ_OFFSET_HOURS))


# ---------- göstergeler ----------
def sma(xs, n):
    return sum(xs[-n:]) / n if len(xs) >= n else None


def ema(xs, n):
    if len(xs) < n:
        return None
    k = 2 / (n + 1)
    e = sum(xs[:n]) / n
    for x in xs[n:]:
        e = x * k + e * (1 - k)
    return e


def rsi(xs, n=14):
    if len(xs) < n + 1:
        return None
    gains = losses = 0.0
    for a, b in zip(xs[-n - 1:-1], xs[-n:]):
        d = b - a
        gains += max(d, 0)
        losses += max(-d, 0)
    if losses == 0:
        return 100.0
    rs = gains / losses
    return 100 - 100 / (1 + rs)


WARMUP = 60 * config.BPH  # 60 saatlik veri birikmeden işlem yapılmaz


def new_state(key, cash=None, scale=None):
    cash = cash or config.START_CASH
    return {
        "key": key,
        "start_cash": cash,
        "scale": scale or cash / config.START_CASH,  # risk tutarları bakiyeyle orantılı ölçeklenir
        "cash": cash,
        "positions": {},
        "trades": [],
        "equity": [],
        "last_prices": {},
        "last_bar": {},
        "day": {"date": None, "start_equity": cash},
        "halted": False,
        "halt_reason": "",
        "blocked_today": False,
    }


class Portfolio:
    def __init__(self, state):
        self.s = state
        k = state.get("scale", 1.0)
        self.cfg = dict(config.STRATEGIES[state["key"]])
        if "lot" in self.cfg:
            self.cfg["lot"] = self.cfg["lot"] * k
        self.risk = dict(config.RISK)
        for f in ("trade_size", "daily_loss_limit", "kill_switch"):
            self.risk[f] = self.risk[f] * k

    # ---------- yardımcılar ----------
    def _room(self, amount):
        """Kademeli stratejide coinlere yatırılan toplam para, bütçenin belirlenen oranını aşmasın."""
        cap = self.cfg.get("max_use")
        if not cap:
            return True
        used = sum(l["cost"] for p in self.s["positions"].values() for l in p["lots"])
        return used + amount <= cap * self.s.get("start_cash", config.START_CASH) + 0.01

    def equity(self):
        total = self.s["cash"]
        for inst, pos in self.s["positions"].items():
            px = self.s["last_prices"].get(inst, 0)
            total += sum(l["qty"] for l in pos["lots"]) * px
        return total

    def _buy(self, ts, inst, price, amount, reason):
        amount = min(amount, self.s["cash"])
        if amount < 10:
            return False
        eff = price * (1 + config.SLIPPAGE)
        qty = amount * (1 - config.FEE_RATE) / eff
        self.s["cash"] -= amount
        pos = self.s["positions"].setdefault(inst, {"lots": [], "peak": price, "bars": 0})
        pos["lots"].append({"qty": qty, "entry": eff, "cost": amount, "ts": ts})
        pos["peak"] = max(pos["peak"], price)
        self.s["trades"].append({"ts": ts, "inst": inst, "side": "AL", "price": price,
                                 "qty": qty, "amount": round(amount, 2), "reason": reason})
        return True

    def _sell_lots(self, ts, inst, price, lots, reason):
        pos = self.s["positions"][inst]
        eff = price * (1 - config.SLIPPAGE)
        qty = sum(l["qty"] for l in lots)
        cost = sum(l["cost"] for l in lots)
        proceeds = qty * eff * (1 - config.FEE_RATE)
        self.s["cash"] += proceeds
        pnl = proceeds - cost
        self.s["trades"].append({"ts": ts, "inst": inst, "side": "SAT", "price": price, "qty": qty,
                                 "amount": round(proceeds, 2), "pnl": round(pnl, 2),
                                 "pnl_pct": round(pnl / cost * 100, 2), "reason": reason})
        pos["lots"] = [l for l in pos["lots"] if l not in lots]
        if not pos["lots"]:
            del self.s["positions"][inst]

    def _can_open(self):
        return (not self.s["halted"] and not self.s["blocked_today"] and not self.s.get("paused")
                and len(self.s["positions"]) < self.risk["max_positions"]
                and self.s["cash"] >= 50)

    # ---------- gün ve fren kontrolleri ----------
    def start_bar(self, ts):
        day = datetime.fromtimestamp(ts / 1000, TZ).strftime("%Y-%m-%d")
        if self.s["day"]["date"] != day:
            self.s["day"] = {"date": day, "start_equity": round(self.equity(), 2)}
            self.s["blocked_today"] = False

    def end_bar(self, ts):
        eq = self.equity()
        if not self.s["halted"] and eq < self.risk["kill_switch"]:
            for inst in list(self.s["positions"]):
                px = self.s["last_prices"][inst]
                self._sell_lots(ts, inst, px, list(self.s["positions"][inst]["lots"]), "Acil fren")
            self.s["halted"] = True
            self.s["halt_reason"] = f"Bakiye {self.risk['kill_switch']:,.0f} TL altına indi"
            eq = self.equity()
        if eq <= self.s["day"]["start_equity"] - self.risk["daily_loss_limit"]:
            self.s["blocked_today"] = True
        if not self.s["equity"] or self.s["equity"][-1][0] != ts:
            self.s["equity"].append([ts, round(eq, 2), round(self.s.get("start_cash", eq), 2)])
        else:
            self.s["equity"][-1][1:] = [round(eq, 2), round(self.s.get("start_cash", eq), 2)]
        self.s["equity"] = self.s["equity"][-3000:]
        if len(self.s["trades"]) > 500:  # silinen eski işlemler coin özetinde saklanır
            arch = self.s.setdefault("coin_arch", {})
            for t in self.s["trades"][:-500]:
                c = arch.setdefault(t["inst"], {"pnl": 0.0, "sells": 0, "wins": 0, "buys": 0, "bought": 0.0})
                if t["side"] == "SAT":
                    c["pnl"] += t.get("pnl", 0); c["sells"] += 1; c["wins"] += t.get("pnl", 0) > 0
                else:
                    c["buys"] += 1; c["bought"] += t.get("amount", 0)
        self.s["trades"] = self.s["trades"][-500:]

    # ---------- strateji ----------
    def on_bar(self, ts, inst, closes):
        price = closes[-1]
        self.s["last_prices"][inst] = price
        self.s["last_bar"][inst] = ts
        if len(closes) < WARMUP:
            return
        pos = self.s["positions"].get(inst)
        if pos:
            pos["bars"] += 1
            pos["peak"] = max(pos["peak"], price)
        getattr(self, "_" + self.s["key"])(ts, inst, closes, price, pos)

    def _dip(self, ts, inst, closes, price, pos):
        c = self.cfg
        if pos:
            entry = pos["lots"][0]["entry"]
            if price >= entry * (1 + c["take_profit"]):
                self._sell_lots(ts, inst, price, list(pos["lots"]), "Hedef kâr")
            elif price <= entry * (1 - self.risk["stop_loss"]):
                self._sell_lots(ts, inst, price, list(pos["lots"]), "Zarar sınırı")
            elif pos["bars"] >= c["max_hold_bars"]:
                self._sell_lots(ts, inst, price, list(pos["lots"]), "Süre doldu")
            return
        m, r = sma(closes, c["sma"]), rsi(closes, c["rsi"])
        if self._can_open() and m and r is not None and price <= m * (1 - c["dip_pct"]) and r < c["rsi_max"]:
            self._buy(ts, inst, price, self.risk["trade_size"], "Ortalamanın altında, aşırı satım")

    def _trend(self, ts, inst, closes, price, pos):
        c = self.cfg
        f, s = ema(closes, c["fast"]), ema(closes, c["slow"])
        pf, ps = ema(closes[:-1], c["fast"]), ema(closes[:-1], c["slow"])
        if pos:
            entry = pos["lots"][0]["entry"]
            if price <= entry * (1 - self.risk["stop_loss"]):
                self._sell_lots(ts, inst, price, list(pos["lots"]), "Zarar sınırı")
            elif price <= pos["peak"] * (1 - c["trailing"]) and price > entry:
                self._sell_lots(ts, inst, price, list(pos["lots"]), "İz süren stop")
            elif f < s:
                self._sell_lots(ts, inst, price, list(pos["lots"]), "Trend döndü")
            return
        b = ema(closes, c["base"])
        if self._can_open() and pf <= ps and f > s and price > b:
            self._buy(ts, inst, price, self.risk["trade_size"], "Yükseliş kesişimi")

    def _entry_ok(self, closes, price, extra=False):
        """Düşüş filtresi: düşen bıçağı tutmamak için yeni alımı erteler (ayarlardan açılır)."""
        c = self.cfg
        if extra and not c.get("filter_all"):
            return True
        if c.get("mkt_filter") and MARKET["down"]:
            return False
        cf = c.get("coin_filter")
        if cf:
            n, lag = 48 * config.BPH, 24 * config.BPH
            now, prev = sma(closes, n), sma(closes[:-lag], n)
            if now and prev and now < prev * (1 - cf):
                return False
        if c.get("confirm") and len(closes) > 1 and closes[-1] <= closes[-2]:
            return False
        return True

    def _grid(self, ts, inst, closes, price, pos):
        c = self.cfg
        if pos:
            done = [l for l in pos["lots"] if price >= l["entry"] * (1 + c["lot_tp"])]
            if done:
                self._sell_lots(ts, inst, price, done, "Kademe kârı")
                pos = self.s["positions"].get(inst)
                if not pos:
                    return
            cost = sum(l["cost"] for l in pos["lots"])
            qty = sum(l["qty"] for l in pos["lots"])
            avg = cost / qty
            if price <= avg * (1 - c["stop"]):
                self._sell_lots(ts, inst, price, list(pos["lots"]), "Zarar sınırı")
            elif (len(pos["lots"]) < c["max_lots"] and not self.s["halted"] and not self.s["blocked_today"]
                  and not self.s.get("paused") and self._room(c["lot"])
                  and price <= pos["lots"][-1]["entry"] * (1 - c["step"]) and self._entry_ok(closes, price, True)):
                self._buy(ts, inst, price, c["lot"], f"{len(pos['lots']) + 1}. kademe")
            return
        m = sma(closes, 20 * config.BPH)  # son 20 saatin ortalaması
        if (self._can_open() and len(self.s["positions"]) < c["max_coins"] and self._room(c["lot"])
                and m and price <= m * (1 - c["step"]) and self._entry_ok(closes, price)):
            self._buy(ts, inst, price, c["lot"], "1. kademe")


MARKET = {"down": False}  # piyasa geneli (BTC) sert düşüşte mi; run_bars her mumda günceller
MARKET_REF = "BTC-TRY"


def _market_down(series, group, th):
    """BTC son 48 saatin ortalamasının th oranından fazla altındaysa piyasa 'düşüşte' sayılır."""
    for _, inst, idx in group:
        if inst == MARKET_REF:
            closes = [c for _, c in series[inst][max(0, idx - 299): idx + 1]]
            m = sma(closes, 48 * config.BPH)
            return bool(m and closes[-1] < m * (1 - th))
    return MARKET["down"]


def _dip_rank(series, inst, idx):
    """Aynı saatte birden çok fırsat varsa en derin düşüş önce değerlendirilir."""
    closes = [c for _, c in series[inst][max(0, idx - 19): idx + 1]]
    return closes[-1] / (sum(closes) / len(closes)) if closes else 1.0


def run_bars(portfolios, events, series):
    """events: (ts, inst, idx) listesi; series[inst]: [(ts, close)]. Zaman sırasıyla işler."""
    events.sort()
    i = 0
    while i < len(events):
        ts = events[i][0]
        group = []
        while i < len(events) and events[i][0] == ts:
            group.append(events[i])
            i += 1
        th = config.STRATEGIES["grid"].get("mkt_filter") or 0
        MARKET["down"] = _market_down(series, group, th) if th else False
        for p in portfolios:
            p.start_bar(ts)
            for _, inst, idx in sorted(group, key=lambda g: _dip_rank(series, g[1], g[2])):
                closes = [c for _, c in series[inst][max(0, idx - 299): idx + 1]]
                p.on_bar(ts, inst, closes)
            p.end_bar(ts)


def watch(p, series):
    """Uygulamadaki "Bot ne yapıyor" kartı için: her coinin alım şartına ne kadar uzak olduğu.
    g: fiyatın alım fiyatına uzaklığı (%; 0 ve altı = şart sağlandı), f: düşüş filtresi bekletiyor."""
    c = p.cfg
    if p.s["key"] != "grid":
        return None
    out = []
    for inst, bars in series.items():
        closes = [x for _, x in bars[-300:]]
        if not closes:
            continue
        price = closes[-1]
        pos = p.s["positions"].get(inst)
        if pos:
            lots = pos["lots"]
            if len(lots) >= c["max_lots"]:
                continue
            target = lots[-1]["entry"] * (1 - c["step"])
            filt = False
        else:
            m = sma(closes, 20 * config.BPH)
            if not m:
                continue
            target = m * (1 - c["step"])
            filt = not p._entry_ok(closes, price)
        out.append({"i": inst, "p": price, "t": target, "g": round((price / target - 1) * 100, 2),
                    "f": filt, "h": len(pos["lots"]) if pos else 0})
    out.sort(key=lambda x: x["g"])
    used = sum(l["cost"] for q in p.s["positions"].values() for l in q["lots"])
    cap = (c.get("max_use") or 1) * p.s.get("start_cash", config.START_CASH)
    return {"items": out, "used": round(used, 2), "cap": round(cap, 2), "lot": round(c.get("lot", 0), 2),
            "room": used + c.get("lot", 0) <= cap + 0.01, "coins": len(p.s["positions"]), "max_coins": c["max_coins"]}
