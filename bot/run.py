"""Bot turu: saatte bir (ve ayarlar kaydedilince) GitHub Actions tarafından çağrılır.

Kullanım:  python -m bot.run
"""
import json
import os
import time

from . import config, okx, report, settings, vault
from .notify import Notifier
from .engine import Portfolio, new_state, run_bars, watch

STATE_FILE = os.path.join(os.path.dirname(__file__), "..", "docs", "data", "state.json")


def tr(v):
    return f"{v:,.0f}".replace(",", ".")


def load_state():
    if not os.path.exists(STATE_FILE):
        return {"created": int(time.time() * 1000),
                "portfolios": {k: new_state(k) for k in config.STRATEGIES}}
    with open(STATE_FILE, encoding="utf-8") as f:
        state = json.load(f)
    for k in ("live", "okx"):
        if vault.is_sealed(state.get(k)):
            try:
                state[k] = vault.unseal(state[k])
            except ValueError as e:
                # Şifre değiştiyse eski kayıt saklanır, gerçek hesap yeniden kurulur
                print(f"{k} çözülemedi: {e}")
                state.setdefault("locked", {})[k] = state.pop(k)
    return state


def save_state(state):
    os.makedirs(os.path.dirname(STATE_FILE), exist_ok=True)
    out = dict(state)
    for k in ("live", "okx"):
        if out.get(k) is not None:
            out[k] = vault.seal(out[k])
    with open(STATE_FILE, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, separators=(",", ":"))


def note(L, text):
    L.setdefault("log", []).append([int(time.time() * 1000), text])
    del L["log"][:-100]
    print(text)


def setup_live(state, S):
    """Gerçek hesap portföyünü ayarlara göre hazırlar."""
    armed, key, budget = bool(S["live"]), S["strategy"], float(S["budget"])
    if armed and not (os.environ.get("OKX_API_KEY") and os.environ.get("OKX_API_SECRET")
                      and os.environ.get("OKX_API_PASSPHRASE")):
        armed = False  # anahtar yoksa gerçek mod açılmaz, bot deneme olarak devam eder
        print("Gerçek mod istendi ama OKX anahtarları tanımlı değil; deneme modunda çalışılıyor.")
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
        take = diff
        if diff < 0 and L["cash"] + diff < 0:
            # Bütçe, coinlere yatırılmış tutarın altına indirildi: nakit eksiye düşmesin,
            # kalan fark coinler satıldıkça nakitten düşülür.
            take = -max(L["cash"], 0.0)
            L["pending_cut"] = round(L.get("pending_cut", 0.0) + (take - diff), 2)
            note(L, f"Bütçe düşürüldü; {tr(take - diff)} TL coinler satıldıkça düşülecek")
        L["base"], L["cash"], L["start_cash"] = budget, L["cash"] + take, L["start_cash"] + diff
        L["checkpoint"] = L.get("checkpoint", budget) + diff
        if L.get("day"):  # "Bugün" kâr/zararı para eklenip çıkarılınca bozulmasın
            L["day"]["start_equity"] = L["day"].get("start_equity", 0) + diff
        note(L, f"Bottaki başlangıç parası {tr(budget)} TL yapıldı")
    if L.get("paused", False) != bool(S["paused"]):
        note(L, "Bot durduruldu: yeni alım yapılmayacak" if S["paused"] else "Bot yeniden başlatıldı")
    L["paused"] = bool(S["paused"])
    L["kasa"], L["armed"] = float(S["kasa"]), armed
    if not L.get("eq_v2"):  # eski grafik noktaları başlangıç parası bilgisi olmadan tutuluyordu; temiz başla
        L["equity"], L["eq_v2"] = [], True
    L["scale"] = L["start_cash"] / config.START_CASH
    return L


def topup(p, S, N=None):
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
    if N:
        N.add("trades", "Kasadan ekleme", f"Kâr hedefi tuttu, bota +{tr(amount)} TL eklendi. "
               f"Bottaki para artık {tr(L['start_cash'])} TL.", 3, ["moneybag"])


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


