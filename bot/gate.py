"""Zamanlanmış tetiklemede botun bu sefer çalışıp çalışmayacağına karar verir.

GitHub her 5 dakikada bir uyandırır; bot, uygulamada seçilen sıklığa (dakika)
göre ya tam tur yapar ya da hiçbir şey yapmadan hemen kapanır.
Sadece standart kütüphane kullanır (paket kurulumundan önce çalışır).
"""
import json, os, sys, time

ALLOWED = (10, 15, 30, 60)


def decide(event, schedule, now_ms):
    if event != "schedule" or schedule == "40 2 * * 1":
        return True, "elle/ayar/haftalık tetikleme"
    try:
        iv = int(json.load(open("docs/ayarlar.json", encoding="utf-8")).get("interval_min", 10))
    except Exception:
        iv = 10
    if iv not in ALLOWED:
        iv = 10
    try:
        last = int(json.load(open("docs/data/summary.json", encoding="utf-8")).get("updated") or 0)
    except Exception:
        last = 0
    gap = (now_ms - last) / 60000
    # GitHub zamanlayıcısı birkaç dakika kayabildiği için 2,5 dk tolerans
    return gap >= iv - 2.5, f"son turdan {gap:.1f} dk geçti, sıklık {iv} dk"


if __name__ == "__main__":
    ok, why = decide(os.environ.get("EVENT", ""), os.environ.get("SCHEDULE", ""), int(time.time() * 1000))
    print(("Çalışıyor: " if ok else "Atlandı: ") + why)
    out = os.environ.get("GITHUB_OUTPUT")
    if out:
        with open(out, "a") as f:
            f.write(f"run={'true' if ok else 'false'}\n")
    sys.exit(0)
