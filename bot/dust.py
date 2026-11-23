"""Küçük bakiyeleri tek dokunuşla çevirme (uygulamadan istek: ayarlar.json → "dust": [{id, ts, ex}]).

tr: OKX TR'deki küçük coin artıkları TRY'ye (olmazsa USDT'ye) çevrilir (OKX "kolay çevir")
g:  OKX Global'deki küçük artıklar USDT'ye çevrilir
m:  MEME cüzdanında masanın tutmadığı token artıkları SOL'a satılır (Jupiter)
Botun açık pozisyonundaki coinlere dokunulmaz. Ağ işi arka planda yapılır.
"""
import threading
import time

from . import transfer

_SEEN = set()


def _okx(ex, prefer, skip, note, X, name):
    lst = ex.req("GET", "/api/v5/trade/easy-convert-currency-list")[0]
    tos = lst.get("toCcy") or []
    to = next((c for c in prefer if c in tos), None)
    if not to:
        raise RuntimeError(f"çevrilecek hedef yok (seçenekler: {', '.join(tos) or '—'})")
    frm = [d["fromCcy"] for d in lst.get("fromData") or [] if d["fromCcy"] not in skip and d["fromCcy"] != to]
    if not frm:
        note(X, f"{name}: çevrilecek küçük bakiye yok")
        return
    done = []
    for i in range(0, len(frm), 5):  # OKX tek istekte en fazla 5 coin alır
        part = frm[i:i + 5]
        for src in ("2", "1"):  # önce fon, sonra işlem hesabı
            try:
                ex.req("POST", "/api/v5/trade/easy-convert", {"fromCcy": part, "toCcy": to, "source": src})
                done += part
                break
            except RuntimeError as e:
                last = e
        else:
            note(X, f"{name}: {', '.join(part)} çevrilemedi ({str(last)[:80]})")
    if done:
        note(X, f"{name}: {', '.join(done)} → {to} çevrildi")


def _run(req, state, X):
    ex_k = req.get("ex")
    note = transfer._note
    try:
        if ex_k == "tr":
            L = state.get("live") or {}
            skip = {i.split("-")[0] for i in (L.get("positions") or {})} | {"TRY", "USDT"}
            _okx(transfer.Ex("https://tr.okx.com", "OKX"), ("TRY", "USDT"), skip, note, X, "OKX TR")
        elif ex_k == "g":
            _okx(transfer.Ex("https://www.okx.com", "OKXG"), ("USDT",), {"USDT", "SOL"}, note, X, "OKX Global")
        elif ex_k == "m":
            from . import meme_gercek
            if not meme_gercek._W.get("key"):
                raise RuntimeError("MEME cüzdanı bağlı değil")
            meme_gercek._Q.put(["dust"])
            note(X, "MEME: masanın tutmadığı token artıkları SOL'a satılıyor")
    except Exception as e:
        note(X, f"Küçük bakiye çevirme ({ex_k}): {str(e)[:120]}")


def step(state, S):
    X = state.setdefault("xfer", {"jobs": [], "seen": [], "log": [], "g_base": 0})
    seen = set(X.get("dust_seen") or [])
    for r in S.get("dust") or []:
        rid = str(r.get("id") or "")
        if not rid or rid in seen or rid in _SEEN or time.time() * 1000 - float(r.get("ts") or 0) > 3600_000:
            continue
        _SEEN.add(rid)
        X["dust_seen"] = (list(seen) + [rid])[-50:]
        seen.add(rid)
        threading.Thread(target=_run, args=(r, state, X), daemon=True).start()
