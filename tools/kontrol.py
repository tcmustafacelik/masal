"""OKX TR ve OKX Global anahtar kontrolü. Sadece okur; işlem/çekim yapmaz.
Depo herkese açık olduğu için çıktıda bakiye ve adres gizlenir (yalnız var/yok, izinler, ağlar)."""
import base64, hashlib, hmac, json, os, time, urllib.request
from datetime import datetime, timezone

def req(base, key, sec, pas, path):
    now = datetime.now(timezone.utc)
    ts = now.strftime("%Y-%m-%dT%H:%M:%S.") + f"{now.microsecond // 1000:03d}Z"
    sign = base64.b64encode(hmac.new(sec.encode(), (ts + "GET" + path).encode(), hashlib.sha256).digest()).decode()
    r = urllib.request.Request(base + path, headers={"OK-ACCESS-KEY": key, "OK-ACCESS-SIGN": sign, "OK-ACCESS-TIMESTAMP": ts,
                                                      "OK-ACCESS-PASSPHRASE": pas, "User-Agent": "masal/1.0"})
    try:
        with urllib.request.urlopen(r, timeout=15) as f:
            d = json.load(f)
    except urllib.error.HTTPError as e:
        d = json.loads(e.read() or b"{}")
    if d.get("code") != "0":
        raise RuntimeError(f"{d.get('code')}: {d.get('msg')}")
    return d["data"]

def mask(a):
    return a[:4] + "…" + a[-4:] if len(a) > 10 else "…"

def check(name, base, pre):
    key, sec, pas = (os.environ.get(pre + s, "") for s in ("_API_KEY", "_API_SECRET", "_API_PASSPHRASE"))
    print(f"\n=== {name} ({base}) ===")
    if not (key and sec and pas):
        print("ANAHTAR EKSİK:", [pre + s for s, v in zip(("_API_KEY", "_API_SECRET", "_API_PASSPHRASE"), (key, sec, pas)) if not v]); return
    try:
        c = req(base, key, sec, pas, "/api/v5/account/config")[0]
        print("Bağlantı: TAMAM · izinler:", c.get("perm"), "· IP bağlı:", "evet" if c.get("ip") else "hayır",
              "· hesap modu:", c.get("acctLv"))
    except Exception as e:
        print("Bağlantı HATASI:", e); return
    for p, lbl in (("/api/v5/account/balance", "İşlem hesabı"), ("/api/v5/asset/balances", "Fon hesabı")):
        try:
            d = req(base, key, sec, pas, p)
            rows = d[0].get("details", []) if p.endswith("account/balance") else d
            n = [x["ccy"] for x in rows if float(x.get("bal") or x.get("eq") or 0) > 0]
            usdt = sum(float(x.get("availBal") or 0) for x in rows if x["ccy"] == "USDT")
            if lbl == "Fon hesabı":
                print("  fon ayrıntı:", [x for x in rows if x["ccy"] == "USDT"])
            print(f"{lbl}: okunuyor · {len(n)} varlık var · boş USDT {usdt:.2f}")
        except Exception as e:
            print(f"{lbl}: HATA {e}")
    for pth in ("/api/v5/account/max-withdrawal?ccy=USDT", "/api/v5/asset/non-tradable-assets?ccy=USDT"):
        try:
            print("  ", pth.split("?")[0].split("/")[-1], req(base, key, sec, pas, pth)[:2])
        except Exception as e:
            print("  ", pth.split("?")[0].split("/")[-1], "HATA", e)
    try:
        cs = req(base, key, sec, pas, "/api/v5/asset/currencies?ccy=USDT")
        print("   kota:", {k: cs[0].get(k) for k in ("wdQuota", "usedWdQuota", "usedWdQuotaUnit")} if cs else None)
    except Exception as e:
        print("   kota HATA", e)
    try:
        d = req(base, key, sec, pas, "/api/v5/asset/deposit-address?ccy=USDT")
        print("USDT yatırma adresleri:", ", ".join(f"{x['chain']}={mask(x['addr'])}" for x in d[:8]))
    except Exception as e:
        print("Yatırma adresi: HATA", e)
    try:
        d = req(base, key, sec, pas, "/api/v5/asset/currencies?ccy=USDT")
        print("USDT çekim ağları (ücret):", ", ".join(f"{x['chain']}({x.get('fee') or x.get('minFee')})" for x in d if x.get("canWd")))
    except Exception as e:
        print("Çekim ağları: HATA", e)

def moves(name, base, pre):
    key, sec, pas = (os.environ.get(pre + s, "") for s in ("_API_KEY", "_API_SECRET", "_API_PASSPHRASE"))
    if not key:
        return
    for p, lbl in (("/api/v5/asset/withdrawal-history?limit=3", "Son çekimler"), ("/api/v5/asset/deposit-history?ccy=USDT&limit=3", "Son yatırmalar")):
        try:
            rows = req(base, key, sec, pas, p)
            print(f"{name} {lbl}:", "; ".join(f"{x.get('amt')} {x.get('ccy')} · {x.get('chain')} · durum {x.get('state')} · {time.strftime('%d.%m %H:%M', time.gmtime(int(x.get('ts'))/1000+3*3600))}" for x in rows) or "yok")
        except Exception as e:
            print(f"{name} {lbl}: HATA {e}")


check("OKX TR", "https://tr.okx.com", "OKX")
check("OKX Global", "https://www.okx.com", "OKXG")
moves("OKX TR", "https://tr.okx.com", "OKX")
moves("OKX Global", "https://www.okx.com", "OKXG")
