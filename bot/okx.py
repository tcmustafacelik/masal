"""OKX TR herkese açık piyasa verisi. Anahtar gerektirmez."""
import gzip
import json
import threading
import time
import urllib.parse
import urllib.request

from . import config

BAR_MS = config.BAR_MIN * 60_000  # mum süresi


_GATE = threading.Lock()
_LAST = [0.0]
MIN_GAP = 0.055  # istekler arası en az ~55 ms (~18 istek/sn): OKX mum sınırının (40 istek/2 sn) altında


def _throttle():
    with _GATE:
        wait = _LAST[0] + MIN_GAP - time.monotonic()
        if wait > 0:
            time.sleep(wait)
        _LAST[0] = time.monotonic()


def _get(path, params=None, retries=3, timeout=15, throttle=True):
    url = config.BASE_URL + path
    if params:
        url += "?" + urllib.parse.urlencode(params)
    last = None
    for attempt in range(retries):
        try:
            if throttle:
                _throttle()
            req = urllib.request.Request(url, headers={"User-Agent": "masal/1.0", "Accept-Encoding": "gzip"})
            with urllib.request.urlopen(req, timeout=timeout) as r:
                raw = r.read()
                if r.headers.get("Content-Encoding") == "gzip":  # sıkıştırılmış: tüm fiyat listesi ~390 KB yerine ~100 KB
                    raw = gzip.decompress(raw)
                body = json.loads(raw)
            if body.get("code") != "0":
                raise RuntimeError(f"OKX hata {body.get('code')}: {body.get('msg')}")
            return body["data"]
        except Exception as e:  # ağ hatasında kısa bekleyip tekrar dene
            last = e
            if attempt + 1 < retries:  # son denemeden sonra boşuna beklenmez
                time.sleep(1.5 * (attempt + 1))
    raise RuntimeError(f"Veri alınamadı: {url} ({last})")


def tickers(fast=False):
    """fast: her turda çağrılan anlık fiyat okuması. Tek deneme, kısa zaman aşımı; mum çekimlerinin hız sınırı
    sırasını beklemez (fiyat listesinin sınırı ayrıdır). Olmazsa tur beklemez, bir sonraki turda yeniden okunur."""
    if fast:
        return _get("/api/v5/market/tickers", {"instType": "SPOT"}, retries=1, timeout=5, throttle=False)
    return _get("/api/v5/market/tickers", {"instType": "SPOT"})


_RATE = {"t": 0.0, "v": None}
_USDC = {"t": 0.0, "v": None}
_EUR = {"t": 0.0, "v": None}
_PAIRS = {"USDT-TRY": _RATE, "USDC-USDT": _USDC, "USDT-EUR": _EUR}


def _pair(inst, box):
    """Kur (1 dk önbellek). Her turda okunan fiyat listesi kurları da tazeler (note_rates); ayrı istek çoğu zaman gerekmez."""
    if box["v"] is None or time.time() - box["t"] > 60:
        v = float(_get("/api/v5/market/ticker", {"instId": inst}, retries=2, timeout=6)[0]["last"])
        box["v"], box["t"] = v, time.time()
    return box["v"]


def note_rates(rows):
    """Fiyat listesindeki kur pariteleri önbelleğe yazılır: kur için ayrı (bekleten) istek atılmaz, kur hep tazedir."""
    now = time.time()
    for t in rows:
        box = _PAIRS.get(t.get("instId"))
        if box is not None:
            try:
                v = float(t.get("last") or 0)
            except (TypeError, ValueError):
                v = 0
            if v > 0:
                box["v"], box["t"] = v, now


def usdt_try():
    """USDT'nin TL kuru (1 dk önbellek)."""
    return _pair("USDT-TRY", _RATE)


def usdc_usdt():
    """USDC'nin USDT karşılığı (1 dk önbellek)."""
    return _pair("USDC-USDT", _USDC)


def usdt_eur():
    """1 USDT kaç EUR (1 dk önbellek)."""
    return _pair("USDT-EUR", _EUR)


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


VOL = {}  # coin başına kapanmış mumların hacmi (Bekçi'nin hacim patlaması kontrolü)
SPREAD = {}  # son fiyat çekiminde her paritenin alış-satış farkı (oran); Bekçi kayma kontrolünde kullanır
ASK = {}     # anlık en iyi satış fiyatı (TL karşılığı): alım bu fiyattan olur


def prices_tl():
    """TL, USDT ve USDC paritelerinin anlık fiyatı, TL karşılığı olarak (alış-satış farkı ve satış fiyatı da saklanır).
    Tek istek: kurlar aynı listeden alınır. Kuru okunamayan paritenin coinleri listeye girmez (yanlış kurla fiyat verilmez)."""
    rows = tickers(fast=True)
    note_rates(rows)
    k = {}
    for q in config.QUOTES:
        try:
            k[q] = rate(q)
        except Exception as e:
            print("Kur okunamadı:", q, e)
    out = {}
    for t in rows:
        inst, last = t["instId"], float(t.get("last") or 0)
        q = inst.rpartition("-")[2]
        if last and q in k:
            out[inst] = last * k[q]
            bid, ask = float(t.get("bidPx") or 0), float(t.get("askPx") or 0)
            if bid > 0 and ask > 0:
                SPREAD[inst] = (ask - bid) / ask
                ASK[inst] = ask * k[q]
            else:  # tahta boş: eski satış fiyatıyla alım kararı verilmesin (Bekçi "fark yüksek" diye geçirmez)
                SPREAD[inst] = 1.0
                ASK.pop(inst, None)
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
    rows_t = tickers()
    note_rates(rows_t)
    for t in rows_t:
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


def candles(inst, limit=100, retries=3, vol_out=None):
    """Son kapanmış mumlar, eskiden yeniye. Her öğe: (ts_ms, close).
    vol_out verilirse hacimler VOL yerine oraya yazılır (arka plan çekimi: mumlarla birlikte tek adımda yayınlanır)."""
    data = _get("/api/v5/market/candles", {"instId": inst, "bar": config.BAR, "limit": limit}, retries=retries)
    k = tl_factor(inst)  # fiyatlar TL karşılığıyla tutulur
    out = [(int(r[0]) + BAR_MS, float(r[4]) * k) for r in data if r[8] == "1"]  # sadece kapanmış mumlar; zaman = kapanış
    (VOL if vol_out is None else vol_out)[inst] = [float(r[5]) for r in sorted(data, key=lambda r: int(r[0])) if r[8] == "1"]  # hacim (eskiden yeniye)
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
