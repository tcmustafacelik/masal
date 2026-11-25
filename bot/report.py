"""Panel için özet dosyası: docs/data/summary.json"""
import json
import os

from . import config, vault
from .engine import Portfolio

OUT = os.path.join(os.path.dirname(__file__), "..", "docs", "data", "summary.json")


# Herkese açık özette gösterilmeyen ayarlar (para tutarları, cüzdan, kara liste, istekler): uygulama kilidi açınca
# şifreli kutudaki tam ayarları kullanır
BOT_VER = "1.100.0"
_PRIVATE = {"budget", "kasa", "real_total", "target", "xfer", "ban", "notify", "sell", "buy", "convert", "liquidate",
            "xfer_req", "xfer_cancel", "dust", "desk_cmd", "test_req", "clear", "clear_all", "topup"}
_PRIVATE_SUB = {"lev": ("real_budget", "max_loss", "real", "real_reset", "cross_ok"), "meme": ("wallet", "budget", "max_loss", "real"),
                "gspot": ("budget", "max_loss", "real")}


def public_settings(S):
    out = {k: v for k, v in (S or {}).items() if k not in _PRIVATE}
    for k, subs in _PRIVATE_SUB.items():
        if isinstance(out.get(k), dict):
            out[k] = {a: b for a, b in out[k].items() if a not in subs}
    out["ban"] = {}
    return out


def tr(v):
    return f"{v:,.0f}".replace(",", ".")


def describe(key, c):
    pct = lambda v: f"%{v * 100:g}".replace(".", ",")
    if key == "grid":
        return (f"Her {pct(c['step'])} düşüşte küçük bir kademe daha alır (en fazla {c['max_lots']}), "
                f"her kademeyi {pct(c['lot_tp'])} kârla ayrı satar."
                + (f" Coin bir günde {pct(c['coin_filter'])}'den fazla geriliyorsa yeni alımı bekletir." if c.get("coin_filter") else ""))
    if key == "dip":
        return (f"Fiyat 20 saatlik ortalamanın {pct(c['dip_pct'])} altına inip aşırı satımdayken alır; "
                f"{pct(c['take_profit'])} kârda ya da {c['max_hold_bars'] // config.BPH} saat dolunca satar.")
    return (f"Kısa ortalama uzun ortalamayı yukarı kesip fiyat ana trendin üstündeyken girer; "
            f"zirveden {pct(c['trailing'])} geri çekilince çıkar.")


def _xfer(state, S):
    try:
        from . import transfer
        return transfer.public(state, S)
    except Exception:
        return None


def _lev(state):
    try:
        from . import kaldirac
        return kaldirac.public(state)
    except Exception:
        return None


def _gs(state, k):
    try:
        from . import gspot
        return gspot.public(state.get(k))
    except Exception as e:
        print("Global spot özeti:", e)
        return None


def _levr(state):
    try:
        from . import kaldirac_gercek
        return kaldirac_gercek.public(state)
    except Exception:
        return None


def _memer(state):
    try:
        from . import meme_gercek
        return meme_gercek.public(state)
    except Exception:
        return None


def _meme(state):
    try:
        from . import meme
        return meme.public(state)
    except Exception:
        return None


