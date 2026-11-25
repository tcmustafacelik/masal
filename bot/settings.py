"""Uygulamadaki Ayarlar ekranının kaydettiği docs/ayarlar.json dosyasını okur ve bota uygular.

Tutarlar yüzde olarak tutulur; böylece bottaki para değiştikçe hepsi kendiliğinden ölçeklenir.
"""
import copy
import json
import math
import os

from . import config

PATH = os.path.join(os.path.dirname(__file__), "..", "docs", "ayarlar.json")

DEFAULTS = {
    "live": False,          # True: gerçek emir gönderilir
    "lang": "",             # uygulama ve bildirim dili (bulutta; boşsa Türkçe ve cihaz seçimi geçerli)
    "theme": "",            # uygulama teması (bulutta; boşsa cihaz seçimi geçerli)
    "accent": "",           # vurgu rengi (kehribar, okyanus, zümrüt, ametist, grafit)
    "paused": False,        # True: gerçek hesapta yeni alım yapılmaz (açık pozisyonlar korunur)
    "liquidate": 0,         # zaman damgası; yeniyse gerçek hesaptaki her şey satılır
    "sell": {"ts": 0, "insts": []},
    "clear": 0,  # zaman damgası yeniyse eski kayıtlar (akış, aktarım geçmişi, masa günlükleri, bildirimler) temizlenir
    "clear_all": 0,  # zaman damgası yeniyse (clear ile birlikte) işlem geçmişleri de silinir
    "xfer": {"daily_max": 10000, "sweep_on": True, "sweep_pct": 50, "sweep_days": 7, "sweep_min": 10, "use_bot": False},  # para aktarımı ve kâr süpürme
    "dust": [],
    "gspot": {"on": True, "real": False, "bank": 100.0, "budget": 50.0, "max_loss": 15.0, "lot_pct": 10.0, "lot2_pct": 45.0,
              "lot3_pct": 77.0, "step_pct": 3.3, "step3_pct": 6.6, "lot_tp_pct": 3.5, "stop_pct": 50.0, "max_lots": 5,
              "max_coins": 5, "use_pct": 85.0, "sma_hours": 72, "trend_filter_pct": 5.0, "vol_filter": 4.0, "coins": 30, "instant": True},  # Global spot masası ($)
    "ban": {"spot": [], "lev": [], "gspot": []},  # kara liste: masa başına yeni işlem açılmayacak coinler
    "buy": [],  # uygulamadan elle alım istekleri [{id, ts, inst, amt (TL)}]
    "desk_cmd": [],  # futures elle kapat/aç, eşleştir istekleri
    "xfer_cancel": [],  # iptal edilecek aktarım istekleri (id listesi)
    "xfer_req": [],  # uygulamadan aktarım istekleri [{id, ts, dir, amt, src}]; her biri bir kez işlenir
    "convert": {"ts": 0},
    "target": {"on": False, "amount": 20000, "mode": "profit"},  # açıksa hedefe ulaşınca her şey satılır ve bot durur
    "lev": {"on": True, "bank": 100.0, "lev": 3, "risk_pct": 1.0, "max_pos": 3, "sl_atr": 2.0, "tp_atr": 4.0, "daily_loss_pct": 5, "fee_pct": 0.05, "slip_pct": 0.05, "coins": ["BTC", "ETH", "SOL", "XRP", "DOGE", "HYPE", "ZEC", "PEPE"], "brk_h": 20, "trend_h": 200, "trend_on": True, "fast": False, "real": False, "real_budget": 30.0, "real_lev": 2, "max_loss": 10.0, "real_reset": 0, "cross_ok": True},  # kaldıraç deneme masası (sanal para, en fazla 3x)
    # mode: "profit" = toplam kâr bu tutara ulaşınca; "total" = bottaki para + kasadaki yedek toplamı bu tutara ulaşınca   # zaman damgası yeniyse alım-satım hesabındaki boş TL'nin tamamı seçili pariteye çevrilir  # seçili coinleri elle sat: zaman damgası yeniyse listedekiler bir kez satılır
    "strategy": "grid",
    "quote": "USDT",        # yeni alımların paritesi: TRY, USDT ya da USDC
    "budget": 2000,         # bottaki başlangıç parası (TL)
    "kasa": 10000,          # hesaptaki toplam kasa (TL)
    "topup": {"amount": 250, "profit_pct": 5, "days": 7},
    "risk": {"trade_pct": 10, "max_positions": 5, "stop_pct": 5, "daily_loss_pct": 3, "kill_pct": 15},
    "grid": {"step_pct": 2, "lot_pct": 4, "lot_tp_pct": 2.5, "max_lots": 3, "max_coins": 3, "stop_pct": 7, "use_pct": 40, "trend_filter_pct": 1, "instant": True, "step3_pct": 3, "lot2_pct": 100, "lot3_pct": 100, "sma_hours": 20, "vol_filter": 2, "pos_tp_pct": 0},
    "dip": {"dip_pct": 3, "rsi_max": 35, "take_profit_pct": 4, "max_hold_hours": 48},
    "trend": {"trailing_pct": 4},
    "notify": {"enabled": False, "topic": "", "trades": True, "alerts": True, "daily": True, "money": True, "daily_hour": 21, "cleared": 0},
}


