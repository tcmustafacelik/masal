"""Panel için özet dosyası: docs/data/summary.json"""
import json
import os

from . import config
from .engine import Portfolio

OUT = os.path.join(os.path.dirname(__file__), "..", "docs", "data", "summary.json")


def build(state):
    strategies = {}
    items = list(state["portfolios"].items())
    if state.get("live"):
        items.append(("live", state["live"]))
    for key, s in items:
        p = Portfolio(s)
        eq = p.equity()
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
            })
        cfg = config.STRATEGIES[s["key"]]
        start = s.get("start_cash", config.START_CASH)
        live = key == "live"
        strategies[key] = {
            "name": "Gerçek hesap" if live else cfg["name"],
            "desc": (f"{cfg['name']} stratejisi gerçek OKX TR hesabında, {start:,.0f} TL bütçeyle. "
                     + ("Emirler gerçek." if s.get("armed") else "Şu an deneme modunda: emir gönderilmiyor.")) if live else cfg["desc"],
            "live": live, "armed": bool(s.get("armed")), "start_cash": start, "log": s.get("log", [])[-20:][::-1],
            "kasa": s.get("kasa"), "base": s.get("base"), "topups": s.get("topups", 0),
            "last_topup": s.get("last_topup"), "checkpoint": s.get("checkpoint"),
            "risk": dict(p.risk, lot=p.cfg.get("lot")),
            "equity": round(eq, 2), "cash": round(s["cash"], 2),
            "pnl": round(eq - start, 2),
            "pnl_pct": round((eq / start - 1) * 100, 2),
            "today_pnl": round(eq - s["day"]["start_equity"], 2),
            "trades": len(sells), "win_rate": round(len(wins) / len(sells) * 100, 1) if sells else None,
            "realized": round(sum(t["pnl"] for t in sells), 2),
            "positions": sorted(positions, key=lambda x: -x["value"]),
            "recent": s["trades"][-40:][::-1],
            "equity_series": s["equity"][-24 * 30:],
            "halted": s["halted"], "halt_reason": s["halt_reason"], "blocked_today": s["blocked_today"],
        }
    out = {
        "updated": state.get("updated"), "created": state.get("created"),
        "mode": "Sanal", "start_cash": config.START_CASH,
        "risk": config.RISK, "fee": config.FEE_RATE, "slippage": config.SLIPPAGE,
        "universe": state.get("universe", []), "strategies": strategies,
    }
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, separators=(",", ":"))
