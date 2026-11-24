"""Global spot masası: OKX Global'de USDT paritelerinde kademeli (grid) alım-satım.

İki masa birlikte çalışır:
  gspot   DENEME: gerçek fiyatlarla sanal parayla işlem (her zaman çalışır, sonuçlar herkese açık özette)
  gspotr  GERÇEK: aynı kararlar OKX Global işlem hesabında gerçek emirle (ayarlardan "gerçek" açılınca)

Kurallar OKX TR spot botunun kademeli stratejisiyle aynıdır, ayarları ayrıdır (tutarlar $):
  1. kademe  fiyat son N saatin ortalamasının %step altına inince
  sonraki   son kademenin %step (3. kademeden sonra %step3) altına inince; tutarı 1. kademenin lot2/lot3 yüzdesi
  satış     her kademe kendi alışının %lot_tp üstünde satılır; ortalamanın %stop altında hepsi satılır
  süzgeç    48 saatlik ortalama hızla düşüyorsa yeni coin alınmaz; son mumun hacmi 24 saatlik ortalamanın
            k katını aşıyorsa (panik satışı) alım ertelenir
Çıkışlar bot tarafından izlenir (2-3 sn'de bir, alış/satış tahtası fiyatıyla); borsaya ayrıca emir konmaz.
Gerçek emirler arka plandaki tek bir iş parçacığında verilir (tur beklemez); her emir kendi kimliğiyle (clOrdId)
verilir, yanıt kaybolursa bu kimlikle borsada aranır, iki kez verilmez. Yalnız nakit (tdMode=cash) işlem yapılır.
Gerçek masa kapatılınca yeni alım yapmaz, eldeki kademeleri kurallarıyla satmaya devam eder.
"""
import json
import math
import os
import queue
import threading
import time
import urllib.request

from . import config

BASE = "https://www.okx.com"
DEFAULT = {
    "on": True,
    "real": False,
    "bank": 100.0,          # deneme masasının sanal kasası ($)
    "budget": 50.0,         # gerçek masanın kullanacağı en fazla para ($, Global işlem hesabındaki USDT'den)
    "max_loss": 15.0,       # gerçek masada toplam zarar buna ulaşınca yeni alım durur ($)
    "lot_pct": 10.0,        # 1. kademe: kasanın yüzdesi
    "lot2_pct": 45.0,       # 2. kademe: 1. kademenin yüzdesi
    "lot3_pct": 77.0,       # 3. ve sonraki kademeler: 1. kademenin yüzdesi
    "step_pct": 3.3,
    "step3_pct": 6.6,
    "lot_tp_pct": 3.5,
    "stop_pct": 50.0,
    "max_lots": 5,
    "max_coins": 5,
    "use_pct": 85.0,        # coinlere yatırılan toplam para kasanın bu yüzdesini aşmaz
    "sma_hours": 72,
    "trend_filter_pct": 5.0,
    "vol_filter": 4.0,
    "coins": 30,            # en yüksek hacimli kaç coin izlenir
}
FEE = 0.001                 # OKX Global spot alıcı (taker) ücreti
SLIP = 0.0005
MIN_ORDER = 5.0             # $: bundan küçük kademe alınmaz
BPH = 4                     # saatte 4 mum (15 dk)
WARM = 60 * BPH             # 60 saatlik veri birikmeden alım yapılmaz
EVERY = 1.5                 # fiyat okuma aralığı (sn)
# SOL: memecoin aktarımı Global'de SOL alıp satar; Global spot SOL tutmaz (aynı coine iki iş dokunmasın)
STABLE = {"SOL", "USDT", "USDC", "DAI", "FDUSD", "TUSD", "PYUSD", "USDG", "RLUSD", "USDE", "EURT", "EUR", "XAUT", "PAXG",
          "BUSD", "USDP", "USD1", "USDQ", "SUSDE", "WBTC", "STETH", "WETH", "WSTETH", "CBBTC"}

_LOCK = threading.Lock()
_SNAP = {"ts": 0, "bid": {}, "ask": {}, "last": {}, "vol": {}, "c": {}, "v": {}, "uni": [], "err": "", "bar": 0}
_TH = {"t": None, "last": 0.0, "uni_t": 0.0}
_INST = {}                  # instId -> (lotSz, minSz)


