# Masal

Kişisel otomasyon sistemi. İlk modül: **OKX TR kripto botu**.

- `bot/` — bot motoru (stratejiler, risk kuralları, gerçek emir modülü)
- `docs/` — telefondan açılan uygulama (panel + Ayarlar ekranı) ve bot verileri
- `docs/ayarlar.json` — uygulamadaki Ayarlar ekranının kaydettiği ayarlar
- `.github/workflows/bot.yml` — botu saatte bir ve ayarlar kaydedilince çalıştırır

## Tek seferlik kurulum

1. **Settings → Secrets and variables → Actions → Secrets:** `OKX_API_KEY`, `OKX_API_SECRET`, `OKX_API_PASSPHRASE`
   (OKX TR anahtarı: sadece Okuma + Al-Sat; çekim izni YOK).
2. **Settings → Pages:** Branch `main`, klasör `/docs`.
3. **Fine-grained token** (yalnız bu depo, Contents: Read and write) oluşturup uygulamada Ayarlar → GitHub bağlantısı'na yapıştır.

Bundan sonra her şey uygulamadaki **Ayarlar** ekranından yönetilir.
