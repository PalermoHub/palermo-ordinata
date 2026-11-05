"""Fase 6: frame PNG dell'animazione Mappa -> Ordinata -> Mappa di una zona.

Uso: 03_make_animation.py <id zona> [--ss 2] [--colore alt|sup|uso] [--no-raggruppa] [--out frames]
Poi: scripts/make_gif.sh <id zona>  (ffmpeg -> img/anim/<id>.mp4 e .gif)

Disegna con Pillow (nessun browser), 1080x1350. Layout e interpolazione sono quelli di js/app.js.
Font: DejaVu Sans, oppure Inter se si imposta FONT_DIR (con Inter-Regular.otf, Inter-Bold.otf).
"""
import argparse
import json
import math
import os
import shutil
import sys
from multiprocessing import Pool

import numpy as np
from PIL import Image, ImageDraw, ImageFont

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from layout import pack  # noqa: E402

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
W, H = 1080, 1350
AREA = (60, 230, 1020, 1150)                       # area di disegno (x0, y0, x1, y1)
FPS = 25
HOLD_MAP, MOVE, HOLD_SORT = 1.6, 2.2, 2.8
LAB_PX = 34                                         # altezza minima dello slot delle etichette (px)
BG, SUB, FOOT, FAINT = "#0f1115", "#c9ccd3", "#8a8f99", "#4a5060"
COLORI = {
    "uso": ["#f2b134", "#4fb3d9", "#e58fb0", "#b07cf0", "#ef6f6c", "#5fd38d", "#7e9cf5", "#9bc53d", "#5a6070"],
    "alt": ["#35476b", "#3f78a8", "#3fa7a0", "#8fcf6a", "#f2d04b", "#f27a45", "#5a6070"],
    "sup": ["#3f78a8", "#3fa7a0", "#f2d04b", "#f27a45"],
}
KEY = {"uso": 0, "alt": 1, "sup": 2}
NOME_COL = {"uso": "uso", "alt": "altezza", "sup": "superficie"}


def ease(t):
    return 4 * t ** 3 if t < 0.5 else 1 - (-2 * t + 2) ** 3 / 2


def tratteggia(dr, pts, colo, on, off, width):
    """Linea tratteggiata lungo una poligonale (px)."""
    pos_ciclo = 0.0
    for (x0, y0), (x1, y1) in zip(pts, pts[1:]):
        L = math.hypot(x1 - x0, y1 - y0)
        t = 0.0
        while t < L:
            fase = pos_ciclo % (on + off)
            if fase < on:
                f = min(on - fase, L - t)
                a, b = t / L, (t + f) / L
                dr.line([(x0 + (x1 - x0) * a, y0 + (y1 - y0) * a), (x0 + (x1 - x0) * b, y0 + (y1 - y0) * b)], fill=colo, width=width)
            else:
                f = min(on + off - fase, L - t)
            t += f
            pos_ciclo += f


def hex_rgb(h):
    h = h.lstrip("#")
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))


def mix(fg, a, bg=BG):
    f, b = hex_rgb(fg), hex_rgb(bg)
    return tuple(round(b[i] + (f[i] - b[i]) * a) for i in range(3))


def font(bold, size):
    d = os.environ.get("FONT_DIR")
    cand = [os.path.join(d, "Inter-Bold.otf" if bold else "Inter-Regular.otf")] if d else []
    cand.append("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf" if bold else "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf")
    for c in cand:
        if os.path.exists(c):
            return ImageFont.truetype(c, size)
    return ImageFont.load_default()


