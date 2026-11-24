"""Kesintisiz çalışma: bot GitHub'da yaklaşık 50 dakika boyunca ~5 saniyede bir tur atar.

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
import threading
import time
import traceback

from . import run

DURATION = int(os.environ.get("LOOP_MIN", "50")) * 60
STEP = int(os.environ.get("LOOP_STEP", "2"))  # tur aralığı (sn)
HEARTBEAT = 10  # sn: fiyatla değişen kâr/zarar en geç bu sürede ekrana gider (işlem olunca hemen gönderilir)


def sh(*args, cwd=None, timeout=None):
    """timeout: ağa çıkan git komutları (fetch/push) takılırsa iş parçacığı sonsuza kadar beklemesin."""
    try:
        return subprocess.run(args, capture_output=True, text=True, cwd=cwd, timeout=timeout)
    except subprocess.TimeoutExpired:
        return subprocess.CompletedProcess(args, 124, "", "zaman aşımı")


def code_rev(ref):
    """Bot kodu ve iş akışı dosyasının sürümü; ikisinden biri değişince oturum yenilenir."""
    a = sh("git", "rev-parse", f"{ref}:bot").stdout.strip()
    b = sh("git", "rev-parse", f"{ref}:.github/workflows/bot.yml").stdout.strip()
    return a + b


_FETCH = {"t": None, "ok": False, "sha": "", "rev": None, "applied": None}


def _fetch_main():
    """Arka plan: ana dalı çeker ve gelen sürümü (commit) bir kez çözer. Tur boyunca "FETCH_HEAD" adı değil bu sabit
    sürüm kullanılır; bir sonraki çekim FETCH_HEAD'i değiştirse de yarısı eski yarısı yeni dosya alınmaz."""
    ok = sh("git", "fetch", "-q", "--depth", "1", "origin", "main", timeout=45).returncode == 0
    sha = sh("git", "rev-parse", "FETCH_HEAD").stdout.strip() if ok else ""
    if ok and sha and sha != _FETCH["sha"]:
        _FETCH["rev"] = code_rev(sha)  # yalnız sürüm değişince hesaplanır
    _FETCH["sha"] = sha or _FETCH["sha"]
    _FETCH["ok"] = bool(ok and sha)


def refresh_settings():
    """Son ayarları çeker; ana daldaki bot kodunun sürümünü ve o sürümün commit kimliğini döndürür: (rev, sha).
    git fetch (0,5-1 sn) arka planda yürür: tur onu beklemez, biten çekimin sonucu bir sonraki turda uygulanır.
    Ana dal değişmediyse (çoğu tur) hiçbir git komutu çalıştırılmaz."""
    rev = sha = None
    th = _FETCH["t"]
    if th is not None and not th.is_alive():
        if _FETCH["ok"]:
            sha = _FETCH["sha"]
            if sha != _FETCH["applied"]:
                ok = sh("git", "checkout", sha, "--", "docs/ayarlar.json").returncode == 0
                sh("git", "reset", "-q", "docs/ayarlar.json")
                if ok:
                    _FETCH["applied"] = sha
            rev = _FETCH["rev"]
        _FETCH["t"] = None
    if _FETCH["t"] is None:
        _FETCH["t"] = threading.Thread(target=_fetch_main, daemon=True)
        _FETCH["t"].start()
    return rev, sha


def read_json(path):
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return {}


def custom_backtest():
    """Uygulamadan istenen "bu ayarlarla test et" isteği varsa çalıştırır."""
    req = (read_json("docs/ayarlar.json").get("test_req") or {})
    done = (read_json("docs/data/backtest.json").get("custom") or {}).get("ts")
    if req.get("ts") and req.get("ts") != done and req.get("ts") != getattr(custom_backtest, "started", None):
        if start_bt("--custom"):
            custom_backtest.started = req["ts"]
            print("İstenen geçmiş test arka planda başladı")
    return False


def notifier():
    from . import settings
    from .notify import Notifier
    return Notifier(settings.load())


def recovery_note():
    """Bot bir süre çalışmadıysa yeniden başladığını bildirir."""
    upd = read_json("docs/data/summary.json").get("updated") or 0
    gap = (time.time() * 1000 - upd) / 60000
    if upd and gap > 5:
        n = notifier()
        n.add("alerts", "Bot yeniden çalışıyor", f"Bot {gap:.0f} dakika sessiz kaldıktan sonra yeniden başladı.", 4,
              ["white_check_mark"])
        n.flush()


