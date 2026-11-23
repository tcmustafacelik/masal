"""Tek seferlik: OKX Global'de USDT ile SOL alır ve MEME sıcak cüzdanına (Solana ağı) gönderir.
Elle çalıştırılır. Depo herkese açık olduğu için çıktıda tutar ve adres gösterilmez."""
import json, math, os, sys, time
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from bot import transfer

USD = float(os.environ.get("MEME_USD") or 15)
CID = os.environ.get("MEME_CID") or "memesol1"
addr = json.load(open("docs/ayarlar.json"))["meme"]["wallet"]
g = transfer.Ex("https://www.okx.com", "OKXG")
assert g.ok and addr, "anahtar ya da cüzdan adresi yok"
for w in g.req("GET", "/api/v5/asset/withdrawal-history?ccy=SOL"):
    if w.get("clientId") == CID:
        print("Bu gönderim zaten yapılmış; durum:", w.get("state")); sys.exit(0)
px = float(json.load(__import__("urllib.request").request.urlopen("https://www.okx.com/api/v5/market/ticker?instId=SOL-USDT"))["data"][0]["last"])
if (g.funding("SOL") + g.trading("SOL")) * px >= USD * 0.8:
    print("SOL zaten alınmış; yeniden alınmadı")  # önceki denemede alınıp bekleyen SOL gönderilir
else:
    if g.funding("USDT") >= USD:
        g.move("USDT", USD, transfer.FUNDING, transfer.TRADING)
    o = g.market("SOL-USDT", "buy", f"{USD:.2f}", quote=True)
    print("SOL alım emri verildi:", o.get("sCode"), o.get("sMsg") or "")
    time.sleep(3)
t = g.trading("SOL")
if t > 0:
    g.move("SOL", t, transfer.TRADING, transfer.FUNDING)
time.sleep(1)
chain = fee = mn = None
for c in g.req("GET", "/api/v5/asset/currencies?ccy=SOL"):
    if c["chain"].lower() in ("sol-solana", "sol-sol") or "solana" in c["chain"].lower():
        if c.get("canWd"):
            chain, fee, mn = c["chain"], float(c.get("fee") or c.get("minFee") or 0), float(c.get("minWd") or 0)
            break
if not chain:
    sys.exit("Solana ağında SOL çekimi kapalı")
have = g.funding("SOL")
amt = math.floor((have - fee) * 1e6) / 1e6
print("Ağ:", chain, "· ücret", fee, "SOL")
if amt < mn:
    sys.exit("tutar en az çekimin altında")
body = {"ccy": "SOL", "amt": f"{amt:f}", "dest": "4", "toAddr": addr, "chain": chain,
        "fee": f"{fee:f}".rstrip("0").rstrip("."), "clientId": CID}
try:
    r = g.req("POST", "/api/v5/asset/withdrawal", body)[0]
except RuntimeError as e:
    print("İlk deneme:", e)
    body["rcvrInfo"] = {"walletType": "private"}
    r = g.req("POST", "/api/v5/asset/withdrawal", body)[0]
print("GÖNDERİLDİ · çekim no:", r.get("wdId"))
