"""Bot turu: saatte bir (ve ayarlar kaydedilince) GitHub Actions tarafından çağrılır.

Kullanım:  python -m bot.run
"""
import json
import os
import threading
import time
from concurrent.futures import ThreadPoolExecutor

from . import config, okx, report, settings, vault
from .live import tr_err, spot_snapshot
from .notify import Notifier
from .engine import Portfolio, new_state, run_bars, watch, step_for, lot_for

STATE_FILE = os.path.join(os.path.dirname(__file__), "..", "docs", "data", "state.json")


def tr(v):
    return f"{v:,.0f}".replace(",", ".")


SEALED = ("live", "okx", "xfer", "levr", "memer")  # herkese açık depoda bakiye ve cüzdan bilgisi şifreli durur


def load_state():
    if not os.path.exists(STATE_FILE):
        return {"created": int(time.time() * 1000),
                "portfolios": {k: new_state(k) for k in config.STRATEGIES} if config.VIRTUAL else {}}
    with open(STATE_FILE, encoding="utf-8") as f:
        state = json.load(f)
    for k in SEALED:
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
    for k in SEALED:
        if out.get(k) is not None:
            out[k] = vault.seal(out[k])
    tmp = STATE_FILE + ".tmp"  # yarım yazılmış dosya kalmasın: önce geçici dosya, sonra tek adımda yer değiştir
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, separators=(",", ":"))
    os.replace(tmp, STATE_FILE)


def note(L, text):
    L.setdefault("log", []).append([int(time.time() * 1000), text])
    del L["log"][:-100]
    print(text)


def sync_cash(state, L):
    """Botun nakit kaydını borsadaki gerçek boş parayla eşitler (fazlasını asla kullanmaz).
    Ayarlara borsadakinden yüksek bir bütçe girilse bile bot olmayan parayla alım denemez; fark uygulamada gösterilir."""
    o = state.get("okx") or {}
    if not L.get("armed") or not o.get("ok") or o.get("try") is None or time.time() * 1000 - (o.get("ts") or 0) > 300_000:
        return
    real = float(o.get("cash_tl") if o.get("cash_tl") is not None else (o.get("try") or 0) + (o.get("usdt_tl") or 0))
    over = L["cash"] - real
    if over <= max(20.0, real * 0.01):
        L.pop("over_ts", None)
    else:
        # Alım/satım sonrası eski ölçümle yanlış eşitleme olmasın: fark iki ayrı ölçümde (90 sn arayla) sürmeli
        # ve arada işlem olmamalı
        last = max([t.get("ts", 0) for t in L.get("trades", [])[-5:]] + [0])
        if not L.get("over_ts") or last > L["over_ts"] - 30_000:
            L["over_ts"] = o["ts"]
        elif o["ts"] - L["over_ts"] >= 90_000:
            L.pop("over_ts", None)
            L["cash"] = round(real, 2)
            L["cash_gap"] = round(L.get("cash_gap", 0.0) + over, 2)
            note(L, f"Nakit borsayla eşitlendi: kayıtta {tr(over)} TL fazla görünüyordu (borsada {tr(real)} TL boş)")
    L["real_total"] = o.get("total_tl")


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
        L["cash"] += L.pop("cash_gap", 0.0)  # eşitlemede düşülen fark: yeni bütçe gerçek bakiyeye göre girildi
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
    T = S.get("target") or {}
    if L.get("target_done") and (not T.get("on") or L["target_done"] != f"{float(T.get('amount') or 0):.0f}{T.get('mode') or ''}"):
        L.pop("target_done")  # hedef kapatıldı ya da değiştirildi: bot kaldığı yerden devam eder
        note(L, "Kâr hedefi değişti; bot yeniden alım yapabilir")
    want_pause = bool(S["paused"]) or bool(L.get("target_done"))
    if L.get("paused", False) != want_pause:
        note(L, "Bot durduruldu: yeni alım yapılmayacak" if want_pause else "Bot yeniden başlatıldı")
    L["paused"] = want_pause
    L["kasa"], L["armed"] = float(S["kasa"]), armed
    sync_cash(state, L)
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
        now = int(time.time() * 1000)
        if now - L.get("liq_try", 0) < 20_000:
            return
        L["liq_try"] = now
        for inst in list(L["positions"]):
            p._sell_lots(now, inst, L["last_prices"].get(inst, 0), list(L["positions"][inst]["lots"]),
                         "Elle: hepsini sat")
        # hepsi satılana kadar (en çok 10 dk) 20 sn'de bir yeniden denenir; bir hata isteği kaybettirmez
        if not L["positions"] or now - req > 600_000:
            L["liquidated_at"] = req
            note(L, "Uygulamadan istenen 'hepsini sat' tamamlandı" if not L["positions"]
                 else "'Hepsini sat' 10 dakikada tamamlanamadı; kalan coinler için yeniden iste")


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
        note(L, f"HATA TL çevirme: {tr_err(e)}")


