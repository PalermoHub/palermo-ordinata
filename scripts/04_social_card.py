#!/usr/bin/env python3
"""Genera img/social-card.png (1200x630) per Open Graph / Twitter card.

Sagome reali degli edifici di Palermo (poligoni dei dati), raddrizzate sul lato
lungo e ordinate in righe dal più grande al più piccolo, colorate per altezza
come nell'app. Uso: python3 scripts/04_social_card.py
"""
import glob, json, math, os
import numpy as np
from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
W, H, SS = 1200, 630, 2
BG = (14, 17, 22)
TEXT, DIM, ACCENT = (230, 233, 239), (154, 164, 178), (245, 166, 35)
ALT = ['#35476b', '#3f78a8', '#3fa7a0', '#8fcf6a', '#f2d04b', '#f27a45', '#5a6070']
ALT = [tuple(int(c[i:i + 2], 16) for i in (1, 3, 5)) for c in ALT]
SKIP, N_TOP = 150, 1500       # salta i colossi (porto, industrie), poi mostra fino a N_TOP edifici
SCALE = 0.07                  # px per decimetro
GAP = 2.5                     # px tra una sagoma e l'altra

# ---- dati: 8 circoscrizioni = tutta la città; teniamo i più grandi
idx = json.load(open(f'{ROOT}/data/index.json'))
zone = {z['id']: z for z in idx['zone']}
bs, pts = [], []
for f in sorted(glob.glob(f'{ROOT}/data/zone/circ-*.json')):
    z = json.load(open(f)); o = zone[z['id']]
    bs += z['b']
    pts += [(b[1], b[3], max(b[6], b[7]), o['ox'] + b[8], o['oy'] + b[9]) for b in z['b']]
pts = np.array(pts, float)
bs.sort(key=lambda r: -r[3])
visti, uniq = set(), []                           # i dati hanno edifici duplicati: ne mostriamo uno solo
for r in bs:
    kd = (r[3], r[6], r[7], r[1])
    if kd not in visti: visti.add(kd); uniq.append(r)
bs = uniq
bs = [r for r in bs if r[1] != 6][SKIP:SKIP + N_TOP]       # [uso, alt, sup, area, h_dm, ang, bw, bh, cx, cy, rings]


def sagoma(r):
    """Anelli ruotati sul lato lungo, traslati in modo che il bbox parta da (0,0)."""
    ang = r[5]; c, s = math.cos(ang), math.sin(ang)
    rings = [np.array(g, float).reshape(-1, 2) @ np.array([[c, -s], [s, c]]) for g in r[10]]
    allp = np.vstack(rings); lo = allp.min(0)
    rings = [g - lo for g in rings]
    w, h = np.ptp(allp[:, 0]), np.ptp(allp[:, 1])
    if h > w:                                   # lato lungo in orizzontale
        rings = [np.column_stack([g[:, 1], w - g[:, 0]]) for g in rings]; w, h = h, w
    return rings, w, h


img = Image.new('RGB', (W * SS, H * SS), BG); d = ImageDraw.Draw(img)
k = SCALE * SS
X0 = 490 * SS                                   # le sagome occupano la parte destra
x, y, rh = X0, 12 * SS, 0.0
for r in bs:
    rings, w, h = sagoma(r)
    pw, ph = w * k, h * k
    if x + pw > W * SS:
        x = X0; y += rh + GAP * SS; rh = 0
    if y > H * SS: break
    col = ALT[r[1]]
    for g in rings:
        d.polygon([(x + px * k, y + py * k) for px, py in g], fill=col)
    x += pw + GAP * SS; rh = max(rh, ph)

# ---- mappa generale: la città com'è (posizioni reali)
MX, MY, MW, MH = 30, 24, 400, 290
alt, area, ext, PX, PY = pts.T
kk = min(MW * SS / np.ptp(PX), MH * SS / np.ptp(PY))
ox = MX * SS + (MW * SS - np.ptp(PX) * kk) / 2; oy = MY * SS + (MH * SS - np.ptp(PY) * kk) / 2
for i in np.argsort(-area):
    px = ox + (PX[i] - PX.min()) * kk; py = oy + (PY.max() - PY[i]) * kk
    r = max(0.9, 0.5 * ext[i] * kk)
    d.rectangle([px - r, py - r, px + r, py + r], fill=ALT[int(alt[i])])

# ---- velo sfumato a sinistra per il testo
veil = Image.new('L', img.size, 0); vd = ImageDraw.Draw(veil)
for xx in range(0, 760 * SS):
    a = 255 if xx <= 440 * SS else int(255 * max(0, 1 - (xx - 440 * SS) / (30 * SS)))
    vd.line([xx, 330 * SS, xx, H * SS], fill=a)
    vd.line([xx, 0, xx, 330 * SS], fill=int(a * 0) if False else (255 if xx > 440 * SS and xx < 490 * SS else 0))
img = Image.composite(Image.new('RGB', img.size, BG), img, veil)
d = ImageDraw.Draw(img)

F = lambda n, s: ImageFont.truetype(f'/mnt/c/Windows/Fonts/{n}', s * SS)
d.text((48 * SS, 338 * SS), 'Palermo, ordinata', font=F('segoeuib.ttf', 46), fill=TEXT)
d.text((52 * SS, 410 * SS), 'Gli edifici zona per zona,', font=F('segoeui.ttf', 28), fill=DIM)
d.text((52 * SS, 446 * SS), 'dal più grande al più piccolo', font=F('segoeui.ttf', 28), fill=DIM)
d.text((52 * SS, 556 * SS), '111.478 edifici · 88 zone', font=F('seguisb.ttf', 24), fill=TEXT)

out = f'{ROOT}/img/social-card.png'
img.resize((W, H), Image.LANCZOS).save(out, optimize=True)
print(out, os.path.getsize(out) // 1024, 'KB')
