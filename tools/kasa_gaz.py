"""Tek seferlik: KASA'nın Arbitrum'da işlem ücreti (gaz) için birazcık ETH'si olsun diye OKX Global'den
KASA'ya en az çekim kadar ETH gönderir. KASA'nın anahtarı sistemde yoktur; parayı KASA'dan sen gönderirsin."""
import json, math, os, sys, time, urllib.request
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from bot import transfer

g = transfer.Ex("https://www.okx.com", "OKXG")
CID = "kasagaz1"
for w in g.req("GET", "/api/v5/asset/withdrawal-history?ccy=ETH"):
    if w.get("clientId") == CID:
        print("Zaten gönderilmiş; durum:", w.get("state")); sys.exit(0)
chain = None
for c in g.req("GET", "/api/v5/asset/currencies?ccy=ETH"):
    if "arbitrum one" in c["chain"].lower() and c.get("canWd"):
        chain, fee, mn = c["chain"], float(c.get("fee") or c.get("minFee") or 0), float(c.get("minWd") or 0)
        break
if not chain:
    sys.exit("Arbitrum'da ETH çekimi kapalı")
px = float(json.load(urllib.request.urlopen(urllib.request.Request("https://www.okx.com/api/v5/market/ticker?instId=ETH-USDT", headers={"User-Agent": "masal/1.0"})))["data"][0]["last"])
amt = max(mn, 0.0003)
need = amt + fee
print(f"Ağ {chain} · en az {mn} · ücret {fee} ETH · yaklaşık ${need * px:.2f}")
have = g.funding("ETH") + g.trading("ETH")
if have < need:
    usd = max(1.0, (need - have) * px * 1.06)
    tr, fu = g.trading("USDT"), g.funding("USDT")
    print("USDT işlem hesabında yeterli:", tr >= usd, "· fon hesabında yeterli:", fu >= usd - tr)
    if tr < usd:
        g.move("USDT", min(fu, usd - tr + 0.01), transfer.FUNDING, transfer.TRADING)
        time.sleep(1)
    o = g.market("ETH-USDT", "buy", f"{usd:.2f}", quote=True)
    print("ETH alındı:", o.get("sCode"))
    time.sleep(3)
t = g.trading("ETH")
if t >= 0.0001:
    try:
        g.move("ETH", t, transfer.TRADING, transfer.FUNDING)
    except RuntimeError as e:
        print("Aktarım atlandı:", e)
time.sleep(1)
amt = math.floor((g.funding("ETH") - fee) * 1e6) / 1e6
body = {"ccy": "ETH", "amt": f"{amt:f}", "dest": "4", "toAddr": transfer.KASA, "chain": chain,
        "fee": f"{fee:f}".rstrip("0").rstrip("."), "clientId": CID}
try:
    r = g.req("POST", "/api/v5/asset/withdrawal", body)[0]
except RuntimeError as e:
    print("İlk deneme:", e)
    body["rcvrInfo"] = {"walletType": "private"}
    r = g.req("POST", "/api/v5/asset/withdrawal", body)[0]
print("GÖNDERİLDİ · çekim no:", r.get("wdId"))
