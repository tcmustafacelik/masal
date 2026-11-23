"""Memecoin masası (DENEME): Solana'daki yeni tokenleri gerçek verilerle izler, sanal parayla al-sat yapar.

Gerçek para, cüzdan ya da anahtar YOKTUR. Amaç: bu yaklaşımın gerçekten kazandırıp kazandırmadığını
gerçek fiyatlarla, birkaç gün boyunca görmek. Her karar sebebiyle kaydedilir.

Ajanlar:
  Gözcü   (scan)  DexScreener'da yeni öne çıkan / yeni profil açan Solana tokenleri bulur
  Bekçi   (risk)  RugCheck raporu, likidite, yaş, piyasa değeri, alım-satım dengesi; tek kusurda geçirmez
  Ölçücü  (size)  sanal kasanın belli bir yüzdesiyle girer, aynı anda en fazla N token
  Çıkışçı (exit)  kâr al, iz süren stop, zarar kes, süre dolumu, likidite çekilmesi (halı)
Veri çekme arka planda yapılır; OKX turunu bekletmez.
"""
import json
import threading
import time
import urllib.request

DS = "https://api.dexscreener.com"
RC = "https://api.rugcheck.xyz/v1/tokens/{}/report/summary"

DEFAULT = {
    "on": True,          # deneme masası açık
    "bank": 100.0,       # sanal başlangıç kasası (USD)
    "size_pct": 10,      # her girişte kasanın yüzdesi
    "max_pos": 5,        # aynı anda en fazla token
    "min_liq": 20000,    # en az likidite (USD)
    "max_fdv": 5_000_000,
    "min_age_min": 10,   # en az bu kadar dakikalık havuz (ilk dakikaların tuzaklarından kaçın)
    "max_age_h": 72,
    "tp_pct": 30,        # kâr al
    "trail_from": 15,    # bu kârdan sonra iz süren stop devreye girer
    "trail_pct": 12,     # zirveden bu kadar geri çekilirse sat
    "sl_pct": 15,        # zarar kes
    "max_hold_h": 4,     # en uzun tutma süresi
    "slip_pct": 1.0,     # varsayılan kayma (her yön)
    "fee_pct": 0.5,      # DEX + işlem ücreti (her yön)
}
EVERY = 10  # saniye

_SNAP = {"ts": 0, "pairs": {}, "cands": [], "rug": {}, "err": ""}
_LOCK = threading.Lock()
_THREAD = {"t": None, "last": 0.0}
_RUG_CACHE = {}  # mint -> (ts, rapor)


