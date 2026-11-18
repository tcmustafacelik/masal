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


TOPUP_AMOUNT = 1_000.0
TOPUP_PROFIT = 0.05
TOPUP_DAYS = 7


def topup(p):
    """Kâr ettikçe kasadan ek para: aktif para son eklemeden beri %5 kâra ulaştıysa ve
    en az 7 gün geçtiyse +1.000 TL. Zarardayken ya da acil fren varken asla eklenmez."""
    L = p.s
    now = int(time.time() * 1000)
    eq = p.equity()
    days_ok = not L.get("last_topup") or now - L["last_topup"] >= TOPUP_DAYS * 86_400_000
    room = L["kasa"] - L["start_cash"]
    if L["halted"] or room < TOPUP_AMOUNT or not days_ok or eq < L["checkpoint"] * (1 + TOPUP_PROFIT):
        return
    L["cash"] += TOPUP_AMOUNT
    L["start_cash"] += TOPUP_AMOUNT
    L["topups"] = L.get("topups", 0) + 1
    L["last_topup"] = now
    L["checkpoint"] = eq + TOPUP_AMOUNT
    L["scale"] = L["start_cash"] / config.START_CASH
    L.setdefault("log", []).append([now, f"Kâr hedefi tuttu: kasadan +{TOPUP_AMOUNT:,.0f} TL eklendi"])


def main():
    state = load_state()
    ports = [Portfolio(s) for s in state["portfolios"].values()]

    # Gerçek para modülü: MASAL_BUDGET tanımlıysa devreye girer
    budget = float(os.environ.get("MASAL_BUDGET") or 0)
    kasa = float(os.environ.get("MASAL_KASA") or 10_000)
    armed = os.environ.get("MASAL_LIVE") == "1"
    live = None
    if budget > 0:
        from .live import LivePortfolio
        key = os.environ.get("MASAL_STRATEGY") or "grid"
        was_armed = state.get("live", {}).get("armed")
        if "live" not in state or state["live"].get("key") != key or (armed and was_armed is False):
            # Deneme modundan gerçeğe geçince sanal pozisyonlar silinir, temiz başlanır
            state["live"] = new_state(key, cash=budget)
            state["live"].update(base=budget, topups=0, last_topup=None, checkpoint=budget)
        L = state["live"]
        if budget != L.get("base", budget):  # bütçe elle değiştirildiyse aktif paraya yansıt
            diff = budget - L["base"]
            L["base"], L["cash"], L["start_cash"] = budget, L["cash"] + diff, L["start_cash"] + diff
            L["checkpoint"] = L.get("checkpoint", budget) + diff
            L.setdefault("log", []).append([int(time.time() * 1000), f"Başlangıç bütçesi elle {budget:,.0f} TL yapıldı"])
        L["kasa"], L["armed"] = kasa, armed
        L["scale"] = L["start_cash"] / config.START_CASH
        live = LivePortfolio(L, armed)
        ports.append(live)

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
    if live:
        topup(live)
    state["updated"] = int(time.time() * 1000)
    state["universe"] = sorted(series)
    save_state(state)
    report.build(state)
    print(f"{len(events)} yeni mum işlendi, {len(series)} coin takipte.")


if __name__ == "__main__":
    main()