# ---------------------------------------------------------------- dati
def carica(zid, colore, raggruppa):
    index = json.load(open(os.path.join(ROOT, "data", "index.json")))
    zona = next(z for z in index["zone"] if z["id"] == zid)
    d = json.load(open(os.path.join(ROOT, "data", "zone", zid + ".json")))
    kk = KEY[colore]
    B = []
    for b in d["b"]:
        uso, alt, sup, area, h, ang, bw, bh, cx, cy, rings = b
        c, s = math.cos(ang), math.sin(ang)
        rr = []
        u0 = v0 = x0 = y0 = math.inf
        u1 = v1 = x1 = y1 = -math.inf
        for r in rings:
            p = np.array(r, dtype=float).reshape(-1, 2)
            p[:, 1] = -p[:, 1]                                  # y verso il basso
            rr.append(p)
            u = p[:, 0] * c - p[:, 1] * s
            v = p[:, 0] * s + p[:, 1] * c
            u0, u1 = min(u0, u.min()), max(u1, u.max())
            v0, v1 = min(v0, v.min()), max(v1, v.max())
            x0, x1 = min(x0, p[:, 0].min()), max(x1, p[:, 0].max())
            y0, y1 = min(y0, p[:, 1].min()), max(y1, p[:, 1].max())
        B.append(dict(cls=(uso, alt, sup), area=area, ang=ang, rings=rr,
                      lw=u1 - u0, lh=v1 - v0, lcx=(u0 + u1) / 2, lcy=(v0 + v1) / 2,
                      cx=cx, cy=-cy))
    order = list(range(len(B)))
    if raggruppa:
        order.sort(key=lambda i: (B[i]["cls"][kk], -B[i]["area"]))
    else:
        order.sort(key=lambda i: -B[i]["area"])
    return index, zona, d, B, order


def fit(L, bw, bh):
    x0, y0, x1, y1 = L
    w, h = x1 - x0, y1 - y0
    k = min(bw / w, bh / h)
    return dict(k=k, tx=(bw - w * k) / 2 - x0 * k + AREA[0], ty=(bh - h * k) / 2 - y0 * k + AREA[1])


def prepara(zid, colore, raggruppa):
    index, zona, d, B, order = carica(zid, colore, raggruppa)
    bw, bh = AREA[2] - AREA[0], AREA[3] - AREA[1]
    kk = KEY[colore]
    items = [(b["lw"], b["lh"]) for b in B]
    grp = (lambda i: B[i]["cls"][kk]) if raggruppa else None
    vm = fit((0, -d["h"], d["w"], 0), bw, bh)
    lab = 260
    pos, lw_, lh_, labels = pack(items, order, bw / bh, grp, lab)
    vs = fit((0, 0, lw_, lh_), bw, bh)
    for _ in range(3):
        if not raggruppa:
            break
        need = LAB_PX / vs["k"]
        if need <= lab * 1.02:
            break
        lab = need
        pos, lw_, lh_, labels = pack(items, order, bw / bh, grp, lab)
        vs = fit((0, 0, lw_, lh_), bw, bh)
    return dict(index=index, zona=zona, d=d, B=B, order=order, pos=pos, labels=labels,
                vm=vm, vs=vs, colore=colore, raggruppa=raggruppa)


# ---------------------------------------------------------------- frame
G = {}


def matrici(e):
    B, pos, vm, vs = G["B"], G["pos"], G["vm"], G["vs"]
    ang = G["ang"]
    a = ang * e
    c, s = np.cos(a), np.sin(a)
    k = vm["k"] + (vs["k"] - vm["k"]) * e
    mx = vm["tx"] + G["cx"] * vm["k"]
    my = vm["ty"] + G["cy"] * vm["k"]
    sx = vs["tx"] + (G["px"] - G["lcx"]) * vs["k"]
    sy = vs["ty"] + (G["py"] - G["lcy"]) * vs["k"]
    return c * k, s * k, mx + (sx - mx) * e, my + (sy - my) * e


