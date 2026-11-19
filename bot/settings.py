"""Uygulamadaki Ayarlar ekranının kaydettiği docs/ayarlar.json dosyasını okur ve bota uygular.

Tutarlar yüzde olarak tutulur; böylece bottaki para değiştikçe hepsi kendiliğinden ölçeklenir.
"""
import copy
import json
import os

from . import config

PATH = os.path.join(os.path.dirname(__file__), "..", "docs", "ayarlar.json")

DEFAULTS = {
    "live": False,          # True: gerçek emir gönderilir
    "paused": False,        # True: gerçek hesapta yeni alım yapılmaz (açık pozisyonlar korunur)
    "liquidate": 0,         # zaman damgası; yeniyse gerçek hesaptaki her şey satılır
    "sell": {"ts": 0, "insts": []},  # seçili coinleri elle sat: zaman damgası yeniyse listedekiler bir kez satılır
    "strategy": "grid",
    "quote": "USDT",        # yeni alımların paritesi: TRY, USDT ya da USDC
    "budget": 2000,         # bottaki başlangıç parası (TL)
    "kasa": 10000,          # hesaptaki toplam kasa (TL)
    "topup": {"amount": 250, "profit_pct": 5, "days": 7},
    "risk": {"trade_pct": 10, "max_positions": 5, "stop_pct": 5, "daily_loss_pct": 3, "kill_pct": 15},
    "grid": {"step_pct": 2, "lot_pct": 4, "lot_tp_pct": 2.5, "max_lots": 3, "max_coins": 3, "stop_pct": 7, "use_pct": 40, "trend_filter_pct": 1, "instant": True},
    "dip": {"dip_pct": 3, "rsi_max": 35, "take_profit_pct": 4, "max_hold_hours": 48},
    "trend": {"trailing_pct": 4},
    "notify": {"enabled": False, "topic": "", "trades": True, "alerts": True, "daily": True, "money": True},
}


def _merge(base, extra):
    out = copy.deepcopy(base)
    for k, v in (extra or {}).items():
        if isinstance(v, dict) and isinstance(out.get(k), dict):
            out[k] = _merge(out[k], v)
        elif k in out:
            out[k] = v
    return out


def load():
    data = {}
    if os.path.exists(PATH):
        try:
            with open(PATH, encoding="utf-8") as f:
                data = json.load(f)
        except Exception as e:
            print("Ayar dosyası okunamadı, varsayılanlar kullanılıyor:", e)
    s = _merge(DEFAULTS, data)
    if s["strategy"] not in config.STRATEGIES:
        s["strategy"] = "grid"
    apply(s)
    return s


def apply(s):
    """Yüzdeleri 10.000 TL tabanına çevirip config'e yazar; motor bunları bakiyeye göre ölçekler."""
    base = config.START_CASH
    if s.get("quote") not in config.QUOTES:
        s["quote"] = "USDT"
    config.QUOTE = s["quote"]
    from . import engine
    engine.MARKET_REF = f"BTC-{config.QUOTE}"
    r = s["risk"]
    config.RISK.update({
        "trade_size": base * r["trade_pct"] / 100,
        "max_positions": int(r["max_positions"]),
        "stop_loss": r["stop_pct"] / 100,
        "daily_loss_limit": base * r["daily_loss_pct"] / 100,
        "kill_switch": base * (1 - r["kill_pct"] / 100),
    })
    g, d, t = s["grid"], s["dip"], s["trend"]
    config.STRATEGIES["grid"].update(step=g["step_pct"] / 100, lot=base * g["lot_pct"] / 100,
                                     lot_tp=g["lot_tp_pct"] / 100, max_lots=int(g["max_lots"]),
                                     max_coins=int(g["max_coins"]), stop=g["stop_pct"] / 100,
                                     max_use=g.get("use_pct", 40) / 100,
                                     coin_filter=g.get("trend_filter_pct", 0) / 100,
                                     instant=bool(g.get("instant", False)))
    config.STRATEGIES["dip"].update(dip_pct=d["dip_pct"] / 100, rsi_max=d["rsi_max"],
                                    take_profit=d["take_profit_pct"] / 100, max_hold_bars=int(d["max_hold_hours"]) * config.BPH)
    config.STRATEGIES["trend"].update(trailing=t["trailing_pct"] / 100)
