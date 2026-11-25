"""Kaldıraç masası (DENEME): OKX Global sürekli vadeli (perpetual) piyasasında gerçek fiyatlarla, sanal parayla işlem.

Gerçek para kullanılmaz; emir gönderilmez. Amaç: yöntemin gerçekten kazandırıp kazandırmadığını birkaç gün görmek.
Yöntem (62 günlük 1 saatlik veride denendi): 20 saatlik kanal kırılımı, 200 saatlik ortalamanın yönünde
(pencereler ayarlardan: brk_h, trend_h, trend_on).
  Gözcü   1 sa mumlar: fiyat son 20 saatin zirvesini kırarsa ve 200 sa ortalamanın üstündeyse UZUN;
          dibini kırarsa ve altındaysa KISA
  Bekçi   aynı anda en fazla 3 pozisyon, izole marjin, en fazla 3x; günlük zarar sınırında masayı o gün kapatır
  Ölçücü  her işlemde kasanın %1'i riske edilir (zarar durdurmaya kadar); teminat kasanın en fazla 1/3'ü
  Çıkışçı zarar durdur 2 ATR, kâr al 4 ATR, kâra geçince iz süren stop; 20/50 ortalamalar ters dönerse çık
Veri çekme arka planda yapılır; ana turu bekletmez. Herkese açık OKX verisi kullanılır, anahtar gerekmez.
"""
import json
import threading
import time
import urllib.request

from . import config

BASE = "https://www.okx.com"
DEFAULT = {
    "on": True,
    "bank": 100.0,        # sanal başlangıç kasası (USDT)
    "lev": 3,             # kaldıraç (izole)
    "risk_pct": 1.0,      # işlem başına riske edilen kasa yüzdesi
    "max_pos": 3,
    "sl_atr": 2.0,
    "tp_atr": 4.0,
    "daily_loss_pct": 5,  # gün içi zarar bu yüzdeye ulaşırsa pozisyonlar kapanır, o gün yeni işlem yok
    "fee_pct": 0.05,      # OKX taker ücreti (her yön)
    "slip_pct": 0.05,
    "coins": ["BTC", "ETH", "SOL", "XRP", "DOGE", "HYPE", "ZEC", "PEPE"],
    "brk_h": 20,          # kırılım kanalı (saat): fiyat son brk_h saatin zirvesini/dibini kırınca sinyal. Küçüldükçe daha sık işlem
    "trend_h": 200,       # eğilim süzgeci: bu kadar saatlik ortalamanın yönünde işlem (en fazla 280)
    "trend_on": True,     # False: eğilim süzgeci kapalı, yönü yalnız kırılım belirler (daha sık ve daha riskli)
}
EVERY = 5        # fiyat kontrolü (sn)
CANDLE_EVERY = 300  # mum yenileme (sn); karar kapanmış saatlik mumla verilir

_SNAP = {"ts": 0, "px": {}, "c": {}, "err": ""}
_LOCK = threading.Lock()
_TH = {"t": None, "last": 0.0, "clast": 0.0}


def _get(path):
    req = urllib.request.Request(BASE + path, headers={"User-Agent": "masal/1.0"})
    with urllib.request.urlopen(req, timeout=10) as r:
        d = json.loads(r.read())
    if d.get("code") != "0":
        raise RuntimeError(d.get("msg"))
    return d["data"]


def _fetch(coins, candles):
    try:
        px = {}
        for t in _get("/api/v5/market/tickers?instType=SWAP"):
            c = t["instId"].split("-")[0]
            if t["instId"].endswith("-USDT-SWAP") and c in coins:
                px[c] = float(t["last"])
        with _LOCK:
            _SNAP["px"] = px  # fiyatlar mumları beklemeden yayınlanır
        out, errs = {}, []
        if candles:
            from concurrent.futures import ThreadPoolExecutor

            def one(c):
                try:
                    rows = _get(f"/api/v5/market/candles?instId={c}-USDT-SWAP&bar=1H&limit=300")
                    rows = [r for r in rows if r[8] == "1"]  # yalnız kapanmış mumlar
                    out[c] = [(int(r[0]), float(r[2]), float(r[3]), float(r[4])) for r in reversed(rows)]
                except Exception as e:
                    errs.append(f"{c}: {e}")
            with ThreadPoolExecutor(6) as pool:
                list(pool.map(one, coins))
        with _LOCK:
            _SNAP["err"] = errs[0] if errs else ""
            if out:
                _SNAP["c"] = {**_SNAP.get("c", {}), **out}  # isteği başarısız olan coin eski mumlarıyla kalır
            _SNAP["ts"] = int(time.time() * 1000)
    except Exception as e:
        _SNAP["err"] = str(e)


