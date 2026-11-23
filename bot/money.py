"""OKX TR hesabındaki para hareketlerini (yatırma, çekme, hesaplar arası aktarma) izler.

Her turda son hareketleri okur; daha önce görülmeyen tamamlanmış bir hareket varsa
bildirim gönderir ve gerçek hesabın kayıtlarına yazar. Sadece okuma yapar.
"""
import time

from . import config
from .live import para

# OKX fonlama hesabı hareket türleri
BILL_TYPES = {"1": "yatirma", "2": "cekme", "13": "iptal", "130": "fonlamaya", "131": "alimsatima"}


def _amt(x):
    try:
        return float(x)
    except (TypeError, ValueError):
        return 0.0


def _fmt(ccy, amt):
    return f"{para(amt)} TL" if ccy == config.CASH else f"{amt:.8f}".rstrip("0").rstrip(".") + f" {ccy}"


def fetch_events(api):
    """Kaynaklardan gelen hareketleri tek biçime çevirir: (anahtar, tür, ccy, miktar, zaman)."""
    out = []
    try:
        for r in api._req("GET", "/api/v5/asset/deposit-history?limit=20"):
            if str(r.get("state")) == "2":
                out.append((f"dep:{r.get('depId')}", "yatirma", r.get("ccy"), _amt(r.get("amt")), int(r.get("ts") or 0)))
    except Exception as e:
        print("Yatırma geçmişi okunamadı:", e)
    try:
        for r in api._req("GET", "/api/v5/asset/withdrawal-history?limit=20"):
            if str(r.get("state")) == "2":
                out.append((f"wd:{r.get('wdId')}", "cekme", r.get("ccy"), _amt(r.get("amt")), int(r.get("ts") or 0)))
    except Exception as e:
        print("Çekme geçmişi okunamadı:", e)
    try:
        seen_dw = {(k, c, round(a, 6)) for _, k, c, a, _ in out}
        for r in api._req("GET", "/api/v5/asset/bills?limit=30"):
            kind = BILL_TYPES.get(str(r.get("type")))
            if not kind or kind == "iptal":
                continue
            amt = abs(_amt(r.get("balChg")))
            # TL yatırma/çekme gibi diğer kaynakta görünmeyenler buradan yakalanır
            if kind in ("yatirma", "cekme") and (kind, r.get("ccy"), round(amt, 6)) in seen_dw:
                continue
            out.append((f"bill:{r.get('billId')}", kind, r.get("ccy"), amt, int(r.get("ts") or 0)))
    except Exception as e:
        print("Hesap hareketleri okunamadı:", e)
    return out


def balances(api):
    """TL bakiyesi: fonlama ve alım-satım hesapları."""
    fund = trade = None
    try:
        rows = api._req("GET", f"/api/v5/asset/balances?ccy={config.CASH}")
        fund = sum(_amt(r.get("bal")) for r in rows)
    except Exception as e:
        print("Fonlama bakiyesi okunamadı:", e)
    try:
        trade = api.available(config.CASH)
    except Exception as e:
        print("Alım-satım bakiyesi okunamadı:", e)
    return fund, trade


MSG = {
    "yatirma": ("Para yatırıldı", "OKX TR hesabına {x} geldi (Fonlama hesabı). Botun kullanması için Alım-satım hesabına aktar.", ["moneybag"]),
    "cekme": ("Para çekildi", "OKX TR hesabından {x} çekildi.", ["outbox_tray"]),
    "alimsatima": ("Alım-satım hesabına aktarıldı", "{x} Alım-satım hesabına geçti; bot artık bu parayı kullanabilir.", ["arrow_right"]),
    "fonlamaya": ("Fonlama hesabına aktarıldı", "{x} Alım-satım hesabından Fonlama hesabına geçti; bot bu parayı kullanamaz.", ["arrow_left"]),
}
SIGN = {"yatirma": "+", "cekme": "−", "alimsatima": "", "fonlamaya": ""}


def fetch():
    """Ağ kısmı (arka planda çalışabilir): hareketler ve TL bakiyeleri. Anahtar yoksa None."""
    import os
    if not os.environ.get("OKX_API_KEY"):
        return None
    from .live import OkxPrivate
    api = OkxPrivate()
    events = sorted(fetch_events(api), key=lambda e: e[4])
    fund, trade = balances(api)
    return events, fund, trade


def scan(state, L, N, note, data=None):
    """Yeni hareketleri bulur, bildirir ve kaydeder. data verilmezse ağdan hemen okunur."""
    data = data if data is not None else fetch()
    if not data:
        return
    events, fund, trade = data
    mem = state.setdefault("money", {"seen": [], "init": False})
    seen = set(mem.get("seen", []))
    now = int(time.time() * 1000)
    fresh = [e for e in events if e[0] not in seen]
    found = False
    for key, kind, ccy, amt, ts in fresh:
        seen.add(key)
        # ilk çalıştırmada sadece son 6 saattekiler bildirilir; eskiler sessizce kaydedilir
        if not mem.get("init") and now - ts > 6 * 3600 * 1000:
            continue
        found = True
        title, body, tags = MSG[kind]
        x = _fmt(ccy, amt)
        note(L, f"{title}: {SIGN[kind]}{x}")
        N.add("money", f"{title}: {SIGN[kind]}{x}", body.format(x=x), 4, tags)
    # Kaynaklardan biri TL hareketini göstermezse bakiye farkından yakalanır
    prev = mem.get("bal") or {}
    if mem.get("init") and not found:
        for name, cur, label in (("fund", fund, "Fonlama"), ("trade", trade, "Alım-satım")):
            old = prev.get(name)
            if cur is None or old is None or abs(cur - old) < 1:
                continue
            if name == "trade" and L.get("armed"):
                continue  # gerçek modda alım-satım bakiyesi botun işlemleriyle zaten değişir
            d = cur - old
            note(L, f"{label} hesabında TL değişti: {para(old)} → {para(cur)} TL")
            N.add("money", f"{label} hesabı: {'+' if d > 0 else '−'}{para(abs(d))} TL",
                  f"{label} hesabındaki TL {para(old)} → {para(cur)} TL oldu.", 3, ["bank"])
    mem["bal"] = {"fund": fund if fund is not None else prev.get("fund"),
                  "trade": trade if trade is not None else prev.get("trade"), "ts": now}
    mem["seen"] = sorted(seen)[-300:]
    mem["init"] = True
