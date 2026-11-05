"""Confronta il packing Python con l'output di js/layout.js (salvato da un browser).

Uso: test_layout.py <js_layout.json> [id zona]   (JSON con n, w, h, labels, lw, lh, lcx, pos)
Aspetto 960/920, altezza etichetta 260 dm, colore = altezza, raggruppato.
"""
import importlib.util
import json
import os
import sys

here = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location("anim", os.path.join(here, "03_make_animation.py"))
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
from layout import pack

js = json.load(open(sys.argv[1]))
zid = sys.argv[2] if len(sys.argv) > 2 else "upl-tribunali-o-kalsa"
index, zona, d, B, order = m.carica(zid, "alt", True)
items = [(b["lw"], b["lh"]) for b in B]
pos, w, h, labels = pack(items, order, 960 / 920, lambda i: B[i]["cls"][1], 260)
js_pos = js["pos"]
err = max(max(abs(p[0] - js_pos[2 * i]), abs(p[1] - js_pos[2 * i + 1])) for i, p in enumerate(pos))
err_dim = max(max(abs(items[i][0] - js["lw"][i]), abs(items[i][1] - js["lh"][i])) for i in range(len(items)))
print(f"edifici: py {len(items)} js {js['n']}")
print(f"errore massimo posizione slot: {err:.6f} dm | dimensioni: {err_dim:.6f} dm")
print(f"w: py {w:.3f} js {js['w']:.3f} | h: py {h:.3f} js {js['h']:.3f} | etichette: py {len(labels)} js {len(js['labels'])}")
ok = err < 1e-6 and err_dim < 1e-6 and abs(w - js["w"]) < 1e-6 and abs(h - js["h"]) < 1e-6 and len(labels) == len(js["labels"])
print("OK" if ok else "DIFFERENZE")
sys.exit(0 if ok else 1)