def _ema(a, n):
    k, o = 2 / (n + 1), [a[0]]
    for x in a[1:]:
        o.append(o[-1] + k * (x - o[-1]))
    return o


def _windows(cfg):
    """Ayarlardaki pencereler güvenli aralığa çekilir: kırılım 2-200 sa, eğilim 20-280 sa (300 mumluk veri yeter)."""
    def num(k, lo, hi):
        try:
            return int(max(lo, min(hi, float(cfg.get(k) or DEFAULT[k]))))
        except (TypeError, ValueError):
            return DEFAULT[k]
    return num("brk_h", 2, 200), num("trend_h", 20, 280), bool(cfg.get("trend_on", True))


def _ind(rows, brk=20, trend=200):
    h, l, c = [r[1] for r in rows], [r[2] for r in rows], [r[3] for r in rows]
    tr = [h[0] - l[0]] + [max(h[i] - l[i], abs(h[i] - c[i - 1]), abs(l[i] - c[i - 1])) for i in range(1, len(c))]
    return {"t": rows[-1][0], "c": c[-1], "atr": _ema(tr, 14)[-1], "e20": _ema(c, 20)[-1], "e50": _ema(c, 50)[-1],
            "e200": _ema(c, trend)[-1], "hh": max(h[-brk - 1:-1]), "ll": min(l[-brk - 1:-1])}  # e200: eğilim ortalaması (trend_h)


def new_state(cfg):
    return {"bank": cfg["bank"], "start": cfg["bank"], "positions": {}, "trades": [], "log": [], "equity": [],
            "seen": {}, "day": "", "day_eq": cfg["bank"], "halt": "", "snap": 0,
            "stats": {"checked": 0, "signals": 0, "entered": 0, "blocked": 0}}


def _note(L, ts, kind, text):
    L["log"].append([ts, kind, text])
    L["log"] = L["log"][-80:]


def _upnl(p, px):
    return p["side"] * (px - p["entry"]) * p["qty"]


def _close(L, c, px, ts, reason, cfg):
    p = L["positions"].pop(c)
    L.setdefault("ev", []).append(["close", c, reason])  # gerçek masa aynı kararı uygular
    exit_px = px * (1 - p["side"] * cfg["slip_pct"] / 100)
    pnl = p["side"] * (exit_px - p["entry"]) * p["qty"] - exit_px * p["qty"] * cfg["fee_pct"] / 100
    L["bank"] += pnl
    pct = pnl / p["margin"] * 100
    L["trades"].append({"ts": ts, "sym": c, "side": "UZUN" if p["side"] > 0 else "KISA", "pnl": round(pnl, 2),
                        "pct": round(pct, 1), "reason": reason, "open": p["ts"]})
    _note(L, ts, "exit", f"KAPAT {c} {'UZUN' if p['side'] > 0 else 'KISA'} · {'+' if pnl >= 0 else ''}{pnl:.2f}$ "
                         f"(teminata göre %{pct:+.0f}) · {reason}")


