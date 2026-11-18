# Masal

Kişisel otomasyon sistemi. İlk modül: **OKX TR kripto botu**.

- `bot/` — bot motoru (Python; stratejiler, risk kuralları, gerçek emir modülü)
- `src/` — uygulamanın TypeScript kaynağı; `npm run build` ile `docs/app.js` üretilir
- `docs/` — telefondan açılan uygulama (panel + Ayarlar ekranı)
- `docs/ayarlar.json` — uygulamadaki Ayarlar ekranının kaydettiği ayarlar
- `data` dalı — botun ürettiği veriler (özet, işlem geçmişi, geçmiş test)
- `.github/workflows/bot.yml` — botu kesintisiz çalıştırır (~10 sn'de bir tur, 50 dk'lık oturumlar zincir hâlinde; yedek zamanlayıcı 5 dk)
- `.github/workflows/denetim.yml` — uygulama kodunun tür denetimi ve derlemenin güncel olduğunu kontrol eder
- `tools/surum.py` — yeni sürüm yayınlama

## Tek seferlik kurulum

1. **Settings → Secrets and variables → Actions → Secrets:** `OKX_API_KEY`, `OKX_API_SECRET`, `OKX_API_PASSPHRASE`
   (OKX TR anahtarı: sadece Okuma + Al-Sat; çekim izni YOK).
2. **Settings → Pages:** Branch `main`, klasör `/docs`.
3. **Fine-grained token** (yalnız bu depo, Contents: Read and write) oluşturup uygulamada Ayarlar → GitHub bağlantısı'na yapıştır.

Bundan sonra her şey uygulamadaki **Ayarlar** ekranından yönetilir.
