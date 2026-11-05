/* Vista Ordinata con tutte le zone: un blocco per zona (Layout.pack, invariato), centrato sul
   baricentro geografico della zona e rilassato fino a non sovrapporsi. Unita': decimetri, y verso il basso.
   Disponi(zone, perZona, {margine, cittaH}) ->
     {pos: Float64Array(2N) centri slot (indice globale), blocchi: [{z, x, y, w, h, etichette:[{cls,x,y}]}], w, h, sposta: [dx, dy]}
   perZona[z] = {items, order, group, indici}: input di Layout.pack e indice globale di ogni item. */
(function (root) {
  const MIN_LATO = 500;           // 50 m: blocco di una zona vuota
  const PASSI = 400;

  function disponi(zone, perZona, opz) {
    const L = root.Layout || (typeof require !== 'undefined' ? require('./layout.js') : null);
    const margine = opz.margine, H = opz.cittaH;
    const blocchi = [], locali = [];
    zone.forEach((zn, z) => {
      const p = perZona[z];
      const asp = Math.max(zn.w, 1) / Math.max(zn.h, 1);
      const r = p.items.length ? L.pack(p.items, p.order, asp, p.group || null) : { pos: new Float64Array(0), w: 0, h: 0 };
      const w = Math.max(r.w, MIN_LATO), h = Math.max(r.h, MIN_LATO);
      locali.push(r);
      blocchi.push({ z, x: zn.ox + zn.w / 2 - w / 2, y: H - (zn.oy + zn.h / 2) - h / 2, w, h });
    });

    for (let passo = 0; passo < PASSI; passo++) {            // rilassamento: spinge via le coppie sovrapposte
      let mosso = false;
      for (let i = 0; i < blocchi.length; i++) for (let j = i + 1; j < blocchi.length; j++) {
        const a = blocchi[i], b = blocchi[j];
        let dx = (b.x + b.w / 2) - (a.x + a.w / 2), dy = (b.y + b.h / 2) - (a.y + a.h / 2);
        const px = (a.w + b.w) / 2 + margine - Math.abs(dx), py = (a.h + b.h) / 2 + margine - Math.abs(dy);
        if (px <= 0 || py <= 0) continue;
        mosso = true;
        if (px < py) { const s = dx === 0 ? (i % 2 ? 1 : -1) : Math.sign(dx); a.x -= s * px / 2; b.x += s * px / 2; }
        else { const s = dy === 0 ? (i % 2 ? 1 : -1) : Math.sign(dy); a.y -= s * py / 2; b.y += s * py / 2; }
      }
      if (!mosso) break;
    }

    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const b of blocchi) { x0 = Math.min(x0, b.x); y0 = Math.min(y0, b.y); x1 = Math.max(x1, b.x + b.w); y1 = Math.max(y1, b.y + b.h); }
    const dx = -x0, dy = -y0;
    for (const b of blocchi) { b.x += dx; b.y += dy; }

    let N = 0;
    for (const p of perZona) N += p.indici.length;
    const pos = new Float64Array(2 * N);
    perZona.forEach((p, z) => {
      const b = blocchi[z], r = locali[z];
      const cx = b.x + (b.w - r.w) / 2, cy = b.y + (b.h - r.h) / 2;     // blocco piu' grande del contenuto: centrato
      p.indici.forEach((g, k) => { pos[2 * g] = cx + r.pos[2 * k]; pos[2 * g + 1] = cy + r.pos[2 * k + 1]; });
      b.etichette = (r.labels || []).map(l => ({ cls: l.cls, x: cx, y: cy + l.y }));   // etichette di gruppo, coordinate globali
    });
    return { pos, blocchi, w: x1 - x0, h: y1 - y0, sposta: [dx, dy] };
  }

  const Blocchi = { disponi };
  if (typeof module !== 'undefined' && module.exports) module.exports = Blocchi;
  else root.Blocchi = Blocchi;
})(typeof window !== 'undefined' ? window : globalThis);