# ---------- piyasa verisi (herkese açık, anahtar gerekmez) ----------
def _get(path, timeout=10):
    req = urllib.request.Request(BASE + path, headers={"User-Agent": "masal/1.0"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        d = json.loads(r.read())
    if d.get("code") != "0":
        raise RuntimeError(d.get("msg"))
    return d["data"]


def _bar_ts(now=None):
    now = now or time.time()
    return int(now // 900 * 900 * 1000)


def _fetch(held, n_coins):
    """Tek istek: bütün spot fiyatları. Yeni 15 dk'lık mum kapanınca (ya da hiç yoksa) izlenen coinlerin mumları."""
    try:
        rows = _get("/api/v5/market/tickers?instType=SPOT")
        bid, ask, last, vol = {}, {}, {}, {}
        for t in rows:
            i = t["instId"]
            if not i.endswith("-USDT"):
                continue
            try:
                b, a, la = float(t.get("bidPx") or 0), float(t.get("askPx") or 0), float(t.get("last") or 0)
                v = float(t.get("volCcy24h") or 0)
            except ValueError:
                continue
            if la > 0:
                bid[i], ask[i], last[i], vol[i] = b or la, a or la, la, v
        now = time.time()
        uni = _SNAP["uni"]
        if not uni or now - _TH["uni_t"] > 3600:
            if not _INST:
                for x in _get("/api/v5/public/instruments?instType=SPOT"):
                    # yalnız kripto (instCategory 1; hisse senedi tokenleri hariç), normal işlem kuralı
                    if (x.get("quoteCcy") == "USDT" and x.get("state") == "live" and str(x.get("instCategory") or "1") == "1"
                            and x.get("ruleType", "normal") == "normal"):
                        _INST[x["instId"]] = (float(x.get("lotSz") or 0), float(x.get("minSz") or 0))
            cand = []
            for i, v in vol.items():
                base = i.split("-")[0]
                if base in STABLE or i not in _INST or base.endswith(("3L", "3S", "UP", "DOWN")):
                    continue
                if ask[i] <= 0 or bid[i] <= 0 or (ask[i] - bid[i]) / ask[i] > 0.003:
                    continue  # alış-satış farkı %0,3'ten büyükse alınmaz
                cand.append((v, i))
            uni = [i for _, i in sorted(cand, reverse=True)[:max(5, min(60, int(n_coins)))]]
            _TH["uni_t"] = now
        with _LOCK:
            _SNAP.update(bid=bid, ask=ask, last=last, vol=vol, uni=uni, ts=int(now * 1000))
        want = list(dict.fromkeys(list(uni) + list(held)))
        bar = _bar_ts(now - 3)  # mum kapandıktan 3 sn sonra
        need = [i for i in want if (_SNAP["c"].get(i) or [[0]])[-1][0] < bar - 900_000]
        if need:
            from concurrent.futures import ThreadPoolExecutor
            out, errs = {}, []

            def one(i):
                try:
                    have = _SNAP["c"].get(i)
                    lim = 300 if not have or len(have) < WARM else 10
                    r = _get(f"/api/v5/market/candles?instId={i}&bar=15m&limit={lim}")
                    r = [x for x in r if x[8] == "1"]  # yalnız kapanmış mumlar
                    out[i] = [(int(x[0]), float(x[4]), float(x[6])) for x in reversed(r)]  # (ts, kapanış, hacim coin)
                except Exception as e:
                    errs.append(f"{i}: {e}")
            with ThreadPoolExecutor(6) as pool:
                list(pool.map(one, need))
            with _LOCK:
                for i, rows in out.items():
                    old = [x for x in (_SNAP["c"].get(i) or []) if x[0] < (rows[0][0] if rows else 0)]
                    _SNAP["c"][i] = (old + rows)[-400:]
                for i in list(_SNAP["c"]):
                    if i not in want:
                        del _SNAP["c"][i]
                _SNAP["err"] = errs[0] if errs else ""
                _SNAP["bar"] = bar
    except Exception as e:
        _SNAP["err"] = str(e)[:200]


def _kick(held, n_coins):
    th = _TH["t"]
    now = time.time()
    if (th is None or not th.is_alive()) and now - _TH["last"] >= EVERY:
        _TH["last"] = now
        _TH["t"] = threading.Thread(target=_fetch, args=(held, n_coins), daemon=True)
        _TH["t"].start()


# ---------- kurallar ----------
def cfg_of(S):
    g = {**DEFAULT, **(S.get("gspot") or {})}

    def f(k, lo, hi):
        try:
            return max(lo, min(hi, float(g.get(k))))
        except (TypeError, ValueError):
            return DEFAULT[k]
    return {"on": bool(g.get("on", True)), "real": bool(g.get("real")), "bank": f("bank", 10, 1e6),
            "budget": f("budget", 0, 1e6), "max_loss": f("max_loss", 1, 1e6),
            "lot": f("lot_pct", 1, 100) / 100, "lot2": f("lot2_pct", 10, 100) / 100, "lot3": f("lot3_pct", 10, 100) / 100,
            "step": f("step_pct", .5, 30) / 100, "step3": max(f("step_pct", .5, 30), f("step3_pct", .5, 40)) / 100,
            "tp": f("lot_tp_pct", .3, 50) / 100, "stop": f("stop_pct", 1, 90) / 100,
            "max_lots": int(f("max_lots", 1, 10)), "max_coins": int(f("max_coins", 1, 20)), "use": f("use_pct", 5, 100) / 100,
            "sma_n": int(f("sma_hours", 4, 72)) * BPH, "cf": f("trend_filter_pct", 0, 50) / 100,
            "vol_k": f("vol_filter", 0, 50) or None, "coins": int(f("coins", 5, 60))}


def new_state(cash):
    return {"cash": round(cash, 2), "start": round(cash, 2), "positions": {}, "trades": [], "log": [], "equity": [],
            "seen": {}, "pending": {}, "stats": {"buys": 0, "sells": 0}, "halt": ""}


def _note(G, kind, text, ts=None):
    G["log"].append([ts or int(time.time() * 1000), kind, text])
    G["log"] = G["log"][-80:]


def _sma(xs, n):
    return sum(xs[-n:]) / n if len(xs) >= n else None


def lot_size(c, base, n):
    a = base * c["lot"]
    return a if n <= 0 else a * (c["lot2"] if n == 1 else c["lot3"])


def _entry_ok(c, rows, add):
    """Hacim patlaması (her alımda) ve düşen bıçak süzgeci (yalnız yeni coinde)."""
    if c["vol_k"] and len(rows) >= 25:
        v = [x[2] for x in rows]  # mum hacmi (USDT)
        prev = v[-97:-1]
        avg = sum(prev) / len(prev) if prev else 0
        if avg > 0 and v[-1] / avg > c["vol_k"]:
            return False
    if not add and c["cf"]:
        closes = [x[1] for x in rows]
        n, lag = 48 * BPH, 24 * BPH
        now, prev = _sma(closes, n), _sma(closes[:-lag], n)
        if now and prev and now < prev * (1 - c["cf"]):
            return False
    return True


def _target(c, rows, pos):
    """Bu coinde bir sonraki alımın fiyatı; alım yapılamazsa None."""
    if pos:
        n = len(pos["lots"])
        if n >= c["max_lots"]:
            return None
        return pos["lots"][-1]["entry"] * (1 - (c["step3"] if n >= 2 else c["step"]))
    m = _sma([x[1] for x in rows], c["sma_n"])
    return m * (1 - c["step"]) if m else None


def _used(G):
    return sum(l["cost"] for p in G["positions"].values() for l in p["lots"])


def _equity(G, px):
    return G["cash"] + sum(sum(l["qty"] for l in p["lots"]) * px.get(i, p["lots"][-1]["entry"])
                           for i, p in G["positions"].items())


def decide(G, c, snap, base, can_buy, ts):
    """Bir masanın bu turdaki kararları: [("sell", inst, lots, sebep, fiyat), ("buy", inst, $, sebep, fiyat)].
    Satışlar alış tahtası (bid), alımlar satış tahtası (ask) fiyatıyla kontrol edilir."""
    acts = []
    bid, ask = snap["bid"], snap["ask"]
    cool = G.get("cool") or {}
    for k in [k for k, v in cool.items() if v <= ts]:
        del cool[k]
    for inst, pos in G["positions"].items():
        if inst in G["pending"] or inst in cool or not pos["lots"]:
            continue
        b = bid.get(inst)
        if not b:
            continue
        done = [l for l in pos["lots"] if b >= l["entry"] * (1 + c["tp"])]
        qty = sum(l["qty"] for l in pos["lots"])
        avg = sum(l["cost"] for l in pos["lots"]) / qty if qty else 0
        if avg and b <= avg * (1 - c["stop"]):
            acts.append(("sell", inst, list(pos["lots"]), "Zarar sınırı", b))
        elif done:
            acts.append(("sell", inst, done, "Kademe kârı", b))
    if not can_buy:
        return acts
    room = c["use"] * base - _used(G)
    cash = G["cash"] - sum(a[2] for a in acts if a[0] == "buy")
    n_coins = len(G["positions"])
    cands = []
    for inst in list(dict.fromkeys(list(snap["uni"]) + list(G["positions"]))):
        if inst in G["pending"] or inst in cool or config.banned("gspot", inst):
            continue
        rows = snap["c"].get(inst) or []
        a = ask.get(inst)
        if len(rows) < WARM or not a:
            continue
        pos = G["positions"].get(inst)
        if not pos and inst not in snap["uni"]:
            continue
        t = _target(c, rows, pos)
        if not t or a > t:
            continue
        cands.append((a / t, inst, pos, rows, a))
    for _, inst, pos, rows, a in sorted(cands):
        if any(x[1] == inst for x in acts):
            continue
        n = len(pos["lots"]) if pos else 0
        amt = lot_size(c, base, n)
        if not pos and n_coins >= c["max_coins"]:
            continue
        if amt < MIN_ORDER or amt > room + 0.01 or amt > cash:
            continue
        if not _entry_ok(c, rows, bool(pos)):
            continue
        acts.append(("buy", inst, round(amt, 2), f"{n + 1}. kademe", a))
        room -= amt
        cash -= amt
        n_coins += 0 if pos else 1
    return acts


def _book_buy(G, inst, qty, cost, px, reason, ts):
    pos = G["positions"].setdefault(inst, {"lots": [], "ts": ts})
    pos["lots"].append({"qty": qty, "entry": cost / qty, "cost": cost, "ts": ts})
    G["cash"] = round(G["cash"] - cost, 6)
    G["stats"]["buys"] += 1
    G["trades"].append({"ts": ts, "inst": inst, "sym": inst.split("-")[0], "side": "AL", "price": px, "qty": qty,
                        "usd": round(cost, 2), "reason": reason})
    _note(G, "buy", f"AL {inst.split('-')[0]} ${cost:.2f} · fiyat {px:.6g} · {reason}", ts)


def _book_sell(G, inst, lots, got, px, reason, ts):
    pos = G["positions"].get(inst)
    if not pos:
        return
    cost = sum(l["cost"] for l in lots)
    pnl = got - cost
    G["cash"] = round(G["cash"] + got, 6)
    G["stats"]["sells"] += 1
    gone = {id(l) for l in lots}
    pos["lots"] = [l for l in pos["lots"] if id(l) not in gone]
    if not pos["lots"]:
        del G["positions"][inst]
    G["trades"].append({"ts": ts, "inst": inst, "sym": inst.split("-")[0], "side": "SAT", "price": px,
                        "usd": round(got, 2), "pnl": round(pnl, 2), "pct": round(pnl / cost * 100, 1) if cost else 0,
                        "reason": reason})
    G["trades"] = G["trades"][-300:]
    _note(G, "exit", f"SAT {inst.split('-')[0]} ${got:.2f} · {'+' if pnl >= 0 else ''}{pnl:.2f}$ · {reason}", ts)


def _paper(G, acts, ts):
    for a in acts:
        if a[0] == "buy":
            _, inst, amt, why, px = a
            eff = px * (1 + SLIP)
            _book_buy(G, inst, amt * (1 - FEE) / eff, amt, eff, why, ts)
        else:
            _, inst, lots, why, px = a
            eff = px * (1 - SLIP)
            _book_sell(G, inst, lots, sum(l["qty"] for l in lots) * eff * (1 - FEE), eff, why, ts)


# ---------- gerçek emirler (arka plan) ----------
_Q = queue.Queue()
_RES = []
_W = {"t": None}


def _ex():
    from .transfer import Ex
    return Ex(BASE, "OKXG")


def _floor(q, step):
    if step <= 0:
        return q
    return math.floor(q / step + 1e-9) * step


def _fmt(q, step):
    d = max(0, -int(math.floor(math.log10(step)))) if step > 0 else 8
    return f"{q:.{d}f}"


def _fill(ex, inst, oid=None, cl=None):
    """Emrin sonucu: (durum, dolan miktar, ortalama fiyat, ücret, ücret birimi). Emir yoksa None."""
    for _ in range(8):
        if oid:
            d = ex.req("GET", f"/api/v5/trade/order?instId={inst}&ordId={oid}")[0]
        else:
            d = ex.find_order(inst, cl)
            if d is None:
                return None
        st = d.get("state")
        if st in ("filled", "canceled", "mmp_canceled"):
            return st, float(d.get("accFillSz") or 0), float(d.get("avgPx") or 0), float(d.get("fee") or 0), d.get("feeCcy")
        time.sleep(0.4)
    return "live", 0.0, 0.0, 0.0, ""


def _place(ex, inst, side, sz, cl, quote):
    """Piyasa emri ve sonucu. Borsa reddettiyse (RuntimeError) emir verilmemiştir. Ağ hatasında emir verilmiş
    olabilir: kendi kimliğiyle (clOrdId) aranır; bulunamazsa verilmemiş sayılır."""
    try:
        o = ex.market(inst, side, sz, quote=quote, cl=cl)
        return _fill(ex, inst, oid=o.get("ordId"))
    except RuntimeError:
        raise
    except Exception:
        time.sleep(1.5)
        f = _fill(ex, inst, cl=cl)
        if f is None:
            raise RuntimeError("emir yanıtı alınamadı; borsada da bulunamadı (verilmedi)")
        return f


def _check(ex, job):
    """Bot yeniden başladı / sonuç kayboldu: kimliğiyle emir aranır; dolmuşsa sonucu kayda geçer."""
    inst, base = job["inst"], job["inst"].split("-")[0]
    f = _fill(ex, inst, cl=job["cl"])
    if f is None or f[1] <= 0:
        return {"ok": False, "gone": True, "fail": "emir borsada yok (verilmemiş)"}
    st, sz, px, fee, fccy = f
    if job["act"] == "buy":
        return {"ok": True, "qty": sz + (fee if fccy == base else 0), "cost": sz * px, "px": px}
    want = sum(l["qty"] for l in job["lots"])
    return {"ok": True, "got": sz * px + (fee if fccy == "USDT" else 0), "px": px, "ratio": min(1.0, sz / want) if want else 1.0}


def _work():
    """Tek iş parçacığı: sıradaki gerçek emri verir, sonucu ana tura bırakır. Hata yükselmez, sonuca yazılır."""
    ex = _ex()
    while True:
        job = _Q.get()
        res = dict(job)
        try:
            inst, base = job["inst"], job["inst"].split("-")[0]
            lot_sz, min_sz = _INST.get(inst, (0, 0))
            if job.get("check"):
                res.update(_check(ex, job))
            elif job["act"] == "buy":
                # İşlem hesabındaki USDT futures masasıyla ortak: Global spot yalnız kendi parasını (phys: fon
                # hesabından kendisinin geçirdiği + satışlardan gelen − alımlara giden) kullanır, futures'ınkine dokunmaz
                own = job.get("phys", 0.0)
                if own < job["amt"] * 0.999:
                    try:  # eksik kısım fon hesabında varsa işlem hesabına geçirilir (Kasalar'dan Global'e gelen para)
                        need = round(job["amt"] - max(0.0, own) + 0.2, 2)
                        if ex.funding("USDT") >= need:
                            ex.move("USDT", need, "6", "18", "gs" + os.urandom(8).hex())
                            res["moved"] = need
                            own += need
                            time.sleep(1.0)
                    except Exception as e:
                        print("Global spot: fon hesabından aktarım olmadı:", e)
                usdt = min(own, ex.trading("USDT"))
                if usdt < job["amt"] * 0.999:
                    res.update(ok=False, fail=f"Global işlem hesabında yeterli USDT yok (${usdt:.2f})", nousd=True)
                else:
                    f = _place(ex, inst, "buy", f"{job['amt']:.2f}", job["cl"], True)
                    st, sz, px, fee, fccy = f
                    if sz <= 0:
                        res.update(ok=False, fail=f"emir dolmadı ({st})")
                    else:
                        net = sz + (fee if fccy == base else 0)  # ücret coinden kesilir (eksi)
                        res.update(ok=True, qty=net, cost=sz * px, px=px)
            else:
                have = 0.0
                for x in ex.req("GET", f"/api/v5/account/balance?ccy={base}")[0].get("details", []):
                    if x["ccy"] == base:
                        have = float(x.get("availBal") or 0)
                want = sum(l["qty"] for l in job["lots"])
                sz = _floor(min(want, have), lot_sz)
                if sz <= 0 or (min_sz and sz < min_sz):
                    res.update(ok=False, dust=True, fail=f"hesapta satılabilecek {base} yok ya da en küçük emrin altında")
                else:
                    f = _place(ex, inst, "sell", _fmt(sz, lot_sz), job["cl"], False)
                    st, done, px, fee, fccy = f
                    if done <= 0:
                        res.update(ok=False, fail=f"emir dolmadı ({st})")
                    else:
                        got = done * px + (fee if fccy == "USDT" else 0)
                        res.update(ok=True, got=got, px=px, ratio=min(1.0, done / want) if want else 1.0)
        except Exception as e:
            res.update(ok=False, fail=str(e)[:160], err=True)
        with _LOCK:
            _RES.append(res)


def _start_worker():
    if _W["t"] is None or not _W["t"].is_alive():
        _W["t"] = threading.Thread(target=_work, daemon=True)
        _W["t"].start()


def _apply_results(R):
    with _LOCK:
        res, _RES[:] = list(_RES), []
    for r in res:
        inst, ts = r["inst"], int(time.time() * 1000)
        if ((R["pending"].get(inst) or {}).get("job") or {}).get("cl") != r.get("cl"):
            continue  # bu emrin sonucu zaten işlendi (ör. kimlikle sorgu ve asıl yanıt ikisi de geldi)
        R["pending"].pop(inst, None)
        sym = inst.split("-")[0]
        if not r.get("ok") and not r.get("gone"):
            # başarısız emir her turda (2-3 sn) yeniden denenmesin: 1 dk (USDT yoksa 5 dk) bekler
            R.setdefault("cool", {})[inst] = ts + (300_000 if r.get("nousd") else 60_000)
        if r["act"] == "buy":
            if r.get("moved"):
                R["phys"] = R.get("phys", 0.0) + r["moved"]
                _note(R, "info", f"Fon hesabından işlem hesabına ${r['moved']:.2f} USDT geçti", ts)
            if r.get("ok"):
                R["phys"] = R.get("phys", 0.0) - r["cost"]
                _book_buy(R, inst, r["qty"], r["cost"], r["px"], r["why"], ts)
            elif r.get("gone"):
                pass
            elif r.get("nousd"):
                if ts - R.get("nousd_ts", 0) > 3600_000:
                    R["nousd_ts"] = ts
                    _note(R, "risk", f"ENGEL {sym}: {r['fail']}", ts)
            else:
                _note(R, "risk", f"HATA alım {sym}: {r['fail']}", ts)
        else:
            pos = R["positions"].get(inst)
            lots = [l for l in (pos or {}).get("lots", []) if l["ts"] in r["lot_ts"]]
            if r.get("ok") and pos:
                if r["ratio"] < 0.999:  # kısmi doldu: her kademenin satılan kısmı kapanır, kalanı kayıtta durur
                    k, parts = r["ratio"], []
                    for l in lots:
                        part = {"qty": l["qty"] * k, "entry": l["entry"], "cost": l["cost"] * k, "ts": l["ts"], "part": 1}
                        l["qty"] *= 1 - k
                        l["cost"] *= 1 - k
                        pos["lots"].append(part)
                        parts.append(part)
                    lots = parts
                R["phys"] = R.get("phys", 0.0) + r["got"]
                _book_sell(R, inst, lots, r["got"], r["px"], r["why"], ts)
            elif r.get("gone"):
                pass
            elif r.get("dust") and pos:
                for l in lots:
                    pos["lots"].remove(l)
                if not pos["lots"]:
                    del R["positions"][inst]
                _note(R, "risk", f"{sym}: {r['fail']}; kayıttan düşüldü", ts)
            elif pos and not r.get("ok"):
                _note(R, "risk", f"HATA satış {sym}: {r['fail']} (yeniden denenecek)", ts)


PHYS = {"v": 0.0}  # Global spot'un işlem hesabındaki USDT'si: futures masası kendi bakiyesinden bunu düşer
FUNDRES = {"v": 0.0}  # Global spot'un fon hesabında bekleyen (henüz kullanmadığı) parası: elle aktarımlar buna dokunmaz


def _send(R, acts):
    _start_worker()
    free = R.get("phys", 0.0) - sum(p["job"].get("amt", 0) for p in R["pending"].values() if p["act"] == "buy")
    ts = int(time.time() * 1000)
    for a in acts:
        inst = a[1]
        cl = "g" + os.urandom(11).hex()
        if a[0] == "buy":
            job = {"act": "buy", "inst": inst, "amt": a[2], "why": a[3], "cl": cl, "phys": round(max(0.0, free), 6)}
            free -= a[2]
        else:
            job = {"act": "sell", "inst": inst, "lots": [dict(l) for l in a[2]], "lot_ts": [l["ts"] for l in a[2]],
                   "why": a[3], "cl": cl}
        R["pending"][inst] = {"ts": ts, "act": a[0], "job": job}  # kayıtta durur: bot yeniden başlarsa emir kimlikle sorulur
        _Q.put(job)


# ---------- tur ----------
def _mark(G, snap, ts):
    px = snap["bid"]
    eq = _equity(G, px)
    if not G["equity"] or ts - G["equity"][-1][0] >= 15 * 60000:
        G["equity"].append([ts, round(eq, 2)])
        G["equity"] = G["equity"][-700:]
    G["eq"] = round(eq, 2)


def manual_sell(state, inst, desk="gspotr"):
    """Uygulamadan elle sat: o coinin bütün kademeleri satılır (gerçek masada emirle)."""
    G = state.get(desk)
    if not G or inst not in G["positions"] or inst in G["pending"]:
        return
    with _LOCK:
        b = _SNAP["bid"].get(inst)
    if not b:
        return
    acts = [("sell", inst, list(G["positions"][inst]["lots"]), "elle satıldı", b)]
    if desk == "gspotr":
        _send(G, acts)
    else:
        _paper(G, acts, int(time.time() * 1000))


def step(state, S, N=None):
    c = cfg_of(S)
    P = state.get("gspot")
    R = state.get("gspotr")
    PHYS["v"] = max(0.0, (R or {}).get("phys", 0.0))  # futures masası her eşitlemede bunu kendi bakiyesinden düşer
    # gerçek masa açıkken fon hesabında onun için ayrılan: boştaki nakdi − işlem hesabına geçirdiği
    FUNDRES["v"] = max(0.0, (R or {}).get("cash", 0.0) - PHYS["v"]) if (R and c["real"]) else 0.0
    if not c["on"] and not (R and R["positions"]):
        return
    if not P:
        P = state["gspot"] = new_state(c["bank"])
    held = set(P["positions"]) | set((R or {}).get("positions") or {})
    _kick(held, c["coins"])
    with _LOCK:
        snap = {"ts": _SNAP["ts"], "bid": dict(_SNAP["bid"]), "ask": dict(_SNAP["ask"]), "uni": list(_SNAP["uni"]),
                "c": dict(_SNAP["c"]), "err": _SNAP["err"]}
    if not snap["ts"]:
        return
    ts = int(time.time() * 1000)
    # Deneme masası: kararlar hemen uygulanır
    if c["on"]:
        _paper(P, decide(P, c, snap, P["start"], True, ts), ts)
        _mark(P, snap, ts)
        P["watch"] = watch(P, c, snap)
        P["err"] = snap["err"]
    # Gerçek masa
    if c["real"] and not R and _ex().ok:
        R = state["gspotr"] = new_state(c["budget"])
        R["funded"] = c["budget"]
        _note(R, "info", f"Gerçek Global spot masası açıldı · bütçe ${c['budget']:.2f}", ts)
    if R:
        _apply_results(R)
        for inst, p in list(R["pending"].items()):
            if ts - p["ts"] > 90_000 and _Q.empty() and not p.get("asked"):
                # sonucu gelmeyen istek (ör. bot yeniden başladı): emir kendi kimliğiyle borsada aranır
                p["asked"] = ts
                _start_worker()
                _Q.put({**p["job"], "check": True})
            elif p.get("asked") and ts - p["asked"] > 120_000:
                R["pending"].pop(inst, None)
        if c["real"] and abs(c["budget"] - R.get("funded", R["start"])) > 0.005:
            d = c["budget"] - R.get("funded", R["start"])  # bütçe değişti: fark nakde eklenir / nakitten düşülür
            R["cash"] = round(R["cash"] + d, 6)
            R["start"] = round(R["start"] + d, 2)
            R["funded"] = c["budget"]
            _note(R, "info", f"Bütçe ${c['budget']:.2f} oldu", ts)
        eq = _equity(R, snap["bid"])
        if not R["halt"] and eq <= R["start"] - c["max_loss"]:
            R["halt"] = f"toplam zarar ${c['max_loss']:.0f} sınırına ulaştı; yeni alım yok"
            _note(R, "risk", "DUR: " + R["halt"], ts)
            if N:
                N.add("alerts", "Global spot: yeni alım durdu", R["halt"].capitalize() + ". Eldeki coinler kurallarıyla satılır.", 4, ["warning"])
        elif R["halt"] and eq > R["start"] - c["max_loss"] * 0.8:
            R["halt"] = ""
        can = c["real"] and not R["halt"] and not S.get("paused")
        acts = decide(R, c, snap, R["start"], can, ts)
        if acts:
            _send(R, acts)
        _mark(R, snap, ts)
        R["watch"] = None
        PHYS["v"] = max(0.0, R.get("phys", 0.0))


def watch(G, c, snap):
    """Uygulama için: alım şartına en yakın coinler (fiyatın alım fiyatına uzaklığı, %)."""
    out = []
    for inst in snap["uni"]:
        if config.banned("gspot", inst):
            continue
        rows = snap["c"].get(inst) or []
        a = snap["ask"].get(inst)
        if len(rows) < WARM or not a:
            continue
        pos = G["positions"].get(inst)
        t = _target(c, rows, pos)
        if not t:
            continue
        out.append({"i": inst, "p": a, "t": t, "g": round((a / t - 1) * 100, 2), "h": len(pos["lots"]) if pos else 0,
                    "f": not _entry_ok(c, rows, bool(pos))})
    out.sort(key=lambda x: x["g"])
    return out[:12]


def public(G, snap_bid=None):
    if not G:
        return None
    with _LOCK:
        bid = dict(_SNAP["bid"])
        warm = sum(1 for r in _SNAP["c"].values() if len(r) >= WARM)
        n = len(_SNAP["uni"])
    pos = []
    for inst, p in G["positions"].items():
        qty = sum(l["qty"] for l in p["lots"])
        cost = sum(l["cost"] for l in p["lots"])
        b = bid.get(inst) or p["lots"][-1]["entry"]
        pos.append({"inst": inst, "sym": inst.split("-")[0], "lots": len(p["lots"]), "qty": qty, "cost": round(cost, 2),
                    "val": round(qty * b, 2), "pnl": round(qty * b - cost, 2), "avg": cost / qty if qty else 0, "px": b,
                    "pending": inst in G["pending"], "ts": p.get("ts")})
    sells = [t for t in G["trades"] if t["side"] == "SAT"]
    wins = [t for t in sells if t["pnl"] > 0]
    eq = G.get("eq", G["cash"])
    return {"cash": round(G["cash"], 2), "equity": eq, "start": G["start"], "pnl": round(eq - G["start"], 2),
            "funded": G.get("funded"), "halt": G["halt"], "err": G.get("err", ""),
            "positions": sorted(pos, key=lambda x: -x["val"]), "trades": G["trades"][-40:][::-1], "log": G["log"][-40:][::-1],
            "equity_series": G["equity"][-200:], "sells": len(sells), "realized": round(sum(t["pnl"] for t in sells), 2),
            "win_rate": round(len(wins) / len(sells) * 100) if sells else None, "watch": G.get("watch"),
            "fav": config.top_earners(G["trades"]), "warm": warm, "uni": n, "stats": G["stats"],
            "phys": round(max(0.0, G.get("phys", 0.0)), 2), "fund_res": round(max(0.0, G["cash"] - G.get("phys", 0.0)), 2), "nousd": bool(G.get("cool") and G.get("nousd_ts"))}
