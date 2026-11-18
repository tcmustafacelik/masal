"""Yeni sürüm yayınlarken: python tools/surum.py 1.5.0 "Not 1" "Not 2"
docs/version.json ve docs/index.html içindeki APP_VERSION birlikte güncellenir."""
import json, re, sys, datetime, pathlib
root = pathlib.Path(__file__).resolve().parent.parent
ver, notes = sys.argv[1], sys.argv[2:]
(root / "docs/version.json").write_text(json.dumps(
    {"version": ver, "date": datetime.date.today().isoformat(), "notes": notes}, ensure_ascii=False, indent=2) + "\n")
p = root / "docs/index.html"
p.write_text(re.sub(r"const APP_VERSION='[^']*'", f"const APP_VERSION='{ver}'", p.read_text()))
sw = root / "docs/sw.js"
sw.write_text(re.sub(r"const CACHE = 'masal-[^']*'", f"const CACHE = 'masal-{ver}'", sw.read_text()))
print("Sürüm", ver)
