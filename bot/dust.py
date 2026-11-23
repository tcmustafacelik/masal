"""Küçük bakiyeler: listeleme (dakikada bir, Kasalar ekranında) ve seçilenleri tek dokunuşla çevirme.

Uygulamadan istek: ayarlar.json → "dust": [{id, ts, ex: tr|g|m, ccys: [...]}]
  tr: OKX TR'deki seçilen artıklar TRY'ye (olmazsa USDT'ye) çevrilir (OKX Convert: ücretsiz, en az tutar ~0)
  g:  OKX Global'deki seçilen artıklar USDT'ye çevrilir
  m:  MEME cüzdanında seçilen token artıkları SOL'a satılır (Jupiter)
Botun açık coinleri, nakit (TRY/USDT/USDC/EUR) ve SOL listelenmez, çevrilmez. Tek istekte en fazla MAX coin.
"""
import threading
import time

from . import transfer

MAX = 10
SMALL = 5.0  # $; bunun altındaki bakiyeler "küçük" sayılır
CASH = {"TRY", "USDT", "USDC", "EUR", "USD"}
_SEEN = set()
_HELD = {"tr": set()}


def _assets(ex):
    """İşlem + fon hesabındaki coinler: {ccy: (miktar, usd)}"""
    out = {}
    for d in ex.req("GET", "/api/v5/account/balance")[0].get("details", []):
        q = float(d.get("eq") or 0)
        if q > 0:
            a = out.get(d["ccy"], (0.0, 0.0))
            out[d["ccy"]] = (a[0] + q, a[1] + float(d.get("eqUsd") or 0))
    fund = ex.req("GET", "/api/v5/asset/balances")
    if fund:
        try:
            px = {t["instId"].split("-")[0]: float(t["last"]) for t in ex.req("GET", "/api/v5/market/tickers?instType=SPOT")
                  if t["instId"].endswith("-USDT")}
        except Exception:
            px = {}
        for d in fund:
            q = float(d.get("bal") or 0)
            if q > 0:
                a = out.get(d["ccy"], (0.0, 0.0))
                out[d["ccy"]] = (a[0] + q, a[1] + q * px.get(d["ccy"], 0))
    return out


def scan(C):
    """Kasalar ekranı için küçük bakiye listesi."""
    res = {}
    for k, skip in (("tr", CASH | _HELD["tr"]), ("g", CASH | {"SOL"})):
        if not C[k].ok:
            continue
        try:
            res[k] = sorted(({"ccy": c, "amt": round(a, 8), "usd": round(u, 2)} for c, (a, u) in _assets(C[k]).items()
                             if c not in skip and 0 < u < SMALL), key=lambda x: -x["usd"])[:30]
        except Exception as e:
            print("Küçük bakiye listesi", k, e)
    try:
        from . import meme_gercek as G
        R = G._W.get("R") or {}
        if R.get("addr"):
            from . import meme
            with meme._LOCK:
                pairs = dict(meme._SNAP.get("pairs") or {})
            lst = []
            for m, h in G._holdings(R["addr"]).items():
                if m in (R.get("pos") or {}):
                    continue
                p = pairs.get(m) or {}
                usd = h["ui"] * float(p.get("priceUsd") or 0)
                lst.append({"ccy": m, "sym": (p.get("baseToken") or {}).get("symbol") or m[:4] + "…", "amt": h["ui"], "usd": round(usd, 2)})
            res["m"] = sorted(lst, key=lambda x: -x["usd"])[:30]
    except Exception as e:
        print("MEME artık listesi:", e)
    return res


def _convert(ex, ccy, quotes):
    # para fon hesabındaysa işlem hesabına alınır (Convert işlem hesabından yapılır)
    try:
        f = ex.funding(ccy, total=True)
        if f > 0:
            ex.move(ccy, f, transfer.FUNDING, transfer.TRADING)
    except Exception:
        pass
    amt = ex.trading(ccy)
    if amt <= 0:
        raise RuntimeError("bakiye yok")
    last = None
    for q in quotes:
        try:
            e = ex.req("POST", "/api/v5/asset/convert/estimate-quote",
                       {"baseCcy": ccy, "quoteCcy": q, "side": "sell", "rfqSz": f"{amt:f}", "rfqSzCcy": ccy})[0]
            ex.req("POST", "/api/v5/asset/convert/trade", {"quoteId": e["quoteId"], "baseCcy": ccy, "quoteCcy": q, "side": "sell",
                                                           "sz": f"{amt:f}", "szCcy": ccy, "clTReqId": f"d{int(time.time() * 1000)}"})
            return q
        except RuntimeError as err:
            last = err
    raise last or RuntimeError("çevrilemedi")


def _run(req, X):
    note = transfer._note
    k = req.get("ex")
    ccys = [str(c) for c in (req.get("ccys") or [])][:MAX]
    name = {"tr": "OKX TR", "g": "OKX Global", "m": "MEME"}.get(k, k)
    try:
        if k in ("tr", "g"):
            ex = transfer._clients()[k]
            ok, bad = [], []
            for c in ccys:
                if c in CASH or (k == "tr" and c in _HELD["tr"]) or (k == "g" and c == "SOL"):
                    bad.append(f"{c} (korunuyor)")
                    continue
                try:
                    to = _convert(ex, c, ("TRY", "USDT") if k == "tr" else ("USDT",))
                    ok.append(f"{c}→{to}")
                except Exception as e:
                    bad.append(f"{c} ({str(e)[:50]})")
            note(X, f"{name}: " + (f"çevrildi {', '.join(ok)}" if ok else "çevrilen yok") + (f" · olmadı: {', '.join(bad)}" if bad else ""))
        elif k == "m":
            from . import meme_gercek
            if not meme_gercek._W.get("key"):
                raise RuntimeError("MEME cüzdanı bağlı değil")
            meme_gercek._Q.put(["dust", ccys])
            note(X, f"MEME: {len(ccys)} token artığı SOL'a satılıyor")
        X["dust_at"] = 0  # liste hemen yenilensin
    except Exception as e:
        note(X, f"{name} küçük bakiye çevirme: {str(e)[:120]}")


def step(state, S):
    X = state.setdefault("xfer", {"jobs": [], "seen": [], "log": [], "g_base": 0})
    L = state.get("live") or {}
    _HELD["tr"] = {i.split("-")[0] for i in (L.get("positions") or {})}
    seen = set(X.get("dust_seen") or [])
    for r in S.get("dust") or []:
        rid = str(r.get("id") or "")
        if not rid or rid in seen or rid in _SEEN or time.time() * 1000 - float(r.get("ts") or 0) > 3600_000:
            continue
        _SEEN.add(rid)
        seen.add(rid)
        X["dust_seen"] = list(seen)[-50:]
        threading.Thread(target=_run, args=(r, X), daemon=True).start()
