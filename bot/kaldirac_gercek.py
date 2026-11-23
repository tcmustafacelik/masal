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
import math
import queue
import threading
import time

from . import transfer

DEFAULT = {"real": False, "real_budget": 30.0, "real_lev": 2, "max_loss": 10.0, "real_reset": 0}
SYNC = 20
_Q = queue.Queue()
_LOCK = threading.Lock()
_W = {"t": None, "R": None, "cfg": {}}


def _new(cfg):
    return {"funded": 0.0, "harvest": 0.0, "eq": 0.0, "avail": 0.0, "pos": {}, "trades": [], "log": [], "equity": [],
            "day": "", "day_eq": 0.0, "halt": "", "dead": "", "err": "", "sync": 0, "reset": cfg.get("real_reset", 0)}


def _note(R, kind, text):
    print("[" + __name__.split(".")[-1] + "]", text)  # günlükte izlemek için (anahtar/tutar dışı bilgi)
    R["log"].append([int(time.time() * 1000), kind, text])
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
                return float(x.get("eq") or 0), float(x.get("availBal") or 0)
        return 0.0, 0.0

    def positions(self):
        out = {}
        for p in self.ex.req("GET", "/api/v5/account/positions?instType=SWAP"):
            if float(p.get("pos") or 0) != 0 and p["instId"].endswith("-USDT-SWAP"):
                out[p["instId"].split("-")[0]] = p
        return out

    def _ps(self, side):
        return {"posSide": "long" if side > 0 else "short"} if self.mode() == "long_short_mode" else {}

    def open(self, c, side, contracts, stop, tp, lev):
        inst = f"{c}-USDT-SWAP"
        sp = self.specs()[inst]
        if (inst, lev) not in self.lev_set:
            self.ex.req("POST", "/api/v5/account/set-leverage",
                        {"instId": inst, "lever": str(lev), "mgnMode": "isolated", **self._ps(side)})
            self.lev_set.add((inst, lev))
        d = self.ex.req("POST", "/api/v5/trade/order", {
            "instId": inst, "tdMode": "isolated", "side": "buy" if side > 0 else "sell", "ordType": "market",
            "sz": _fmt(contracts, sp["lotSz"]), **self._ps(side),
            "attachAlgoOrds": [{"tpTriggerPx": _fmt(tp, sp["tickSz"]), "tpOrdPx": "-1", "tpTriggerPxType": "last",
                                "slTriggerPx": _fmt(stop, sp["tickSz"]), "slOrdPx": "-1", "slTriggerPxType": "last"}]})
        oid = d[0]["ordId"]
        for _ in range(5):
            time.sleep(0.6)
            o = self.ex.req("GET", f"/api/v5/trade/order?instId={inst}&ordId={oid}")[0]
            if o["state"] == "filled":
                return float(o["avgPx"]), float(o["accFillSz"])
        raise RuntimeError(f"{c} emri dolmadı ({o['state']})")

    def close(self, c, side):
        self.ex.req("POST", "/api/v5/trade/close-position",
                    {"instId": f"{c}-USDT-SWAP", "mgnMode": "isolated", "autoCxl": True, **self._ps(side)})

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
    _note(R, "exit", f"GERÇEK KAPAT {c} · {'+' if pnl >= 0 else ''}{pnl:.2f}$ (teminata göre %{pct:+.0f}) · {reason}")


def _close_all(D, R, reason):
    for c, p in list(R["pos"].items()):
        try:
            D.close(c, p["side"])
            p["closing"] = reason
        except Exception as e:
            _note(R, "risk", f"{c} kapatılamadı: {e}")


