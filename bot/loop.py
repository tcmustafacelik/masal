"""Kesintisiz çalışma: bot GitHub'da yaklaşık 50 dakika boyunca ~10 saniyede bir tur atar.

Her turda:
  * uygulamadan kaydedilen son ayarları GitHub'dan çeker (ayar ~20 sn'de uygulanır),
  * botun normal turunu çalıştırır (borsadaki korumalar, para hareketleri, bildirimler, mumlar),
  * önemli bir değişiklik olduysa ya da 60 sn geçtiyse kayıtları "data" dalına yazar.
Süre dolunca iş akışı bir sonraki oturumu kendisi başlatır.
"""
import json
import os
import shutil
import subprocess
import time
import traceback

from . import run

DURATION = int(os.environ.get("LOOP_MIN", "50")) * 60
STEP = int(os.environ.get("LOOP_STEP", "10"))
HEARTBEAT = 30


def sh(*args, cwd=None):
    return subprocess.run(args, capture_output=True, text=True, cwd=cwd)


def refresh_settings():
    r = sh("git", "fetch", "-q", "--depth", "1", "origin", "main")
    if r.returncode == 0:
        sh("git", "checkout", "FETCH_HEAD", "--", "docs/ayarlar.json")
        sh("git", "reset", "-q", "docs/ayarlar.json")


def push_data():
    token, repo = os.environ.get("GH_TOKEN"), os.environ.get("GITHUB_REPOSITORY")
    if not token or not repo:
        return False
    d = "/tmp/masal-data"
    shutil.rmtree(d, ignore_errors=True)
    os.makedirs(d + "/docs")
    shutil.copytree("docs/data", d + "/docs/data")
    sh("git", "init", "-q", "-b", "data", cwd=d)
    sh("git", "add", "-A", cwd=d)
    sh("git", "-c", "user.name=masal-bot", "-c", "user.email=masal-bot@users.noreply.github.com",
       "commit", "-qm", "Bot turu " + time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), cwd=d)
    for _ in range(3):
        r = sh("git", "push", "-q", "-f", f"https://x-access-token:{token}@github.com/{repo}.git", "data", cwd=d)
        if r.returncode == 0:
            return True
        time.sleep(3)
    print("Kayıt gönderilemedi:", r.stderr[-300:])
    return False


def weekly_backtest():
    try:
        g = json.load(open("docs/data/backtest.json", encoding="utf-8")).get("generated", 0)
    except Exception:
        g = 0
    if time.time() * 1000 - g > 7 * 86400 * 1000:
        print("Haftalık geçmiş test çalışıyor…")
        sh("python", "-m", "bot.backtest", "30")


def main():
    start, last_sig, last_push, n, errors = time.time(), None, 0, 0, 0
    weekly_backtest()
    while time.time() - start < DURATION:
        t0 = time.time()
        n += 1
        try:
            refresh_settings()
            sig = run.main()
            errors = 0
            if sig != last_sig or time.time() - last_push >= HEARTBEAT:
                if push_data():
                    last_sig, last_push = sig, time.time()
        except Exception:
            errors += 1
            traceback.print_exc()
            if errors >= 5:
                raise  # üst üste hata: oturum biter, bir dakika sonra yenisi başlar
        time.sleep(max(1, STEP - (time.time() - t0)))
    push_data()
    print(f"Oturum bitti: {n} tur.")


if __name__ == "__main__":
    main()
