"""Bot turu: saatte bir (ve ayarlar kaydedilince) GitHub Actions tarafından çağrılır.

Kullanım:  python -m bot.run
"""
import json
import os
import time

from . import config, okx, report, settings
from .engine import Portfolio, new_state, run_bars

STATE_FILE = os.path.join(os.path.dirname(__file__), "..", "docs", "data", "state.json")


def tr(v):
    return f"{v:,.0f}".replace(",", ".")


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


def note(L, text):
    L.setdefault("log", []).append([int(time.time() * 1000), text])
    del L["log"][:-100]
    print(text)


def setup_live(state, S):
    """Gerçek hesap portföyünü ayarlara göre hazırlar."""
    armed, key, budget = bool(S["live"]), S["strategy"], float(S["budget"])
    L = state.get("live")
    if L and L.get("key") != key and L.get("armed") and L["positions"]:
        # Gerçek modda strateji değişti: eski stratejinin coinleri önce satılır
        from .live import LivePortfolio
        old = LivePortfolio(L, True)
        ts = int(time.time() * 1000)
        for inst in list(L["positions"]):
            old._sell_lots(ts, inst, L["last_prices"].get(inst, 0), list(L["positions"][inst]["lots"]), "Strateji değişti")
        if L["positions"]:
            note(L, "Strateji değişikliği bekletildi: bazı coinler satılamadı, bir sonraki turda tekrar denenecek")
            key = L["key"]
    if not L or L.get("key") != key or (armed and L.get("armed") is False):
        # İlk kurulumda, strateji değişince ya da denemeden gerçeğe geçince temiz başlanır
        old_log = (L or {}).get("log", [])
        L = new_state(key, cash=budget)
        L.update(base=budget, topups=0, last_topup=None, checkpoint=budget, log=old_log)
        note(L, f"Gerçek hesap {'GERÇEK' if armed else 'deneme'} modunda {tr(budget)} TL ile başladı "
                f"({config.STRATEGIES[key]['name']})")
        state["live"] = L
    elif budget != L.get("base", budget):  # bütçe değiştirildiyse aktif paraya yansıt
        diff = budget - L["base"]
        L["base"], L["cash"], L["start_cash"] = budget, L["cash"] + diff, L["start_cash"] + diff
        L["checkpoint"] = L.get("checkpoint", budget) + diff
        note(L, f"Bottaki başlangıç parası {tr(budget)} TL yapıldı")
    if L.get("paused", False) != bool(S["paused"]):
        note(L, "Bot durduruldu: yeni alım yapılmayacak" if S["paused"] else "Bot yeniden başlatıldı")
    L["paused"] = bool(S["paused"])
    L["kasa"], L["armed"] = float(S["kasa"]), armed
    L["scale"] = L["start_cash"] / config.START_CASH
    return L


def topup(p, S):
    """Kâr ettikçe kasadan ek para. Zarardayken, durdurulmuşken ya da acil frende asla eklenmez."""
    L, T = p.s, S["topup"]
    amount = float(T["amount"])
    now = int(time.time() * 1000)
    eq = p.equity()
    days_ok = not L.get("last_topup") or now - L["last_topup"] >= float(T["days"]) * 86_400_000
    if (L["halted"] or L.get("paused") or amount <= 0 or L["kasa"] - L["start_cash"] < amount or not days_ok
            or eq < L["checkpoint"] * (1 + float(T["profit_pct"]) / 100)):
        return
    L["cash"] += amount
    L["start_cash"] += amount
    L["topups"] = L.get("topups", 0) + 1
    L["last_topup"] = now
    L["checkpoint"] = eq + amount
    L["scale"] = L["start_cash"] / config.START_CASH
    note(L, f"Kâr hedefi tuttu: kasadan +{tr(amount)} TL eklendi")


def liquidate(p, S):
    L = p.s
    req = int(S.get("liquidate") or 0)
    if req and req > L.get("liquidated_at", 0):
        L["liquidated_at"] = req
        ts = int(time.time() * 1000)
        for inst in list(L["positions"]):
            p._sell_lots(ts, inst, L["last_prices"].get(inst, 0), list(L["positions"][inst]["lots"]),
                         "Elle: hepsini sat")
        note(L, "Uygulamadan istenen 'hepsini sat' tamamlandı")


def check_okx():
    """Anahtarlar tanımlıysa sadece okuma yaparak bağlantıyı ve TL bakiyesini kontrol eder (emir vermez)."""
    if not os.environ.get("OKX_API_KEY"):
        return {"ok": False, "status": "Anahtar tanımlı değil"}
    try:
        from .live import OkxPrivate
        bal = OkxPrivate().available(config.QUOTE)
        return {"ok": True, "status": "Bağlantı çalışıyor", "try": round(bal, 2), "ts": int(time.time() * 1000)}
    except Exception as e:
        return {"ok": False, "status": f"Bağlantı hatası: {e}"[:200], "ts": int(time.time() * 1000)}


def main():
    S = settings.load()
    state = load_state()
    ports = [Portfolio(s) for s in state["portfolios"].values()]

    from .live import LivePortfolio
    L = setup_live(state, S)
    live = LivePortfolio(L, L["armed"])

    insts = set(okx.universe())
    for p in ports + [live]:  # elde tutulan coinler listeden düşse bile takip edilir
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
        events += [(ts, inst, idx) for idx, (ts, _) in enumerate(bars) if ts > last_seen]
        time.sleep(0.1)

    # İlk çalıştırmada geçmiş mumlar sadece göstergeleri ısıtır; yalnızca en son mum işlenir
    if not any(p.s["last_bar"] for p in ports):
        latest = {}
        for ts, inst, idx in events:
            latest[inst] = max(latest.get(inst, (0, 0)), (ts, idx))
        events = [(ts, inst, idx) for inst, (ts, idx) in latest.items()]

    # Gerçek hesap kendi kaldığı yerden devam eder; yeni kurulduysa sadece son mumdan başlar
    live_events = []
    for inst, bars in series.items():
        seen = live.s["last_bar"].get(inst)
        if seen is None:
            live_events.append((bars[-1][0], inst, len(bars) - 1)) if bars else None
        else:
            live_events += [(ts, inst, i) for i, (ts, _) in enumerate(bars) if ts > seen]

    run_bars(ports, events, series)
    run_bars([live], live_events, series)
    liquidate(live, S)
    topup(live, S)

    state["okx"] = check_okx()
    state["updated"] = int(time.time() * 1000)
    state["universe"] = sorted(series)
    save_state(state)
    report.build(state, S)
    print(f"{len(events)} yeni mum işlendi, {len(series)} coin takipte.")


if __name__ == "__main__":
    main()