def frame(e, ss=None):
    ss = ss or G["ss"]
    im = Image.new("RGB", (W * ss, H * ss), hex_rgb(BG))
    dr = ImageDraw.Draw(im)
    z, vm, vs = G["zona"], G["vm"], G["vs"]
    col = [hex_rgb(c) for c in COLORI[G["colore"]]]
    kk = KEY[G["colore"]]
    ck, sk, ox, oy = matrici(e)

    if e < 0.999:                                                       # contorno della zona
        colo = mix(FAINT, 1 - e)
        for r in G["d"]["outline"]:
            p = np.array(r, dtype=float).reshape(-1, 2)
            pts = [((vm["tx"] + x * vm["k"]) * ss, (vm["ty"] - y * vm["k"]) * ss) for x, y in p]
            pts.append(pts[0])
            tratteggia(dr, pts, colo, 10 * ss, 8 * ss, max(1, round(1.4 * ss)))

    for i in G["order"]:
        b = G["B"][i]
        a, bb, tx, ty = ck[i], sk[i], ox[i], oy[i]
        fill = col[b["cls"][kk]]
        outs = []
        for r in b["rings"]:
            X = (a * r[:, 0] - bb * r[:, 1] + tx) * ss
            Y = (bb * r[:, 0] + a * r[:, 1] + ty) * ss
            outs.append(np.column_stack([X, Y]).ravel().tolist())
        if len(outs) == 1:
            if len(outs[0]) >= 6:
                dr.polygon(outs[0], fill=fill)
        else:                                                           # anelli multipli: regola pari-dispari
            xs = [v for o in outs for v in o[0::2]]
            ys = [v for o in outs for v in o[1::2]]
            bx0, by0, bx1, by1 = int(min(xs)) - 1, int(min(ys)) - 1, int(max(xs)) + 2, int(max(ys)) + 2
            m = Image.new("1", (bx1 - bx0, by1 - by0), 0)
            xor = Image.new("1", m.size, 0)
            md = ImageDraw.Draw(xor)
            from PIL import ImageChops
            for o in outs:
                if len(o) < 6:
                    continue
                t = Image.new("1", m.size, 0)
                ImageDraw.Draw(t).polygon([v - (bx0 if j % 2 == 0 else by0) for j, v in enumerate(o)], fill=1)
                m = ImageChops.logical_xor(m, t)
            im.paste(fill, (bx0, by0), m)

    f_sub, f_lab = font(False, 22 * ss), font(False, 20 * ss)
    dr.text((60 * ss, 70 * ss), f"{z['name']} · {z['n']:,} edifici".replace(",", "."), font=font(True, 34 * ss), fill="white")
    cap1 = "Com'è" ; cap2 = f"Ordinati per {NOME_COL[G['colore']]} e per superficie" if G["raggruppa"] else "Ordinati per superficie"
    if e < 0.5:
        dr.text((60 * ss, 118 * ss), cap1, font=f_sub, fill=mix(SUB, 1 - 2 * e))
    if e > 0.5:
        dr.text((60 * ss, 118 * ss), cap2, font=f_sub, fill=mix(SUB, 2 * e - 1))
    if G["raggruppa"] and e > 0.6:                                      # etichette dei gruppi
        nomi = G["index"]["classi"][G["colore"]]
        colt = mix(SUB, (e - 0.6) / 0.4)
        for cls, y in G["labels"]:
            dr.text((vs["tx"] * ss, (vs["ty"] + y * vs["k"]) * ss), nomi[cls]["nome"], font=f_lab, fill=colt)

    # legenda (solo classi presenti), a capo
    f_leg = font(False, 18 * ss)
    nomi = G["index"]["classi"][G["colore"]]
    q = z[G["colore"]]["n"]
    x, y = 60, 1172
    for i, c in enumerate(nomi):
        if not q[i]:
            continue
        txt = c["nome"]
        wt = dr.textlength(txt, font=f_leg) / ss
        if x + 22 + wt > W - 60:
            x, y = 60, y + 28
        dr.rectangle([x * ss, (y + 3) * ss, (x + 14) * ss, (y + 17) * ss], fill=col[i])
        dr.text(((x + 22) * ss, y * ss), txt, font=f_leg, fill=SUB)
        x += 22 + wt + 22
    # barra di scala
    k = vm["k"] + (vs["k"] - vm["k"]) * e
    m = next((v for v in (10, 20, 50, 100, 200, 500, 1000, 2000, 5000) if v * 10 * k >= 100), 5000)
    L, ys = m * 10 * k, 1262
    xe = W - 60
    dr.line([((xe - L) * ss, ys * ss), (xe * ss, ys * ss)], fill=FOOT, width=2 * ss)
    for xx in (xe - L, xe):
        dr.line([(xx * ss, (ys - 6) * ss), (xx * ss, (ys + 6) * ss)], fill=FOOT, width=2 * ss)
    lab = f"{m} m" if m < 1000 else f"{m // 1000} km"
    dr.text((xe * ss, (ys - 12) * ss), lab, font=font(False, 16 * ss), fill=FOOT, anchor="rb")
    ff = font(False, 16 * ss)
    dr.text((60 * ss, 1298 * ss), "Edifici: DigitalTwin Palermo (CTC 2006, Overture Maps, GBA, OpenBuildingMap) · confini: Comune di Palermo.", font=ff, fill=FOOT)
    dr.text((60 * ss, 1320 * ss), "Palermo, ordinata", font=ff, fill=FOOT)
    return im.resize((W, H), Image.LANCZOS) if ss > 1 else im


