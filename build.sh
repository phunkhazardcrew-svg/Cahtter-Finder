#!/bin/sh
# Builds index.html (GitHub Pages) and chatter-finder.html (fragment for the claude.ai artifact) from src/
set -e
cd "$(dirname "$0")"
python3 - <<'PY'
src=open("src/app.src.html").read()
core=open("src/core.js").read().replace('if (typeof module !== "undefined") module.exports = ChatterCore;\n','')
frag=src.replace("/*CORE*/",core)
open("chatter-finder.html","w").write(frag)
head='<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">\n<meta name="theme-color" content="#0e1114">\n<link rel="manifest" href="manifest.webmanifest">\n<style>:root{padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}[hidden]{display:none!important}img{max-width:100%}</style>\n</head>\n<body>\n'
open("index.html","w").write(head+frag+"\n</body>\n</html>\n")
PY
echo built