def step(state, S):
    cfg = {**DEFAULT, **(S.get("lev") or {})}
    if not cfg.get("on"):
        return
    L = state.get("lev")
    if not L:
        L = state["lev"] = new_state(cfg)
    lev = max(1, min(3, float(cfg["lev"])))  # en fazla 3x (güvenlik sınırı, ayarla aşılamaz)
    now = time.time()
    th = _TH["t"]
    if (th is None or not th.is_alive()) and now - _TH["last"] >= EVERY:
        hour0 = now - now % 3600 + 4  # saat başı mum kapanır: 4 sn sonra hemen çekilir (karar beklemeden verilir)
        need_c = now - _TH["clast"] >= CANDLE_EVERY or not _SNAP["c"] or (now >= hour0 and _TH["clast"] < hour0)
        _TH["last"] = now
        if need_c:
            _TH["clast"] = now
        # açık pozisyonu olan coin ayarlardan çıkarılsa da fiyatı okunur (zarar durdur / kâr al çalışmaya devam etsin)
        want = list(dict.fromkeys(list(cfg["coins"]) + list(L["positions"])))
        _TH["t"] = threading.Thread(target=_fetch, args=(want, need_c), daemon=True)
        _TH["t"].start()
    with _LOCK:
        snap = {"ts": _SNAP["ts"], "px": dict(_SNAP["px"]), "c": _SNAP["c"]}
    if not snap["ts"] or snap["ts"] == L.get("snap"):
        return
    L["snap"] = ts = snap["ts"]
    px = snap["px"]
    day = time.strftime("%Y-%m-%d", time.gmtime(ts / 1000 + 3 * 3600))
    eq = L["bank"] + sum(_upnl(p, px.get(c, p["now"])) for c, p in L["positions"].items())
    if day != L["day"]:
        L["day"], L["day_eq"], L["halt"] = day, eq, ""

    # Çıkışçı: zarar durdur / kâr al / iz süren stop (her fiyat kontrolünde)
    for c, p in list(L["positions"].items()):
        x = px.get(c)
        if not x:
            continue
        p["now"] = x
        s = p["side"]
        if s * (x - p["stop"]) <= 0:
            _close(L, c, x, ts, "iz süren stop" if p.get("trailed") else "zarar durdur", cfg)
        elif s * (x - p["tp"]) >= 0:
            _close(L, c, x, ts, "kâr al", cfg)
        elif s * (x - p["entry"]) > 1.5 * p["atr"]:  # kâra geçti: stopu fiyatın 2 ATR arkasına çek
            ns = x - s * cfg["sl_atr"] * p["atr"]
            if s * (ns - p["stop"]) > 0:
                p["stop"], p["trailed"] = ns, True
                L.setdefault("ev", []).append(["trail", c, ns])  # gerçek masa borsadaki stopu da taşır

    # günlük zarar sınırı
    eq = L["bank"] + sum(_upnl(p, p["now"]) for p in L["positions"].values())
    if not L["halt"] and eq <= L["day_eq"] * (1 - cfg["daily_loss_pct"] / 100):
        for c in list(L["positions"]):
            _close(L, c, L["positions"][c]["now"], ts, "günlük zarar sınırı", cfg)
        L["halt"] = day
        _note(L, ts, "risk", f"Günlük zarar sınırı (%{cfg['daily_loss_pct']}) doldu; bugün yeni işlem yok")

    # Gözcü + Bekçi + Ölçücü: kapanan saatlik mumla karar
    brk, trend, trend_on = _windows(cfg)
    need = max(60, brk + 2, trend + 10 if trend_on else 0)  # göstergelerin oturması için gereken mum sayısı
    coins = {c for c in (cfg.get("coins") or []) if not config.banned("lev", c)}  # kara listedekiler yeni sinyal üretmez
    for c, rows in (snap["c"] or {}).items():
        if len(rows) < need:
            continue
        if c not in coins and c not in L["positions"]:
            # ayarlardan çıkarılan coin (mumları oturum sonuna kadar bellekte kalır): yeni sinyal üretmez, izleme listesinden düşer
            (L.get("watch") or {}).pop(c, None)
            continue
        k = _ind(rows, brk, trend)
        L.setdefault("watch", {})[c] = {"hh": k["hh"], "ll": k["ll"], "e200": k["e200"], "up": k["e20"] > k["e50"],
                                        "trend": trend_on, "atr": k["atr"]}
        if L["seen"].get(c) == k["t"]:
            continue  # bu mum için karar verildi
        L["seen"][c] = k["t"]
        L["stats"]["checked"] += 1
        p = L["positions"].get(c)
        if p and ((p["side"] > 0 and k["e20"] < k["e50"]) or (p["side"] < 0 and k["e20"] > k["e50"])):
            # Tek mumluk dönüş çoğu zaman sahte çıkıyordu (giriş sonrası 1 saatte küçük zararla kapanma):
            # eğilim art arda 2 saatlik mum ters kalırsa kapatılır; arada zarar durdur zaten borsada korur.
            p["against"] = p.get("against", 0) + 1
            if p["against"] >= 2:
                _close(L, c, px.get(c, k["c"]), ts, "eğilim döndü (20/50 ort., 2 saat)", cfg)
            continue
        if p:
            p["against"] = 0
            continue
        if trend_on:
            side = 1 if k["c"] > k["hh"] and k["c"] > k["e200"] else -1 if k["c"] < k["ll"] and k["c"] < k["e200"] else 0
        else:  # eğilim süzgeci kapalı: yönü yalnız kırılım belirler
            side = 1 if k["c"] > k["hh"] else -1 if k["c"] < k["ll"] else 0
        if not side:
            continue
        # Kısa vadeli eğilim (20/50 ort.) kırılımın tersindeyse girilmez: aksi hâlde pozisyon bir sonraki mumda
        # "eğilim döndü" diye küçük zararla kapanıyordu (deneme masasındaki kayıpların çoğu buydu).
        if (side > 0) != (k["e20"] > k["e50"]):
            continue
        L["stats"]["signals"] += 1
        why = (f"{brk} sa zirvesi kırıldı ({k['hh']:.6g})" if side > 0 else f"{brk} sa dibi kırıldı ({k['ll']:.6g})")
        if trend_on:
            why += f", {trend} sa ort. {'üstünde' if side > 0 else 'altında'}"
        name = "UZUN" if side > 0 else "KISA"
        bad = None
        if L["halt"]:
            bad = "günlük zarar sınırı dolu"
        elif len(L["positions"]) >= cfg["max_pos"]:
            bad = f"en fazla {cfg['max_pos']} pozisyon"
        elif not px.get(c):
            bad = "fiyat yok"
        elif side < 0 and not config.CROSS_OK and f"{c}-USDT" in ((state.get("gspotr") or {}).get("positions") or {}):
            bad = "Global spot'ta elde (yükselişe oynuyor); ters pozisyon açılmaz"
        if bad:
            L["stats"]["blocked"] += 1
            _note(L, ts, "risk", f"ENGEL {c} {name}: {bad}")
            continue
        _enter(L, c, side, k, px[c], cfg, lev, ts, why)

    # Ayarlardan çıkarılmış coin izleme listesinde kalmasın (yeniden başlamadan sonra mumu bellekte olmadığı için
    # yukarıdaki döngü ona hiç uğramaz ve kayıt sonsuza kadar taşınırdı)
    for c in [c for c in (L.get("watch") or {}) if c not in coins and c not in L["positions"]]:
        del L["watch"][c]
    L["trades"] = L["trades"][-300:]
    eq = L["bank"] + sum(_upnl(p, p["now"]) for p in L["positions"].values())
    if not L["equity"] or ts - L["equity"][-1][0] >= 15 * 60000:
        L["equity"].append([ts, round(eq, 2)])
        L["equity"] = L["equity"][-700:]