_BAD = object()


def _coerce(d, v):
    """Dosyadaki değeri varsayılanın türüne getirir; getirilemiyorsa (boş, bozuk, yanlış tür) _BAD döner."""
    if isinstance(d, bool):
        return bool(v) if isinstance(v, (bool, int)) else _BAD
    if isinstance(d, (int, float)):
        if isinstance(v, str):
            try:
                v = float(v.replace(",", "."))
            except ValueError:
                return _BAD
        if isinstance(v, bool):
            return int(v)
        return v if isinstance(v, (int, float)) and math.isfinite(v) else _BAD
    if isinstance(d, str):
        return v if isinstance(v, (str, dict)) else _BAD  # şifreli alanlar (bildirim konusu) sözlük olarak durur
    if isinstance(d, list):
        return v if isinstance(v, list) else _BAD
    if isinstance(d, dict):
        return v if isinstance(v, dict) else _BAD
    return v


def _merge(base, extra, bad=None, path=""):
    out = copy.deepcopy(base)
    for k, v in (extra or {}).items():
        if k not in out:
            continue
        if isinstance(v, dict) and isinstance(out[k], dict):
            out[k] = _merge(out[k], v, bad, path + k + ".")
            continue
        c = _coerce(out[k], v)
        if c is _BAD:
            if bad is not None:
                bad.append(path + k)
        else:
            out[k] = c
    return out


_GOOD = {}
# Bozuk gelirse varsayılanı zararsız olan alanlar (görünüm, bildirim, tek seferlik istek listeleri)
_SOFT = {"clear_all", "ban", "fav", "lang", "theme", "accent", "notify", "dust", "buy", "desk_cmd", "xfer_cancel", "xfer_req", "sell", "convert", "clear", "liquidate"}


def _get(d, path):
    for k in path.split("."):
        d = d[k]
    return d


def _put(d, path, v):
    ks = path.split(".")
    for k in ks[:-1]:
        d = d[k]
    d[ks[-1]] = v


def _deep(base, over):
    """Düz yazılmış alanlar şifrelinin üstüne alan alan yazılır (ör. {"lev": {"brk_h": 6}} lev'in yalnız o alanını değiştirir)."""
    out = dict(base)
    for k, v in over.items():
        out[k] = _deep(out[k], v) if isinstance(v, dict) and isinstance(out.get(k), dict) else v
    return out


