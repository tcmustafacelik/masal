"""Telefona bildirim: ntfy.sh üzerinden. Konu adı ayarlarda şifreli saklanır."""
import json
import urllib.request

from . import vault


class Notifier:
    def __init__(self, S):
        n = S.get("notify") or {}
        self.on = bool(n.get("enabled"))
        self.cats = {"trades": n.get("trades", True), "alerts": n.get("alerts", True), "daily": n.get("daily", True)}
        self.topic = ""
        if self.on and n.get("topic"):
            try:
                self.topic = vault.unseal(n["topic"]) if vault.is_sealed(n["topic"]) else n["topic"]
            except ValueError as e:
                print("Bildirim konusu çözülemedi:", e)
        self.queue = []

    def add(self, cat, title, message, priority=3, tags=None):
        if self.on and self.topic and self.cats.get(cat, True):
            self.queue.append({"topic": self.topic, "title": title, "message": message,
                               "priority": priority, "tags": tags or []})

    def flush(self):
        for m in self.queue[:15]:  # bir turda en fazla 15 bildirim
            try:
                req = urllib.request.Request("https://ntfy.sh/", data=json.dumps(m).encode(), method="POST",
                                             headers={"Content-Type": "application/json", "User-Agent": "masal/1.0"})
                urllib.request.urlopen(req, timeout=10).read()
            except Exception as e:
                print("Bildirim gönderilemedi:", e)
        self.queue = []