def check_target(p, S, N):
    """Kâr hedefi: açıksa ve toplam kâr hedefe ulaştıysa her şey satılır, bot yeni alım yapmaz."""
    L, T = p.s, S.get("target") or {}
    amount = float(T.get("amount") or 0)
    if not T.get("on") or amount <= 0 or L.get("target_done"):
        return
    eq = p.equity()
    profit = eq - L["start_cash"]
    total = eq + max(0.0, float(L.get("kasa") or 0) - L["start_cash"])  # kasadaki yedek para dahil
    if (total if T.get("mode") == "total" else profit) < amount:
        return
    ts = int(time.time() * 1000)
    for inst in list(L["positions"]):
        p._sell_lots(ts, inst, L["last_prices"].get(inst, 0), list(L["positions"][inst]["lots"]), "Hedef tuttu: hepsini sat")
    if L["positions"]:
        note(L, "Kâr hedefi tuttu ama bazı coinler satılamadı; bir sonraki turda tekrar denenecek")
        return
    L["target_done"], L["paused"] = f"{amount:.0f}{T.get('mode') or ''}", True
    what = f"kasa dahil toplam para {tr(total)} TL" if T.get("mode") == "total" else f"toplam kâr {tr(profit)} TL"
    note(L, f"Kâr hedefi tuttu: {what}. Her şey satıldı, bot durdu.")
    N.add("alerts", f"Hedef tuttu: {what}",
          f"{tr(amount)} TL hedefine ulaşıldı (kâr {'+' if profit >= 0 else '−'}{tr(abs(profit))} TL). Bütün coinler satıldı, bot yeni alım yapmıyor. "
          "Devam etmek için Ayarlar'dan hedefi kapat ya da yükselt.", 5, ["trophy"])


def clear_old(state, S):
    """Uygulamadan "Eski kayıtları temizle": işlem geçmişi ve kâr/zarar hesabı korunur; günlükler ve biten işler silinir."""
    ts = int(S.get("clear") or 0)
    if not ts or ts <= state.get("cleared_at", 0):
        return
    state["cleared_at"] = ts
    L = state.get("live") or {}
    if L.get("log"):
        del L["log"][:-5]  # aynı liste (portföy de bu listeye yazıyor)
    L["notifs"] = []
    X = state.get("xfer") or {}
    nowm = time.time() * 1000  # bankaya çekilecek TL'yi koruyan son 48 saatin g2tr işleri silinmez
    X["jobs"] = [j for j in X.get("jobs", []) if j.get("stage") not in ("done", "failed")
                 or (j.get("dir") == "g2tr" and nowm - (j.get("sent_ts") or j.get("ts") or 0) < 48 * 3600_000)]
    X["log"] = []
    for k in ("meme", "lev", "levr", "memer"):
        d = state.get(k) or {}
        if d:
            d["log"] = d.get("log", [])[-5:]
    try:
        from . import kaldirac_gercek
        kaldirac_gercek.trim_log()
        from . import meme_gercek
        meme_gercek.trim_log()
    except Exception:
        pass
    print("Eski kayıtlar temizlendi")


def desk_commands(state, S):
    """Uygulamadan masa komutları: {"desk_cmd": [{id, ts, desk: lev|meme, act: close|sell, sym}]} (her biri bir kez)."""
    done = state.setdefault("desk_done", [])
    for c in S.get("desk_cmd") or []:
        if not isinstance(c, dict):
            continue  # bozuk kayıt turu düşürmesin
        cid = str(c.get("id") or "")
        try:
            old = time.time() * 1000 - float(c.get("ts") or 0) > 600_000
        except (TypeError, ValueError):
            old = True
        if not cid or cid in done or old:
            continue
        done.append(cid)
        try:
            if c.get("desk") == "lev" and c.get("act") == "open":
                from . import kaldirac
                kaldirac.manual_open(state, S, str(c.get("sym")), c.get("side"))
            elif c.get("desk") == "lev":
                from . import kaldirac
                kaldirac.manual_close(state, str(c.get("sym")), S=S)
            elif c.get("desk") == "meme":
                from . import meme
                meme.manual_sell(state, str(c.get("sym")))
        except Exception as e:
            print("Masa komutu:", e)
    state["desk_done"] = done[-50:]


def sell_selected(p, S):
    """Uygulamadan/ayarlardan istenen coinleri satar (zaman damgası yeniyse; 10 dakikadan eski istek işlenmez).
    Satılamayan coin (geçici bağlantı hatası, borsada serbest bakiye yok, sonucu doğrulanmamış emir, kısmi dolum)
    için istek kaybolmaz: 2 dakika boyunca 15 sn arayla yeniden denenir (uygulamadaki "Satılıyor" süresi)."""
    L, req = p.s, S.get("sell") or {}
    try:
        ts_req = int(req.get("ts") or 0)
    except (TypeError, ValueError):
        ts_req = 0
    now = int(time.time() * 1000)
    if ts_req and ts_req > L.get("sold_sel_at", 0):
        L["sold_sel_at"] = ts_req
        insts = [str(i) for i in (req.get("insts") or []) if isinstance(i, str)] if isinstance(req.get("insts"), list) else []
        if now - ts_req > 600_000:
            if insts:
                p._note(now, "Elle satış isteği 10 dakikadan eski; işlenmedi (yeniden iste)")
        elif insts:
            L["sell_pend"] = {"t0": now, "try": 0, "insts": insts}
    sp = L.get("sell_pend")
    if not sp:
        return
    if now - sp.get("try", 0) < 15_000:
        return
    sp["try"] = now
    for inst in sp["insts"]:
        if inst in L["positions"]:
            p._sell_lots(now, inst, L["last_prices"].get(inst, 0), list(L["positions"][inst]["lots"]), "Elle satış")
    left = [i for i in sp["insts"] if i in L["positions"]]
    if not left:
        L.pop("sell_pend", None)
    elif now - sp["t0"] > 120_000:
        L.pop("sell_pend", None)
        p._note(now, "Elle satış 2 dakikada tamamlanamadı: " + ", ".join(i.split("-")[0] for i in left) + "; yeniden iste")
    else:
        sp["insts"] = left


