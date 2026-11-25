"""Telefona bildirim: ntfy.sh üzerinden. Konu adı ayarlarda şifreli saklanır."""
import json
import os
import re
import threading
import time
import urllib.request

from . import vault


_TOK = re.compile(r"[+−-]?%?\d[\d.,:]*%?|\b[A-Z][A-Z0-9]{1,11}\b")
_EN = None


_CAPS = {"KAPAT": "CLOSE", "KISA": "SHORT", "UZUN": "LONG"}


def _en_num(v):
    if v in _CAPS:
        return _CAPS[v]
    if re.fullmatch(r"\d+\.", v):  # sıra sayısı: "2." → "2" (İngilizcede "step 2")
        return v[:-1]
    if re.search(r"\.(\d{1,2}|\d{4,})(?!\d)", v):  # tarih (19.11), sayı değil
        return v
    if not re.fullmatch(r"[+−-]?%?[\d.,]+%?", v) or ":" in v:
        return v
    pct = "%" in v
    x = v.replace("%", "").replace(".", "\x01").replace(",", ".").replace("\x01", ",")
    return x + "%" if pct else x


def to_en(text):
    """Uygulamayla aynı sözlük (docs/en.json) ve aynı kalıp yöntemiyle İngilizceye çevirir; bulunamazsa aynen bırakır."""
    global _EN
    if _EN is None:
        try:
            with open(os.path.join(os.path.dirname(__file__), "..", "docs", "en.json"), encoding="utf-8") as f:
                _EN = json.load(f)
        except Exception:
            _EN = {}
    out = []
    for line in str(text).split("\n"):
        core = " ".join(line.split())
        if core in _EN:
            out.append(_EN[core])
            continue
        vals = []
        key = _TOK.sub(lambda m: (vals.append(m.group(0)), "{%d}" % (len(vals) - 1))[1], core)
        if re.match(r"(AL|SAT) [A-Z0-9%]", core) and vals:  # "AL CHIRP 0.038 SOL" → "BUY CHIRP…" (satır başındaki işlem sözcüğü)
            vals[0] = "BUY" if vals[0] == "AL" else "SELL"
        e = (_EN.get(key + "#ord") if any(re.fullmatch(r"\d+\.", v) for v in vals) else None) or _EN.get(key)
        out.append(re.sub(r"\{(\d+)\}", lambda m: _en_num(vals[int(m.group(1))]), e) if e is not None else line)
    return "\n".join(out)


class Notifier:
    def __init__(self, S):
        n = S.get("notify") or {}
        self.on = bool(n.get("enabled"))
        self.cats = {"trades": n.get("trades", True), "alerts": n.get("alerts", True), "daily": n.get("daily", True), "money": n.get("money", True)}
        self.topic = ""
        if self.on and n.get("topic"):
            try:
                self.topic = vault.unseal(n["topic"]) if vault.is_sealed(n["topic"]) else n["topic"]
            except ValueError as e:
                print("Bildirim konusu çözülemedi:", e)
        self.queue = []
        self.en = S.get("lang") == "en"
        try:
            self.daily_hour = min(23, max(0, int(n.get("daily_hour", 21))))
        except (TypeError, ValueError):
            self.daily_hour = 21

    def add(self, cat, title, message, priority=3, tags=None):
        if self.on and self.topic and self.cats.get(cat, True):
            if self.en:
                title, message = to_en(title), to_en(message)
            # Öncelik en az 4: telefon uykudayken (Doze) normal öncelikli bildirimler uygulama açılana kadar
            # bekletilebiliyor; yüksek öncelik anında iletilir. Günlük özet acil değil, normal kalır.
            if cat != "daily":
                priority = max(priority, 4)
            self.queue.append({"topic": self.topic, "title": title, "message": message,
                               "priority": priority, "tags": tags or []})

    def flush(self):
        """Bildirimler arka planda sırayla gönderilir: ntfy yavaşsa bot turu beklemez."""
        if self.queue:
            with _SLOCK:  # kuyruğa ekleme ve "gönderici çalışıyor mu" kontrolü tek adımda (bildirim kuyrukta unutulmasın)
                _OUTQ.extend(self.queue[:15])  # bir turda en fazla 15 bildirim
                _start_sender()
        self.queue = []


_OUTQ = []
_SND = {"t": None}
_SLOCK = threading.Lock()


def _sender(own=True):
    while True:
        with _SLOCK:
            if not _OUTQ:
                if own:
                    _SND["t"] = None  # çıkış kilit altında işaretlenir: bu andan sonra eklenen bildirim yeni gönderici başlatır
                return
            m = _OUTQ.pop(0)
        for attempt in (0, 1):  # geçici ağ hatasında bildirim kaybolmasın: bir kez daha denenir (sıra bozulmaz)
            try:
                req = urllib.request.Request("https://ntfy.sh/", data=json.dumps(m).encode(), method="POST",
                                             headers={"Content-Type": "application/json", "User-Agent": "masal/1.0"})
                urllib.request.urlopen(req, timeout=10).read()
                break
            except Exception as e:
                if attempt:
                    print("Bildirim gönderilemedi:", e)
                else:
                    time.sleep(2)


def _start_sender():
    """_SLOCK tutulurken çağrılır."""
    t = _SND["t"]
    if t is None or not t.is_alive():
        _SND["t"] = threading.Thread(target=_sender, daemon=True)
        _SND["t"].start()


def drain(timeout=15):
    """Yeniden başlamadan önce bekleyen bildirimler gönderilsin."""
    t = _SND["t"]
    if t is not None and t.is_alive():
        t.join(timeout)
    if _OUTQ:
        _sender(own=False)


HB_ID = "masal-nabiz"


def heartbeat(n, minutes=10):
    """Ölü adam düğmesi: ntfy'da ileri tarihli bir "Bot durdu" mesajı bekletilir.
    Bot çalıştıkça bu mesaj silinip yeniden kurulur; bot durursa süre dolunca telefona düşer."""
    if not n.topic:
        return True
    try:
        urllib.request.urlopen(urllib.request.Request(f"https://ntfy.sh/{n.topic}/{HB_ID}", method="DELETE",
                                                      headers={"User-Agent": "masal/1.0"}), timeout=10).read()
    except Exception as e:
        # silinemediyse bekleyen eski "Bot durdu" mesajı süresi dolunca düşer (yanlış alarm): hemen yeniden denenir
        print("Nabız silinemedi:", e)
        return False
    if not (n.on and n.cats.get("alerts", True)):
        return True
    m = {"topic": n.topic, "title": "Bot durdu", "priority": 5, "tags": ["rotating_light"],
         "message": f"Masal botu {minutes} dakikadır çalışmıyor. Uygulamayı açıp kontrol et. "
                    "OKX'teki kâr al / zarar durdur emirleri çalışmaya devam ediyor.",
         "delay": f"{minutes}m", "sequence_id": HB_ID}
    if n.en:
        m["title"], m["message"] = "Bot stopped", (f"The Masal bot has not run for {minutes} minutes. Open the app to check. "
                                                    "Take-profit / stop-loss orders on OKX keep working.")
    try:
        urllib.request.urlopen(urllib.request.Request("https://ntfy.sh/", data=json.dumps(m).encode(), method="POST",
                                                      headers={"Content-Type": "application/json", "User-Agent": "masal/1.0"}),
                               timeout=10).read()
    except Exception as e:
        print("Nabız mesajı kurulamadı:", e)
        return False
    return True