_PUSH = {"t": None, "ok": True}


def _push_dir(d, token, repo):
    sh("git", "init", "-q", "-b", "data", cwd=d)
    sh("git", "add", "-A", cwd=d)
    sh("git", "-c", "user.name=masal-bot", "-c", "user.email=masal-bot@users.noreply.github.com",
       "commit", "-qm", "Bot turu " + time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), cwd=d)
    ok = False
    for _ in range(3):
        r = sh("git", "push", "-q", "-f", f"https://x-access-token:{token}@github.com/{repo}.git", "data", cwd=d, timeout=90)
        if r.returncode == 0:
            ok = True
            break
        time.sleep(3)
    if not ok:
        print("Kayıt gönderilemedi:", r.stderr[-300:])
    shutil.rmtree(d, ignore_errors=True)
    _PUSH["ok"] = ok


def push_data(wait=False):
    """Kayıtların o anki kopyası alınır, gönderim arka planda yapılır (tur 1-2 sn beklemesin).
    Önceki gönderim sürüyorsa bu tur atlanır, bir sonraki turda yeniden denenir."""
    token, repo = os.environ.get("GH_TOKEN"), os.environ.get("GITHUB_REPOSITORY")
    if not token or not repo:
        return False
    th = _PUSH["t"]
    if th is not None and th.is_alive():
        if not wait:
            return False
        th.join()
    d = f"/tmp/masal-data-{time.time_ns()}"
    os.makedirs(d + "/docs")
    shutil.copytree("docs/data", d + "/docs/data", ignore=shutil.ignore_patterns("*.tmp"))
    if wait:
        _push_dir(d, token, repo)
        return _PUSH["ok"]
    _PUSH["t"] = threading.Thread(target=_push_dir, args=(d, token, repo), daemon=True)
    _PUSH["t"].start()
    return True


BT = None  # arka planda çalışan geçmiş test (bot turlarını bekletmesin)


def start_bt(*args):
    global BT
    if BT is None or BT.poll() is not None:
        BT = subprocess.Popen(["python", "-m", "bot.backtest", "30", *args])
        return True
    return False


def bt_finished():
    """Arka plandaki test bittiyse True döner (sonuç hemen kaydedilsin diye)."""
    global BT
    if BT is not None and BT.poll() is not None:
        BT = None
        return True
    return False


def weekly_backtest():
    try:
        g = json.load(open("docs/data/backtest.json", encoding="utf-8")).get("generated", 0)
    except Exception:
        g = 0
    if time.time() * 1000 - g > 7 * 86400 * 1000:
        print("Haftalık geçmiş test arka planda başladı")
        start_bt()


def flush_desks():
    """Yeniden başlamadan / oturum bitmeden önce: aktarım işleri ve gerçek masaların son hâli kayda yazılır."""
    try:
        from . import kaldirac_gercek, meme_gercek, transfer
        transfer.quiesce()
        a, b = kaldirac_gercek.quiesce(), meme_gercek.quiesce()
        st = run.load_state()
        if st.get("xfer") is not None:
            q = transfer._NoteQ()
            transfer._merge_jobs(st["xfer"], q)
        if a is not None:
            st["levr"] = a
        if b is not None:
            st["memer"] = b
        run.save_state(st)
        if st.get("xfer") is not None and q.items:
            n = notifier()
            for a, k in q.items:
                n.add(*a, **k)
            n.flush()
    except Exception as e:
        print("Masalar kaydedilemedi:", e)
    try:
        from .notify import drain
        drain()
    except Exception as e:
        print("Bildirimler gönderilemedi:", e)


def resume_desks():
    try:
        from . import kaldirac_gercek, meme_gercek
        kaldirac_gercek.resume()
        meme_gercek.resume()
    except Exception as e:
        print("Masalar devam ettirilemedi:", e)


