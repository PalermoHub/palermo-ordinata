#!/usr/bin/env bash
# Uso: scripts/make_gif.sh <id zona> [fps_gif]
# Legge frames/<id>/NNNN.png (da 03_make_animation.py) e scrive img/anim/<id>.mp4 e <id>.gif
set -euo pipefail
ZONA="${1:?id zona}"
FPS_GIF="${2:-20}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
IN="$ROOT/frames/$ZONA/%04d.png"
OUT="$ROOT/img/anim"
mkdir -p "$OUT"
PAL="$(mktemp --suffix=.png)"
trap 'rm -f "$PAL"' EXIT
ffmpeg -y -loglevel error -framerate 25 -i "$IN" -c:v libx264 -pix_fmt yuv420p -crf 18 -movflags +faststart "$OUT/$ZONA.mp4"
ffmpeg -y -loglevel error -framerate 25 -i "$IN" -vf "fps=$FPS_GIF,scale=720:-1:flags=lanczos,palettegen=max_colors=32:stats_mode=full" "$PAL"
ffmpeg -y -loglevel error -framerate 25 -i "$IN" -i "$PAL" -lavfi "fps=$FPS_GIF,scale=720:-1:flags=lanczos[x];[x][1:v]paletteuse=dither=none:diff_mode=rectangle" -loop 0 "$OUT/$ZONA.gif"
ls -lh "$OUT/$ZONA".*
