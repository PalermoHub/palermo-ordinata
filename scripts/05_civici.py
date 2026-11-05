"""Fase 7: indice dei civici ANNCSU per la ricerca (data/civici.json).

Ogni civico (punto) e' agganciato all'edificio piu' vicino entro MAX_DIST m (prima quello che lo contiene).
I punti ANNCSU stanno sull'ingresso, spesso sul filo strada: solo ~36% cade dentro un poligono,
quindi l'aggancio e' "l'edificio piu' probabile".

Formato: { "NOME VIA": [ [civici...], [indice UPL...], [indice edificio nel file UPL...] ] }
  - indice UPL: posizione tra le zone level=upl di data/index.json
  - indice edificio: posizione in data/zone/upl-*.json -> "b" (stesso ordine di edifici.gpkg per UPL)
Sorgente civici: DigitalTwin/dati/civici-omi/civici/*.json (ANNCSU feb 2026, coordinate in 1e-6 gradi, delta-codificate).
Uso: PROJ_DATA=~/micromamba/envs/qgis/share/proj ~/micromamba/envs/qgis/bin/python 05_civici.py
"""
import glob
import json
import os
import warnings

import geopandas as gpd
import numpy as np
from shapely.geometry import Point

from common import *

warnings.filterwarnings("ignore")
SRC = "/home/coseerobe/GitHub-Clone/coseerobe/DigitalTwin/dati/civici-omi/civici/*.json"
MAX_DIST = 25.0  # m

pts = []
for f in sorted(glob.glob(SRC)):
    for via, (num, lo, la) in json.load(open(f)).items():
        for n, x, y in zip(num, np.cumsum(lo) / 1e6, np.cumsum(la) / 1e6):
            pts.append((via, str(n), x, y))
g = gpd.GeoDataFrame([p[:2] for p in pts], columns=["via", "num"], geometry=[Point(p[2], p[3]) for p in pts], crs=4326).to_crs(CRS)
print("civici:", len(g), "vie:", g.via.nunique())

b = gpd.read_file(os.path.join(WORK, "edifici.gpkg"))
index = json.load(open(os.path.join(OUT, "index.json")))
upl = [z for z in index["zone"] if z["level"] == "upl"]
ord_upl = {z["name"]: k for k, z in enumerate(upl)}
b["u"] = b.UPL.str.strip().map(ord_upl)
assert b.u.notna().all(), "UPL non riconosciute"
b["bi"] = b.groupby("u").cumcount()          # posizione nel file UPL (stesso ordine dell'export)
for k, z in enumerate(upl):
    assert int((b.u == k).sum()) == z["n"], "conteggio diverso in " + z["id"]

# prima l'edificio che contiene il punto, poi il piu' vicino entro MAX_DIST
b = b.reset_index(drop=True)
nn = gpd.sjoin_nearest(g, b[["geometry"]], how="left", max_distance=MAX_DIST, distance_col="d")
nn = nn[~nn.index.duplicated(keep="first")]
dentro = gpd.sjoin(g, b[["geometry"]], how="inner", predicate="within")
dentro = dentro[~dentro.index.duplicated(keep="first")]
riga = nn.index_right.copy()
riga.loc[dentro.index] = dentro.index_right
g["riga"] = riga
ok = g[g.riga.notna()].copy()
print(f"agganciati: {len(ok)} / {len(g)} ({100*len(ok)/len(g):.1f}%), dentro il poligono: {len(dentro)}")
ok["u"] = b.u.values[ok.riga.astype(int)].astype(int)
ok["bi"] = b.bi.values[ok.riga.astype(int)].astype(int)

out = {}
for via, d in ok.groupby("via"):
    d = d.assign(_n=d.num.str.extract(r"^(\d+)")[0].astype(float).fillna(1e9)).sort_values(["_n", "num"], kind="stable")
    out[via] = [d.num.tolist(), d.u.tolist(), d.bi.tolist()]
path = os.path.join(OUT, "civici.json")
with open(path, "w") as f:
    json.dump(out, f, separators=(",", ":"), ensure_ascii=False)
print(f"{len(out)} vie, {os.path.getsize(path)/1e6:.2f} MB -> {path}")
