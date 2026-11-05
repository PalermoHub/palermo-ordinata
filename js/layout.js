/* Layout "shelf packing": edifici ordinati per area decrescente, in righe.
   Unita': decimetri. Input: items con bw, bh (dimensioni dello slot) e area.
   Algoritmo duplicato in scripts/03_make_animation.py (Fase 6): tenerli allineati. */
(function (root) {
  const GAP = 15;          // 1,5 m
  const FILL = 1.12;       // margine sulla larghezza del contenitore
  const LABEL_H = 260;     // 26 m: spazio per l'etichetta di gruppo

  /* order: array di indici in items, gia' ordinati. group(i) -> classe (opzionale).
     Ritorna {pos: Float64Array(2n) centri slot, w, h, labels:[{cls, y}]} */
  function pack(items, order, aspect, group, labH) {
    labH = labH || LABEL_H;
    let tot = 0;
    for (const i of order) tot += (items[i].bw + GAP) * (items[i].bh + GAP);
    const W = Math.max(Math.sqrt(tot * FILL * aspect), 1);
    const pos = new Float64Array(items.length * 2);
    const labels = [];
    let x = 0, y = 0, rowH = 0, last = null, maxX = 0;
    for (const i of order) {
      const it = items[i];
      if (group) {
        const g = group(i);
        if (g !== last) {
          if (x > 0) { y += rowH + GAP; x = 0; rowH = 0; }
          if (last !== null) y += GAP * 2;
          labels.push({ cls: g, y });
          y += labH + GAP;
          last = g;
        }
      }
      if (x > 0 && x + it.bw > W) { x = 0; y += rowH + GAP; rowH = 0; }
      pos[2 * i] = x + it.bw / 2;
      pos[2 * i + 1] = y + it.bh / 2;
      x += it.bw + GAP;
      if (x > maxX) maxX = x;
      if (it.bh > rowH) rowH = it.bh;
    }
    return { pos, w: Math.max(maxX - GAP, 1), h: y + rowH, labels };
  }

  root.Layout = { pack, GAP, LABEL_H };
})(typeof window !== 'undefined' ? window : globalThis);
