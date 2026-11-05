"""Fase 1a: pulizia edifici e assegnazione alle zone.

Scrive data/work/edifici.gpkg (EPSG:32632) e data/work/prep_report.json.
Uso: PROJ_DATA=~/micromamba/envs/qgis/share/proj ~/micromamba/envs/qgis/bin/python 01_prep.py
"""
import json
import math
import os
import warnings

import geopandas as gpd
import numpy as np
from shapely.geometry import MultiPolygon, Polygon

from common import *

warnings.filterwarnings("ignore")
os.makedirs(WORK, exist_ok=True)
rep = {}

upl = gpd.read_file(CONF.format("upl")).set_crs(CRS, allow_override=True)
b = gpd.read_file(GPKG).to_crs(CRS)
rep["righe_input"] = len(b)

# geometria: 2D, valida, solo poligoni
b["geometry"] = b.geometry.force_2d()
inv = ~b.geometry.is_valid
rep["geometrie_corrette"] = int(inv.sum())
b.loc[inv, "geometry"] = b.loc[inv, "geometry"].make_valid()


def solo_poligoni(g):
    parti = [p for p in getattr(g, "geoms", [g]) if isinstance(p, Polygon)]
    for p in getattr(g, "geoms", []):
        if isinstance(p, MultiPolygon):
            parti += list(p.geoms)
    parti = [p for p in parti if not p.is_empty]
    if not parti:
        return None
    return parti[0] if len(parti) == 1 else MultiPolygon(parti)


b["geometry"] = b.geometry.apply(solo_poligoni)
vuoti = b.geometry.isna()
rep["senza_poligoni"] = int(vuoti.sum())
b = b[~vuoti].copy()

# area sempre dalla geometria
b["area"] = b.geometry.area
piccoli = b.area < MIN_AREA
rep["scartati_area_minore_5"] = int(piccoli.sum())
b = b[~piccoli].copy().reset_index(drop=True)

# zona: UPL del punto rappresentativo; i fuori entro 50 m alla UPL piu' vicina
pts = gpd.GeoDataFrame(geometry=b.geometry.representative_point(), crs=CRS)
j = gpd.sjoin(pts, upl[["UPL", "geometry"]], how="left", predicate="within")
j = j[~j.index.duplicated(keep="first")]
b["UPL"] = j["UPL"]
fuori = b["UPL"].isna()
rep["fuori_da_ogni_upl"] = int(fuori.sum())
if fuori.any():
    near = gpd.sjoin_nearest(pts[fuori], upl[["UPL", "geometry"]], how="left",
                             max_distance=MAX_DIST_FUORI, distance_col="d")
    near = near[~near.index.duplicated(keep="first")]
    b.loc[near.index, "UPL"] = near["UPL"]
rep["scartati_fuori_upl"] = int(b["UPL"].isna().sum())
b = b[b["UPL"].notna()].copy()
b = b.merge(upl[["UPL", "Quartiere", "Circoscrizione"]], on="UPL", how="left")

# classi
b["uso"] = b.occupancy.apply(classe_uso)
b["alt"] = b.altezza.apply(classe_altezza)
b["sup"] = b.area.apply(classe_superficie)


# angolo del lato lungo (radianti, da asse x, in [0, pi)) e rettangolo minimo
def angolo(g):
    r = g.minimum_rotated_rectangle
    if not isinstance(r, Polygon):
        return 0.0
    c = list(r.exterior.coords)
    l1 = math.dist(c[0], c[1])
    l2 = math.dist(c[1], c[2])
    (x0, y0), (x1, y1) = (c[0], c[1]) if l1 >= l2 else (c[1], c[2])
    return math.atan2(y1 - y0, x1 - x0) % math.pi


b["ang"] = b.geometry.apply(angolo)
b["h"] = b.altezza.fillna(0).clip(lower=0)

rep["edifici_output"] = len(b)
rep["per_uso"] = {USI[k][0]: int(v) for k, v in b.uso.value_counts().sort_index().items()}
rep["per_altezza"] = {int(k): int(v) for k, v in b.alt.value_counts().sort_index().items()}
rep["per_superficie"] = {int(k): int(v) for k, v in b.sup.value_counts().sort_index().items()}

b[["UPL", "Quartiere", "Circoscrizione", "uso", "alt", "sup", "area", "h", "ang", "geometry"]] \
    .to_file(os.path.join(WORK, "edifici.gpkg"), driver="GPKG", layer="edifici")
json.dump(rep, open(os.path.join(WORK, "prep_report.json"), "w"), indent=2, ensure_ascii=False)
print(json.dumps(rep, indent=2, ensure_ascii=False))