def _sync(D, R, cfg):
    eq, avail = D.balance()
    live = D.positions()
    R["eq"], R["avail"] = round(eq, 4), round(avail, 4)
    for c, p in list(R["pos"].items()):
        if c in live:
            x = live[c]
            p.update(now=float(x.get("markPx") or x.get("last") or p["entry"]), upl=float(x.get("upl") or 0),
                     liq=float(x.get("liqPx") or 0) or p.get("liq"), margin=float(x.get("margin") or x.get("imr") or p["margin"]))
            continue
        if not p.get("closing") and time.time() * 1000 - p["ts"] < 15000:
            continue  # yeni açıldı, borsa listesi henüz güncellenmedi
        h = None
        try:
            h = D.last_closed(c)
        except Exception:
            pass
        pnl = float(h.get("realizedPnl") or h.get("pnl") or 0) if h else 0.0
        reason = p.get("closing") or ("borsadaki zarar durdur / kâr al" if h else "borsada kapanmış")
        _record(R, c, p, pnl, float(h.get("closeAvgPx") or 0) if h else 0, reason)
        del R["pos"][c]
    # botun bilmediği pozisyon (ör. kapatma emri yarıda kaldı): masa yalnız kendi coinlerini yönetir, dokunmaz, bildirir
    for c in live:
        if c not in R["pos"] and c in cfg.get("coins", []):
            R["err"] = f"{c}: borsada masanın kaydında olmayan pozisyon var"
    # gün başı ve zarar sınırları
    total = eq + R["harvest"]
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
    want = float(cfg["real_budget"])
    if not R["dead"] and R["funded"] < want:
        free = D.ex.funding("USDT")
        amt = min(want - R["funded"], free)
        if amt >= 1:
            D.ex.move("USDT", amt, transfer.FUNDING, transfer.TRADING)
            R["funded"] = round(R["funded"] + amt, 4)
            _note(R, "info", f"{amt:.2f} USDT fon hesabından işlem hesabına geçti (gerçek masa bütçesi {R['funded']:.2f} $)")
            R["eq"], R["avail"] = round(eq + amt, 4), round(avail + amt, 4)
            if R["day_eq"]:
                R["day_eq"] += amt
    elif not R["pos"] and eq - R["funded"] + R["harvest"] > 0 and eq > want + 1:
        amt = math.floor((eq - want) * 100) / 100
        if amt >= 1 and avail >= amt:
            D.ex.move("USDT", amt, transfer.TRADING, transfer.FUNDING)
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
           "zaten açık" if c in R["pos"] else "bütçe henüz aktarılmadı" if R["funded"] <= 0 else None)
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
    avg, filled = D.open(c, side, n, stop, tp, lev)
    qty = filled * sp["ctVal"]
    R["pos"][c] = {"side": side, "ts": int(time.time() * 1000), "entry": avg, "now": avg, "qty": qty, "contracts": filled,
                   "margin": qty * avg / lev, "stop": stop, "tp": tp, "liq": avg * (1 - side * (1 / lev - 0.005)),
                   "upl": 0.0, "why": why, "lev": lev}
    _note(R, "buy", f"GERÇEK AÇ {c} {name} {lev}x · {filled:g} sözleşme · teminat ${qty * avg / lev:.2f} · "
                    f"borsada zarar durdur {stop:.6g} / kâr al {tp:.6g}")


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
                elif ev and ev[0] == "kill":
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


def step(state, S, paper_cfg):
    cfg = {**paper_cfg, **DEFAULT, **{k: v for k, v in (S.get("lev") or {}).items() if k in DEFAULT}}
    L = state.get("lev") or {}
    evs = L.pop("ev", [])
    if not cfg["real"] and not state.get("levr"):
        return
    if not transfer.Ex("https://www.okx.com", "OKXG").ok:
        return
    if _W["R"] is None:
        _W["R"] = state.get("levr") or _new(cfg)
    R = _W["R"]
    if cfg.get("real_reset", 0) != R.get("reset", 0):  # ayarlardan yeniden başlat: durma kaldırılır
        with _LOCK:
            R["reset"], R["dead"], R["halt"] = cfg.get("real_reset", 0), "", ""
            R["funded"], R["harvest"] = R["eq"], 0.0
            _note(R, "info", "Masa ayarlardan yeniden başlatıldı")
    _W["cfg"] = cfg
    if _W["t"] is None or not _W["t"].is_alive():
        _W["t"] = threading.Thread(target=_loop, daemon=True)
        _W["t"].start()
    was = state.get("levr", {}).get("on")
    if was and not cfg["real"] and R["pos"]:
        _Q.put(["kill"])
    for e in evs:
        if cfg["real"] or e[0] == "close":
            _Q.put(e)
    with _LOCK:
        R["on"] = bool(cfg["real"])
        state["levr"] = {k: (dict(v) if isinstance(v, dict) else list(v) if isinstance(v, list) else v) for k, v in R.items()}


def trim_log():
    with _LOCK:
        if _W["R"]:
            del _W["R"]["log"][:-5]


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
            "trades": done[-40:][::-1], "log": R["log"][-40:][::-1], "equity_series": R["equity"][-200:],
            "closed": len(done), "win_rate": round(len(wins) / len(done) * 100) if done else None}