def load():
    """Ayarları okur. Dosya bozuksa ya da bir değer kullanılamaz durumdaysa (boş/yanlış tür) işlem ayarlarında
    varsayılana DÖNÜLMEZ: varsayılanda gerçek mod kapalı, bütçe ve zarar sınırları farklıdır; gerçek hesap yanlış
    ayarla işlem yapardı. Bozuk alan için oturumda en son okunan değer kullanılır (diğer alanlar, ör. durdur / hepsini
    sat, güncel okunur); hiç okunmadıysa tur hata verir (bot işlem yapmaz, borsadaki korumalar çalışır, "bot durdu"
    uyarısı gelir)."""
    data, bad = {}, []
    if os.path.exists(PATH):
        try:
            with open(PATH, encoding="utf-8") as f:
                data = json.load(f)
            if not isinstance(data, dict):
                raise ValueError("beklenmeyen biçim")
            from . import vault
            if vault.is_sealed(data.get("sec")):
                # Ayarlar uygulamada OKX şifresiyle şifrelenir (herkese açık depoda okunmasın); düz yazılmış alanlar
                # (ör. elle düzeltme) şifreli olanın üstüne yazılır, uygulama bir sonraki kayıtta onları da şifreler
                plain = {k: v for k, v in data.items() if k != "sec"}
                data = _deep(vault.unseal(data["sec"]), plain)
        except Exception as e:
            if "d" not in _GOOD:
                raise RuntimeError(f"Ayar dosyası okunamadı; bot bu ayarlarla çalışmaz (docs/ayarlar.json düzeltilmeli): {e}")
            _warn(f"Ayar dosyası okunamadı, son okunan ayarlar kullanılıyor: {e}")
            data = _GOOD["d"]
    s = _merge(DEFAULTS, data, bad)
    for path in bad:
        if "s" in _GOOD:
            _put(s, path, copy.deepcopy(_get(_GOOD["s"], path)))
        elif path.split(".")[0] not in _SOFT:
            raise RuntimeError(f"Ayar kullanılamıyor: {path}; bot bu ayarlarla çalışmaz (docs/ayarlar.json düzeltilmeli)")
    if bad:
        _warn("Kullanılamayan ayar değeri atlandı (son geçerli değer kullanılıyor): " + ", ".join(bad[:6]))
    else:
        _GOOD.pop("warn", None)
    _GOOD["d"] = data
    if s["strategy"] not in config.STRATEGIES:
        s["strategy"] = "grid"
    apply(s)
    _GOOD["s"] = copy.deepcopy(s)
    return s


def _warn(text):
    if _GOOD.get("warn") != text:  # her turda (2 sn) değil, uyarı değişince yazılır
        _GOOD["warn"] = text
        print(text)


def apply(s):
    """Yüzdeleri 10.000 TL tabanına çevirip config'e yazar; motor bunları bakiyeye göre ölçekler."""
    s.pop("meme", None)  # memecoin masası kaldırıldı: eski ayarları yok sayılır
    # Deneme modu kaldırıldı: bütün masalar gerçek parayla çalışır (masa kapatmak için "on" kullanılır)
    s["live"] = True
    # ("Masa açık" anahtarı gerçek masayı açar/kapatır: kapalı futures pozisyonlarını kapatır, Global yeni alım yapmaz)
    for k in ("gspot", "lev"):
        if isinstance(s.get(k), dict):
            s[k]["real"] = s[k].get("on", True) is not False
    if isinstance(s.get("ban"), dict):
        s["ban"].pop("meme", None)
    base = config.START_CASH
    if s.get("quote") not in config.QUOTES:
        s["quote"] = "USDT"
    config.QUOTE = s["quote"]
    b = s.get("ban") if isinstance(s.get("ban"), dict) else {}
    # kara liste üç masada ortak: herhangi bir masadaki coin hepsinde yeni işlem açmaz
    allb = {config.ban_key(x) for k in ("spot", "lev", "gspot") for x in (b.get(k) or []) if isinstance(x, str) and x.strip()}
    config.BAN = {k: set(allb) for k in ("spot", "lev", "gspot")}
    # Global spot (uzun) ile futures (kısa) aynı coinde ters pozisyon tutabilir mi (Ayarlar → Futures)
    config.CROSS_OK = bool((s.get("lev") or {}).get("cross_ok", True))
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
                                     pos_tp=max(0.0, float(g.get("pos_tp_pct") or 0)) / 100,
                                     max_coins=int(g["max_coins"]), stop=g["stop_pct"] / 100,
                                     max_use=g.get("use_pct", 40) / 100,
                                     coin_filter=g.get("trend_filter_pct", 0) / 100,
                                     vol_k=float(g.get("vol_filter") or 0) or None,
                                     instant=bool(g.get("instant", False)),
                                     step3=max(g["step_pct"], g.get("step3_pct") or g["step_pct"]) / 100,
                                     lot2=min(100, max(10, g.get("lot2_pct") or 100)) / 100,
                                     lot3=min(100, max(10, g.get("lot3_pct") or 100)) / 100,
                                     sma_h=int(min(72, max(4, g.get("sma_hours") or 20))))
    config.STRATEGIES["dip"].update(dip_pct=d["dip_pct"] / 100, rsi_max=d["rsi_max"],
                                    take_profit=d["take_profit_pct"] / 100, max_hold_bars=int(d["max_hold_hours"]) * config.BPH)
    config.STRATEGIES["trend"].update(trailing=t["trailing_pct"] / 100)
