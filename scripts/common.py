"""Costanti e percorsi condivisi dalla pipeline (Fasi 1 e 6)."""
import os
import re
import unicodedata

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
WORK = os.path.join(ROOT, "data", "work")
OUT = os.path.join(ROOT, "data")

GPKG = "/home/coseerobe/GitHub-Clone/coseerobe/DigitalTwin/dati/edifici/edificato.gpkg"
CONF = "/home/coseerobe/GitHub-Clone/coseerobe/palermo_popolazione/dati/geo_{}.geojson"
CRS = 32632  # UTM 32N, come i confini

MIN_AREA = 5.0          # m2: sotto questa soglia l'edificio e' scartato
MAX_DIST_FUORI = 50.0   # m: raggio per assegnare gli edifici fuori da ogni UPL
SIMPLIFY = 0.3          # m: tolleranza di semplificazione delle impronte
SIMPLIFY_ZONE = 2.0     # m: tolleranza per i contorni delle zone
SIMPLIFY_SEL = 25.0     # m: tolleranza per i contorni del selettore
DM = 10                 # coordinate esportate in decimetri

# Classi (l'ordine e' l'indice salvato nei JSON e va tenuto uguale nell'app)
USI = [  # (id, nome, prefissi occupancy)
    ("RES", "Residenziale", ("RES",)),
    ("COM", "Commerciale e servizi", ("COM",)),
    ("MIX", "Uso misto", ("MIX",)),
    ("IND", "Industriale", ("IND",)),
    ("ASS", "Assistenza e culto", ("ASS",)),
    ("EDU", "Istruzione", ("EDU",)),
    ("GOV", "Pubblica amministrazione", ("GOV",)),
    ("AGR", "Agricolo", ("AGR",)),
    ("ND", "Non classificato", ()),
]
ALTEZZE = [  # (nome, limite superiore incluso in m)
    ("fino a 3 m", 3), ("3–6 m", 6), ("6–12 m", 12),
    ("12–18 m", 18), ("18–30 m", 30), ("oltre 30 m", float("inf")),
]
ALT_ND = len(ALTEZZE)  # indice di "altezza non disponibile"
SUPERFICI = [("sotto 50 m²", 50), ("50–200 m²", 200), ("200–1.000 m²", 1000), ("oltre 1.000 m²", float("inf"))]


def slug(s):
    s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode()
    return re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")


def classe_uso(occ):
    if occ is None or occ != occ:
        return len(USI) - 1
    for i, (_, _, pref) in enumerate(USI):
        if pref and occ.startswith(pref):
            return i
    return len(USI) - 1


def classe_altezza(h):
    if not h or h <= 0:
        return ALT_ND
    for i, (_, lim) in enumerate(ALTEZZE):
        if h <= lim:
            return i
    return len(ALTEZZE) - 1


def classe_superficie(a):
    for i, (_, lim) in enumerate(SUPERFICI):
        if a < lim:
            return i
    return len(SUPERFICI) - 1