def build(state, S=None):
    strategies = {}
    items = list(state["portfolios"].items())
    if state.get("live"):
        items.append(("live", state["live"]))
    for key, s in items:
        p = Portfolio(s)
        eq = p.equity() - s.get("pending_cut", 0.0)
        sells = [t for t in s["trades"] if t["side"] == "SAT"]
        wins = [t for t in sells if t["pnl"] > 0]
        positions = []
        for inst, pos in s["positions"].items():
            qty = sum(l["qty"] for l in pos["lots"])
            cost = sum(l["cost"] for l in pos["lots"])
            px = s["last_prices"].get(inst, 0)
            value = qty * px
            positions.append({
                "inst": inst, "lots": len(pos["lots"]), "qty": qty, "cost": round(cost, 2),
                "avg": cost / qty if qty else 0, "price": px, "value": round(value, 2),
                "pnl": round(value - cost, 2), "pnl_pct": round((value / cost - 1) * 100, 2) if cost else 0,
                "since": pos["lots"][0]["ts"],
                "tp": pos["lots"][0].get("tp"), "sl": pos["lots"][0].get("sl"),
                "protected": all(l.get("algo") for l in pos["lots"]) if s.get("armed") else None,
            })
        coins = {k: dict(v) for k, v in s.get("coin_arch", {}).items()}
        for t in s["trades"]:
            c = coins.setdefault(t["inst"], {"pnl": 0.0, "sells": 0, "wins": 0, "buys": 0, "bought": 0.0})
            if t["side"] == "SAT":
                c["pnl"] += t.get("pnl", 0); c["sells"] += 1; c["wins"] += t.get("pnl", 0) > 0
            else:
                c["buys"] += 1; c["bought"] += t.get("amount", 0)
        coin_list = []
        for inst, c in coins.items():
            op = next((x for x in positions if x["inst"] == inst), None)
            coin_list.append({"inst": inst, "realized": round(c["pnl"], 2), "sells": c["sells"], "wins": int(c["wins"]),
                              "buys": c["buys"], "bought": round(c["bought"], 2),
                              "open_qty": op["qty"] if op else 0, "open_cost": op["cost"] if op else 0,
                              "open_pnl": op["pnl"] if op else 0, "price": op["price"] if op else None})
        coin_list.sort(key=lambda x: -(x["realized"] + x["open_pnl"]))
        cfg = config.STRATEGIES[s["key"]]
        start = s.get("start_cash", config.START_CASH)
        live = key == "live"
        strategies[key] = {
            "name": "Gerçek hesap" if live else cfg["name"],
            "desc": (f"{cfg['name']} stratejisi gerçek OKX TR hesabında, {tr(start)} TL bütçeyle. "
                     + ("Emirler gerçek." if s.get("armed") else "Şu an deneme modunda: emir gönderilmiyor.")) if live else describe(s["key"], p.cfg),
            "live": live, "armed": bool(s.get("armed")), "start_cash": start, "log": s.get("log", [])[-20:][::-1],
            "paused": bool(s.get("paused")), "target_done": s.get("target_done"), "kasa": s.get("kasa"), "real_total": s.get("real_total"), "cash_gap": s.get("cash_gap"), "base": s.get("base"), "topups": s.get("topups", 0),
            "last_topup": s.get("last_topup"), "checkpoint": s.get("checkpoint"),
            "risk": dict(p.risk, lot=p.cfg.get("lot")),
            "equity": round(eq, 2), "cash": round(s["cash"], 2),
            "pnl": round(eq - start, 2),
            "pnl_pct": round((eq / start - 1) * 100, 2) if start else 0,  # bütçe 0 girilmişse özet yine yazılır
            "today_pnl": round(eq - s["day"]["start_equity"], 2),
            "trades": len(sells), "win_rate": round(len(wins) / len(sells) * 100, 1) if sells else None,
            "realized": round(sum(t["pnl"] for t in sells), 2),
            "positions": sorted(positions, key=lambda x: -x["value"]),
            "coins": coin_list,
            "recent": s["trades"][-40:][::-1],
            "equity_series": s["equity"][-24 * 30 * config.BPH:][::config.BPH],
            "halted": s["halted"], "halt_reason": s["halt_reason"], "blocked_today": s["blocked_today"],
            "watch": s.get("watch") if live else None,
            "notifs": s.get("notifs", [])[-150:] if live else None,
            "cfg": {k: p.cfg.get(k) for k in ("step", "lot", "lot_tp", "max_lots", "max_coins", "stop", "max_use", "coin_filter", "instant", "step3", "lot2", "lot3", "sma_h")}
            if s["key"] == "grid" else None,
        }
    out = {
        "updated": state.get("updated"), "created": state.get("created"),
        "mode": "Sanal", "start_cash": config.START_CASH,
        "risk": config.RISK, "fee": config.FEE_RATE, "slippage": config.SLIPPAGE,
        "universe": state.get("universe", []), "strategies": strategies, "settings": S, "okx": state.get("okx"), "perf": state.get("perf"), "bot_ver": BOT_VER, "meme": _meme(state), "lev": _lev(state), "xfer": _xfer(state, S), "levr": _levr(state), "memer": _memer(state),
        "gspot": _gs(state, "gspot"), "gspotr": _gs(state, "gspotr"),
    }
    if vault.password() and "live" in strategies:
        # Gerçek hesap bilgileri herkese açık sayfada şifreli durur; uygulama OKX şifresiyle çözer
        lv = strategies.pop("live")
        okx_, xfer_, levr_, memer_ = state.get("okx"), out.pop("xfer", None), out.pop("levr", None), out.pop("memer", None)
        gsr_ = out.pop("gspotr", None)
        # Sıkıştırılıp şifrelenen tam kutu (uygulama 1.82+ bunu okur): şifreli veri sıkışmadığı için önce sıkıştırılır
        out["live_z"] = vault.seal({"strategy": lv, "okx": okx_, "xfer": xfer_, "levr": levr_, "memer": memer_, "gspotr": gsr_,
                                    "settings": S}, z=True)
        out["settings"] = public_settings(S)  # tam ayarlar şifreli kutuda; açıkta yalnız deneme masalarının ihtiyacı
        # Eski biçimdeki yedek kutu (live_enc) artık yazılmıyor: uygulama 1.82'den beri sıkıştırılmış kutuyu okuyor; özet ~%30 küçüldü
        out["live_public"] = {"armed": lv["armed"], "paused": lv["paused"]}
        out["okx"] = None
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, separators=(",", ":"))
    # Tüm işlem geçmişi ayrı dosyada (uygulama sadece "Tümünü gör" açılınca indirir)
    hist = {"updated": state.get("updated"), "strategies": {}}
    for key, s in items:
        hist["strategies"][key] = s.get("trades", [])
    if vault.password() and "live" in hist["strategies"]:
        hist["live_enc"] = vault.seal(hist["strategies"].pop("live"))
    with open(os.path.join(os.path.dirname(OUT), "trades.json"), "w", encoding="utf-8") as f:
        json.dump(hist, f, ensure_ascii=False, separators=(",", ":"))
