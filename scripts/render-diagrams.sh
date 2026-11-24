#!/usr/bin/env bash
# Renderiza docs/diagrams/source/*.mmd (Mermaid, fonte editável) em SVG e PNG (docs/diagrams/rendered).
# Requer Node + Chromium (o mermaid-cli baixa via puppeteer). Variáveis opcionais:
#   MMDC="caminho do mmdc"  |  PUPPETEER_CFG="arquivo json do puppeteer (ex.: executablePath do Chromium local)"
set -euo pipefail
cd "$(dirname "$0")/.."
MMDC="${MMDC:-npx --yes @mermaid-js/mermaid-cli}"
OUT=docs/diagrams/rendered
CFG="${PUPPETEER_CFG:-docs/diagrams/puppeteer-config.json}"
mkdir -p "$OUT"
for f in docs/diagrams/source/*.mmd; do
  name="$(basename "$f" .mmd)"
  echo "-> $name"
  $MMDC -p "$CFG" -i "$f" -o "$OUT/$name.svg" -b transparent -w 1800
  $MMDC -p "$CFG" -i "$f" -o "$OUT/$name.png" -b white -w 1800 -s 2
done
