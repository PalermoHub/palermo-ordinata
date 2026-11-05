/* Isolati = aggregati strutturali del DPC (gruppi di edifici contigui), con le statistiche dei loro edifici. Solo vista Mappa.
   Isolati.carica(index) -> Promise: scarica data/isolati.json e proietta i contorni in Mercator (una volta sola).
   Isolati.pronto() -> bool.  Isolati.hit(mx, my) -> posizione dell'isolato sotto il punto Mercator, o -1.
   Isolati.lista -> [{idag, n, m2, h, uso:[...], upl, vie:[[via, n, [civici]]], anelli:[Float64Array Mercator], bbox:{x0,y0,x1,y1}}]
   Isolati.membri(k, livello, nItems) -> Promise<{lista, set}>; Isolati.trova(idag) -> posizione o -1.
   Isolati.scheda(i, index, classi) -> {titolo, zona, righe:[[etichetta, valore]], indirizzi} per la scheda.
   L'aggregato non e' sempre un isolato delimitato da strade: e' un'approssimazione, dichiarata nella Guida. */
(function (root) {
  const CELLA = 100;                                              // m: lato delle celle della griglia di ricerca
  const MINUSC = new Set(['di', 'del', 'della', 'dei', 'delle', 'degli', 'dello', 'da', 'e', 'al', 'alla', 'in']);
  const bello = n => n.toLowerCase().replace(/[^\s'’.-]+/g, (w, i) => (i && MINUSC.has(w)) ? w : w.charAt(0).toUpperCase() + w.slice(1));
  const NUM = new Intl.NumberFormat('it-IT', { useGrouping: 'always' });
  let lista = null, griglia = null, cella = 0, promessa = null, edif = null, perms = null;

  async function scarica(index) {
    const r = await fetch('data/isolati.json');
    if (!r.ok) throw new Error('isolati.json: HTTP ' + r.status);
    const d = await r.json();
    const out = new Array(d.i.length);
    for (let k = 0; k < d.i.length; k++) {
      const [idag, n, m2, h, uso, upl, vie, anelli] = d.i[k];
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      const rr = anelli.map(a => {
        const m = new Float64Array(a.length);
        for (let i = 0; i < a.length; i += 2) {
          const p = root.Geo.cittaToMerc(index, a[i], a[i + 1]);
          m[i] = p[0]; m[i + 1] = p[1];
          if (p[0] < x0) x0 = p[0]; if (p[0] > x1) x1 = p[0]; if (p[1] < y0) y0 = p[1]; if (p[1] > y1) y1 = p[1];
        }
        return m;
      });
      out[k] = { idag, n, m2, h: h / 10, uso, upl, vie, anelli: rr, bbox: { x0, y0, x1, y1 } };
    }
    cella = CELLA / root.Geo.metriPerUnitaMerc(38.1394);
    const g = new Map();
    out.forEach((s, k) => {
      const b = s.bbox;
      for (let gx = Math.floor(b.x0 / cella); gx <= Math.floor(b.x1 / cella); gx++)
        for (let gy = Math.floor(b.y0 / cella); gy <= Math.floor(b.y1 / cella); gy++) {
          const kk = gx * 1000003 + gy; (g.get(kk) || g.set(kk, []).get(kk)).push(k);
        }
    });
    lista = out; griglia = g; edif = d.e;
  }

  function carica(index) {
    if (!promessa) promessa = scarica(index).catch(e => { promessa = null; throw e; });
    return promessa;
  }

  /* posizioni (in Citta.items del livello caricato) degli edifici dell'isolato k; Uint8Array di appartenenza + elenco.
     Ai livelli circ/quar serve perm-livelli.json (edificio del livello -> indice UPL concatenato). */
  async function membri(k, livello, nItems) {
    const el = [], set = new Uint8Array(nItems);
    let perm = null;
    if (livello !== 'upl') {
      if (!perms) { const r = await fetch('data/perm-livelli.json'); if (!r.ok) throw new Error('perm-livelli.json: HTTP ' + r.status); perms = await r.json(); }
      perm = perms[livello];
    }
    for (let i = 0; i < nItems; i++) if (edif[perm ? perm[i] : i] === k) { el.push(i); set[i] = 1; }
    return { lista: el, set };
  }

  const trova = idag => lista ? lista.findIndex(s => s.idag === idag) : -1;

  function dentro(anelli, px, py) {                               // pari-dispari su tutti gli anelli
    let c = false;
    for (const r of anelli) for (let i = 0, j = r.length - 2; i < r.length; j = i, i += 2) {
      if (((r[i + 1] > py) !== (r[j + 1] > py)) && (px < (r[j] - r[i]) * (py - r[i + 1]) / (r[j + 1] - r[i + 1]) + r[i])) c = !c;
    }
    return c;
  }

  function hit(mx, my) {
    if (!lista) return -1;
    const l = griglia.get(Math.floor(mx / cella) * 1000003 + Math.floor(my / cella));
    if (!l) return -1;
    for (const k of l) {
      const b = lista[k].bbox;
      if (mx < b.x0 || mx > b.x1 || my < b.y0 || my > b.y1) continue;
      if (dentro(lista[k].anelli, mx, my)) return k;
    }
    return -1;
  }

  /* testo per la scheda; classi = index.classi, ordine uguale agli indici di uso */
  function scheda(k, index) {
    const s = lista[k], C = index.classi;
    const upl = index.zone.filter(z => z.level === 'upl')[s.upl];
    const quar = upl && index.zone.find(z => z.id === upl.parent);
    const circ = quar && index.zone.find(z => z.id === quar.parent);
    const usi = s.uso.map((n, i) => [n, C.uso[i].nome]).filter(a => a[0] > 0).sort((a, b) => b[0] - a[0])
      .map(([n, nome]) => `${NUM.format(n)} ${nome.toLowerCase()}`).join(', ');
    const righe = [
      ['Edifici', NUM.format(s.n)],
      ['Impronta a terra', `${NUM.format(s.m2)} m²`],
      ['Altezza mediana', s.h > 0 ? `${s.h.toFixed(1).replace('.', ',')} m` : 'non disponibile'],
      ['Uso', usi.replace(/non classificato/, 'non classificati')],
    ];
    const indirizzi = s.vie.map(([via, nc, civ]) => `${bello(via)} ${civ.join(', ')}${nc > civ.length ? '…' : ''}`);
    return { titolo: 'Isolato n. ' + (s.idag.slice(8).replace(/^0+/, '') || '0'), zona: [quar && quar.name, circ && circ.name].filter(Boolean).join(' · '), righe, indirizzi };
  }

  root.Isolati = { carica, pronto: () => !!lista, hit, scheda, membri, trova, get lista() { return lista; } };
})(typeof window !== 'undefined' ? window : globalThis);
