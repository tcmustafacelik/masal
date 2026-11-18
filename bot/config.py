"""Botun bütün ayarları tek yerde. Değiştirmek için sadece bu dosyayı düzenle."""

BASE_URL = "https://tr.okx.com"

# Sanal başlangıç bakiyesi (her strateji kendi kasasıyla yarışır)
START_CASH = 10_000.0

# İşlem maliyeti: komisyon + kayma payı (tek yön). OKX TR alıcı komisyonu ~%0,22.
FEE_RATE = 0.0025
SLIPPAGE = 0.001

# Hangi coinler: TL paritesinde, 24 saatlik hacmi yeterli olanlar
QUOTE = "TRY"
MIN_VOLUME_TRY = 250_000   # günlük en az bu kadar TL hacim
MAX_SYMBOLS = 24
MAX_SPREAD = 0.008  # alış-satış farkı %0,8'den büyük (sığ) coinler alınmaz
EXCLUDED = {"USDT", "USDC", "XAUT", "PAXG", "EURT", "DAI", "FDUSD", "TUSD"}

BAR = "1H"

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
        "sma": 20, "rsi": 14, "dip_pct": 0.03, "rsi_max": 35,
        "take_profit": 0.04, "max_hold_bars": 48,
    },
    "trend": {
        "name": "Trend takibi",
        "fast": 12, "slow": 26, "base": 50, "trailing": 0.04,
    },
    "grid": {
        "name": "Kademeli",
        "step": 0.02, "lot": 400.0, "max_lots": 3, "lot_tp": 0.025, "max_coins": 3, "max_use": 0.4,
        "stop": 0.07,  # ortalama maliyetin %7 altında tüm kademeler satılır
    },
}

TZ_OFFSET_HOURS = 3  # Türkiye saati