def buy_selected(p, S):
    """Uygulamadan elle alım: {"buy": [{id, ts, inst, amt}]} — her istek bir kez, 10 dakikadan eskisi işlenmez.
    Alınan coin botun kendi kademesi gibi yönetilir (kademe kârı, zarar durdur, sonraki kademeler)."""
    reqs = [r for r in (S.get("buy") or []) if isinstance(r, dict)]
    L = p.s
    done = L.setdefault("buy_done", [])
    now = time.time() * 1000
    def fresh(r):
        try:
            return now - float(r.get("ts") or 0) <= 600_000
        except (TypeError, ValueError):
            return False
    todo = [r for r in reqs if str(r.get("id") or "") and str(r["id"]) not in done and fresh(r)]
    if not todo:
        return
    try:
        prices = okx.prices_tl()
    except Exception as e:
        print("Elle alım: fiyat alınamadı", e)
        return  # bir sonraki turda yeniden denenir
    for r in todo:
        done.append(str(r["id"]))
        inst = str(r.get("inst") or "")
        try:
            amt = float(r.get("amt") or 0)
        except (TypeError, ValueError):
            continue
        price = okx.ASK.get(inst) or prices.get(inst) or L["last_prices"].get(inst)
        if not inst or amt < 10 or not price:
            p._note(int(now), f"Elle alım yapılamadı: {inst.split('-')[0]} " + ("tutarı 10 TL'nin altında" if inst and amt < 10 else "fiyatı bulunamadı"))
            continue
        if config.banned("spot", inst):
            p._note(int(now), f"Elle alım yapılmadı: {inst.split('-')[0]} kara listede")
            continue
        n = len((L["positions"].get(inst) or {}).get("lots") or [])
        notes = len(p.log)
        if not p._buy(int(now), inst, price, amt, f"{n + 1}. kademe · elle alım") and len(p.log) == notes:
            # alım olmadı ve sebebi kayda geçmedi (boş nakit 10 TL'nin altında ya da coin bu hesapta işleme kapalı)
            p._note(int(now), f"Elle alım yapılamadı: {inst.split('-')[0]} · botta yeterli boş nakit yok ya da coin işleme kapalı")
    L["buy_done"] = done[-50:]

def daily_summary(L, p, N):
    """Her gün ayarlanan saatte (varsayılan 21:00) günün özetini gönderir."""
    from datetime import datetime, timedelta, timezone
    now = datetime.now(timezone(timedelta(hours=config.TZ_OFFSET_HOURS)))
    today = now.strftime("%Y-%m-%d")
    if now.hour < getattr(N, "daily_hour", 21) or L.get("daily_sent") == today or not N.on:
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


def fund_to_trading(state, N):
    """OKX TR'de bankadan gelen TL (ve USDT) Fonlama hesabına düşer; bot yalnız Alım-satım hesabını kullanabilir.
    Fonlamadaki para kendiliğinden Alım-satım'a alınır (dışarı aktarım işi beklerken dokunulmaz)."""
    X = state.get("xfer") or {}
    now = time.time() * 1000
    # TR'ye giden/gelen aktarım sürerken ya da Global'den gelip bankaya çekilmek üzere Nakit'e konan para varken dokunulmaz
    if any((j.get("stage") not in ("done", "failed") and "tr" in j.get("dir", ""))
           or (j.get("dir") == "g2tr" and now - (j.get("sent_ts") or j.get("ts") or 0) < 48 * 3600_000)
           for j in X.get("jobs", [])):
        return
    try:
        from . import transfer
        ex = transfer.Ex("https://tr.okx.com", "OKX")
        moved = []
        for ccy in ("TRY", "USDT"):
            amt = ex.funding(ccy)
            if amt >= (10 if ccy == "TRY" else 0.5):
                ex.move(ccy, amt, transfer.FUNDING, transfer.TRADING)
                moved.append(f"{amt:,.2f} {ccy}".replace(",", "X").replace(".", ",").replace("X", "."))
        if moved:
            state["okx"]["fund_tl"] = 0
            N.add("money", "Para bota hazırlandı", f"{' ve '.join(moved)} Fonlama'dan Alım-satım hesabına alındı; bot artık kullanabilir.", 3, ["inbox_tray"])
            print("Fonlamadan alım-satıma:", moved)
    except Exception as e:
        print("Fonlama aktarımı:", e)


_OKXT = {}


