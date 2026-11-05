"""Verifica dei dati dei lotti prodotti da 09_lotti.py (data/lotti.pmtiles, data/lotti/*.json).

Controlli: numero di particelle nel PMTiles, id feature = k senza buchi, Foglio/Paricella di 20 k a caso uguali al gpkg,
lunghezza di edifici.json = numero di edifici, file per UPL coerenti. Stampa i conteggi usati nella Metodologia.
Uso: PROJ_DATA=~/micromamba/envs/qgis/share/proj ~/micromamba/envs/qgis/bin/python verifica_lotti.py
"""
import json
import os
import random
import subprocess
import sys
import warnings

import geopandas as gpd
import numpy as np

from common import *

warnings.filterwarnings("ignore")
SRC = "/mnt/d/Archivio Lavori/Work in progress/Ufficio Urbanistica/Catasto Palermo/Settembre 2026/paricelle_PA_G273.gpkg"
PM = os.path.join(OUT, "lotti.pmtiles")
ok = True


def controlla(nome, cond, dettaglio=""):
    global ok
    ok &= bool(cond)
    print(("OK    " if cond else "ERRORE"), nome, dettaglio)


lotti = gpd.read_file(SRC)
n = len(lotti)
meta = json.loads(subprocess.run(["pmtiles", "show", PM, "--metadata"], capture_output=True, text=True, check=True).stdout)
conteggio = meta["tilestats"]["layers"][0]["count"]
controlla("particelle nel PMTiles", conteggio == n, f"{conteggio} / {n}")

campi = meta["vector_layers"][0]["fields"]
controlla("campi attesi nei tile", all(c in campi for c in ["k", "foglio", "Paricella", "m2", "cop", "n", "lib", "cav"]), str(sorted(campi)))

# file di lavoro scritto da 09_lotti.py, da cui tippecanoe ha costruito il PMTiles
lav = os.path.join(WORK, "lotti.geojsonl")
visti, ko, campione = set(), 0, set(random.Random(1).sample(range(n), 20))
with open(lav) as f:
    for riga in f:
        p = json.loads(riga)["properties"]
        visti.add(p["k"])
        if p["k"] in campione:
            r = lotti.iloc[p["k"]]
            ko += str(r.foglio) != str(p["foglio"]) or str(r.Paricella) != str(p["Paricella"])
controlla("k univoco e senza buchi", visti == set(range(n)))
controlla("foglio/Paricella di 20 k a caso uguali al gpkg", ko == 0, f"{ko} differenze")

ed = json.load(open(os.path.join(OUT, "lotti", "edifici.json")))
index = json.load(open(os.path.join(OUT, "index.json")))
totale = sum(z["n"] for z in index["zone"] if z["level"] == "upl")
controlla("edifici.json: un elemento per edificio", len(ed["e"]) == totale, f"{len(ed['e'])} / {totale}")
senza = sum(1 for v in ed["e"] if v < 0)
controlla("lu: ogni lotto con edifici ha una UPL", all(str(v) in ed["lu"] for v in set(ed["e"]) if v >= 0))
con_ed = len(ed["lu"])
aree = np.array([r[2] for u in range(55) if os.path.exists(os.path.join(OUT, "lotti", f"upl-{u}.json")) for r in json.load(open(os.path.join(OUT, "lotti", f"upl-{u}.json"))).values()])
controlla("anelli per ogni lotto con edifici", len(aree) == con_ed, f"{len(aree)} / {con_ed}")
print(f"lotti: {n}; con edifici: {con_ed}; liberi: {n - con_ed}; edifici senza lotto: {senza}; a cavallo: {len(ed['cav'])}; mediana m² (con edifici): {int(np.median(aree)) if len(aree) else 0}")
sys.exit(0 if ok else 1)
