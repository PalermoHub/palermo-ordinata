"""Autocorrelazione spaziale sulle UPL: Moran's I globale e LISA (Anselin 1995).

Variabili per UPL: altezza media (m, edifici con altezza nota), copertura
(impronta a terra / area UPL) e densita' (edifici per km2). Pesi: contiguita'
queen (tolleranza 1 m), standardizzati per riga; le UPL isolate ricevono i 2
vicini piu' vicini. Significativita' con 9999 permutazioni condizionate.
Variabili dai lotti catastali (servono 09_lotti.py: data/work/lotti.geojsonl e data/lotti/edifici.json):
lotto mediano (m2, particelle non stradali con punto rappresentativo nella UPL), frammentazione (particelle per
ettaro), quota di edifici a cavallo di piu' particelle (%), quota di particelle senza edifici (%).
Legge data/work/edifici.gpkg (01_prep.py) e scrive data/moran.json.
Uso: python3 scripts/08_moran.py
"""
import json
import os

import geopandas as gpd
import numpy as np

from common import *

PERM = 9999
SEED = 20261105
ALPHA = 0.05
VARIABILI = [
    ("alt", "Altezza media", "m"),
    ("cop", "Copertura del suolo", "%"),
    ("den", "Densità di edifici", "edifici/km²"),
    ("lmed", "Lotto mediano", "m²"),
    ("frag", "Frammentazione dei lotti", "lotti/ha"),
    ("cavq", "Edifici a cavallo", "%"),
    ("vuoq", "Lotti non costruiti", "%"),
]
CLUSTER = ["ns", "HH", "LL", "LH", "HL"]  # indice salvato nel JSON

upl = gpd.read_file(CONF.format("upl")).set_crs(CRS, allow_override=True)
b = gpd.read_file(os.path.join(WORK, "edifici.gpkg"), layer="edifici")

g = b.groupby("UPL")
tab = upl[["UPL", "Quartiere", "Circoscrizione"]].copy()
tab["area_km2"] = upl.geometry.area.values / 1e6
tab["n"] = tab.UPL.map(g.size()).fillna(0).astype(int)
tab["foot"] = tab.UPL.map(g.area.sum()).fillna(0)
hv = b[b.h > 0].groupby("UPL").h.mean()
tab["alt"] = tab.UPL.map(hv)
tab["cop"] = 100 * tab.foot / (tab.area_km2 * 1e6)
tab["den"] = tab.n / tab.area_km2
tab["id"] = "upl-" + tab.UPL.map(slug)

# --- variabili dai lotti catastali ---
lotti = gpd.read_file(os.path.join(WORK, "lotti.geojsonl")).to_crs(CRS)
lotti = lotti[~lotti.Paricella.astype(str).str.upper().str.startswith("STRADA")].copy()   # le particelle stradali non sono lotti
lotti["geometry"] = lotti.geometry.representative_point()
j = gpd.sjoin(lotti[["m2", "lib", "geometry"]], upl[["UPL", "geometry"]], how="inner", predicate="within")
gl = j.groupby("UPL")
tab["lmed"] = tab.UPL.map(gl.m2.median())
tab["frag"] = tab.UPL.map(gl.size()) / (tab.area_km2 * 100)          # particelle per ettaro (1 km2 = 100 ha)
tab["vuoq"] = 100 * tab.UPL.map(gl.lib.mean())
idx = json.load(open(os.path.join(OUT, "index.json")))
ed = json.load(open(os.path.join(OUT, "lotti", "edifici.json")))
cav = np.array(ed["cav"])
cavn, off = {}, 0
for z in [z for z in idx["zone"] if z["level"] == "upl"]:          # stesso ordine "UPL concatenate" di edifici.json
    cavn[z["name"]] = int(((cav >= off) & (cav < off + z["n"])).sum()); off += z["n"]
