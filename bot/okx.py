"""OKX TR herkese açık piyasa verisi. Anahtar gerektirmez."""
import json
import time
import urllib.parse
import urllib.request

from . import config

BAR_MS = 3_600_000  # 1 saatlik mum


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


def universe():
    """Hacmi yeterli TL paritelerini hacme göre sıralı döndürür."""
    rows = []
    for t in tickers():
        inst = t["instId"]
        base, _, quote = inst.partition("-")
        if quote != config.QUOTE or base in config.EXCLUDED:
            continue
        vol = float(t.get("volCcy24h") or 0)
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
    out = [(int(r[0]) + BAR_MS, float(r[4])) for r in data if r[8] == "1"]  # sadece kapanmış mumlar; zaman = kapanış
    return sorted(out)


def history(inst, bars=720):
    """Geçmiş mumlar (sayfalı), eskiden yeniye."""
    out, after = [], None
    while len(out) < bars:
        params = {"instId": inst, "bar": config.BAR, "limit": 100}
        if after:
            params["after"] = after
        data = _get("/api/v5/market/history-candles", params)
        if not data:
            break
        out.extend((int(r[0]) + BAR_MS, float(r[4])) for r in data if r[8] == "1")
        after = data[-1][0]
        time.sleep(0.12)
    return sorted(set(out))[-bars:]
