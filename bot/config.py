"""Botun bütün ayarları tek yerde. Değiştirmek için sadece bu dosyayı düzenle."""

BASE_URL = "https://tr.okx.com"

# Sanal başlangıç bakiyesi (her strateji kendi kasasıyla yarışır)
START_CASH = 10_000.0

# İşlem maliyeti: komisyon + kayma payı (tek yön). OKX TR alıcı komisyonu ~%0,22.
FEE_RATE = 0.0025
SLIPPAGE = 0.001

# Hesap TL ile tutulur; coinler USDT paritesinden alınıp satılır (kullanıcı isteği: derin piyasa, düşük fark).
# Bütün tutarlar ve fiyatlar uygulamada TL karşılığıyla gösterilir (USDT fiyatı x USDT-TRY kuru).
CASH = "TRY"
QUOTE = "USDT"             # yeni alımların paritesi; uygulamadaki Ayarlar'dan seçilir
QUOTES = ("TRY", "USDT", "USDC", "EUR")
MIN_VOLUME_TRY = 100_000   # günlük en az bu kadar TL karşılığı hacim
VIRTUAL = False  # sanal karşılaştırma stratejileri kapalı (uygulamada gizli; veri ve tur süresi küçülür)
MAX_SYMBOLS = 60           # hacmi en yüksek 60 coin izlenir (kullanıcı seçimi)
MAX_SPREAD = 0.008  # alış-satış farkı %0,8'den büyük (sığ) coinler alınmaz
EXCLUDED = {"USDT", "USDC", "XAUT", "PAXG", "EURT", "DAI", "FDUSD", "TUSD", "PYUSD", "USDG", "RLUSD", "USDE",
            "EURC", "EUROC", "USD1", "BUSD", "USDP", "USDD", "TRY", "EUR", "WBTC", "STETH", "WETH", "BETH", "OKSOL"}

import os as _os
BAR_MIN = int(_os.environ.get("MASAL_BAR_MIN", "15"))  # mum süresi (dakika): kararlar bu aralıkla verilir
BAR = {15: "15m", 30: "30m", 60: "1H"}[BAR_MIN]
BPH = 60 // BAR_MIN  # saatteki mum sayısı; göstergeler saat cinsinden aynı kalsın diye pencereler bununla çarpılır

# Risk kuralları (dengeli profil)
RISK = {
    "trade_size": 1_000.0,      # işlem başına en fazla TL
    "max_positions": 5,         # aynı anda en fazla açık pozisyon
    "stop_loss": 0.05,          # işlem başına zarar sınırı %5
    "daily_loss_limit": 300.0,  # gün içi toplam kayıp bu tutarı geçerse o gün yeni işlem yok
    "kill_switch": 8_500.0,     # toplam bakiye bunun altına inerse her şey kapanır, bot durur
}

STRATEGIES = {
    "dip": {
        "name": "Düşüşte al",
        "sma": 20 * BPH, "rsi": 14, "dip_pct": 0.03, "rsi_max": 35,
        "take_profit": 0.04, "max_hold_bars": 48 * BPH,
    },
    "trend": {
        "name": "Trend takibi",
        "fast": 12 * BPH, "slow": 26 * BPH, "base": 50 * BPH, "trailing": 0.04,
    },
    "grid": {
        "name": "Kademeli",
        "step": 0.02, "lot": 400.0, "max_lots": 3, "lot_tp": 0.025, "max_coins": 3, "max_use": 0.4,
        "stop": 0.07,  # ortalama maliyetin %7 altında tüm kademeler satılır
    },
}

TZ_OFFSET_HOURS = 3  # Türkiye saati
