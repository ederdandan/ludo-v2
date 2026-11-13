#!/usr/bin/env bash
# Gera assets/textures/*.ktx2 a partir da madeira CC0 "oak_veneer_01" (Poly Haven).
# Uso: scripts/encode-textures.sh /caminho/para/basisu(.exe)   (basis_universal 1.16+)
#   albedo  → ETC1S sRGB (pequeno, bom para cor)
#   rough   → ETC1S linear
#   normal  → UASTC linear + zstd (ETC1S estraga normais)
set -euo pipefail
BASISU="${1:?informe o caminho do basisu}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/assets/textures"
SRC="$(mktemp -d)"
URL=https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k/oak_veneer_01/oak_veneer_01
mkdir -p "$OUT"
for m in diff nor_gl rough; do curl -sfL -o "$SRC/$m.jpg" "${URL}_${m}_1k.jpg"; done
cd "$SRC"
"$BASISU" -ktx2 -mipmap -q 220 -comp_level 2 diff.jpg -output_file "$OUT/oak_albedo.ktx2"
"$BASISU" -ktx2 -mipmap -linear -q 160 -comp_level 2 rough.jpg -output_file "$OUT/oak_rough.ktx2"
"$BASISU" -ktx2 -mipmap -linear -normal_map -uastc -uastc_level 2 -uastc_rdo_l 1.5 nor_gl.jpg -output_file "$OUT/oak_normal.ktx2"
rm -rf "$SRC"
ls -la "$OUT"