def _get(url, timeout=8):
    req = urllib.request.Request(url, headers={"User-Agent": "masal/1.0", "Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read())


def _fetch(held):
    """Arka plan: aday tokenler + tutulanların güncel havuz verisi + yeni adayların RugCheck raporu."""
    try:
        mints = []
        for path in ("/token-boosts/latest/v1", "/token-profiles/latest/v1"):
            try:
                for x in _get(DS + path) or []:
                    if x.get("chainId") == "solana" and x.get("tokenAddress") not in mints:
                        mints.append(x["tokenAddress"])
            except Exception as e:
                _SNAP["err"] = f"{path}: {e}"
        want = list(dict.fromkeys(list(held) + mints))[:90]
        pairs = {}
        for i in range(0, len(want), 30):
            chunk = want[i:i + 30]
            try:
                for p in _get(f"{DS}/tokens/v1/solana/{','.join(chunk)}") or []:
                    m = (p.get("baseToken") or {}).get("address")
                    if not m or p.get("quoteToken", {}).get("symbol") not in ("SOL", "USDC", "USDT"):
                        continue
                    best = pairs.get(m)
                    if not best or (p.get("liquidity") or {}).get("usd", 0) > (best.get("liquidity") or {}).get("usd", 0):
                        pairs[m] = p  # token başına en likit havuz
            except Exception as e:
                _SNAP["err"] = f"tokens: {e}"
        now = time.time()
        rug = {}
        for m in mints:
            c = _RUG_CACHE.get(m)
            if c and now - c[0] < 3600:
                rug[m] = c[1]
                continue
            if len([1 for v in _RUG_CACHE.values() if now - v[0] < 60]) > 20:
                continue  # dakikada en fazla ~20 yeni rapor (RugCheck'e yüklenmeyelim)
            try:
                r = _get(RC.format(m))
                _RUG_CACHE[m] = (now, r)
                rug[m] = r
            except Exception:
                pass
        for k in [k for k, v in _RUG_CACHE.items() if now - v[0] > 7200]:
            del _RUG_CACHE[k]
        with _LOCK:
            _SNAP.update(ts=int(now * 1000), pairs=pairs, cands=mints, rug=rug)
    except Exception as e:
        _SNAP["err"] = str(e)


def new_state(cfg):
    return {"cash": cfg["bank"], "start": cfg["bank"], "positions": {}, "trades": [], "log": [],
            "seen": {}, "equity": [], "stats": {"scanned": 0, "blocked": 0, "entered": 0}, "snap": 0}


def _note(M, ts, kind, text):
    M["log"].append([ts, kind, text])
    M["log"] = M["log"][-80:]


def _risk(m, p, rug, cfg, now_ms):
    """Bekçi: geçmezse sebebini döndürür, geçerse None."""
    liq = (p.get("liquidity") or {}).get("usd") or 0
    fdv = p.get("fdv") or 0
    age_min = (now_ms - (p.get("pairCreatedAt") or now_ms)) / 60000
    tx = (p.get("txns") or {}).get("m5") or {}
    if liq < cfg["min_liq"]:
        return f"likidite düşük (${liq:,.0f})"
    if fdv > cfg["max_fdv"]:
        return f"piyasa değeri yüksek (${fdv / 1e6:.1f} M)"
    if age_min < cfg["min_age_min"]:
        return f"çok yeni ({age_min:.0f} dk)"
    if age_min > cfg["max_age_h"] * 60:
        return f"eski havuz ({age_min / 60:.0f} sa)"
    if not rug:
        return "RugCheck raporu yok"
    dangers = [r.get("name") for r in rug.get("risks") or [] if r.get("level") == "danger"]
    if dangers:
        return "RugCheck tehlike: " + ", ".join(dangers[:2])
    if (rug.get("score_normalised") or 0) > 30:
        return f"RugCheck risk puanı yüksek ({rug.get('score_normalised')})"
    if (rug.get("lpLockedPct") or 0) < 80:
        return f"likidite kilitli değil (%{rug.get('lpLockedPct') or 0:.0f})"
    if (tx.get("buys") or 0) < 5:
        return "son 5 dk'da alıcı az"
    return None


def _signal(p):
    """Gözcü: hacim patlaması + alıcı baskısı + kovalamaya değmeyecek kadar yükselmemiş fiyat."""
    v = p.get("volume") or {}
    ch = p.get("priceChange") or {}
    tx = (p.get("txns") or {}).get("m5") or {}
    b, s = tx.get("buys") or 0, tx.get("sells") or 0
    v5, v1h = v.get("m5") or 0, v.get("h1") or 0
    spike = v5 / (v1h / 12) if v1h > 0 else 0
    m5, h1 = ch.get("m5") or 0, ch.get("h1") or 0
    if spike >= 2 and b >= s * 1.2 and 0 < m5 <= 15 and h1 > 0:
        return f"hacim {spike:.1f}x · alıcı {b}/{s} · 5 dk %{m5:+.1f} · 1 sa %{h1:+.1f}"
    return None


def step(state, S):
    """Her OKX turunda çağrılır; ağ işi arka planda, burada sadece karar verilir."""
    cfg = {**DEFAULT, **(S.get("meme") or {})}
    if not cfg.get("on"):
        return
    M = state.get("meme")
    if not M:
        M = state["meme"] = new_state(cfg)
    now = time.time()
    th = _THREAD["t"]
    if (th is None or not th.is_alive()) and now - _THREAD["last"] >= EVERY:
        _THREAD["last"] = now
        _THREAD["t"] = threading.Thread(target=_fetch, args=(list(M["positions"]),), daemon=True)
        _THREAD["t"].start()
    with _LOCK:
        snap = dict(_SNAP)
    if not snap["ts"] or snap["ts"] == M.get("snap"):
        return
    M["snap"] = snap["ts"]
    ts = snap["ts"]
    pairs, rug = snap["pairs"], snap["rug"]
    slip, fee = cfg["slip_pct"] / 100, cfg["fee_pct"] / 100

    # Çıkışçı: tutulan tokenler
    for m, pos in list(M["positions"].items()):
        p = pairs.get(m)
        if not p:
            continue
        price = float(p.get("priceUsd") or 0)
        liq = (p.get("liquidity") or {}).get("usd") or 0
        if price <= 0:
            continue
        pos["now"] = price
        pos["peak"] = max(pos["peak"], price)
        gain = (price / pos["entry"] - 1) * 100
        reason = None
        if liq < pos["liq0"] * 0.6:
            reason = f"likidite çekildi (${pos['liq0']:,.0f} → ${liq:,.0f})"
        elif gain >= cfg["tp_pct"]:
            reason = f"kâr al %{gain:.0f}"
        elif gain <= -cfg["sl_pct"]:
            reason = f"zarar kes %{gain:.0f}"
        elif (pos["peak"] / pos["entry"] - 1) * 100 >= cfg["trail_from"] and price <= pos["peak"] * (1 - cfg["trail_pct"] / 100):
            reason = f"iz süren stop (zirveden %{(1 - price / pos['peak']) * 100:.0f} geri)"
        elif ts - pos["ts"] > cfg["max_hold_h"] * 3600_000:
            reason = f"süre doldu ({cfg['max_hold_h']} sa)"
        if reason:
            got = pos["qty"] * price * (1 - slip) * (1 - fee)
            pnl = got - pos["cost"]
            M["cash"] += got
            M["trades"].append({"ts": ts, "sym": pos["sym"], "mint": m, "side": "SAT", "usd": round(got, 2),
                                "pnl": round(pnl, 2), "pct": round(pnl / pos["cost"] * 100, 1), "reason": reason})
            _note(M, ts, "exit", f"SAT {pos['sym']} ${got:.2f} · {'+' if pnl >= 0 else ''}{pnl:.2f}$ · {reason}")
            del M["positions"][m]
            M.setdefault("ev", []).append(["sell", m, reason])  # gerçek masa aynı kararı uygular

    # Gözcü + Bekçi + Ölçücü: yeni girişler
    for m in snap["cands"]:
        if m in M["positions"] or len(M["positions"]) >= cfg["max_pos"]:
            continue
        if ts - M["seen"].get(m, 0) < 15 * 60000:
            continue  # aynı tokene 15 dk içinde tekrar bakılmaz (karar tekrarlanmasın)
        p = pairs.get(m)
        if not p:
            continue
        sym = (p.get("baseToken") or {}).get("symbol") or m[:4]
        M["stats"]["scanned"] += 1
        sig = _signal(p)
        if not sig:
            continue
        M["seen"][m] = ts
        bad = _risk(m, p, rug.get(m), cfg, ts)
        if bad:
            M["stats"]["blocked"] += 1
            _note(M, ts, "risk", f"ENGEL {sym}: {bad}")
            continue
        size = M["cash"] * cfg["size_pct"] / 100 if M["cash"] > 0 else 0
        size = min(size, M["cash"])
        if size < 1:
            continue
        price = float(p.get("priceUsd") or 0)
        if price <= 0:
            continue
        eff = price * (1 + slip)
        qty = size * (1 - fee) / eff
        M["cash"] -= size
        M["positions"][m] = {"sym": sym, "ts": ts, "entry": eff, "now": price, "peak": price, "qty": qty, "cost": size,
                             "liq0": (p.get("liquidity") or {}).get("usd") or 0, "why": sig, "url": p.get("url")}
        M["stats"]["entered"] += 1
        M["trades"].append({"ts": ts, "sym": sym, "mint": m, "side": "AL", "usd": round(size, 2), "reason": sig})
        _note(M, ts, "buy", f"AL {sym} ${size:.2f} · {sig}")
        M.setdefault("ev", []).append(["buy", m, sym, sig])

    # temizlik ve kasa seyri
    M["seen"] = {k: v for k, v in M["seen"].items() if ts - v < 6 * 3600_000}
    M["trades"] = M["trades"][-300:]
    eq = M["cash"] + sum(pp["qty"] * pp["now"] for pp in M["positions"].values())
    if not M["equity"] or ts - M["equity"][-1][0] >= 15 * 60000:
        M["equity"].append([ts, round(eq, 2)])
        M["equity"] = M["equity"][-700:]


def public(state):
    """Uygulamaya gidecek özet (deneme verisi; gerçek para yok, şifrelenmez)."""
    M = state.get("meme")
    if not M:
        return None
    eq = M["cash"] + sum(p["qty"] * p["now"] for p in M["positions"].values())
    sells = [t for t in M["trades"] if t["side"] == "SAT"]
    wins = [t for t in sells if t["pnl"] > 0]
    return {"cash": round(M["cash"], 2), "equity": round(eq, 2), "start": M["start"], "stats": M["stats"],
            "positions": [{"mint": m, **{k: p[k] for k in ("sym", "ts", "entry", "now", "peak", "cost", "why", "url")},
                           "value": round(p["qty"] * p["now"], 2)} for m, p in M["positions"].items()],
            "trades": M["trades"][-40:][::-1], "log": M["log"][-40:][::-1], "equity_series": M["equity"][-200:],
            "sells": len(sells), "win_rate": round(len(wins) / len(sells) * 100) if sells else None,
            "updated": M.get("snap"), "err": _SNAP.get("err") or ""}
