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

MAX = 100
SMALL = 5.0  # $; bunun altındaki bakiyeler "küçük" sayılır
CASH = {"TRY", "USDT", "USDC", "EUR", "USD"}
_SEEN = set()
_OUT = []  # arka plan işinin sonuçları: ana turda kayda ve bildirime aktarılır (durum her turda diskten okunur)
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
    note = lambda _x, text: _OUT.append(["note", text])
    k = req.get("ex")
    ccys = [str(c) for c in (req.get("ccys") or [])][:MAX]
    name = {"tr": "OKX TR", "g": "OKX Global", "m": "MEME"}.get(k, k)
    try:
        if k in ("tr", "g"):
            ex = transfer._clients()[k]
            want = str(req.get("to") or ("TRY" if k == "tr" else "USDT"))
            ok, bad, todo = [], [], []
            for c in ccys:
                if c in CASH or (k == "tr" and c in _HELD["tr"]) or (k == "g" and c == "SOL"):
                    bad.append(f"{c} (korunuyor)")
                else:
                    todo.append(c)
            # 1) OKX "küçük varlıkları dönüştür" (kolay çevir): en küçük tutar sınırı yok
            try:
                lst = ex.req("GET", "/api/v5/trade/easy-convert-currency-list")[0]
                tos = lst.get("toCcy") or []
                to = want if want in tos else ("USDT" if "USDT" in tos else (tos[0] if tos else None))
                easy = [c for c in todo if c in {d["fromCcy"] for d in lst.get("fromData") or []}]
                for i in range(0, len(easy), 5):
                    part = easy[i:i + 5]
                    try:
                        ex.req("POST", "/api/v5/trade/easy-convert", {"fromCcy": part, "toCcy": to})
                        ok += [f"{c}→{to}" for c in part]
                    except Exception as e:
                        for c in part:
                            bad.append(f"{c} ({str(e)[:60]})")
                    time.sleep(0.3)
                todo = [c for c in todo if c not in easy]
            except Exception as e:
                print("Kolay çevir kullanılamadı:", e)
            # 2) kalanlar: OKX Convert (fiyat teklifiyle)
            for c in todo:
                try:
                    alt = [x for x in (("TRY", "USDT") if k == "tr" else ("USDT", "USDC")) if x != want]
                    to2 = _convert(ex, c, (want, *alt))
                    ok.append(f"{c}→{to2}")
                    time.sleep(0.25)  # borsa istek sınırına takılmasın
                except Exception as e:
                    bad.append(f"{c} ({str(e)[:50]})")
            why = {}
            for b in bad:
                why.setdefault(b.split(" (", 1)[-1].rstrip(")"), []).append(b.split(" (")[0])
            msg = (f"{len(ok)} coin çevrildi ({', '.join(ok[:8])}{'…' if len(ok) > 8 else ''})" if ok else "çevrilen yok") + \
                  "".join(f" · {len(v)} coin olmadı: {k_[:70]}" for k_, v in list(why.items())[:2])
            note(X, f"{name}: " + msg)
            _OUT.append(["push", f"{name} · küçük bakiyeler", msg])
        elif k == "m":
            from . import meme_gercek
            if not meme_gercek._W.get("key"):
                raise RuntimeError("MEME cüzdanı bağlı değil")
            meme_gercek._Q.put(["dust", ccys])
            note(X, f"MEME: {len(ccys)} token artığı SOL'a satılıyor")
        _OUT.append(["refresh"])  # liste hemen yenilensin
    except Exception as e:
        note(X, f"{name} küçük bakiye çevirme: {str(e)[:120]}")


def step(state, S, N=None):
    X = state.setdefault("xfer", {"jobs": [], "seen": [], "log": [], "g_base": 0})
    while _OUT:
        o = _OUT.pop(0)
        if o[0] == "note":
            transfer._note(X, o[1])
        elif o[0] == "push" and N:
            N.add("money", o[1], o[2][:300], 3, ["recycle"])
        elif o[0] == "refresh":
            X["dust_at"] = 0
    L = state.get("live") or {}
    _HELD["tr"] = {i.split("-")[0] for i in (L.get("positions") or {})}
    seen_l = list(X.get("dust_seen") or [])
    seen = set(seen_l)
    for r in S.get("dust") or []:
        rid = str(r.get("id") or "")
        if not rid or rid in seen or rid in _SEEN or time.time() * 1000 - float(r.get("ts") or 0) > 3600_000:
            continue
        _SEEN.add(rid)
        seen.add(rid)
        seen_l.append(rid)
        X["dust_seen"] = seen_l[-50:]
        threading.Thread(target=_run, args=(r, X), daemon=True).start()
