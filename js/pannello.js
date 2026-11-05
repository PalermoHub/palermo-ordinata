/* Contenuto del pannello destro: statistiche, classifiche delle zone, quote per classe, legenda.
   Pannello.aggiorna(S, azioni) ridisegna tutto per la zona selezionata (S.sel) o per l'intera citta' (S.sel === null).
   azioni = {seleziona(zi | null)}. Nessuna dipendenza dal DOM oltre agli id di index.html. */
(function (root) {
  const $ = id => document.getElementById(id);
  const NUM = new Intl.NumberFormat('it-IT', { useGrouping: 'always' });
  const fmt = n => NUM.format(n);
  const f1 = x => x.toFixed(1).replace('.', ',');
  const NOME_COL = { alt: 'altezza', sup: 'superficie', uso: 'uso' };
  
  function el(tag, cls, testo) { const e = document.createElement(tag); if (cls) e.className = cls; if (testo !== undefined) e.textContent = testo; return e; }

  function somma(zone, m) {                                       // quote cumulate di tutte le zone del livello
    const r = { n: zone[0][m].n.map(() => 0), m2: zone[0][m].m2.map(() => 0) };
    for (const z of zone) z[m].n.forEach((v, i) => { r.n[i] += v; r[`m2`][i] += z[m].m2[i]; });
    return r;
  }

  const mediana = v => { if (!v.length) return 0; v.sort((a, b) => a - b); const m = v.length >> 1; return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2; };

  function altezze(S, zi) {                                       // altezza mediana (m) degli edifici con quota nota
    const v = [];
    for (const b of S.citta.items) if ((zi === null || b.z === zi) && b.cls[1] !== 6) v.push(b.h);
    return mediana(v);
  }

  function stat(S, az) {
    const box = $('stat'); box.textContent = '';
    const Z = S.citta.zone, z = S.sel === null ? null : Z[S.sel];
    const tot = Z.reduce((a, x) => ({ n: a.n + x.n, imp: a.imp + x.footprint_m2, km2: a.km2 + x.area_km2 }), { n: 0, imp: 0, km2: 0 });
    const n = z ? z.n : tot.n, imp = z ? z.footprint_m2 : tot.imp, km2 = z ? z.area_km2 : tot.km2;
    const med = z ? z.median_m2 : S.mediana;
    const hz = altezze(S, S.sel), hc = z ? altezze(S, null) : hz;
    const usi = (z ? z.uso : somma(Z, 'uso')).n, ND = S.index.classi.uso.findIndex(c => c.id === 'ND');
    const cls = usi.reduce((a, v, i) => i === ND ? a : a + v, 0), tutti = usi.reduce((a, b) => a + b, 0) || 1;
    let iu = -1; usi.forEach((v, i) => { if (i !== ND && (iu < 0 || v > usi[iu])) iu = i; });
    const uso = cls ? S.index.classi.uso[iu].nome : 'n.d.';
    const notaUso = cls ? `${f1(usi[iu] / cls * 100)}% dei classificati (${f1(cls / tutti * 100)}% del totale)` : 'nessun edificio classificato';
    const nome = el('div', 'stat-nome'); nome.append(el('span', '', z ? z.name : 'Tutta Palermo'));
    if (z) { const b = el('button', '', 'Mostra tutta la città'); b.type = 'button'; b.addEventListener('click', () => az.seleziona(null)); nome.append(b); }
    box.append(nome);
    const g = el('div', 'stat-grid');
    const carte = [
      ['Edifici', fmt(n), z ? `${f1(n / tot.n * 100)}% della città` : `in ${Z.length} zone`],
      ['Impronta a terra', `${f1(imp / 1e4)} ha`, `${f1(imp / (km2 * 1e6) * 100)}% ${z ? 'della zona' : 'del territorio'}`],
      ['Mediana', `${fmt(med)} m²`, z ? `città: ${fmt(S.mediana)} m²` : 'superficie di un edificio'],
      ['Densità', `${fmt(Math.round(n / km2))}`, z ? `edifici/km² · città ${fmt(Math.round(tot.n / tot.km2))}` : 'edifici per km²'],
      ['Altezza mediana', hz ? `${f1(hz)} m` : 'n.d.', z && hc ? `città: ${f1(hc)} m` : 'edifici con quota nota'],
      ['Uso prevalente', uso, notaUso],
    ];
    for (const [t, v, nt] of carte) {
      const c = el('div', 'stat-card'); c.append(el('p', 'stat-card-title', t), el('p', 'stat-card-val', v), el('p', 'stat-card-note', nt)); g.append(c);
    }
    box.append(g);
  }

  const METRICHE = [
    { k: 'n', titolo: 'Edifici', val: z => z.n, fmt: v => fmt(v), quota: true },
    { k: 'footprint_m2', titolo: 'Impronta a terra', val: z => z.footprint_m2, fmt: v => `${f1(v / 1e4)} ha`, quota: true },
    { k: 'median_m2', titolo: 'Mediana', val: z => z.median_m2, fmt: v => `${fmt(v)} m²` },
  ];
  const PRIME = 6;
  const KEY = { uso: 0, alt: 1, sup: 2 };

  function perZona(S) {                                           // valori per zona ricalcolati sulle sole classi attive (null = nessun filtro)
    if (!S.spente.size) return null;
    const k = KEY[S.colore], Z = S.citta.zone, n = Z.map(() => 0), imp = Z.map(() => 0), ar = Z.map(() => []);
    for (const b of S.citta.items) if (!S.spente.has(b.cls[k])) { n[b.z]++; imp[b.z] += b.area; ar[b.z].push(b.area); }
    return Z.map((z, i) => ({ n: n[i], footprint_m2: imp[i], median_m2: Math.round(mediana(ar[i])) }));
  }
  const aperte = new Set();                                       // classifiche espanse ("Mostra tutte")

  function classifiche(S, az) {
    const box = $('classifiche'); box.textContent = '';
    const Z = S.citta.zone, F = perZona(S);
    for (const m of METRICHE) {
      const righe = Z.map((z, i) => ({ z, i, v: m.val(F ? F[i] : z) })).filter(r => !S.conf || r.i === S.conf.a || r.i === S.conf.b).sort((a, b) => b.v - a.v);   // con il confronto attivo: solo le due zone
      const max = righe.length ? Math.max(righe[0].v, 1) : 1, tot = righe.reduce((a, r) => a + r.v, 0) || 1;
      let vis = aperte.has(m.k) ? righe : righe.slice(0, PRIME);
      const sel = righe.findIndex(r => r.i === S.sel);            // la zona selezionata resta sempre visibile
      if (sel >= vis.length) vis = vis.concat(righe[sel]);
      const card = el('section', 'rank-card'); card.append(el('h2', '', S.conf ? `${m.titolo} · confronto` : m.titolo));
      const lista = el('div', 'ranking-list');
      for (const r of vis) {
        const riga = el('div', 'rank-row' + (S.sel === r.i ? ' on' : '')), b = el('button', 'rank-label', r.z.name);
        b.type = 'button'; b.title = r.z.name; b.addEventListener('click', () => az.seleziona(r.i));
        const tr = el('span', 'rank-track'), f = el('i', 'rank-fill' + (S.conf && r.i === S.conf.b ? ' b' : '')); f.style.width = (r.v / max * 100) + '%'; tr.append(f);
        riga.append(el('span', 'rank-num', String(righe.indexOf(r) + 1)), b, tr, el('span', 'rank-value', m.fmt(r.v)), el('span', 'rank-pct', m.quota ? `${f1(r.v / tot * 100)}%` : ''));
        lista.append(riga);
      }
      card.append(lista);
      if (righe.length > PRIME && !S.conf) {
        const t = el('button', 'rank-more', aperte.has(m.k) ? 'Mostra meno' : `Mostra tutte (${righe.length})`); t.type = 'button';
        t.addEventListener('click', () => { aperte.has(m.k) ? aperte.delete(m.k) : aperte.add(m.k); classifiche(S, az); });
        card.append(t);
      }
      box.append(card);
    }
  }

  function barre(titolo, nomi, col, dati, unita, S, az, comune) {
    const sec = document.createDocumentFragment();
    sec.append(el('h2', '', titolo));
    const att = dati.map((v, i) => S.spente.has(i) ? 0 : v);      // scala e percentuali solo sulle classi attive
    const g = el('div', 'barre'), max = Math.max(...att, 1, comune || 0), tot = att.reduce((a, b) => a + b, 0) || 1;
    nomi.forEach((c, i) => {
      if (!dati[i]) return;
      const spenta = S.spente.has(i);
      const r = el('button', 'barra' + (spenta ? ' off' : '')); r.type = 'button'; r.setAttribute('aria-pressed', String(!spenta));
      const sola = !spenta && S.spente.size === nomi.length - 1;
      r.title = sola ? 'Mostra tutte le classi' : 'Mostra solo questa classe'; r.addEventListener('click', () => az.solo(i));
      const b = el('span', 'b'), f = el('i'); f.style.width = (att[i] / max * 100) + '%'; f.style.background = col[i]; b.append(f);
      r.append(el('span', 'n', c.nome), b, el('span', 'v', spenta ? '—' : `${fmt(Math.round(dati[i]))}${unita === 'm2' ? ' m²' : ''} · ${f1(dati[i] / tot * 100)}%`));
      g.append(r);
    });
    sec.append(g);
    return sec;
  }

  function quote(S, az) {
    const q = $('quote-body'); q.textContent = '';
    const Z = S.citta.zone, m = S.colore, nomi = S.index.classi[m], col = S.colori[m];
    if (S.conf) {                                                   // confronto: stesse barre per le due zone, sulla stessa scala
      const zs = [Z[S.conf.a], Z[S.conf.b]], att = (v) => v.map((x, i) => S.spente.has(i) ? 0 : x);
      const mx = k => Math.max(...zs.flatMap(z => att(z[m][k])), 1);
      const mn = mx('n'), mm = mx('m2');
      for (const z of zs) q.append(barre(`${z.name}: edifici per ${NOME_COL[m]}`, nomi, col, z[m].n, 'n', S, az, mn),
                                    barre(`${z.name}: impronta a terra per ${NOME_COL[m]}`, nomi, col, z[m].m2, 'm2', S, az, mm));
      return;
    }
    const d = S.sel === null ? somma(Z, m) : Z[S.sel][m], nome = S.sel === null ? 'Tutta Palermo' : Z[S.sel].name;
    q.append(barre(`${nome}: edifici per ${NOME_COL[m]}`, nomi, col, d.n, 'n', S, az),
             barre(`${nome}: impronta a terra per ${NOME_COL[m]}`, nomi, col, d.m2, 'm2', S, az));
  }

  function legenda(S, az) {
    const L = $('legenda'); L.textContent = '';
    const m = S.colore, nomi = S.index.classi[m], col = S.colori[m];
    const d = S.sel === null ? somma(S.citta.zone, m) : S.citta.zone[S.sel][m];
    nomi.forEach((c, i) => {
      if (!d.n[i]) return;
      const spenta = S.spente.has(i);
      const r = el('button', 'row' + (spenta ? ' off' : '')), sw = el('i'); sw.style.background = col[i];
      r.type = 'button'; r.setAttribute('aria-pressed', String(!spenta)); r.title = spenta ? 'Mostra questa classe' : 'Nascondi questa classe';
      r.addEventListener('click', () => az.filtra(i));
      r.append(sw, el('span', '', c.nome), el('b', '', fmt(d.n[i]))); L.append(r);
    });
    if (S.spente.size) {
      const b = el('button', 'azzera', 'Mostra tutte le classi'); b.type = 'button';
      b.addEventListener('click', () => az.azzera()); L.append(b);
    }
  }

  function controlli(S) {
    document.querySelectorAll('#seg-livello button').forEach(b => { const on = b.dataset.l === S.livello; b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); });
    document.querySelectorAll('#seg-colore button').forEach(b => { const on = b.dataset.c === S.colore; b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); });
  }

  /* Confronto di due zone dello stesso livello, sulle sole classi attive (stessi filtri della legenda). */
  const conf = { liv: null, a: null, b: null, aperto: false };

  function metricheZona(S, zi) {
    const k = KEY[S.colore], z = S.citta.zone[zi], ar = [], h = [];
    let imp = 0;
    for (const b of S.citta.items) if (b.z === zi && !S.spente.has(b.cls[k])) { ar.push(b.area); imp += b.area; if (b.cls[1] !== 6) h.push(b.h); }
    return { n: ar.length, imp, med: Math.round(mediana(ar)), alt: mediana(h), dens: ar.length / z.area_km2 };
  }

  const RIGHE_CONF = [
    { t: 'Edifici', v: m => m.n, f: v => fmt(v) },
    { t: 'Impronta a terra', v: m => m.imp, f: v => `${f1(v / 1e4)} ha` },
    { t: 'Superficie mediana', v: m => m.med, f: v => `${fmt(v)} m²` },
    { t: 'Altezza mediana', v: m => m.alt, f: v => v ? `${f1(v)} m` : 'n.d.' },
    { t: 'Densità', v: m => m.dens, f: v => `${fmt(Math.round(v))} /km²` },
  ];

  function confronto(S, az) {
    const box = $('confronto'); if (!box) return;
    box.textContent = '';
    const Z = S.citta.zone;
    if (conf.liv !== S.livello) { conf.liv = S.livello; conf.a = null; conf.b = null; conf.aperto = false; }
    if (conf.aperto && !S.conf) conf.aperto = false;                  // la mappa ha chiuso il confronto (cambio livello)
    if (conf.a === null) conf.a = S.sel !== null ? S.sel : 0;
    if (conf.b === null || conf.b === conf.a) conf.b = Z.findIndex((_, i) => i !== conf.a);
    const det = el('details', 'conf'); det.open = conf.aperto;
    const applica = () => az.confronta(conf.a, conf.b);
    det.addEventListener('toggle', () => {
      if (det.open === conf.aperto) return;                           // apertura programmatica del ridisegno: niente da fare
      conf.aperto = det.open;
      if (det.open) applica(); else az.confronta(null);
    });
    det.append(el('summary', '', 'Confronta due zone'));
    const sel = (chiave) => {
      const s = el('select'); s.setAttribute('aria-label', chiave === 'a' ? 'Prima zona' : 'Seconda zona');
      const ord = Z.map((z, i) => ({ z, i })).sort((x, y) => x.z.name.localeCompare(y.z.name, 'it'));
      for (const { z, i } of ord) { const o = el('option', '', z.name); o.value = String(i); if (conf[chiave] === i) o.selected = true; s.append(o); }
      s.addEventListener('change', () => { conf[chiave] = +s.value; tabella(); if (conf.aperto) applica(); });
      return s;
    };
    const scelte = el('div', 'conf-sel'); scelte.append(sel('a'), el('span', '', 'vs'), sel('b'));
    const tab = el('div', 'conf-tab');
    const nota = el('p', 'conf-nota');
    const k = S.colore, nomi = S.index.classi[k];
    nota.textContent = S.spente.size ? `Solo le classi attive di ${NOME_COL[k]}: ${nomi.length - S.spente.size} su ${nomi.length}.` : `Tutte le classi di ${NOME_COL[k]}. Spegni classi nella legenda per confrontare una categoria.`;
    function tabella() {
      tab.textContent = '';
      const ma = metricheZona(S, conf.a), mb = metricheZona(S, conf.b);
      const t = el('table'), th = el('tr');
      const intest = (i, cl) => { const h = el('th'); h.append(el('i', 'conf-dot ' + cl), Z[i].name); return h; };
      th.append(el('th'), intest(conf.a, 'a'), intest(conf.b, 'b')); t.append(th);
      for (const r of RIGHE_CONF) {
        const va = r.v(ma), vb = r.v(mb), tr = el('tr');
        const ca = el('td', va > vb ? 'max' : '', r.f(va)), cb = el('td', vb > va ? 'max' : '', r.f(vb));
        tr.append(el('th', '', r.t), ca, cb); t.append(tr);
      }
      tab.append(t);
    }
    tabella();
    const rip = el('button', 'conf-reset', 'Azzera confronto'); rip.type = 'button';
    rip.title = 'Chiude il confronto e torna alla mappa intera';
    rip.addEventListener('click', () => { conf.aperto = false; conf.a = null; conf.b = null; az.confronta(null); confronto(S, az); });
    det.append(scelte, tab, nota, rip); box.append(det);
  }

  function aggiorna(S, az) {
    if (!S.citta) return;
    controlli(S); stat(S, az); confronto(S, az); classifiche(S, az); quote(S, az); legenda(S, az);
  }
  root.Pannello = { aggiorna, controlli };
})(typeof window !== 'undefined' ? window : globalThis);