def convert_request(p, S, N):
    """Uygulamadan/ayarlardan istenen 'boş TL'nin hepsini çevir' isteğini bir kez uygular."""
    L, ts_req = p.s, int((S.get("convert") or {}).get("ts") or 0)
    if not ts_req or ts_req <= L.get("converted_at", 0) or not p.armed:
        return
    L["converted_at"] = ts_req
    try:
        tl = p.convert_all(int(time.time() * 1000))
        if tl:
            N.add("money", f"{tr(tl)} TL {config.QUOTE}'ye çevrildi",
                  f"Alım-satım hesabındaki boş TL {config.QUOTE}'ye çevrildi; bot yeni alımlarda bunu kullanır.", 3, ["currency_exchange"])
        else:
            note(L, "Çevrilecek boş TL yok (Fonlama'dan Alım-satım hesabına aktarıldı mı?)")
    except Exception as e:
        note(L, f"HATA TL çevirme: {e}")


def sell_selected(p, S):
    """Uygulamadan/ayarlardan istenen coinleri bir kez satar (zaman damgası yeniyse)."""
    L, req = p.s, S.get("sell") or {}
    ts_req = int(req.get("ts") or 0)
    if not ts_req or ts_req <= L.get("sold_sel_at", 0):
        return
    L["sold_sel_at"] = ts_req
    ts = int(time.time() * 1000)
    for inst in req.get("insts") or []:
        if inst in L["positions"]:
            p._sell_lots(ts, inst, L["last_prices"].get(inst, 0), list(L["positions"][inst]["lots"]), "Elle satış")


def daily_summary(L, p, N):
    """Her akşam 21:00 turunda günün özetini gönderir."""
    from datetime import datetime, timedelta, timezone
    now = datetime.now(timezone(timedelta(hours=config.TZ_OFFSET_HOURS)))
    today = now.strftime("%Y-%m-%d")
    if now.hour < 21 or L.get("daily_sent") == today or not N.on:
        return
    L["daily_sent"] = today
    eq = p.equity()
    day_pnl = eq - L["day"]["start_equity"]
    tot = eq - L["start_cash"]
    start_ms = int(datetime.strptime(today, "%Y-%m-%d").replace(tzinfo=now.tzinfo).timestamp() * 1000)
    n_tr = sum(1 for t in L["trades"] if t["ts"] >= start_ms)
    sg = lambda v: ("+" if v >= 0 else "−") + tr(abs(v))
    N.add("daily", "Masal · günün özeti",
          f"Bugün {sg(day_pnl)} TL · toplam {sg(tot)} TL\nBottaki para {tr(eq)} TL · bugün {n_tr} işlem · "
          f"{len(L['positions'])} açık pozisyon", 2, ["bar_chart"])


def check_okx():
    """Anahtarlar tanımlıysa sadece okuma yaparak bağlantıyı ve TL bakiyesini kontrol eder (emir vermez)."""
    if not os.environ.get("OKX_API_KEY"):
        return {"ok": False, "status": "Anahtar tanımlı değil"}
    try:
        from .live import OkxPrivate
        api = OkxPrivate()
        bal = api.available(config.CASH)
        out = {"ok": True, "status": "Bağlantı çalışıyor", "try": round(bal, 2), "ts": int(time.time() * 1000)}
        if config.QUOTE != config.CASH:  # seçili paritede işlem izni var mı (emir vermeden kontrol)
            try:
                api._req("GET", f"/api/v5/account/max-avail-size?instId=BTC-{config.QUOTE}&tdMode=cash")
                out["quote_ok"] = True
            except Exception as e:
                out["quote_ok"], out["quote_err"] = False, str(e)[:160]
            out["usdt"] = round(api.available(config.QUOTE), 2)
            out["usdt_tl"] = round(out["usdt"] * okx.rate(config.QUOTE), 2)  # boştaki USDT/USDC/EUR'nun TL karşılığı
            out["quote"] = config.QUOTE
        return out
    except Exception as e:
        return {"ok": False, "status": f"Bağlantı hatası: {e}"[:200], "ts": int(time.time() * 1000)}