def main():
    from .notify import heartbeat
    start, last_sig, last_push, n, errors, last_hb = float(os.environ.get("MASAL_T0") or time.time()), None, 0, 0, 0, 0
    start_rev = os.environ.get("MASAL_REV") or code_rev("HEAD")
    try:
        recovery_note()
    except Exception as e:
        print("Yeniden başlama notu gönderilemedi:", e)
    weekly_backtest()
    while time.time() - start < DURATION:
        t0 = time.time()
        n += 1
        try:
            rev, sha = refresh_settings()
            if rev and sha and start_rev and rev != start_rev:
                wf = lambda r: sh("git", "rev-parse", f"{r}:.github/workflows/bot.yml").stdout.strip()
                if wf(sha) != wf("HEAD"):
                    print("İş akışı güncellendi; oturum yenisiyle değiştiriliyor.")
                    break
                # yalnız bot kodu değişti: aynı oturumda birkaç saniyede yeniden başla (yeni oturumu 1 dk beklemeden)
                import sys
                good = os.environ.get("MASAL_SHA") or "HEAD"  # şu an çalışan (açılabildiği bilinen) kodun sürümü
                ok = sh("git", "checkout", sha, "--", "bot").returncode == 0
                sh("git", "reset", "-q", "bot")
                # yeni kod açılabiliyor mu? açılamıyorsa eski kodla devam (bozuk gönderim botu kilitlemesin)
                if ok and sh(sys.executable, "-c", "import bot.loop, bot.run, bot.transfer, bot.dust, bot.money, bot.meme, bot.meme_gercek, bot.meme_aktar, bot.kaldirac, bot.kaldirac_gercek", timeout=120).returncode == 0:
                    try:
                        flush_desks()
                        push_data(wait=True)
                        os.environ["MASAL_T0"], os.environ["MASAL_REV"], os.environ["MASAL_SHA"] = str(start), rev, sha
                        print("Bot kodu güncellendi; aynı oturumda yeniden başlatılıyor.", flush=True)
                        os.execv(sys.executable, [sys.executable, "-m", "bot.loop"])
                    except Exception:
                        if good == "HEAD":
                            os.environ.pop("MASAL_SHA", None)
                        else:
                            os.environ["MASAL_SHA"] = good
                        sh("git", "checkout", good, "--", "bot")  # yeniden başlanamadı: diskteki kod da çalışan sürüme dönsün
                        sh("git", "reset", "-q", "bot")
                        resume_desks()
                        raise
                else:
                    # diskte, çalışan sürüm geri yüklenir (ilk indirilen HEAD değil: oturum içinde daha önce güncellenmiş olabilir)
                    sh("git", "checkout", good, "--", "bot")
                    sh("git", "reset", "-q", "bot")
                    print("Yeni bot kodu açılamadı; eski kodla devam ediliyor.")
                    start_rev = rev
            if time.time() - last_hb > 3 * 60:  # nabız 3 dk'da bir; bot 10 dk susarsa telefona uyarı düşer
                hb_n = notifier()  # ayarlar ana turda okunur (arka planda okunursa config tur ortasında değişebilirdi)

                def _hb(n_=hb_n):
                    try:
                        heartbeat(n_)
                    except Exception as e:
                        print("Nabız kurulamadı:", e)
                threading.Thread(target=_hb, daemon=True).start()  # ntfy yavaşsa tur beklemesin
                last_hb = time.time()
            custom_backtest()
            if bt_finished():
                last_sig = None  # test sonucunu hemen kaydet
            sig = run.main()
            errors = 0
            if not _PUSH["ok"]:  # arka plandaki son gönderim başarısızsa yeniden gönder
                last_sig, _PUSH["ok"] = None, True
            if sig != last_sig or time.time() - last_push >= HEARTBEAT:
                if push_data():
                    last_sig, last_push = sig, time.time()
        except Exception:
            errors += 1
            traceback.print_exc()
            if errors >= 5:
                flush_desks()
                push_data(wait=True)  # bitmeden önce son kayıt mutlaka gönderilsin
                raise  # üst üste hata: oturum biter, bir dakika sonra yenisi başlar
        took = time.time() - t0
        run.PERF["turn"] = round(took, 2)
        if took > STEP:
            print(f"Uzun tur: {took:.1f} sn")
        time.sleep(max(0.2, STEP - took))
    flush_desks()
    push_data(wait=True)
    print(f"Oturum bitti: {n} tur.")


if __name__ == "__main__":
    main()