tab["cavq"] = 100 * tab.UPL.map(cavn) / tab.n.replace(0, np.nan)
# UPL senza edifici (o senza altezze) non hanno un valore: restano fuori dall'analisi
ok = tab.n.gt(0) & tab.alt.notna() & tab.lmed.notna()
print("UPL escluse:", list(tab.UPL[~ok]))
tab = tab[ok].reset_index(drop=True)
geom = upl.set_index("UPL").geometry.loc[tab.UPL].reset_index(drop=True)
N = len(tab)

# pesi queen
buf = geom.buffer(1.0)
sidx = buf.sindex
W = np.zeros((N, N))
for i in range(N):
    for j in sidx.query(buf[i], predicate="intersects"):
        if j != i:
            W[i, j] = 1
isol = np.where(W.sum(1) == 0)[0]
if len(isol):
    c = np.c_[geom.centroid.x, geom.centroid.y]
    for i in isol:
        d = np.hypot(*(c - c[i]).T)
        for j in np.argsort(d)[1:3]:
            W[i, j] = W[j, i] = 1
print("UPL:", N, "isolate (knn):", len(isol), "vicini medi:", W.sum(1).mean().round(2))
Wr = W / W.sum(1, keepdims=True)

rng = np.random.default_rng(SEED)


def moran(x):
    z = x - x.mean()
    return len(x) / Wr.sum() * (z @ Wr @ z) / (z @ z)


def lisa(x):
    z = (x - x.mean()) / x.std()
    I = z * (Wr @ z)
    # permutazioni condizionate: z_i fisso, gli altri valori rimescolati
    cnt = np.zeros(N)
    for i in range(N):
        k = W[i] > 0
        m = int(k.sum())
        altri = np.delete(z, i)
        idx = np.argsort(rng.random((PERM, N - 1)), axis=1)[:, :m]
        lag = altri[idx].mean(1)  # righe standardizzate: media dei vicini
        sim = z[i] * lag
        # p pseudo a due code
        cnt[i] = (min((sim >= I[i]).sum(), (sim <= I[i]).sum()) + 1) / (PERM + 1) * 2
    p = np.minimum(cnt, 1.0)
    lag = Wr @ z
    q = np.where((z > 0) & (lag > 0), 1, np.where((z < 0) & (lag < 0), 2, np.where((z < 0) & (lag > 0), 3, 4)))
    return z, lag, I, p, q


out = {"permutazioni": PERM, "alpha": ALPHA, "n_upl": int(N), "pesi": "queen, standardizzati per riga",
       "cluster": CLUSTER, "variabili": []}
for key, nome, um in VARIABILI:
    x = tab[key].to_numpy(float)
    I = moran(x)
    sim = np.array([moran(rng.permutation(x)) for _ in range(PERM)])
    p = (np.sum(np.abs(sim - sim.mean()) >= abs(I - sim.mean())) + 1) / (PERM + 1)
    z, lag, Ii, pl, q = lisa(x)
    sig = pl < ALPHA
    cl = np.where(sig, q, 0)
    out["variabili"].append({
        "id": key, "nome": nome, "um": um,
        "I": round(float(I), 4), "E": round(-1 / (N - 1), 4), "p": round(float(p), 4),
        "z": round(float((I - sim.mean()) / sim.std()), 2),
        "media": round(float(x.mean()), 2),
        "upl": {tab.id[i]: [round(float(x[i]), 2), round(float(z[i]), 2), round(float(lag[i]), 2),
                            round(float(Ii[i]), 3), round(float(pl[i]), 4), int(cl[i])] for i in range(N)},
        "conteggi": {CLUSTER[k]: int((cl == k).sum()) for k in range(5)},
    })
    print(nome, "I=%.3f p=%.4f" % (I, p), out["variabili"][-1]["conteggi"])

out["schema_upl"] = ["valore", "z", "lag_z", "Ii", "p", "cluster"]
json.dump(out, open(os.path.join(OUT, "moran.json"), "w"), ensure_ascii=False, separators=(",", ":"))
print("scritto data/moran.json")
