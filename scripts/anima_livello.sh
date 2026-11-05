#!/usr/bin/env bash
# Uso: scripts/anima_livello.sh <circ|quar|upl>
# Genera MP4 e GIF di tutte le zone del livello, cancellando i frame dopo ogni zona.
set -uo pipefail
LIV="${1:?livello: circ, quar o upl}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
export PROJ_DATA="${PROJ_DATA:-$HOME/micromamba/envs/qgis/share/proj}"
PY="${PY:-$HOME/micromamba/envs/qgis/bin/python}"
for ID in $(python3 -c "import json;print(' '.join(z['id'] for z in json.load(open('$ROOT/data/index.json'))['zone'] if z['level']=='$LIV'))"); do
  echo "== $ID"
  if "$PY" "$ROOT/scripts/03_make_animation.py" "$ID" 2>&1 | grep -v "^ERROR 1: PROJ" | tail -1 && "$ROOT/scripts/make_gif.sh" "$ID" >/dev/null; then
    echo "   ok"
  else
    echo "   ERRORE su $ID"
  fi
  rm -rf "$ROOT/frames/$ID"
done
echo FINITO
