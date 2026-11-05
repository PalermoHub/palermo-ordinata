"""Test di lotti.calcola con quadrati sintetici in metri (EPSG:32632).

Uso: ~/micromamba/envs/qgis/bin/python -m pytest scripts/test_lotti.py -q
"""
import os
import sys

import geopandas as gpd
from shapely.geometry import Polygon, box

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from lotti import calcola


def gdf(geoms):
    return gpd.GeoDataFrame({"geometry": geoms}, crs=32632)


def test_edificio_dentro_lotto():
    L, E = calcola(gdf([box(0, 0, 100, 100)]), gdf([box(10, 10, 20, 20)]))
    assert L.loc[0, "m2"] == 10000
    assert L.loc[0, "cop"] == 1 and L.loc[0, "n"] == 1 and not L.loc[0, "lib"]
    assert E.loc[0, "lotto"] == 0 and not E.loc[0, "cav"]


def test_lotto_libero():
    L, E = calcola(gdf([box(0, 0, 100, 100), box(200, 0, 300, 100)]), gdf([box(10, 10, 20, 20)]))
    assert L.loc[1, "n"] == 0 and L.loc[1, "lib"] and L.loc[1, "cop"] == 0


def test_edificio_a_cavallo():
    lotti = gdf([box(0, 0, 60, 100), box(60, 0, 100, 100)])
    L, E = calcola(lotti, gdf([box(30, 10, 70, 30)]))        # 30 m nel lotto 0, 10 m nel lotto 1
    assert E.loc[0, "lotto"] == 0 and E.loc[0, "cav"]
    assert L.loc[0, "cav"] and L.loc[1, "cav"]
    assert L.loc[0, "n"] == 1 and L.loc[1, "n"] == 0


def test_sotto_soglia():
    lotti = gdf([box(0, 0, 100, 100), box(100, 0, 200, 100)])
    L, E = calcola(lotti, gdf([box(95, 10, 195, 20)]))       # 5% dentro il lotto 0, 95% nel lotto 1
    assert L.loc[0, "lib"] and L.loc[0, "n"] == 0
    assert E.loc[0, "lotto"] == 1 and not E.loc[0, "cav"]


def test_rapporto_troncato():
    L, _ = calcola(gdf([box(0, 0, 10, 10)]), gdf([box(-5, -5, 15, 15)]))
    assert L.loc[0, "cop"] == 100 and L.loc[0, "cop_m2"] <= L.loc[0, "m2"]


def test_edificio_senza_lotto():
    L, E = calcola(gdf([box(0, 0, 10, 10)]), gdf([box(500, 500, 510, 510)]))
    assert E.loc[0, "lotto"] == -1 and not E.loc[0, "cav"] and L.loc[0, "lib"]


def test_geometria_invalida():
    farfalla = Polygon([(0, 0), (100, 100), (100, 0), (0, 100)])
    L, E = calcola(gdf([farfalla]), gdf([box(10, 40, 20, 60)]))
    assert len(L) == 1 and len(E) == 1 and L.loc[0, "m2"] > 0


def test_nessun_edificio():
    L, E = calcola(gdf([box(0, 0, 10, 10)]), gdf([]))
    assert len(L) == 1 and L.loc[0, "lib"] and len(E) == 0


def test_lotto_toccato_solo_da_edificio_a_cavallo_non_e_libero():
    """Edificio 100 m2: 55 nel lotto A, 45 nel lotto B (60 m2). B non e' libero: ha costruito sopra."""
    lotti = gdf([box(0, 0, 55, 1), box(55, 0, 115, 1)])
    L, E = calcola(lotti, gdf([box(0, 0, 100, 1)]))
    assert E.loc[0, "lotto"] == 0
    assert L.loc[1, "n"] == 0 and L.loc[1, "nt"] == 1       # nt = edifici che contano nel lotto, anche a cavallo
    assert not L.loc[1, "lib"] and L.loc[1, "cop"] == 75
    assert L.loc[0, "nt"] == 1 and L.loc[0, "n"] == 1


def test_nt_uguale_a_n_senza_cavallo():
    L, _ = calcola(gdf([box(0, 0, 100, 100)]), gdf([box(10, 10, 20, 20), box(30, 30, 40, 40)]))
    assert L.loc[0, "n"] == 2 and L.loc[0, "nt"] == 2
