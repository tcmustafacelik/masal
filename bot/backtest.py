"""Geçmiş verilerle strateji yarışı. Sonuç: docs/data/backtest.json

Kullanım:  python -m bot.backtest [gün_sayısı]
"""
import json
import os
import sys
import time

from . import config, okx, settings
from .engine import Portfolio, new_state, run_bars, WARMUP

OUT = os.path.join(os.path.dirname(__file__), "..", "docs", "data", "backtest.json")


def main(days=30, custom=False):
    req = None
    if custom:  # uygulamadan "Bu ayarlarla test et": kayıtlı ayarlara dokunmadan, istenen ayarlarla test
        try:
            with open(settings.PATH, encoding="utf-8") as f:
                req = json.load(f).get("test_req")
        except Exception:
            req = None
    if req and isinstance(req.get("s"), dict):
        s = settings._merge(settings.DEFAULTS, req["s"])
        settings.apply(s)
    else:
        req = None
        settings.load()
    bars_needed = days * 24 + WARMUP
    insts = okx.universe()
    series = {}
    for inst in insts:
        try:
            series[inst] = okx.history(inst, bars=bars_needed)
        except Exception as e:
            print("Atlandı:", inst, e)
    events = [(ts, inst, i) for inst, s in series.items() for i, (ts, _) in enumerate(s)]

    results = {}
    for key in config.STRATEGIES:
        p = Portfolio(new_state(key))
        run_bars([p], list(events), series)
        sells = [t for t in p.s["trades"] if t["side"] == "SAT"]
        wins = [t for t in sells if t["pnl"] > 0]
        eq = [e[1] for e in p.s["equity"]]
        peak, mdd = eq[0] if eq else config.START_CASH, 0.0
        for v in eq:
            peak = max(peak, v)
            mdd = max(mdd, (peak - v) / peak)
        final = p.equity()
        results[key] = {
            "name": config.STRATEGIES[key]["name"],
            "final": round(final, 2),
            "pnl": round(final - config.START_CASH, 2),
            "pnl_pct": round((final / config.START_CASH - 1) * 100, 2),
            "trades": len(sells),
            "win_rate": round(len(wins) / len(sells) * 100, 1) if sells else 0,
            "max_drawdown": round(mdd * 100, 2),
            "halted": p.s["halted"],
            "equity": p.s["equity"][::6],  # 6 saatlik seyreltme
        }

    # Al ve tut karşılaştırması: aynı coinlere eşit para yatırıp hiç dokunmamak
    hold = []
    for s in series.values():
        if len(s) > WARMUP:
            hold.append(s[-1][1] / s[WARMUP][1] - 1)
    out = {
        "generated": int(time.time() * 1000),
        "days": days,
        "symbols": sorted(series),
        "hold_pct": round(sum(hold) / len(hold) * 100, 2) if hold else 0,
        "results": results,
        "custom": {"ts": req.get("ts"), "strategy": req["s"].get("strategy")} if req else None,
    }
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, separators=(",", ":"))
    for k, r in results.items():
        print(f"{r['name']:<14} {r['pnl_pct']:>7}%  işlem {r['trades']:>3}  kazanma %{r['win_rate']}  "
              f"en büyük düşüş %{r['max_drawdown']}")
    print(f"Al-tut ortalaması: %{out['hold_pct']}")


if __name__ == "__main__":
    main(int(sys.argv[1]) if len(sys.argv) > 1 and sys.argv[1].isdigit() else 30, "--custom" in sys.argv)
