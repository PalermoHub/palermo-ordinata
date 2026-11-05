"""Fase 7b: data/perm-livelli.json — collega gli edifici dei livelli circ/quar a quelli del livello UPL.

civici.json indica ogni edificio come (UPL, posizione nel file UPL). L'app, ai livelli circoscrizioni/quartieri,
carica gli stessi edifici in un altro ordine: questa tabella dice, per ogni edificio di quel livello (nell'ordine
in cui Citta.carica li concatena), il suo indice nel livello UPL (concatenato). Il livello UPL e' l'identita'.
Aggancio: stessi 8 campi + anelli (indipendenti dalla zona) e, a parita', il centroide cittadino piu' vicino.
Uso: python3 06_perm_livelli.py   (solo libreria standard)
"""
import json
import os
from collections import defaultdict

from common import OUT

index = json.load(open(os.path.join(OUT, "index.json")))


def carica(liv):
    voci = []
    for z in [z for z in index["zone"] if z["level"] == liv]:
        d = json.load(open(os.path.join(OUT, "zone", z["id"] + ".json")))
        for b in d["b"]:
            voci.append((tuple(b[:8]) + (tuple(b[10][0]), len(b[10])), z["ox"] + b[8], z["oy"] + b[9]))
    return voci


upl = carica("upl")
gruppi = defaultdict(list)
for k, (chiave, x, y) in enumerate(upl):
    gruppi[chiave].append((x, y, k))

perm = {}
for liv in ("circ", "quar"):
    voci = carica(liv)
    assert len(voci) == len(upl), liv
    out = [-1] * len(voci)
    usati = set()
    for i, (chiave, x, y) in enumerate(voci):
        cand = [c for c in gruppi[chiave] if c[2] not in usati]
        c = min(cand, key=lambda c: abs(c[0] - x) + abs(c[1] - y))
        assert abs(c[0] - x) + abs(c[1] - y) <= 4, (liv, i, c, x, y)
        usati.add(c[2]); out[i] = c[2]
    assert -1 not in out
    perm[liv] = out
    print(liv, len(out), "ok")

path = os.path.join(OUT, "perm-livelli.json")
with open(path, "w") as f:
    json.dump(perm, f, separators=(",", ":"))
print(f"{os.path.getsize(path)/1e6:.2f} MB -> {path}")
