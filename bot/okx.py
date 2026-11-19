"""OKX TR herkese açık piyasa verisi. Anahtar gerektirmez."""
import json
import time
import urllib.parse
import urllib.request

from . import config

BAR_MS = config.BAR_MIN * 60_000  # mum süresi


def _get(path, params=None, retries=3):
    url = config.BASE_URL + path
    if params:
        url += "?" + urllib.parse.urlencode(params)
    last = None
    for attempt in range(retries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "masal/1.0"})
            with urllib.request.urlopen(req, timeout=15) as r:
                body = json.load(r)
            if body.get("code") != "0":
                raise RuntimeError(f"OKX hata {body.get('code')}: {body.get('msg')}")
            return body["data"]
        except Exception as e:  # ağ hatasında kısa bekleyip tekrar dene
            last = e
            time.sleep(1.5 * (attempt + 1))
    raise RuntimeError(f"Veri alınamadı: {url} ({last})")


def tickers():
    return _get("/api/v5/market/tickers", {"instType": "SPOT"})


_RATE = {"t": 0.0, "v": None}


def usdt_try():
    """USDT'nin TL kuru (1 dk önbellek)."""
    if _RATE["v"] is None or time.time() - _RATE["t"] > 60:
        _RATE["v"] = float(_get("/api/v5/market/ticker", {"instId": "USDT-TRY"})[0]["last"])
        _RATE["t"] = time.time()
    return _RATE["v"]


_USDC = {"t": 0.0, "v": None}


def usdc_usdt():
    """USDC'nin USDT karşılığı (1 dk önbellek)."""
    if _USDC["v"] is None or time.time() - _USDC["t"] > 60:
        _USDC["v"] = float(_get("/api/v5/market/ticker", {"instId": "USDC-USDT"})[0]["last"])
        _USDC["t"] = time.time()
    return _USDC["v"]


_EUR = {"t": 0.0, "v": None}


def usdt_eur():
    """1 USDT kaç EUR (1 dk önbellek)."""
    if _EUR["v"] is None or time.time() - _EUR["t"] > 60:
        _EUR["v"] = float(_get("/api/v5/market/ticker", {"instId": "USDT-EUR"})[0]["last"])
        _EUR["t"] = time.time()
    return _EUR["v"]


def rate(ccy):
    """1 birim paranın TL karşılığı. USDC, farkı düşük olan USDC-USDT ve USDT-TRY üzerinden hesaplanır."""
    if ccy == "TRY":
        return 1.0
    if ccy == "USDT":
        return usdt_try()
    if ccy == "USDC":
        return usdc_usdt() * usdt_try()
    if ccy == "EUR":  # EUR-TL paritesi yok; USDT üzerinden
        return usdt_try() / usdt_eur()
    raise ValueError("Desteklenmeyen parite: " + ccy)


def tl_factor(inst):
    """Paritenin fiyatını TL'ye çeviren çarpan (TL paritesinde 1)."""
    return rate(inst.split("-")[1])


def prices_tl():
    """TL, USDT ve USDC paritelerinin anlık fiyatı, TL karşılığı olarak."""
    k = {q: rate(q) for q in config.QUOTES}
    out = {}
    for t in tickers():
        inst, last = t["instId"], float(t.get("last") or 0)
        q = inst.rpartition("-")[2]
        if last and q in k:
            out[inst] = last * k[q]
    return out


_CRYPTO = {"t": 0.0, "v": set()}


def crypto_ids():
    """İşleme açık kripto pariteleri (tokenize hisse, emtia vb. hariç; 1 sa önbellek)."""
    if not _CRYPTO["v"] or time.time() - _CRYPTO["t"] > 3600:
        rows = _get("/api/v5/public/instruments", {"instType": "SPOT"})
        _CRYPTO["v"] = {r["instId"] for r in rows if r.get("instCategory") == "1" and r.get("state") == "live"}
        _CRYPTO["t"] = time.time()
    return _CRYPTO["v"]


def universe():
    """Hacmi yeterli pariteleri (config.QUOTE) hacme göre sıralı döndürür."""
    rows = []
    ok = crypto_ids()
    for t in tickers():
        inst = t["instId"]
        base, _, quote = inst.partition("-")
        if quote != config.QUOTE or base in config.EXCLUDED or inst not in ok:
            continue
        vol = float(t.get("volCcy24h") or 0) * rate(quote)  # TL karşılığı
        try:
            bid, ask = float(t.get("bidPx") or 0), float(t.get("askPx") or 0)
            spread = (ask - bid) / ask if ask > 0 and bid > 0 else 1
        except ValueError:
            spread = 1
        if vol >= config.MIN_VOLUME_TRY and spread <= config.MAX_SPREAD:
            rows.append((vol, inst))
    rows.sort(reverse=True)
    return [inst for _, inst in rows[: config.MAX_SYMBOLS]]


def candles(inst, limit=100):
    """Son kapanmış mumlar, eskiden yeniye. Her öğe: (ts_ms, close)."""
    data = _get("/api/v5/market/candles", {"instId": inst, "bar": config.BAR, "limit": limit})
    k = tl_factor(inst)  # fiyatlar TL karşılığıyla tutulur
    out = [(int(r[0]) + BAR_MS, float(r[4]) * k) for r in data if r[8] == "1"]  # sadece kapanmış mumlar; zaman = kapanış
    return sorted(out)


def history(inst, bars=720):
    """Geçmiş mumlar (sayfalı), eskiden yeniye."""
    out, after = [], None
    k = tl_factor(inst)
    while len(out) < bars:
        params = {"instId": inst, "bar": config.BAR, "limit": 100}
        if after:
            params["after"] = after
        data = _get("/api/v5/market/history-candles", params)
        if not data:
            break
        out.extend((int(r[0]) + BAR_MS, float(r[4]) * k) for r in data if r[8] == "1")
        after = data[-1][0]
        time.sleep(0.12)
    return sorted(set(out))[-bars:]
