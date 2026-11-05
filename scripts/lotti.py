"""Intersezione edifici x particelle catastali (logica pura, usata da 09_lotti.py).

Tutto in un CRS metrico (EPSG:32632). Un edificio "conta" in una particella se almeno `soglia` (10%) della sua impronta
ci cade dentro; il suo lotto principale e' quello con la sovrapposizione maggiore; e' "a cavallo" se conta in piu' di una.
"""
import geopandas as gpd
import numpy as np
import pandas as pd
import shapely


def calcola(lotti, edifici, soglia=0.10):
    """-> (L, E). L: una riga per lotto (m2, cop_m2, cop 0-100, n, nt, lib, cav). E: una riga per edificio (lotto, cav)."""
    lg = shapely.make_valid(lotti.geometry.values)
    eg = shapely.make_valid(edifici.geometry.values)
    nl, ne = len(lg), len(eg)
    m2 = shapely.area(lg)

    e_lotto = np.full(ne, -1, dtype=int)
    e_cav = np.zeros(ne, dtype=bool)
    lotto_cav = np.zeros(nl, dtype=bool)
    n_lotto = np.zeros(nl, dtype=int)
    nt_lotto = np.zeros(nl, dtype=int)   # edifici che contano nel lotto (>= soglia), anche se il loro lotto principale e' un altro
    cop_m2 = np.zeros(nl)
    if ne and nl:
        tree = shapely.STRtree(lg)
        ei, li = tree.query(eg, predicate="intersects")
        ov = shapely.area(shapely.intersection(eg[ei], lg[li]))
        e_area = shapely.area(eg)
        d = pd.DataFrame({"e": ei, "l": li, "ov": ov})
        d = d[(d.ov > 0) & (d.ov >= soglia * e_area[d.e.values])]
        d = d.sort_values(["e", "ov"], ascending=[True, False])
        princ = d.drop_duplicates("e")
        e_lotto[princ.e.values] = princ.l.values
        np.add.at(n_lotto, princ.l.values, 1)
        np.add.at(nt_lotto, d.l.values, 1)
        molte = d.e.value_counts()
        molte = molte[molte > 1].index.values
        e_cav[molte] = True
        lotto_cav[d[d.e.isin(molte)].l.values] = True
        for l, grp in d.groupby("l"):                         # area coperta senza doppi conteggi
            parti = shapely.intersection(eg[grp.e.values], lg[l])
            cop_m2[l] = shapely.area(shapely.union_all(parti))
    cop = np.minimum(100, np.rint(100 * cop_m2 / np.where(m2 > 0, m2, 1))).astype(int)
    L = pd.DataFrame({"m2": m2, "cop_m2": np.minimum(cop_m2, m2), "cop": cop, "n": n_lotto, "nt": nt_lotto,
                      "lib": nt_lotto == 0, "cav": lotto_cav})
    E = pd.DataFrame({"lotto": e_lotto, "cav": e_cav})
    return L, E
