/* Lotti = particelle catastali (settembre 2026) incrociate con gli edifici. Dati calcolati da scripts/09_lotti.py.
   Lotti.CLASSI / Lotti.classe(cop, n) -> 0..4 (0 = nessun edificio).  Lotti.scheda(props, zona?) -> {titolo, righe, avvisi}.
   Lotti.carica() -> Promise (data/lotti/edifici.json: legame edificio -> lotto).  Lotti.pronto() -> bool.
   Lotti.membri(k, livello, nItems) -> Promise<{lista, set}>: posizioni degli edifici del lotto nel livello caricato.
   Lotti.anelli(k) -> Promise<{foglio, particella, m2, anelli:[Float64Array in dm]}|null>: contorno (file per UPL, su richiesta).
   Lotti.layoutLotto(items, ids, anelli, margine) -> {pos, w, h, anelliBlocco}: blocco con il lotto e i suoi edifici nelle posizioni REALI.
   Il rapporto di copertura e' approssimato: edifici (CTC 2006 + globale) e catasto (settembre 2026) non coincidono al metro. */
(function (root) {
  const NUM = new Intl.NumberFormat('it-IT', { useGrouping: 'always' });
  const MIN_BLOCCO = 500;                                          // dm: blocco minimo di 50 m, come layoutIsolato
  const CLASSI = [
    { max: 0, nome: 'Senza edifici', colore: '#94a3b8' },
    { max: 20, nome: 'Fino al 20%', colore: '#a7f3d0' },
    { max: 40, nome: '20–40%', colore: '#34d399' },
    { max: 60, nome: '40–60%', colore: '#0d9488' },
    { max: 100, nome: 'Oltre il 60%', colore: '#115e59' },
  ];
  let dati = null, promessa = null, perms = null;
  const perUpl = new Map();

  function classe(cop, n) {
    if (!n) return 0;
    for (let i = 1; i < CLASSI.length - 1; i++) if (cop <= CLASSI[i].max) return i;
    return CLASSI.length - 1;
  }

  function scheda(p, zona) {
    const coperto = Math.round(p.m2 * p.cop / 100);
    const righe = [
      ['Superficie', `${NUM.format(p.m2)} m²`],
      ['Coperto (circa)', `${NUM.format(coperto)} m²`],
      ['Rapporto di copertura', `${p.cop} %`],
      ['Edifici', NUM.format(p.n)],
    ];
    const avvisi = [];
    if (p.lib || !p.n) avvisi.push('Lotto libero: nessun edificio sopra.');
    if (p.cav) avvisi.push('Contiene o confina con edifici a cavallo di più particelle.');
    return { titolo: `Particella ${p.foglio}/${p.Paricella}`, zona: zona || '', righe, avvisi };
  }

  function carica() {
    if (!promessa) {
      promessa = fetch('data/lotti/edifici.json').then(r => {
        if (!r.ok) throw new Error('edifici.json: HTTP ' + r.status);
        return r.json();
      }).then(d => { dati = d; }).catch(e => { promessa = null; throw e; });
    }
    return promessa;
  }

  /* edifici del lotto k; `perm` (livelli circ/quar) porta la posizione nel livello all'indice UPL concatenato */
  function selezionaMembri(e, k, perm, nItems) {
    const lista = [], set = new Uint8Array(nItems);
    for (let i = 0; i < nItems; i++) if (e[perm ? perm[i] : i] === k) { lista.push(i); set[i] = 1; }
    return { lista, set };
  }

  async function membri(k, livello, nItems) {
    if (!dati) await carica();
    let perm = null;
    if (livello !== 'upl') {
      if (!perms) { const r = await fetch('data/perm-livelli.json'); if (!r.ok) throw new Error('perm-livelli.json: HTTP ' + r.status); perms = await r.json(); }
      perm = perms[livello];
    }
    return selezionaMembri(dati.e, k, perm, nItems);
  }

  async function anelli(k) {
    if (!dati) await carica();
    const u = dati.lu[String(k)];
    if (u === undefined) return null;
    if (!perUpl.has(u)) {
      const r = await fetch(`data/lotti/upl-${u}.json`);
      if (!r.ok) throw new Error(`upl-${u}.json: HTTP ${r.status}`);
      perUpl.set(u, await r.json());
    }
    const v = perUpl.get(u)[String(k)];
    return v ? { foglio: v[0], particella: v[1], m2: v[2], anelli: v[3].map(a => Float64Array.from(a)) } : null;
  }

  /* items: edifici del livello (X, Y = centroide in dm, y nord; ocx, ocy, ow, oh = riquadro non ruotato, y verso il basso);
     ids: indici in items degli edifici del lotto; anelli: contorni in dm (stesso riferimento di X, Y).
     pos (centri slot, come Layout.pack) in coordinate del blocco, y verso il basso; il resto dei pos resta a 0 */
  function layoutLotto(items, ids, anelli, margine) {
    const m = margine == null ? 100 : margine;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    const allarga = (x, y) => { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; };
    for (const a of anelli) for (let i = 0; i < a.length; i += 2) allarga(a[i], a[i + 1]);
    for (const g of ids) {
      const b = items[g], cx = b.X + b.ocx, cy = b.Y - b.ocy;
      allarga(cx - b.ow / 2, cy - b.oh / 2); allarga(cx + b.ow / 2, cy + b.oh / 2);
    }
    if (!Number.isFinite(x0)) { x0 = y0 = 0; x1 = y1 = 1; }
    const w = Math.max(x1 - x0 + 2 * m, MIN_BLOCCO), h = Math.max(y1 - y0 + 2 * m, MIN_BLOCCO);
    const dx = (w - (x1 - x0)) / 2 - x0, dy = (h - (y1 - y0)) / 2;              // contenuto centrato nel blocco
    const pos = new Float64Array(2 * items.length);
    for (const g of ids) {
      const b = items[g];
      pos[2 * g] = b.X + b.ocx + dx;
      pos[2 * g + 1] = (y1 - (b.Y - b.ocy)) + dy;
    }
    const anelliBlocco = anelli.map(a => {
      const o = new Float64Array(a.length);
      for (let i = 0; i < a.length; i += 2) { o[i] = a[i] + dx; o[i + 1] = (y1 - a[i + 1]) + dy; }
      return o;
    });
    return { pos, w, h, anelliBlocco };
  }

  const Lotti = { CLASSI, classe, scheda, carica, pronto: () => !!dati, membri, selezionaMembri, anelli, layoutLotto };
  if (typeof module !== 'undefined' && module.exports) module.exports = Lotti;
  else root.Lotti = Lotti;
})(typeof window !== 'undefined' ? window : globalThis);
