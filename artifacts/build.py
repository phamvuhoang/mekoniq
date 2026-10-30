#!/usr/bin/env python3
"""Build two portable presentations using only the Python standard library."""
from pathlib import Path

ROOT = Path(__file__).resolve().parent
SRC = ROOT / "src"
style = (SRC / "core.css").read_text()
core = (SRC / "core.js").read_text()
for name, title in [("engineering", "MEKONIQ · Engineering Atlas"), ("investor", "MEKONIQ · Investor Story")]:
    content = (SRC / f"{name}.js").read_text()
    html = f'''<!doctype html>
<html lang="vi"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="{'dark' if name == 'engineering' else 'light'}">
<meta name="description" content="MEKONIQ interactive presentation · Tiếng Việt / 日本語 / English · 2026-10-30">
<title>{title}</title><style>{style}</style></head>
<body data-audience="{name}"><div id="app"></div>
<noscript>Vui lòng bật JavaScript để xem bản trình bày. JavaScriptを有効にしてください。 Please enable JavaScript.</noscript>
<script>{core}\n{content}</script></body></html>'''
    assert "</script" not in core.lower() and "</script" not in content.lower()
    data = html.encode("utf-8")
    assert len(data) <= 256 * 1024, "HTML exceeds the interactive viewer's limit"
    (ROOT / f"{name}.html").write_bytes(data)
    print(f"{name}.html: {len(data):,} bytes · self-contained")
