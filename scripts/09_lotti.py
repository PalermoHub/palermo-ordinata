"""Fase 9: lotti catastali (particelle) incrociati con gli edifici.

Sorgente: paricelle_PA_G273.gpkg (Agenzia delle Entrate, comune G273 = Palermo, settembre 2026), 135.038 particelle, EPSG:4326.
Un edificio conta in una particella se almeno il 10% della sua impronta ci cade dentro; il lotto principale e' quello con la
sovrapposizione maggiore; l'edificio e' "a cavallo" se conta in piu' particelle (vedi lotti.py).

Produce:
  data/lotti.pmtiles        tile z12-17 (layer "particelle"), proprieta':
                            k (indice nel gpkg), foglio, Paricella, m2, cop (0-100, troncato), n (edifici con questo lotto come principale), nt (edifici che contano nel lotto, anche a cavallo), lib (1 = nt = 0), cav (1 = tocca edifici a cavallo)
  data/lotti/edifici.json   { "e": [k | -1 per edificio, ordine "UPL concatenate" come civici.json/isolati.json],
                              "c": [rapporto di copertura 0-100 del lotto principale dell'edificio | -1, stesso ordine],
                              "cav": [posizioni in "e" degli edifici a cavallo], "lu": { "<k>": posizione UPL } per i lotti con edifici }
  data/lotti/upl-<u>.json   { "<k>": [foglio, particella, m2, anelli, cop, nt, cav] } per i lotti con edifici della UPL u (anelli in dm dall'angolo
                            SW della citta', y verso nord, semplificati SIMPLIFY m); UPL del lotto = quella della maggioranza dei suoi edifici
Uso: PROJ_DATA=~/micromamba/envs/qgis/share/proj ~/micromamba/envs/qgis/bin/python 09_lotti.py [percorso/gpkg]
Poi: python verifica_lotti.py
"""
import json
import os
import subprocess
import sys
import warnings

import geopandas as gpd
import numpy as np
import shapely
from shapely.geometry import Polygon

from common import *
from lotti import calcola

warnings.filterwarnings("ignore")
SRC = "/mnt/d/Archivio Lavori/Work in progress/Ufficio Urbanistica/Catasto Palermo/Settembre 2026/paricelle_PA_G273.gpkg"
SRC = sys.argv[1] if len(sys.argv) > 1 else SRC
SIMPLIFY = 0.3   # m
DIR = os.path.join(OUT, "lotti")
os.makedirs(DIR, exist_ok=True)

index = json.load(open(os.path.join(OUT, "index.json")))
ox, oy = index["origin"]
upl = [z for z in index["zone"] if z["level"] == "upl"]
ord_upl = {z["name"]: k for k, z in enumerate(upl)}

lotti = gpd.read_file(SRC).reset_index(drop=True)
lotti["geometry"] = shapely.make_valid(lotti.geometry.values)
lm = lotti.to_crs(CRS)
b = gpd.read_file(os.path.join(WORK, "edifici.gpkg")).reset_index(drop=True)
b["u"] = b.UPL.str.strip().map(ord_upl)
assert b.u.notna().all(), "UPL non riconosciute"
b["bi"] = b.groupby("u").cumcount()
print("particelle:", len(lm), "edifici:", len(b))

L, E = calcola(lm, b)
L["k"] = np.arange(len(L))
print(f"lotti con edifici: {int((~L.lib).sum())}, liberi: {int(L.lib.sum())}, edifici senza lotto: {int((E.lotto < 0).sum())}, a cavallo: {int(E.cav.sum())}")

# --- PMTiles: geojsonl in WGS84 con le statistiche, poi tippecanoe ---
lav = os.path.join(WORK, "lotti.geojsonl")
foglio = lotti["foglio"].astype(str).values
parc = lotti["Paricella"].astype(str).values
with open(lav, "w") as f:
    for k, g in enumerate(lotti.geometry.values):
        r = L.iloc[k]
        p = {"k": k, "foglio": foglio[k], "Paricella": parc[k], "m2": int(round(r.m2)), "cop": int(r.cop), "n": int(r.n), "nt": int(r.nt),
             "lib": int(r.lib), "cav": int(r.cav)}
        f.write(json.dumps({"type": "Feature", "properties": p, "geometry": json.loads(shapely.to_geojson(g))}) + "\n")
pm = os.path.join(OUT, "lotti.pmtiles")
subprocess.run(["tippecanoe", "-q", "-Z12", "-z17", "-l", "particelle", "--no-tile-size-limit",
                "--no-feature-limit", "--no-tiny-polygon-reduction", "--force", "-o", pm, lav], check=True)

# --- legame edificio -> lotto, nello spazio "UPL concatenate" ---
off, tot = [], 0
for z in upl:
    off.append(tot); tot += z["n"]
e = [-1] * tot
c_cop = [-1] * tot       # rapporto di copertura (0-100) del lotto principale di ogni edificio, -1 se senza lotto
cav = []
pos = [off[int(u)] + int(bi) for u, bi in zip(b.u.values, b.bi.values)]
for p_, lot, c in zip(pos, E.lotto.values, E.cav.values):
    e[p_] = int(lot)
    if lot >= 0:
        c_cop[p_] = int(L.cop.iloc[int(lot)])
    if c:
        cav.append(p_)
cav.sort()

# UPL del lotto = maggioranza dei suoi edifici
d = b.assign(lotto=E.lotto.values)
d = d[d.lotto >= 0]
lu = d.groupby("lotto").u.agg(lambda s: int(s.mode().iloc[0])).to_dict()
json.dump({"e": e, "c": c_cop, "cav": cav, "lu": {str(int(k)): int(v) for k, v in lu.items()}},
          open(os.path.join(DIR, "edifici.json"), "w"), separators=(",", ":"))


def anelli(g):
    s = g.simplify(SIMPLIFY, preserve_topology=True)
    if s.is_empty:
        s = g
    out = []
    for p in getattr(s, "geoms", [s]):
        if not isinstance(p, Polygon) or p.is_empty:
            continue
        for r in [p.exterior, *p.interiors]:
            pts = []
            for x, y in r.coords:
                q = (round((x - ox) * DM), round((y - oy) * DM))
                if not pts or q != pts[-1]:
                    pts.append(q)
            if len(pts) > 1 and pts[0] == pts[-1]:
                pts.pop()
            if len(pts) >= 3:
                out.append([int(v) for q in pts for v in q])
    return out


per_upl = {}
for k, u in lu.items():
    k = int(k)
    rr = anelli(lm.geometry.values[k])
    if rr:
        per_upl.setdefault(u, {})[str(k)] = [foglio[k], parc[k], int(round(L.m2.iloc[k])), rr, int(L.cop.iloc[k]), int(L.nt.iloc[k]), int(L.cav.iloc[k])]
for f_ in os.listdir(DIR):
    if f_.startswith("upl-"):
        os.remove(os.path.join(DIR, f_))
for u, dd in per_upl.items():
    json.dump(dd, open(os.path.join(DIR, f"upl-{u}.json"), "w"), separators=(",", ":"), ensure_ascii=False)
mb = lambda p: os.path.getsize(p) / 1e6
print(f"{pm}: {mb(pm):.1f} MB; upl-*.json: {sum(mb(os.path.join(DIR, f)) for f in os.listdir(DIR)):.1f} MB in {len(per_upl)} file")