def check_okx():
    """Anahtarlar tanımlıysa sadece okuma yaparak bağlantıyı ve TL bakiyesini kontrol eder (emir vermez)."""
    if not os.environ.get("OKX_API_KEY"):
        return {"ok": False, "status": "Anahtar tanımlı değil"}
    try:
        from .live import OkxPrivate
        api = OkxPrivate()
        rows = api._req("GET", "/api/v5/account/balance")  # tek istekle bütün para birimleri (ayrıca borç kontrolü)
        det = {d["ccy"]: d for d in (rows[0].get("details", []) if rows else [])}
        av = lambda c: float((det.get(c) or {}).get("availBal") or 0)
        bal = av(config.CASH)
        out = {"ok": True, "status": "Bağlantı çalışıyor", "try": round(bal, 2), "ts": int(time.time() * 1000)}
        out["debt"] = round(sum(float(d.get("liab") or 0) for d in det.values()), 6)
        # botun nakdi TL dışında USDT/USDC/EUR olarak da durabilir: hepsi TL karşılığıyla
        out["cash_tl"] = round(bal + sum(av(c) * okx.rate(c) for c in ("USDT", "USDC", "EUR") if av(c) > 0), 2)
        try:  # hesap türü (10 dakikada bir yeter): bot sadece spot ("cash") işlem yapar
            if time.time() - _CACHE.get("acct_t", 0) > 600:
                cfg = api._req("GET", "/api/v5/account/config")[0]
                _CACHE["acct"] = {"1": "Spot", "2": "Spot ve vadeli", "3": "Çoklu para marjin", "4": "Portföy marjin"}.get(
                    str(cfg.get("acctLv")), str(cfg.get("acctLv")))
                _CACHE["acct_t"] = time.time()
            out["acct"] = _CACHE.get("acct")
        except Exception as e:
            print("Hesap türü okunamadı:", e)
        if config.QUOTE != config.CASH:  # seçili paritede işlem izni var mı (emir vermeden kontrol)
            try:
                api._req("GET", f"/api/v5/account/max-avail-size?instId=BTC-{config.QUOTE}&tdMode=cash")
                out["quote_ok"] = True
            except Exception as e:
                out["quote_ok"], out["quote_err"] = False, str(e)[:160]
            out["usdt"] = round(av(config.QUOTE), 2)
            out["usdt_tl"] = round(out["usdt"] * okx.rate(config.QUOTE), 2)  # boştaki USDT/USDC/EUR'nun TL karşılığı
            out["quote"] = config.QUOTE
        try:  # borsadaki gerçek toplam (işlem + fon hesabı, coinler dahil) ve fon hesabındaki boş TL
            out["total_tl"] = round(float(api._req("GET", "/api/v5/asset/asset-valuation?ccy=TRY")[0].get("totalBal") or 0), 2)
            fb = api._req("GET", "/api/v5/asset/balances?ccy=TRY,USDT")
            out["fund_tl"] = round(sum(float(b.get("availBal") or 0) * (1 if b["ccy"] == "TRY" else okx.rate("USDT")) for b in fb), 2)
        except Exception as e:
            print("Borsa toplamı okunamadı:", e)
        return out
    except Exception as e:
        return {"ok": False, "status": f"Bağlantı hatası: {tr_err(e)}"[:200], "ts": int(time.time() * 1000)}


_CACHE = {"uni": (0, None), "bars": {}}
PERF = {}  # son turların süresi (uygulamadaki bulut ekranı ve hız takibi için)


_UNI = {"t": None, "try": 0.0}


def _universe():
    """İzlenen coin listesi (10 dk'da bir yenilenir). İlk turda ve parite değişince beklenir; sonraki yenilemeler
    arka planda yapılır (2 büyük istek ana turu bekletmez), o sırada eldeki liste kullanılır."""
    t, u, q = (_CACHE["uni"] + (None,))[:3]
    if u is None or q != config.QUOTE:  # parite değişince liste hemen yenilenir
        u = okx.universe()
        _CACHE["uni"] = (time.time(), u, config.QUOTE)
    elif time.time() - t > 600 and not (_UNI["t"] and _UNI["t"].is_alive()) and time.time() - _UNI["try"] > 30:
        _UNI["try"] = time.time()

        def _bg(q0=config.QUOTE):
            try:
                v = okx.universe()
                if q0 == config.QUOTE:
                    _CACHE["uni"] = (time.time(), v, q0)
            except Exception as e:
                print("Coin listesi yenilenemedi (eldeki liste kullanılıyor):", e)
        _UNI["t"] = threading.Thread(target=_bg, daemon=True)
        _UNI["t"].start()
    return u


