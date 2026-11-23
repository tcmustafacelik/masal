"""Yeni sürüm yayınlarken: python tools/surum.py 1.5.0 "Not 1" "Not 2"
docs/version.json, src/app.ts içindeki APP_VERSION ve docs/app.js (derleme) birlikte güncellenir."""
import json, re, sys, datetime, pathlib
root = pathlib.Path(__file__).resolve().parent.parent
ver, notes = sys.argv[1], sys.argv[2:]
try:
    hist = json.loads((root / "docs/version.json").read_text()).get("history") or []
except Exception:
    hist = []
today = datetime.date.today().isoformat()
hist = ([{"version": ver, "date": today, "notes": notes}] + [h for h in hist if h.get("version") != ver])[:15]
(root / "docs/version.json").write_text(json.dumps(
    {"version": ver, "date": today, "notes": notes, "history": hist}, ensure_ascii=False, indent=2) + "\n")
p = root / "src/app.ts"
p.write_text(re.sub(r"const APP_VERSION\s*=\s*'[^']*'", f"const APP_VERSION='{ver}'", p.read_text()))
import subprocess
subprocess.run(["npm", "run", "build", "--silent"], cwd=root, check=True)  # TypeScript -> docs/app.js
sw = root / "docs/sw.js"
sw.write_text(re.sub(r"const CACHE = 'masal-[^']*'", f"const CACHE = 'masal-{ver}'", sw.read_text()))
ix = root / "docs/index.html"  # sayfa her zaman kendi sürümünün kodunu yüklesin
ix.write_text(re.sub(r'src="app\.js(\?v=[^"]*)?"', f'src="app.js?v={ver}"', ix.read_text()))
print("Sürüm", ver)
