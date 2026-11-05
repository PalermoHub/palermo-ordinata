"""Fase 1b: esporta data/index.json e data/zone/<id>.json.

Formato di ogni edificio in `b` (coordinate in decimetri, y verso nord):
  [uso, alt, sup, area_m2, h_dm, ang, bw, bh, cx, cy, rings]
  - uso/alt/sup: indici nelle classi di index.json
  - ang: angolo del lato lungo in radianti, [0, pi)
  - bw, bh: dimensioni dopo la rotazione di -ang (lato lungo orizzontale)
  - cx, cy: centro del rettangolo che contiene l'impronta, relativo all'angolo SW della zona
  - rings: lista di anelli piatti [x0,y0,x1,y1,...] relativi a (cx, cy), non ruotati
Uso: PROJ_DATA=~/micromamba/envs/qgis/share/proj ~/micromamba/envs/qgis/bin/python 02_export.py
"""
import json
import math
import os
import shutil
import warnings

import geopandas as gpd
import numpy as np
from shapely import affinity
from shapely.geometry import Polygon

from common import *

warnings.filterwarnings("ignore")

b = gpd.read_file(os.path.join(WORK, "edifici.gpkg"))
conf = {k: gpd.read_file(CONF.format(f)).set_crs(CRS, allow_override=True)
        for k, f in (("circ", "circoscrizioni"), ("quar", "quartieri"), ("upl", "upl"))}
print("edifici:", len(b))


def anelli(g, tol, ox=0.0, oy=0.0):
    """Anelli piatti in dm, relativi a (ox, oy) in metri."""
    s = g.simplify(tol, preserve_topology=True)
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


# pre-calcolo per edificio (indipendente dalla zona)
voci = []
for r in b.itertuples():
    g = r.geometry
    x0, y0, x1, y1 = g.bounds
    cxm, cym = (x0 + x1) / 2, (y0 + y1) / 2
    rr = anelli(g, SIMPLIFY, cxm, cym)
    if not rr:
        voci.append(None)
        continue
    rot = affinity.rotate(g, -math.degrees(r.ang), origin=(cxm, cym))
    rx0, ry0, rx1, ry1 = rot.bounds
    voci.append((int(r.uso), int(r.alt), int(r.sup), int(round(r.area)), int(round(r.h * DM)),
                 round(float(r.ang), 4), round((rx1 - rx0) * DM), round((ry1 - ry0) * DM), cxm, cym, rr))
print("edifici con anelli validi:", sum(v is not None for v in voci))

# origine globale per il selettore
X0, Y0, X1, Y1 = conf["upl"].total_bounds

zone = []  # (id, livello, nome, parent, geometria, maschera edifici)
for _, r in conf["circ"].iterrows():
    zone.append(("circ-" + slug(r.Circoscrizione), "circ", "Circoscrizione " + r.Circoscrizione, None,
                 r.geometry, (b.Circoscrizione == r.Circoscrizione).values))
for _, r in conf["quar"].iterrows():
    zone.append(("quar-" + slug(r.Quartiere), "quar", r.Quartiere.strip(), "circ-" + slug(r.Circoscrizione),
                 r.geometry, (b.Quartiere == r.Quartiere).values))
for _, r in conf["upl"].iterrows():
    zone.append(("upl-" + slug(r.UPL), "upl", r.UPL.strip(), "quar-" + slug(r.Quartiere),
                 r.geometry, (b.UPL == r.UPL).values))
assert len({z[0] for z in zone}) == len(zone), "id zona duplicati"

zdir = os.path.join(OUT, "zone")
shutil.rmtree(zdir, ignore_errors=True)
os.makedirs(zdir)


def quote(idx, n_classi, key):
    cnt = [0] * n_classi
    fp = [0] * n_classi
    for i in idx:
        v = voci[i]
        cnt[v[key]] += 1
        fp[v[key]] += v[3]
    return {"n": cnt, "m2": fp}


indice = []
for zid, liv, nome, parent, geom, mask in zone:
    x0, y0, x1, y1 = geom.bounds
    idx = [i for i in np.flatnonzero(mask) if voci[i] is not None]
    bl = []
    for i in idx:
        v = voci[i]
        bl.append([*v[:8], round((v[8] - x0) * DM), round((v[9] - y0) * DM), v[10]])
    doc = {"id": zid, "level": liv, "name": nome,
           "w": round((x1 - x0) * DM), "h": round((y1 - y0) * DM), "n": len(bl),
           "outline": anelli(geom, SIMPLIFY_ZONE, x0, y0), "b": bl}
    with open(os.path.join(zdir, zid + ".json"), "w") as f:
        json.dump(doc, f, separators=(",", ":"))
    areas = [voci[i][3] for i in idx]
    indice.append({
        "id": zid, "level": liv, "name": nome, "parent": parent, "n": len(idx),
        "area_km2": round(geom.area / 1e6, 3), "footprint_m2": int(sum(areas)),
        "median_m2": int(np.median(areas)) if areas else 0,
        "uso": quote(idx, len(USI), 0), "alt": quote(idx, len(ALTEZZE) + 1, 1),
        "sup": quote(idx, len(SUPERFICI), 2),
        "ox": round((x0 - X0) * DM), "oy": round((y0 - Y0) * DM),  # angolo SW della zona, in dm dall'angolo SW della citta'
        "sel": anelli(geom, SIMPLIFY_SEL, X0, Y0),  # in dm dall'angolo SW della citta'
    })
    print(f"{zid:55s} {len(bl):6d} edifici  {os.path.getsize(os.path.join(zdir, zid + '.json'))/1e6:6.2f} MB")

index = {
    "crs": f"EPSG:{CRS}", "unit_dm": DM, "origin": [X0, Y0],
    "w": round((X1 - X0) * DM), "h": round((Y1 - Y0) * DM),
    "min_area_m2": MIN_AREA,
    "schema": ["uso", "alt", "sup", "area_m2", "h_dm", "ang", "bw", "bh", "cx", "cy", "rings"],
    "classi": {
        "uso": [{"id": i, "nome": n} for i, n, _ in USI],
        "alt": [{"nome": n, "max": (None if math.isinf(m) else m)} for n, m in ALTEZZE]
               + [{"nome": "altezza non disponibile", "max": None}],
        "sup": [{"nome": n, "max": (None if math.isinf(m) else m)} for n, m in SUPERFICI],
    },
    "zone": indice,
}
with open(os.path.join(OUT, "index.json"), "w") as f:
    json.dump(index, f, separators=(",", ":"), ensure_ascii=False)
tot = sum(os.path.getsize(os.path.join(zdir, p)) for p in os.listdir(zdir))
print(f"\n{len(zone)} zone, {tot/1e6:.1f} MB in data/zone, index.json {os.path.getsize(os.path.join(OUT, 'index.json'))/1e3:.0f} kB")