def _enter(L, c, side, k, x, cfg, lev, ts, why):
    """Pozisyon açar (sinyalle ya da elle): risk, stop ve kâr al aynı kurallarla hesaplanır; olay gerçek masaya gider."""
    name = "UZUN" if side > 0 else "KISA"
    entry = x * (1 + side * cfg["slip_pct"] / 100)
    dist = cfg["sl_atr"] * k["atr"]
    used = sum(q["margin"] for q in L["positions"].values())
    free = L["bank"] - used
    qty = min(L["bank"] * cfg["risk_pct"] / 100 / dist, min(L["bank"] / 3, free) * lev / entry)
    if qty <= 0 or qty * entry / lev < 1:
        _note(L, ts, "risk", f"ENGEL {c} {name}: boş teminat yetersiz")
        return False
    margin = qty * entry / lev
    L["bank"] -= entry * qty * cfg["fee_pct"] / 100
    L["positions"][c] = {"side": side, "ts": ts, "entry": entry, "now": x, "qty": qty, "margin": margin,
                         "atr": k["atr"], "stop": entry - side * dist, "tp": entry + side * cfg["tp_atr"] * k["atr"],
                         "liq": entry * (1 - side * (1 / lev - 0.005)), "why": why}
    L["stats"]["entered"] += 1
    L.setdefault("ev", []).append(["open", c, side, x, dist, cfg["tp_atr"] * k["atr"], why])
    _note(L, ts, "buy", f"AÇ {c} {name} {lev:g}x · teminat ${margin:.2f} · {why}")
    return True


