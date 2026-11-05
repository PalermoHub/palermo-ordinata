/* Autocorrelazione spaziale sulle UPL: Moran's I globale e LISA (cluster HH, LL, LH, HL). Solo vista Mappa.
   Il calcolo e' in scripts/08_moran.py (data/moran.json); qui solo disegno e pannello.
   Moran.carica(index) -> Promise: scarica moran.json e proietta i contorni delle UPL (una volta sola).
   Moran.pronto() -> bool.  Moran.varianti -> [{id, nome, um, I, E, p, z, media, conteggi, upl}].
   Moran.mostra(map, on, vid) accende/spegne il livello sulla mappa MapLibre (sopravvive al cambio di tema).
   Moran.bbox(id) -> bbox Mercator dell'UPL.  Moran.pannello(box, vid, azioni) disegna statistiche, grafico e elenchi.
   Moran.legenda(box, vid) disegna la legenda con i conteggi. */
(function (root) {
  const SRC = 'moran', FILL = 'moran-fill', LINE = 'moran-line';
  const CLS = ['ns', 'HH', 'LL', 'LH', 'HL'];                    // stesso ordine di scripts/08_moran.py
  const COL = { HH: '#d7191c', LL: '#2c7bb6', LH: '#8fc3e3', HL: '#f28e2b', ns: '#8a8f98' };
  const NOME = {
    HH: 'Alto-alto: hotspot', LL: 'Basso-basso: coldspot',
    LH: 'Basso tra alti: outlier', HL: 'Alto tra bassi: outlier', ns: 'Non significativo',
  };
  const SPIEGA = {
    HH: 'UPL con valore alto circondata da UPL con valori alti.',
    LL: 'UPL con valore basso circondata da UPL con valori bassi.',
    LH: 'UPL con valore basso circondata da UPL con valori alti.',
    HL: 'UPL con valore alto circondata da UPL con valori bassi.',
  };
  const N2 = new Intl.NumberFormat('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const N1 = new Intl.NumberFormat('it-IT', { maximumFractionDigits: 1 });
  const N0 = new Intl.NumberFormat('it-IT', { maximumFractionDigits: 0, useGrouping: 'always' });
  const fmtP = p => p <= 0.0001 ? '≤ 0,0001' : p < 0.001 ? '< 0,001' : N2.format(p).replace(/0$/, '');
  const fmtV = (v, um) => um === 'm' ? `${N1.format(v)} m` : um === '%' ? `${N1.format(v)}%` : `${N0.format(v)} ${um}`;
  const SVGNS = 'http://www.w3.org/2000/svg';

  let dati = null, index = null, feat = null, bboxes = {}, nomi = {}, mappa = null, vid = 'alt', attivo = false, promessa = null, tip = null;

  const merc2lng = (x, y) => [x * 360 - 180, Math.atan(Math.sinh(Math.PI * (1 - 2 * y))) * 180 / Math.PI];

  async function scarica(idx) {
    const r = await fetch('data/moran.json');
    if (!r.ok) throw new Error('moran.json: HTTP ' + r.status);
    dati = await r.json(); index = idx;
    feat = [];
    for (const z of idx.zone) {
      if (z.level !== 'upl' || !dati.variabili[0].upl[z.id]) continue;
      nomi[z.id] = z.name;
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      const anelli = z.sel.map(r => {
        const a = [];
        for (let i = 0; i < r.length; i += 2) {
          const [mx, my] = root.Geo.cittaToMerc(idx, r[i], r[i + 1]);
          x0 = Math.min(x0, mx); x1 = Math.max(x1, mx); y0 = Math.min(y0, my); y1 = Math.max(y1, my);
          a.push(merc2lng(mx, my));
        }
        a.push(a[0]);
        return a;
      });
      bboxes[z.id] = { x0, y0, x1, y1 };
      feat.push({ type: 'Feature', properties: { id: z.id }, geometry: { type: 'Polygon', coordinates: anelli } });
    }
  }
  const carica = idx => (promessa || (promessa = scarica(idx).catch(e => { promessa = null; throw e; })));

  const variante = id => dati.variabili.find(v => v.id === id) || dati.variabili[0];

  function collezione() {
    const v = variante(vid);
    return { type: 'FeatureCollection', features: feat.map(f => {
      const u = v.upl[f.properties.id];
      return { ...f, properties: { id: f.properties.id, c: CLS[u[5]] } };
    }) };
  }

  function colori() {
    const m = ['match', ['get', 'c']];
    for (const c of CLS) m.push(c, COL[c]);
    m.push(COL.ns);
    return m;
  }

  function aggiungi() {
    if (!mappa || !attivo || !dati) return;
    if (mappa.getSource(SRC)) { mappa.getSource(SRC).setData(collezione()); return; }
    const primoSimbolo = (mappa.getStyle().layers.find(l => l.type === 'symbol') || {}).id;
    mappa.addSource(SRC, { type: 'geojson', data: collezione() });
    mappa.addLayer({ id: FILL, type: 'fill', source: SRC,
      paint: { 'fill-color': colori(), 'fill-opacity': ['match', ['get', 'c'], 'ns', 0.22, 0.72] } }, primoSimbolo);
    mappa.addLayer({ id: LINE, type: 'line', source: SRC,
      paint: { 'line-color': '#ffffff', 'line-opacity': 0.55, 'line-width': 1 } }, primoSimbolo);
  }

  function togli() {
    if (!mappa) return;
    for (const l of [LINE, FILL]) if (mappa.getLayer(l)) mappa.removeLayer(l);
    if (mappa.getSource(SRC)) mappa.removeSource(SRC);
    if (tip) tip.hidden = true;
  }

  function suMuovi(e) {
    if (!attivo || !mappa.getLayer(FILL)) return;
    const f = mappa.queryRenderedFeatures(e.point, { layers: [FILL] })[0];
    if (!f) { tip.hidden = true; mappa.getCanvas().style.cursor = ''; return; }
    mappa.getCanvas().style.cursor = 'pointer';
    const v = variante(vid), u = v.upl[f.properties.id], c = CLS[u[5]];
    tip.replaceChildren();
    const t = document.createElement('strong'); t.textContent = nomi[f.properties.id]; tip.append(t);
    const r = (a, b) => { const d = document.createElement('div'); d.textContent = `${a}: ${b}`; tip.append(d); };
    r(v.nome, fmtV(u[0], v.um));
    r('Media dei vicini (z)', N2.format(u[2]));
    r('Cluster LISA', c === 'ns' ? 'non significativo' : NOME[c]);
    r('p locale', fmtP(u[4]));
    tip.hidden = false;
    const w = tip.offsetWidth, x = e.originalEvent.clientX, y = e.originalEvent.clientY;
    tip.style.left = Math.min(x + 14, window.innerWidth - w - 8) + 'px'; tip.style.top = (y + 14) + 'px';
  }

  function mostra(map, on, v) {
    if (v) vid = v;
    if (!mappa) {
      mappa = map;
      tip = document.createElement('div'); tip.id = 'moran-tip'; tip.hidden = true; document.body.append(tip);
      map.on('style.load', aggiungi);                               // il cambio tema ricarica lo stile e cancella i layer
      map.on('mousemove', suMuovi);
      map.on('mouseout', () => { if (tip) tip.hidden = true; });
    }
    attivo = !!on;
    if (!attivo) { togli(); return; }
    if (map.isStyleLoaded()) aggiungi(); else map.once('idle', aggiungi);
  }

  const bbox = id => bboxes[id] || null;

  function el(tag, cls, testo) { const e = document.createElement(tag); if (cls) e.className = cls; if (testo != null) e.textContent = testo; return e; }

  function legenda(box, v) {
    box.replaceChildren();
    const d = variante(v);
    for (const c of ['HH', 'LL', 'LH', 'HL', 'ns']) {
      const r = el('div', 'mo-leg');
      const sw = el('i'); sw.style.background = COL[c]; if (c === 'ns') sw.style.opacity = '.45';
      r.append(sw, el('span', null, NOME[c]), el('b', null, String(d.conteggi[c])));
      box.append(r);
    }
  }

  /* diagramma di Moran: z del valore (x) contro z della media dei vicini (y); la pendenza della retta e' I */
  function scatter(d, azioni) {
    const W = 320, H = 260, P = 30;
    let m = 1;
    for (const u of Object.values(d.upl)) m = Math.max(m, Math.abs(u[1]), Math.abs(u[2]));
    m = Math.ceil(m * 2) / 2;
    const X = z => P + (z + m) / (2 * m) * (W - 2 * P), Y = z => H - P - (z + m) / (2 * m) * (H - 2 * P);
    const s = document.createElementNS(SVGNS, 'svg');
    s.setAttribute('viewBox', `0 0 ${W} ${H}`); s.setAttribute('class', 'mo-scatter'); s.setAttribute('role', 'img');
    s.setAttribute('aria-label', `Diagramma di Moran: ${d.nome}, I = ${N2.format(d.I)}`);
    const ln = (x1, y1, x2, y2, cls) => { const l = document.createElementNS(SVGNS, 'line'); l.setAttribute('x1', x1); l.setAttribute('y1', y1); l.setAttribute('x2', x2); l.setAttribute('y2', y2); l.setAttribute('class', cls); s.append(l); };
    const tx = (x, y, t, a) => { const e = document.createElementNS(SVGNS, 'text'); e.setAttribute('x', x); e.setAttribute('y', y); e.setAttribute('text-anchor', a || 'middle'); e.textContent = t; s.append(e); };
    ln(P, Y(0), W - P, Y(0), 'ax'); ln(X(0), P, X(0), H - P, 'ax');
    ln(X(-m), Y(-m * d.I), X(m), Y(m * d.I), 'fit');
    tx(W - P, P - 6, 'alto tra alti', 'end'); tx(P, P - 6, 'basso tra alti', 'start');
    tx(W - P, H - P + 14, 'alto tra bassi', 'end'); tx(P, H - P + 14, 'basso tra bassi', 'start');
    tx(W / 2, H - 4, 'valore (z)');
    for (const [id, u] of Object.entries(d.upl)) {
      const c = document.createElementNS(SVGNS, 'circle');
      c.setAttribute('cx', X(u[1])); c.setAttribute('cy', Y(u[2])); c.setAttribute('r', CLS[u[5]] === 'ns' ? 3.5 : 5);
      c.setAttribute('fill', COL[CLS[u[5]]]); c.setAttribute('class', 'pt' + (CLS[u[5]] === 'ns' ? ' ns' : ''));
      const t = document.createElementNS(SVGNS, 'title'); t.textContent = `${nomi[id]}: ${fmtV(u[0], d.um)}`; c.append(t);
      c.addEventListener('click', () => azioni.vaiA(id));
      s.append(c);
    }
    return s;
  }

  function pannello(box, v, azioni) {
    box.replaceChildren();
    const d = variante(v);
    const forte = d.I > 0.5 ? 'forte' : d.I > 0.25 ? 'moderata' : 'debole';
    const card = el('div', 'mo-card');
    const big = el('div', 'mo-big'); big.append(el('b', null, N2.format(d.I)), el('span', null, "Moran's I"));
    const dl = el('dl', 'mo-dl');
    for (const [a, b] of [['Atteso se casuale', N2.format(d.E)], ['z (da permutazioni)', N1.format(d.z)], ['p', fmtP(d.p)]]) { dl.append(el('dt', null, a), el('dd', null, b)); }
    card.append(big, dl); box.append(card);
    const sig = d.p < dati.alpha;
    box.append(el('p', 'nota',
      sig
        ? `Autocorrelazione positiva ${forte}: ${d.nome.toLowerCase()} simile tende a stare vicino più di quanto farebbe il caso (p ${fmtP(d.p)}, ${N0.format(dati.permutazioni)} permutazioni).`
        : `Nessuna autocorrelazione significativa: la distribuzione di ${d.nome.toLowerCase()} non si distingue da una casuale (p ${fmtP(d.p)}).`));
    box.append(el('h3', null, 'Diagramma di Moran'));
    box.append(scatter(d, azioni));
    box.append(el('p', 'nota', 'Ogni punto è una UPL: sull’asse orizzontale il suo valore, su quello verticale la media dei vicini (valori standardizzati). La retta ha pendenza I. Clic su un punto per andare alla UPL.'));
    box.append(el('h3', null, 'Cluster LISA'));
    let any = false;
    for (const c of ['HH', 'LL', 'LH', 'HL']) {
      const lista = Object.entries(d.upl).filter(([, u]) => CLS[u[5]] === c).sort((a, b) => Math.abs(b[1][1]) - Math.abs(a[1][1]));
      if (!lista.length) continue;
      any = true;
      const g = el('div', 'mo-grp');
      const h = el('div', 'mo-gh'); const sw = el('i'); sw.style.background = COL[c];
      h.append(sw, el('b', null, `${NOME[c]} (${lista.length})`)); g.append(h, el('div', 'nota', SPIEGA[c]));
      const ul = el('div', 'mo-chips');
      for (const [id, u] of lista) {
        const b = el('button', 'mo-chip', `${nomi[id]} · ${fmtV(u[0], d.um)}`);
        b.type = 'button'; b.title = `Vai a ${nomi[id]} sulla mappa`; b.addEventListener('click', () => azioni.vaiA(id));
        ul.append(b);
      }
      g.append(ul); box.append(g);
    }
    if (!any) box.append(el('p', 'nota', 'Nessuna UPL è un cluster o un outlier significativo.'));
    const nLH = d.conteggi.LH + d.conteggi.HL;
    if (!nLH) box.append(el('p', 'nota', 'Nessun outlier spaziale (basso tra alti o alto tra bassi) a p < 0,05 per questa variabile.'));
  }

  root.Moran = { carica, pronto: () => !!dati, mostra, bbox, pannello, legenda, CLS, COL, get varianti() { return dati.variabili; }, get dati() { return dati; } };
})(typeof window !== 'undefined' ? window : globalThis);