def _bar_no():
    return int(time.time() // (config.BAR_MIN * 60))


_BARS = {"t": None, "fail": {}}


def _stale(inst):
    """Bu coinin mumları yenilenmeli mi? Kapanmış mumlar sadece mum kapanışında değişir; arada önbellekten verilir."""
    h = _CACHE["bars"].get(inst)
    if not h:
        return True
    age = time.time() - h[1]
    if h[0] != _bar_no() or age >= 600:
        return True
    # Mum yeni kapandıysa borsa "kapandı" işaretini 1-2 sn geç koyabilir: son mum henüz gelmediyse 10 dk beklenmez,
    # ilk 90 sn içinde 4 sn arayla yeniden sorulur (karar gecikmesin)
    start = _bar_no() * config.BAR_MIN * 60
    late = not h[2] or h[2][-1][0] < start * 1000
    return late and time.time() - start < 90 and age >= 4


def _fetch_bars(need):
    """Arka plan: mumlar aynı anda çekilir (hız sınırı okx._get içinde), hepsi bitince tek adımda yayınlanır."""
    bars, vols = {}, {}

    def one(i):
        no = _bar_no()
        try:
            bars[i] = (no, time.time(), okx.candles(i, limit=300, retries=2, vol_out=vols))
        except Exception as e:
            _BARS["fail"][i] = time.time()
            print("Atlandı:", i, e)
    with ThreadPoolExecutor(max_workers=6) as ex:
        list(ex.map(one, need))
    _BARS["out"] = (bars, vols)


def _series(insts):
    """Coinlerin kapanmış mumları. Mum kapanışında yenileme arka planda yapılır (60 coin ~5-20 sn; ana tur beklemez:
    korumalar, aktarımlar ve masalar o sırada çalışmaya devam eder). Yeni mumlar hepsi birden yayınlanır; böylece aynı
    mumun coinleri motor tarafından birlikte değerlendirilir. Yalnız oturumun ilk turunda beklenir."""
    def merge():
        out = _BARS.pop("out", None)
        if out:
            _CACHE["bars"].update(out[0])
            okx.VOL.update(out[1])
    th = _BARS["t"]
    if not (th and th.is_alive()):
        merge()  # canlılığa bakıldıktan sonra alınır: biten çekimin sonucu kaçmaz
        now = time.time()
        need = [i for i in sorted(insts) if _stale(i) and now - _BARS["fail"].get(i, 0) > 20]
        if need:
            th = _BARS["t"] = threading.Thread(target=_fetch_bars, args=(need,), daemon=True)
            th.start()
            if not _CACHE["bars"]:  # oturumun ilk turu: mum olmadan karar verilemez
                th.join()
                merge()
    return {i: _CACHE["bars"][i][2] for i in sorted(insts) if i in _CACHE["bars"]}


_SPOT = {}


def _spot_sync(live):
    """Borsadaki korumaların (kâr al / zarar durdur) ve coin bakiyelerinin durumu arka planda okunur; biten okumanın
    sonucu burada, ana turda kayda işlenir (tur borsayı beklemez). Eksik koruma varsa hemen burada kurulur."""
    if not live.armed:
        return
    L = live.s
    th = _SPOT.get("t")
    alive = bool(th and th.is_alive())  # önce bakılır: bu arada biten okumanın sonucu aşağıda alınır
    snap = _SPOT.pop("out", None)
    live.resolve_unsure()  # yanıtı kaybolan emir varsa önce o doğrulanıp kayda geçer
    live.reconcile(snap=snap or {})  # borsada tetiklenen korumaları kayda geçir
    if snap and snap.get("have") is not None:
        try:
            live.check_holdings(have=snap["have"], base=snap.get("qty"), pending=snap.get("pending"))  # kayıttaki coin miktarı OKX'tekiyle aynı mı
        except Exception as e:
            print("Bakiye eşleştirme yapılamadı:", e)
    if snap and snap.get("own"):
        try:
            # kayıtta karşılığı kalmamış (sahipsiz) koruma emirleri; yalnız botun kendi kimliğini taşıyanlar
            live.cancel_orphans(snap["own"], {**(snap.get("own_have") or {}), **(snap.get("have") or {})})
        except Exception as e:
            print("Sahipsiz koruma kontrolü:", e)
    if alive:
        return
    now = int(time.time() * 1000)
    algos = [(inst, l["algo"]) for inst, p in L["positions"].items() for l in p["lots"] if l.get("algo")]
    due = bool(L["positions"]) and now - L.get("hold_ck", 0) >= 60_000  # bakiye eşleştirme dakikada bir
    # Coin kalmasa da (hepsi satıldı) dakikada bir bekleyen korumalara bakılır: sahipsiz emir kaldıysa iptal edilir
    orphan_due = not algos and now - _SPOT.get("orph", 0) >= 60_000
    if not algos and not due and not orphan_due:
        return
    _SPOT["orph"] = now
    ccys = None
    if due:
        L["hold_ck"] = now
        ccys = sorted({i.split("-")[0] for i in L["positions"]})
    qty = {inst: sum(l["qty"] for l in p["lots"]) for inst, p in L["positions"].items()}
    api = live.api

    def _bg():
        try:
            out = spot_snapshot(api, algos, ccys)
            out["qty"] = qty
            _SPOT["out"] = out
        except Exception as e:
            print("Borsa kontrolü:", e)
    _SPOT["t"] = threading.Thread(target=_bg, daemon=True)
    _SPOT["t"].start()


def instant_sells(live):
    """Toplu kâr al açıkken: coinin bütün kademelerinin alış ortalamasının %X üstüne (satış/alış tahtası fiyatıyla) çıkıldığı an
    hepsi birden satılır; mum kapanışı beklenmez (borsada kademe başına kâr al emri olmadığı için bu kontrol bota düşer)."""
    c, s = live.cfg, live.s
    ptp = c.get("pos_tp") or 0
    if s["key"] != "grid" or ptp <= 0 or not s["positions"]:
        return
    prices = okx.prices_tl()
    ts = int(time.time() * 1000)
    for inst, pos in list(s["positions"].items()):
        if not pos.get("lots") or (hasattr(live, "_is_unsure") and live._is_unsure(inst)):
            continue
        price = okx.BID.get(inst) or prices.get(inst)
        if not price:
            continue
        s["last_prices"][inst] = prices.get(inst, price)
        cost = sum(l["cost"] for l in pos["lots"])
        qty = sum(l["qty"] for l in pos["lots"])
        if qty > 0 and price >= cost / qty * (1 + ptp):
            live._sell_lots(ts, inst, price, list(pos["lots"]),
                            f"Toplu kâr · {len(pos['lots'])} kademe · ortalamanın %{(price / (cost / qty) - 1) * 100:.1f} üstünde")


def instant_buys(live, series):
    """Kademeli stratejide anlık alım: son kapanmış mumlara göre hesaplanan alım fiyatına
    şimdiki fiyat değerse hemen alır. Kurallar mum kapanışındaki alımla aynıdır."""
    c = live.cfg
    if live.s["key"] != "grid" or not c.get("instant"):
        return None
    w = watch(live, series)
    if not w or not w["items"]:
        return w
    any_buy = False
    prices = okx.prices_tl()  # TL karşılığı anlık fiyatlar (tek istek, bu turda okunur: alım kararı eski fiyatla verilmez)
    ts = int(time.time() * 1000)
    s = live.s
    for it in sorted(w["items"], key=lambda x: (prices.get(x["i"], x["p"]) / x["t"])):
        inst = it["i"]
        # Alım şartı satış (ask) fiyatıyla kontrol edilir: gerçekte ödenecek fiyat budur
        price = okx.ASK.get(inst) or prices.get(inst)
        if not price or it["f"] or price > it["t"]:
            if prices.get(inst):
                s["last_prices"][inst] = prices[inst]
            continue
        if s["halted"] or s["blocked_today"] or s.get("paused") or not live._room(lot_for(c, c["max_lots"] - 1)):
            break  # en küçük kademeye bile yer yok
        # Bekçi: alış-satış farkı yüksekse (sığ tahta) alım yapılmaz; kayma zarara çevirir
        spread = okx.SPREAD.get(inst, 0)
        if spread > config.MAX_BUY_SPREAD:
            key = f"spr_{inst}"
            sl = s.setdefault("skip_log", {})
            if ts - sl.get(key, 0) > 3_600_000:  # aynı coin için saatte bir not
                for k_ in [k_ for k_, v_ in sl.items() if ts - v_ > 3_600_000]:
                    del sl[k_]  # eski kayıtlar silinir, liste büyümez
                sl[key] = ts
                live._note(ts, f"Bekçi: {inst.split('-')[0]} alınmadı, alış-satış farkı %{spread * 100:.2f} (sınır %{config.MAX_BUY_SPREAD * 100:.1f})")
            continue
        avg = it["t"] / (1 - c["step"]) if c["step"] < 1 else it["t"]
        why = f"{c.get('sma_h', 20):g} sa ortalamanın %{(1 - price / avg) * 100:.1f} altında · fark %{spread * 100:.2f}"
        pos = s["positions"].get(inst)
        bought = False
        if pos:
            n = len(pos["lots"])
            last_e = pos["lots"][-1]["entry"]
            if n < c["max_lots"] and price <= last_e * (1 - step_for(c, n)) and live._room(lot_for(c, n)):
                bought = live._buy(ts, inst, price, lot_for(c, n),
                                   f"{n + 1}. kademe · anlık · son alımın %{(1 - price / last_e) * 100:.1f} altında · fark %{spread * 100:.2f}")
        elif live._can_open() and len(s["positions"]) < c["max_coins"] and live._room(c["lot"]):
            bought = live._buy(ts, inst, price, c["lot"], f"1. kademe · anlık · {why}")
        s["last_prices"][inst] = prices.get(inst, price)
        any_buy = any_buy or bool(bought)
        if bought and live.armed:
            # gerçek alım birkaç saniye sürer: sıradaki coin için fiyatlar yeniden okunur; okunamazsa bu tur başka alım yapılmaz
            try:
                prices = okx.prices_tl()
                ts = int(time.time() * 1000)
            except Exception as e:
                print("Fiyatlar yenilenemedi; kalan alımlar bir sonraki tura kaldı:", e)
                break
    return None if any_buy else w  # alım olduysa liste eskidi: çağıran yeniden hesaplar


def signature(state, S):
    """Kaydedilmesi gereken bir değişiklik olup olmadığını anlamak için özet."""
    parts = []
    tail = lambda d: ((d.get("log") or [None])[-1], (d.get("trades") or [{}])[-1].get("ts"))  # listeler sınıra ulaşınca uzunluk değişmez
    for k in ("meme", "lev", "levr", "memer"):
        parts.append(tail(state.get(k) or {}))
    for s in list(state["portfolios"].values()) + [state.get("live") or {}]:
        parts.append(tail(s))
        parts.append([len(s.get("trades", [])), sorted(s.get("positions", {})), len(s.get("log", [])),
                      s.get("halted"), s.get("armed"), s.get("paused"), round(s.get("cash", 0), 2)])
    parts.append(len((state.get("money") or {}).get("seen", [])))
    parts.append((state.get("okx") or {}).get("ok"))
    mm = state.get("meme") or {}
    parts.append([len(mm.get("trades", [])), sorted(mm.get("positions", {})), len(mm.get("log", []))])
    xf = state.get("xfer") or {}
    parts.append([(j.get("id"), j.get("stage"), j.get("msg")) for j in xf.get("jobs", [])] + [xf.get("free_tl"), xf.get("g_val")])
    lv = state.get("lev") or {}
    parts.append([len(lv.get("trades", [])), sorted(lv.get("positions", {})), len(lv.get("log", [])),
                  [round(v.get("stop", 0), 8) for v in (lv.get("positions") or {}).values()]])
    lr = state.get("levr") or {}
    parts.append([len(lr.get("trades", [])), sorted(lr.get("pos", {})), len(lr.get("log", [])), lr.get("err"),
                  round(lr.get("eq", 0) * 2) / 2, lr.get("halt"), lr.get("dead"), lr.get("on")])
    mr = state.get("memer") or {}
    parts.append([len(mr.get("trades", [])), sorted(mr.get("pos", {})), len(mr.get("log", [])), mr.get("err"),
                  round(mr.get("value", 0) * 2) / 2, mr.get("dead"), mr.get("on")])
    parts.append(json.dumps(S, sort_keys=True, default=str))
    return json.dumps(parts, default=str)


def main():
    t_start = time.time()
    S = settings.load()
    N = Notifier(S)
    state = load_state()
    try:
        return _turn(state, S, N, t_start)
    except Exception:
        # Tur yarıda kesildi. Bu turda verilmiş gerçek emir olabilir: kayıt o ana kadarki hâliyle yazılır (yazılmazsa
        # bir sonraki tur diskteki eski kayıtla başlar; alınan coin kayıtsız kalır ve aynı emir yeniden verilebilirdi).
        if not state.get("_saved"):
            try:
                state["updated"] = int(time.time() * 1000)
                save_state(state)
                print("Tur hatayla kesildi; o ana kadarki kayıt yazıldı.")
            except Exception as e:
                print("Kayıt yazılamadı:", e)
            try:
                N.flush()
            except Exception:
                pass
        raise


def _turn(state, S, N, t_start):
    if state.get("locked") and not state.get("locked_notified"):
        state["locked_notified"] = True
        N.add("alerts", "Eski gerçek hesap kaydı açılamadı",
              "OKX şifresi değişmiş görünüyor. Bot gerçek hesabı sıfırdan başlattı; hesapta coin kaldıysa OKX'ten kontrol et. "
              "Anahtarı yenilerken aynı şifreyi kullan.", 5, ["warning"])
    if not config.VIRTUAL:
        state["portfolios"] = {}  # sadece gerçek hesap çalışır (sanal stratejiler kayıt ve süre harcamasın)
    ports = [Portfolio(s) for s in state["portfolios"].values()]

    from .live import LivePortfolio
    L = setup_live(state, S)
    live = LivePortfolio(L, L["armed"])
    live.notifier = N  # deneme modunda da bildirim gelir, başlıkta "Deneme" yazar
    was_halted = L["halted"]
    try:
        _spot_sync(live)  # borsada tetiklenen korumaları önce kayda geçir (borsa okuması arka planda)
    except Exception as e:
        note(L, f"Borsa kontrolü yapılamadı: {tr_err(e)}")
    if L.get("pending_cut", 0) > 0 and L["cash"] > 0:  # bütçe düşürmesinin kalanını satıştan gelen nakitten al
        t = min(L["cash"], L["pending_cut"])
        L["cash"] -= t
        L["pending_cut"] = round(L["pending_cut"] - t, 2)

    # Aynı coin hem TL hem USDT paritesinden alınmasın: gerçek hesapta başka paritede tutulan coinin
    # yeni paritesi listeye alınmaz (ör. elde SOL-TRY varken SOL-USDT alınmaz)
    held = {i.split("-")[0]: i for i in L["positions"]}
    blocked = L.get("blocked", {})  # borsanın bu hesapta işleme izin vermediği coinler
    insts = {u for u in _universe() if held.get(u.split("-")[0], u) == u and u not in blocked}
    live_insts = insts | set(L["positions"])  # gerçek hesap sadece güncel listedeki ve kendi elindeki coinlere bakar
    for p in ports + [live]:  # elde tutulan coinler listeden düşse bile takip edilir
        insts |= set(p.s["positions"])

    series, events = {}, []
    for inst, bars in _series(insts).items():
        series[inst] = bars
        last_seen = max((p.s["last_bar"].get(inst, 0) for p in ports), default=0)
        if not last_seen and bars:  # listeye yeni giren coin: geçmiş mumlar sadece göstergeyi ısıtır, geçmişte işlem yapılmaz
            events.append((bars[-1][0], inst, len(bars) - 1))
            continue
        events += [(ts, inst, idx) for idx, (ts, _) in enumerate(bars) if ts > last_seen]

    # İlk çalıştırmada geçmiş mumlar sadece göstergeleri ısıtır; yalnızca en son mum işlenir
    if ports and not any(p.s["last_bar"] for p in ports):
        latest = {}
        for ts, inst, idx in events:
            latest[inst] = max(latest.get(inst, (0, 0)), (ts, idx))
        events = [(ts, inst, idx) for inst, (ts, idx) in latest.items()]

    # Gerçek hesap kendi kaldığı yerden devam eder; yeni kurulduysa sadece son mumdan başlar
    live_events = []
    live_series = {i: b for i, b in series.items() if i in live_insts}  # sanal stratejilerin eski TL coinleri hariç
    for inst, bars in live_series.items():
        seen = live.s["last_bar"].get(inst)
        if seen is None:
            live_events.append((bars[-1][0], inst, len(bars) - 1)) if bars else None
        else:
            live_events += [(ts, inst, i) for i, (ts, _) in enumerate(bars) if ts > seen]

    run_bars(ports, events, series)
    run_bars([live], live_events, live_series)
    liquidate(live, S)
    sell_selected(live, S)
    try:
        buy_selected(live, S)
    except Exception as e:
        print("Elle alım yapılamadı:", e)
    desk_commands(state, S)
    clear_old(state, S)
    check_target(live, S, N)
    convert_request(live, S, N)
    topup(live, S, N if L["armed"] else None)
    try:
        instant_sells(live)  # toplu kâr al: hedefe değdiği an hepsini sat
    except Exception as e:
        print("Anlık toplu satış kontrolü yapılamadı:", e)
    w = None
    try:
        w = instant_buys(live, live_series)  # fiyat alım seviyesine değdiği an al (mum kapanışını bekleme)
    except Exception as e:
        print("Anlık alım kontrolü yapılamadı:", e)
    try:
        # uygulamada "Bot ne yapıyor" kartı; anlık alım kontrolü az önce aynı listeyi hesapladıysa (ve alım olmadıysa) o kullanılır
        L["watch"] = w if w is not None else watch(live, live_series)
    except Exception as e:
        print("İzleme listesi hazırlanamadı:", e)

    if L["armed"] and L["halted"] and not was_halted:
        N.add("alerts", "Acil fren devrede", f"{L['halt_reason']}. Gerçek hesaptaki her şey satıldı, bot durdu.",
              5, ["rotating_light"])

    prev = state.get("okx") or {}
    # Hesap kontrolü (6 istek) dakikada bir yeter; araya giren turlar önceki sonucu kullanır
    # ilk turda beklenir; sonra arka planda yenilenir (6 istek ana turu bekletmez), sonuç bir sonraki turda kullanılır
    due = not prev or time.time() * 1000 - (prev.get("ts") or 0) > 60_000 or not prev.get("ok")
    fresh = _OKXT.pop("out", None)
    if not prev:
        fresh = check_okx()
    elif due and not (_OKXT.get("t") and _OKXT["t"].is_alive()) and fresh is None:
        def _bg():
            try:
                _OKXT["out"] = check_okx()
            except Exception as e:
                print("Hesap kontrolü:", e)
        _OKXT["t"] = threading.Thread(target=_bg, daemon=True)
        _OKXT["t"].start()
    if fresh is not None:
        state["okx"] = fresh
        if L["armed"] and float(state["okx"].get("fund_tl") or 0) >= 10:
            fund_to_trading(state, N)
    else:
        state["okx"] = prev
    if "quote_ok" in state["okx"] and state["okx"]["quote_ok"] != prev.get("quote_ok"):
        print(f"{config.QUOTE} paritesi işlem izni: {'var' if state['okx']['quote_ok'] else 'YOK - ' + state['okx'].get('quote_err', '')}"
              f" · USDT bakiyesi {state['okx'].get('usdt')}")
    if state["okx"].get("acct") != prev.get("acct"):
        print(f"OKX hesap türü: {state['okx'].get('acct')} · borç: {state['okx'].get('debt')}")
    if L["armed"] and (state["okx"].get("debt") or 0) > 0 and live._once_per_day("debt"):
        N.add("alerts", "OKX hesabında borç görünüyor",
              "Bot sadece spot (nakit) işlem yapar ama hesapta borç kaydı var. OKX'te Varlıklar bölümünü kontrol et.", 5, ["warning"])
    if L["armed"] and state["okx"].get("quote_ok") is False and live._once_per_day("quote"):
        N.add("alerts", f"{config.QUOTE} paritesinde işlem yapılamıyor",
              f"OKX, {config.QUOTE} paritesinde emir iznini reddetti: {tr_err(state['okx'].get('quote_err', ''))}. Bot TL'deki coinleri yönetmeye devam eder.",
              5, ["warning"])
    if L["armed"] and not state["okx"]["ok"] and (prev.get("ok") or live._once_per_day("okx")):
        N.add("alerts", "OKX bağlantısı çalışmıyor",
              state["okx"]["status"] + ". Anahtarın süresi dolmuş olabilir; uygulamadan yenileyebilirsin.", 5,
              ["key"])

    try:
        from . import money
        # para hareketleri 30 sn'de bir; 4-5 istek arka planda okunur, sonuç bir sonraki turda işlenir
        md = _CACHE.pop("money_out", None)
        if md is not None:
            money.scan(state, L, N, note, md)  # para yatırma / çekme / aktarma bildirimleri
        th = _CACHE.get("money_t")
        if time.time() - _CACHE.get("money", 0) >= 30 and not (th and th.is_alive()):
            _CACHE["money"] = time.time()

            def _mbg():
                try:
                    _CACHE["money_out"] = money.fetch()
                except Exception as e:
                    print("Para hareketleri okunamadı:", e)
            _CACHE["money_t"] = threading.Thread(target=_mbg, daemon=True)
            _CACHE["money_t"].start()
    except Exception as e:
        print("Para hareketleri kontrol edilemedi:", e)

    daily_summary(L, live, N)
    try:
        from . import meme
        meme.step(state, S)  # memecoin deneme masası (sanal para; ağ işi arka planda)
    except Exception as e:
        print("Memecoin masası hatası:", e)
    try:
        from . import meme, meme_gercek
        meme_gercek.step(state, S, {**meme.DEFAULT, **(S.get("meme") or {})}, N)  # aynı kararlar MEME cüzdanında
    except Exception as e:
        print("Gerçek memecoin masası hatası:", e)
    try:
        from . import transfer
        if L["armed"]:
            transfer.step(state, S, N)
            from . import dust
            dust.step(state, S, N)  # küçük bakiyeleri çevirme istekleri
    except Exception as e:
        print("Aktarım hatası:", e)
    try:
        from . import kaldirac
        kaldirac.step(state, S)  # kaldıraç deneme masası (sanal para; ağ işi arka planda)
    except Exception as e:
        print("Kaldıraç masası hatası:", e)
    try:
        from . import kaldirac, kaldirac_gercek
        kaldirac_gercek.step(state, S, {**kaldirac.DEFAULT, **(S.get("lev") or {})}, N)  # aynı kararlar gerçek parayla (OKX Global)
    except Exception as e:
        print("Gerçek kaldıraç masası hatası:", e)
    PERF["main"] = round(time.time() - t_start, 2)
    state["perf"] = dict(PERF)
    # Gönderilen bildirimler buluta da yazılır (gerçek hesabın şifreli kaydında): uygulama her cihazda aynı listeyi görür
    if N.queue:
        now_ms = int(time.time() * 1000)
        L["notifs"] = [m for m in L.get("notifs", []) if now_ms - m["t"] < 86400_000][-150:] + [
            {"t": now_ms, "title": m["title"], "message": m["message"], "tags": m.get("tags", [])} for m in N.queue]
    state["updated"] = int(time.time() * 1000)
    state["universe"] = sorted(series)
    save_state(state)
    state["_saved"] = True  # (diske yazılmaz) bundan sonraki hata kaydı etkilemez
    try:
        report.build(state, S)
    except Exception as e:  # özet yazılamasa da işlemler kayıtlı kalır, bildirimler gider
        print("Özet yazılamadı:", e)
    N.flush()
    if events:
        if _CACHE.get("logbar") != _bar_no():  # her 5 sn'de değil, sadece yeni 15 dk'lık mumda yazılsın
            _CACHE["logbar"] = _bar_no()
            print(f"Yeni mum: {len(series)} coin takipte.")
    return signature(state, S)


if __name__ == "__main__":
    main()