def manual_open(state, S, sym, side):
    """Uygulamadan elle açma: botun kurallarıyla (ATR'ye göre zarar durdur, kâr al, iz süren stop, eğilim dönünce kapat)
    açılır ve sonrasını bot yönetir. Günlük zarar sınırı ve pozisyon sayısı sınırı elle açmada da geçerlidir."""
    cfg = {**DEFAULT, **(S.get("lev") or {})}
    L = state.get("lev")
    side = 1 if int(side or 0) > 0 else -1
    name = "UZUN" if side > 0 else "KISA"
    ts = int(time.time() * 1000)
    if not cfg.get("on") or not L:
        return
    with _LOCK:
        rows = list((_SNAP["c"] or {}).get(sym) or [])
        x = _SNAP["px"].get(sym)
    brk, trend, trend_on = _windows(cfg)
    bad = ("zaten açık" if sym in L["positions"] else "kara listede" if config.banned("lev", sym) else "izlenen coinler arasında değil" if sym not in (cfg.get("coins") or [])
           else "günlük zarar sınırı dolu" if L["halt"]
           else f"en fazla {cfg['max_pos']} pozisyon" if len(L["positions"]) >= cfg["max_pos"]
           else "fiyat yok" if not x else "mumlar henüz yüklenmedi" if len(rows) < max(60, brk + 2) else None)
    if bad:
        _note(L, ts, "risk", f"ENGEL {sym} {name} (elle): {bad}")
        return
    lev = max(1, min(3, float(cfg["lev"])))
    _enter(L, sym, side, _ind(rows, brk, trend), x, cfg, lev, ts, "elle açıldı")


def watch_list(L, px):
    """Uygulama için: izlenen coinler, fiyat ve sinyale uzaklık (brk_h sa zirve/dip kırılımı, trend_h sa ortalama yönü)."""
    out = []
    for c, w in (L.get("watch") or {}).items():
        x = px.get(c) or 0
        if not x:
            continue
        if w.get("trend", True):
            side = "UZUN" if x > w["e200"] else "KISA"
        else:  # eğilim süzgeci kapalı: hangi kırılım daha yakınsa o
            side = "UZUN" if abs(w["hh"] - x) <= abs(x - w["ll"]) else "KISA"
        lvl = w["hh"] if side == "UZUN" else w["ll"]
        out.append({"sym": c, "px": x, "side": side, "lvl": lvl, "dist": round((lvl / x - 1) * 100, 2), "open": c in L["positions"], "up": bool(w.get("up")), "atr": w.get("atr")})
    return sorted(out, key=lambda r: abs(r["dist"]))


def manual_close(state, sym, reason="elle kapatıldı", S=None):
    """Uygulamadan 'Kapat': deneme masasında kapatılır, olay gerçek masaya da gider."""
    L = state.get("lev") or {}
    p = (L.get("positions") or {}).get(sym)
    if p:
        _close(L, sym, p["now"], int(time.time() * 1000), reason, {**DEFAULT, **((S or {}).get("lev") or {})})
    else:
        L.setdefault("ev", []).append(["close", sym, reason])


def public(state):
    L = state.get("lev")
    if not L:
        return None
    eq = L["bank"] + sum(_upnl(p, p["now"]) for p in L["positions"].values())
    done = L["trades"]
    wins = [t for t in done if t["pnl"] > 0]
    return {"equity": round(eq, 2), "start": L["start"], "stats": L["stats"], "halt": L["halt"],
            "positions": [{"sym": c, "side": "UZUN" if p["side"] > 0 else "KISA", "ts": p["ts"], "entry": p["entry"],
                           "now": p["now"], "stop": p["stop"], "tp": p["tp"], "liq": p["liq"], "margin": round(p["margin"], 2),
                           "pnl": round(_upnl(p, p["now"]), 2), "why": p["why"]} for c, p in L["positions"].items()],
            "trades": done[-40:][::-1], "log": L["log"][-40:][::-1], "equity_series": L["equity"][-200:], "fav": config.top_earners(done),
            "watch": watch_list(L, {c: p for c, p in _SNAP.get("px", {}).items()}),
            "closed": len(done), "win_rate": round(len(wins) / len(done) * 100) if done else None,
            "updated": L.get("snap"), "err": _SNAP.get("err") or ""}
