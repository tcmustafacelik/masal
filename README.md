# Masal

Kişisel otomasyon sistemi. İlk modül: **OKX TR kripto botu**.

- `bot/` — bot motoru (stratejiler, risk kuralları, gerçek emir modülü)
- `docs/` — telefondan açılan kontrol paneli ve bot verileri
- `.github/workflows/bot.yml` — botu saatte bir çalıştıran zamanlayıcı

## Ayarlar (GitHub → Settings → Secrets and variables → Actions)

| Tür | Ad | Açıklama |
|---|---|---|
| Secret | `OKX_API_KEY`, `OKX_API_SECRET`, `OKX_API_PASSPHRASE` | OKX TR API anahtarı (sadece Okuma + Al-Sat, çekim izni YOK) |
| Variable | `MASAL_BUDGET` | Gerçek hesapta kullanılacak bütçe (TL). Boşsa gerçek modül kapalı. |
| Variable | `MASAL_LIVE` | `1` ise gerçek emir gönderilir; başka her değerde deneme modu. |
| Variable | `MASAL_STRATEGY` | `grid` (Kademeli, varsayılan), `dip` veya `trend` |

**Acil durdurma:** `MASAL_LIVE` değişkenini `0` yap ya da Actions → Masal bot → Disable workflow.