_CACHE = {"uni": (0, None), "bars": {}}


def _universe():
    t, u, q = (_CACHE["uni"] + (None,))[:3]
    if u is None or q != config.QUOTE or time.time() - t > 600:  # parite değişince liste hemen yenilenir
        u = okx.universe()
        _CACHE["uni"] = (time.time(), u, config.QUOTE)
    return u


def _candles(inst):
    """Kapanmış saatlik mumlar sadece saat başında değişir; arada önbellekten verilir."""
    hour = int(time.time() // (config.BAR_MIN * 60))
    hit = _CACHE["bars"].get(inst)
    if hit and hit[0] == hour and time.time() - hit[1] < 600:
        return hit[2]
    bars = okx.candles(inst, limit=300)
    _CACHE["bars"][inst] = (hour, time.time(), bars)
    time.sleep(0.1)
    return bars


def instant_buys(live, series):
    """Kademeli stratejide anlık alım: son kapanmış mumlara göre hesaplanan alım fiyatına
    şimdiki fiyat değerse hemen alır. Kurallar mum kapanışındaki alımla aynıdır."""
    c = live.cfg
    if live.s["key"] != "grid" or not c.get("instant"):
        return
    w = watch(live, series)
    if not w or not w["items"]:
        return
    prices = okx.prices_tl()  # TL karşılığı anlık fiyatlar
    ts = int(time.time() * 1000)
    s = live.s
    for it in sorted(w["items"], key=lambda x: (prices.get(x["i"], x["p"]) / x["t"])):
        inst, price = it["i"], prices.get(it["i"])
        if not price or it["f"] or price > it["t"]:
            continue
        if s["halted"] or s["blocked_today"] or s.get("paused") or not live._room(c["lot"]):
            break
        pos = s["positions"].get(inst)
        if pos:
            n = len(pos["lots"])
            if n < c["max_lots"] and price <= pos["lots"][-1]["entry"] * (1 - c["step"]):
                live._buy(ts, inst, price, c["lot"], f"{n + 1}. kademe · anlık")
        elif live._can_open() and len(s["positions"]) < c["max_coins"]:
            live._buy(ts, inst, price, c["lot"], "1. kademe · anlık")
        s["last_prices"][inst] = price


def signature(state, S):
    """Kaydedilmesi gereken bir değişiklik olup olmadığını anlamak için özet."""
    parts = []
    for s in list(state["portfolios"].values()) + [state.get("live") or {}]:
        parts.append([len(s.get("trades", [])), sorted(s.get("positions", {})), len(s.get("log", [])),
                      s.get("halted"), s.get("armed"), s.get("paused"), round(s.get("cash", 0), 2)])
    parts.append(len((state.get("money") or {}).get("seen", [])))
    parts.append((state.get("okx") or {}).get("ok"))
    parts.append(json.dumps(S, sort_keys=True, default=str))
    return json.dumps(parts, default=str)


def main():
    S = settings.load()
    N = Notifier(S)
    state = load_state()
    if state.get("locked") and not state.get("locked_notified"):
        state["locked_notified"] = True
        N.add("alerts", "Eski gerçek hesap kaydı açılamadı",
              "OKX şifresi değişmiş görünüyor. Bot gerçek hesabı sıfırdan başlattı; hesapta coin kaldıysa OKX'ten kontrol et. "
              "Anahtarı yenilerken aynı şifreyi kullan.", 5, ["warning"])
    ports = [Portfolio(s) for s in state["portfolios"].values()]

    from .live import LivePortfolio
    L = setup_live(state, S)
    live = LivePortfolio(L, L["armed"])
    live.notifier = N  # deneme modunda da bildirim gelir, başlıkta "Deneme" yazar
    was_halted = L["halted"]
    try:
        live.reconcile()  # borsada tetiklenen korumaları önce kayda geçir
    except Exception as e:
        note(L, f"Borsa kontrolü yapılamadı: {e}")
    try:
        live.check_holdings()  # kayıttaki coin miktarı OKX'tekiyle aynı mı
    except Exception as e:
        print("Bakiye eşleştirme yapılamadı:", e)
    if L.get("pending_cut", 0) > 0 and L["cash"] > 0:  # bütçe düşürmesinin kalanını satıştan gelen nakitten al
        t = min(L["cash"], L["pending_cut"])
        L["cash"] -= t
        L["pending_cut"] = round(L["pending_cut"] - t, 2)

    # Aynı coin hem TL hem USDT paritesinden alınmasın: gerçek hesapta başka paritede tutulan coinin
    # yeni paritesi listeye alınmaz (ör. elde SOL-TRY varken SOL-USDT alınmaz)
    held = {i.split("-")[0]: i for i in L["positions"]}
    insts = {u for u in _universe() if held.get(u.split("-")[0], u) == u}
    for p in ports + [live]:  # elde tutulan coinler listeden düşse bile takip edilir
        insts |= set(p.s["positions"])

    series, events = {}, []
    for inst in sorted(insts):
        try:
            bars = _candles(inst)
        except Exception as e:
            print("Atlandı:", inst, e)
            continue
        series[inst] = bars
        last_seen = max((p.s["last_bar"].get(inst, 0) for p in ports), default=0)
        if not last_seen and bars:  # listeye yeni giren coin: geçmiş mumlar sadece göstergeyi ısıtır, geçmişte işlem yapılmaz
            events.append((bars[-1][0], inst, len(bars) - 1))
            continue
        events += [(ts, inst, idx) for idx, (ts, _) in enumerate(bars) if ts > last_seen]

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
    sell_selected(live, S)
    convert_request(live, S, N)
    topup(live, S, N if L["armed"] else None)
    try:
        instant_buys(live, series)  # fiyat alım seviyesine değdiği an al (mum kapanışını bekleme)
    except Exception as e:
        print("Anlık alım kontrolü yapılamadı:", e)
    try:
        L["watch"] = watch(live, series)  # uygulamada "Bot ne yapıyor" kartı
    except Exception as e:
        print("İzleme listesi hazırlanamadı:", e)

    if L["armed"] and L["halted"] and not was_halted:
        N.add("alerts", "Acil fren devrede", f"{L['halt_reason']}. Gerçek hesaptaki her şey satıldı, bot durdu.",
              5, ["rotating_light"])

    prev = state.get("okx") or {}
    state["okx"] = check_okx()
    if "quote_ok" in state["okx"] and state["okx"]["quote_ok"] != prev.get("quote_ok"):
        print(f"{config.QUOTE} paritesi işlem izni: {'var' if state['okx']['quote_ok'] else 'YOK - ' + state['okx'].get('quote_err', '')}"
              f" · USDT bakiyesi {state['okx'].get('usdt')}")
    if L["armed"] and state["okx"].get("quote_ok") is False and live._once_per_day("quote"):
        N.add("alerts", f"{config.QUOTE} paritesinde işlem yapılamıyor",
              f"OKX, {config.QUOTE} paritesinde emir iznini reddetti: {state['okx'].get('quote_err', '')}. Bot TL'deki coinleri yönetmeye devam eder.",
              5, ["warning"])
    if L["armed"] and not state["okx"]["ok"] and (prev.get("ok") or live._once_per_day("okx")):
        N.add("alerts", "OKX bağlantısı çalışmıyor",
              state["okx"]["status"] + ". Anahtarın süresi dolmuş olabilir; uygulamadan yenileyebilirsin.", 5,
              ["key"])

    try:
        from . import money
        money.scan(state, L, N, note)  # para yatırma / çekme / aktarma bildirimleri
    except Exception as e:
        print("Para hareketleri kontrol edilemedi:", e)

    daily_summary(L, live, N)
    state["updated"] = int(time.time() * 1000)
    state["universe"] = sorted(series)
    save_state(state)
    report.build(state, S)
    N.flush()
    if events:
        print(f"{len(events)} yeni mum işlendi, {len(series)} coin takipte.")
    return signature(state, S)


if __name__ == "__main__":
    main()
