"""Fase 8: data/isolati.json — gli "isolati" (aggregati strutturali del DPC) con le statistiche dei loro edifici.

Sorgente: DPC-Aggregati-Strutturali-ITG-Isole, Isole/Sicilia/Palermo/Palermo.shp (CC BY 4.0, Dipartimento della
Protezione Civile). Un aggregato strutturale e' un gruppo di edifici contigui: e' un'approssimazione dell'isolato urbano.

Assegnazione edificio -> aggregato (in ordine):
  1. l'aggregato con cui l'impronta dell'edificio ha la sovrapposizione maggiore;
  2. altrimenti l'aggregato piu' vicino entro MAX_DIST_AGG m (le due fonti non sono allineate al metro);
  3. altrimenti l'edificio resta "senza isolato".
Si esportano solo gli aggregati con almeno un edificio.

Formato: { "agg": "...", "campi": [...], "i": [ [idag, n, m2, h_mediana_dm, [conteggio per uso], upl, vie, anelli], ... ], "e": [...] }
  - e: per ogni edificio, nell'ordine "UPL concatenate" (indice = somma dei conteggi delle UPL precedenti + posizione nel file UPL), la posizione dell'isolato in `i`, o -1
  - anelli: lista di anelli piatti [x0,y0,x1,y1,...] in dm dall'angolo SW della citta' (stesso riferimento di index.json), y verso nord
  - upl: posizione tra le zone level=upl di data/index.json (la UPL che contiene piu' edifici dell'aggregato)
  - vie: [[via, n_civici, [primi civici]], ...] (al massimo MAX_VIE vie), dai civici di civici.json
Uso: PROJ_DATA=~/micromamba/envs/qgis/share/proj ~/micromamba/envs/qgis/bin/python 07_isolati.py [percorso/Palermo.shp]
"""
import json
import os
import sys
import warnings

import geopandas as gpd
import numpy as np
import shapely
from shapely.geometry import Polygon

from common import *

warnings.filterwarnings("ignore")
SHP = "/mnt/d/GitHub - Clone/Italia/pcm-dpc/DPC-Aggregati-Strutturali-ITG-Isole/Isole/Sicilia/Palermo/Palermo.shp"
SHP = sys.argv[1] if len(sys.argv) > 1 else SHP
MAX_DIST_AGG = 3.0   # m
SIMPLIFY_AGG = 0.5   # m
MAX_VIE, MAX_CIV = 3, 6

index = json.load(open(os.path.join(OUT, "index.json")))
ox, oy = index["origin"]
upl = [z for z in index["zone"] if z["level"] == "upl"]
ord_upl = {z["name"]: k for k, z in enumerate(upl)}

agg = gpd.read_file(SHP).to_crs(CRS)
agg["geometry"] = shapely.make_valid(agg.geometry.values)
agg = agg.reset_index(drop=True)
print("aggregati:", len(agg))

b = gpd.read_file(os.path.join(WORK, "edifici.gpkg")).reset_index(drop=True)
b["u"] = b.UPL.str.strip().map(ord_upl)
assert b.u.notna().all(), "UPL non riconosciute"
b["bi"] = b.groupby("u").cumcount()           # posizione nel file UPL (come in 05_civici.py)
print("edifici:", len(b))

# 1. sovrapposizione maggiore
cand = gpd.sjoin(b[["geometry"]], agg[["geometry"]], how="inner", predicate="intersects").rename(columns={"index_right": "a"})
ov = shapely.area(shapely.intersection(b.geometry.values[cand.index.values], agg.geometry.values[cand.a.values]))
cand = cand.assign(ov=ov)
cand = cand[cand.ov > 0].sort_values("ov", ascending=False)
cand = cand[~cand.index.duplicated(keep="first")]
b["a"] = np.nan
b.loc[cand.index, "a"] = cand.a.values
n1 = int(b.a.notna().sum())

# 2. il piu' vicino entro MAX_DIST_AGG
resto = b[b.a.isna()]
vic = gpd.sjoin_nearest(resto[["geometry"]], agg[["geometry"]], how="inner", max_distance=MAX_DIST_AGG).rename(columns={"index_right": "a"})
vic = vic[~vic.index.duplicated(keep="first")]
b.loc[vic.index, "a"] = vic.a.values
n2 = int(b.a.notna().sum()) - n1
print(f"edifici assegnati: {n1} per sovrapposizione + {n2} per vicinanza; senza isolato: {int(b.a.isna().sum())}")

# civici -> edificio -> aggregato
civ = json.load(open(os.path.join(OUT, "civici.json")))
riga = {(int(u), int(bi)): r for r, (u, bi) in enumerate(zip(b.u.values, b.bi.values))}
vie = {}  # aggregato -> {via: [civici]}
a_di_riga = b.a.values
for via, (nn, uu, bb) in civ.items():
    for n, u, bi in zip(nn, uu, bb):
        r = riga.get((u, bi))
        if r is None or a_di_riga[r] != a_di_riga[r]:
            continue
        vie.setdefault(int(a_di_riga[r]), {}).setdefault(via, []).append(n)


def anelli(g):
    s = g.simplify(SIMPLIFY_AGG, preserve_topology=True)
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


righe, righe_agg = [], []
for a, d in b[b.a.notna()].groupby("a"):
    a = int(a)
    g = agg.geometry[a]
    rr = anelli(g)
    if not rr:
        continue
    usi = np.bincount(d.uso.astype(int).values, minlength=len(USI)).tolist()
    h = d.h.values[d.h.values > 0]
    hm = int(round(float(np.median(h)) * DM)) if len(h) else 0
    v = sorted(vie.get(a, {}).items(), key=lambda kv: -len(kv[1]))[:MAX_VIE]
    righe_agg.append(a)
    righe.append([agg.IDAG[a], int(len(d)), int(round(d.area.sum())), hm, usi, int(d.u.mode().iloc[0]),
                  [[via, len(nn), nn[:MAX_CIV]] for via, nn in v], rr])
ordine = sorted(range(len(righe)), key=lambda k: righe[k][0])
righe = [righe[k] for k in ordine]
pos_agg = {righe_agg[k]: p for p, k in enumerate(ordine)}

# legame edificio -> isolato: per ogni edificio nell'ordine "UPL concatenate" (stesso spazio di indici di civici.json), la posizione in `i` o -1
off, tot = [], 0
for z in upl:
    off.append(tot); tot += z["n"]
edif = [-1] * tot
for u, bi, a in zip(b.u.values, b.bi.values, b.a.values):
    if a == a and int(a) in pos_agg:
        edif[off[int(u)] + int(bi)] = pos_agg[int(a)]

out = {"agg": "DPC Aggregati Strutturali ITG Isole (CC BY 4.0)",
       "campi": ["idag", "n", "m2", "h_mediana_dm", "uso", "upl", "vie", "anelli"], "i": righe, "e": edif}
path = os.path.join(OUT, "isolati.json")
with open(path, "w") as f:
    json.dump(out, f, separators=(",", ":"), ensure_ascii=False)
nv = sum(len(r[7]) for r in righe)
print(f"{len(righe)} isolati con edifici, {nv} anelli, {os.path.getsize(path)/1e6:.2f} MB -> {path}")
print("edifici per isolato: mediana", int(np.median([r[1] for r in righe])), "massimo", max(r[1] for r in righe))