def inizializza(st, ss):
    G.update(st)
    G["ss"] = ss
    B, pos = st["B"], st["pos"]
    G["ang"] = np.array([b["ang"] for b in B]) if st.get("lato", True) else np.zeros(len(B))
    G["cx"] = np.array([b["cx"] for b in B]); G["cy"] = np.array([b["cy"] for b in B])
    G["lcx"] = np.array([b["lcx"] for b in B]); G["lcy"] = np.array([b["lcy"] for b in B])
    G["px"] = np.array([p[0] for p in pos]); G["py"] = np.array([p[1] for p in pos])


def lavora(args):
    e, path = args
    frame(e).save(path, optimize=False, compress_level=1)
    return path


def sequenza():
    n_move = int(MOVE * FPS)
    s = [0.0] * int(HOLD_MAP * FPS)
    s += [ease(i / (MOVE * FPS)) for i in range(n_move + 1)]
    s += [1.0] * int(HOLD_SORT * FPS)
    s += [ease(1 - i / (MOVE * FPS)) for i in range(n_move + 1)]
    return s


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("zona")
    ap.add_argument("--ss", type=int, default=2)
    ap.add_argument("--colore", default="alt", choices=list(KEY))
    ap.add_argument("--no-raggruppa", action="store_true")
    ap.add_argument("--out", default=os.path.join(ROOT, "frames"))
    ap.add_argument("--jobs", type=int, default=os.cpu_count())
    a = ap.parse_args()

    st = prepara(a.zona, a.colore, not a.no_raggruppa)
    st["lato"] = True
    out = os.path.join(a.out, a.zona)
    shutil.rmtree(out, ignore_errors=True)
    os.makedirs(out)
    seq = sequenza()
    distinti = {}
    for n, e in enumerate(seq):
        distinti.setdefault(round(e, 5), []).append(n)
    lavori = [(e, os.path.join(out, f"_e{n:04d}.png")) for n, (e, _) in enumerate(distinti.items())]
    inizializza(st, a.ss)
    with Pool(a.jobs, initializer=inizializza, initargs=(st, a.ss)) as p:
        for i, _ in enumerate(p.imap_unordered(lavora, lavori), 1):
            if i % 20 == 0:
                print(f"  {i}/{len(lavori)} frame distinti", flush=True)
    for (e, tmp), (_, nn) in zip(lavori, distinti.items()):
        for n in nn:
            shutil.copyfile(tmp, os.path.join(out, f"{n:04d}.png"))
        os.remove(tmp)
    print(f"{len(seq)} frame ({len(distinti)} distinti, {len(seq)/FPS:.1f} s a {FPS} fps) in {out}")


if __name__ == "__main__":
    main()
