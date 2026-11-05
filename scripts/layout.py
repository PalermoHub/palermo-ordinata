"""Packing a righe: porting di js/layout.js. Tenere i due file allineati.

Unita': decimetri. items: lista di (bw, bh). order: indici gia' ordinati.
group(i) -> classe oppure None. Ritorna (pos, w, h, labels) con pos[i] = (x, y) del centro dello slot.
"""
import math

GAP = 15
FILL = 1.12
LABEL_H = 260


def pack(items, order, aspect, group=None, lab_h=LABEL_H):
    tot = 0.0
    for i in order:
        tot += (items[i][0] + GAP) * (items[i][1] + GAP)
    W = max(math.sqrt(tot * FILL * aspect), 1)
    pos = [None] * len(items)
    labels = []
    x = y = row_h = max_x = 0.0
    last = None
    first = True
    for i in order:
        bw, bh = items[i]
        if group:
            g = group(i)
            if first or g != last:
                if x > 0:
                    y += row_h + GAP
                    x = 0
                    row_h = 0
                if not first:
                    y += GAP * 2
                labels.append((g, y))
                y += lab_h + GAP
                last = g
                first = False
        if x > 0 and x + bw > W:
            x = 0
            y += row_h + GAP
            row_h = 0
        pos[i] = (x + bw / 2, y + bh / 2)
        x += bw + GAP
        max_x = max(max_x, x)
        row_h = max(row_h, bh)
    return pos, max(max_x - GAP, 1), y + row_h, labels
