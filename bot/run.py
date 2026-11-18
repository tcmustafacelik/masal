"""Canlı sanal çalışma: saatte bir GitHub Actions tarafından çağrılır.

Kullanım:  python -m bot.run
"""
import json
import os
import time

from . import config, okx, report
from .engine import Portfolio, new_state, run_bars

STATE_FILE = os.path.join(os.path.dirname(__file__), "..", "docs", "data", "state.json")


def load_state():
    if os.path.exists(STATE_FILE):
        with open(STATE_FILE, encoding="utf-8") as f:
            return json.load(f)
    return {"created": int(time.time() * 1000),
            "portfolios": {k: new_state(k) for k in config.STRATEGIES}}


def save_state(state):
    os.makedirs(os.path.dirname(STATE_FILE), exist_ok=True)
    with open(STATE_FILE, "w", encoding="utf-8") as f:
        json.dump(state, f, ensure_ascii=False, separators=(",", ":"))


def main():
    state = load_state()
    ports = [Portfolio(s) for s in state["portfolios"].values()]

    # Gerçek para modülü: MASAL_BUDGET tanımlıysa devreye girer
    budget = float(os.environ.get("MASAL_BUDGET") or 0)
    armed = os.environ.get("MASAL_LIVE") == "1"
    if budget > 0:
        from .live import LivePortfolio
        key = os.environ.get("MASAL_STRATEGY") or "grid"
        if "live" not in state or state["live"].get("key") != key:
            state["live"] = new_state(key, cash=budget)
        state["live"]["armed"] = armed
        ports.append(LivePortfolio(state["live"], armed))

    insts = set(okx.universe())
    for p in ports:  # elde tutulan coinler listeden düşse bile takip edilir
        insts |= set(p.s["positions"])

    series, events = {}, []
    for inst in sorted(insts):
        try:
            bars = okx.candles(inst, limit=300)
        except Exception as e:
            print("Atlandı:", inst, e)
            continue
        series[inst] = bars
        last_seen = max((p.s["last_bar"].get(inst, 0) for p in ports), default=0)
        for idx, (ts, _) in enumerate(bars):
            if ts > last_seen:
                events.append((ts, inst, idx))
        time.sleep(0.1)

    # İlk çalıştırmada geçmişi işlem yapmadan ısıtma amaçlı kullan: sadece son mumu işle
    if not any(p.s["last_bar"] for p in ports[:3]):
        latest = {}
        for ts, inst, idx in events:
            latest[inst] = max(latest.get(inst, (0, 0)), (ts, idx))
        events = [(ts, inst, idx) for inst, (ts, idx) in latest.items()]

    run_bars(ports, events, series)
    state["updated"] = int(time.time() * 1000)
    state["universe"] = sorted(series)
    save_state(state)
    report.build(state)
    print(f"{len(events)} yeni mum işlendi, {len(series)} coin takipte.")


if __name__ == "__main__":
    main()
