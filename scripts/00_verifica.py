"""Fase 0: verifica dei dati di input (sola lettura, nessun file scritto).

Uso: PROJ_DATA=~/micromamba/envs/qgis/share/proj ~/micromamba/envs/qgis/bin/python 00_verifica.py
"""
import warnings
import geopandas as gpd
import numpy as np

warnings.filterwarnings("ignore")

GPKG = "/home/coseerobe/GitHub-Clone/coseerobe/DigitalTwin/dati/edifici/edificato.gpkg"
CONF = "/home/coseerobe/GitHub-Clone/coseerobe/palermo_popolazione/dati/geo_{}.geojson"
CRS = 32632

circ = gpd.read_file(CONF.format("circoscrizioni")).set_crs(CRS, allow_override=True)
quar = gpd.read_file(CONF.format("quartieri")).set_crs(CRS, allow_override=True)
upl = gpd.read_file(CONF.format("upl")).set_crs(CRS, allow_override=True)

print("== CONFINI ==")
for nome, g in (("circoscrizioni", circ), ("quartieri", quar), ("UPL", upl)):
    inv = (~g.geometry.is_valid).sum()
    print(f"{nome}: {len(g)} feature, non valide {inv}, area totale {g.area.sum()/1e6:.2f} km2")

# gerarchia: ogni UPL deve cadere nel suo quartiere e nella sua circoscrizione
u = upl.copy()
u["rp"] = u.geometry.representative_point()
q_by_name = quar.set_index("Quartiere").geometry
bad = [r.UPL for r in u.itertuples() if not q_by_name[r.Quartiere].buffer(1).contains(r.rp)] \
    if quar["Quartiere"].is_unique else ["quartiere non univoco"]
print("UPL fuori dal proprio quartiere:", bad)
print("quartieri per circoscrizione:", quar.groupby("Circoscrizione").size().to_dict())
print("UPL per quartiere (min/max):", u.groupby("Quartiere").size().min(), u.groupby("Quartiere").size().max())
print("nomi UPL duplicati:", u["UPL"][u["UPL"].duplicated()].tolist())

# sovrapposizioni e buchi tra UPL
ov = gpd.overlay(upl[["UPL", "geometry"]].assign(geometry=upl.geometry.make_valid()),
                 upl[["UPL", "geometry"]].assign(geometry=upl.geometry.make_valid()),
                 how="intersection", keep_geom_type=True)
ov = ov[ov["UPL_1"] != ov["UPL_2"]]
print(f"sovrapposizioni tra UPL: {len(ov)//2} coppie, area {ov.area.sum()/2:.0f} m2")
print(f"somma UPL {upl.area.sum()/1e6:.3f} km2 vs unione {upl.union_all().area/1e6:.3f} km2 "
      f"vs circoscrizioni {circ.area.sum()/1e6:.3f} km2")

print("\n== EDIFICI ==")
b = gpd.read_file(GPKG)
print("righe:", len(b), "CRS:", b.crs)
b = b.to_crs(CRS)
b["geometry"] = b.geometry.force_2d()
inv = ~b.geometry.is_valid
print("geometrie non valide:", int(inv.sum()))
b.loc[inv, "geometry"] = b.loc[inv, "geometry"].make_valid()
print("tipi dopo make_valid:", b.geometry.geom_type.value_counts().to_dict())
b["area_geom"] = b.geometry.area
print("area_mq nulla:", int(b.area_mq.isna().sum()),
      "| per source:", b[b.area_mq.isna()].source.value_counts().to_dict())
ok = b.area_mq.notna() & (b.area_mq > 0)
rap = (b.area_geom[ok] / b.area_mq[ok])
print("area_geom/area_mq: mediana %.3f, p1 %.3f, p99 %.3f" % (rap.median(), rap.quantile(.01), rap.quantile(.99)))
print("area_geom: min %.2f max %.0f mediana %.0f | <5 m2: %d | <10 m2: %d | >5000 m2: %d" % (
    b.area_geom.min(), b.area_geom.max(), b.area_geom.median(),
    (b.area_geom < 5).sum(), (b.area_geom < 10).sum(), (b.area_geom > 5000).sum()))
print("n. poligoni per MultiPolygon >1:", int((b.geometry.apply(lambda g: len(getattr(g, 'geoms', [g]))) > 1).sum()))
print("altezza: nulla %d, =0 %d | quantili 5/25/50/75/95/99:" % (b.altezza.isna().sum(), (b.altezza <= 0).sum()),
      np.round(b.altezza.quantile([.05, .25, .5, .75, .95, .99]).values, 1), "max", b.altezza.max())
print("altezza = 0 per source:", b[b.altezza <= 0].source.value_counts().to_dict())
for lim in (3, 6, 9, 12, 18, 30):
    print(f"  altezza <= {lim:>2} m: {(b.altezza <= lim).mean()*100:5.1f}%")

print("\n== occupancy ==")
occ = b.occupancy.fillna("(null)")
print(occ.value_counts().to_string())
print("prefissi:", occ.str.replace(r"\d+$", "", regex=True).value_counts().to_dict())
print("UNK per source:", b[occ == "UNK"].source.value_counts().to_dict())

print("\n== JOIN con UPL (centroide / punto rappresentativo) ==")
pts = b[["geometry"]].copy()
pts["geometry"] = b.geometry.representative_point()
j = gpd.sjoin(pts, upl[["UPL", "geometry"]], how="left", predicate="within")
j = j[~j.index.duplicated(keep="first")]
fuori = j["UPL"].isna()
print("edifici fuori da ogni UPL:", int(fuori.sum()), f"({fuori.mean()*100:.2f}%)")
cnt = j["UPL"].value_counts()
print("edifici per UPL: min %d, mediana %d, max %d | UPL senza edifici: %d" % (
    cnt.min(), cnt.median(), cnt.max(), len(upl) - len(cnt)))
print(cnt.tail(8).to_string())
print(cnt.head(5).to_string())
b["UPL"] = j["UPL"]
by_c = b.merge(upl[["UPL", "Quartiere", "Circoscrizione"]].drop_duplicates("UPL"), on="UPL", how="left")
print("per circoscrizione:", by_c["Circoscrizione"].value_counts().to_dict())
print("edifici per quartiere (max):", by_c["Quartiere"].value_counts().head(3).to_dict())
