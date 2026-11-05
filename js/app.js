'use strict';
/* Orchestratore: stato, caricamento, animazione Mappa⇄Ordinata, interazione, selezione zone, mini-mappa, hash, tema. */
const $ = id => document.getElementById(id);
const cv = $('cv'), ov = $('ov'), tip = $('tip');
const DUR = 1600;                                                              // ms
const ease = t => t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;   // cubica in-out
const ridotto = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const mobile = () => matchMedia('(max-width: 640px)').matches;
const LIVELLI = ['circ', 'quar', 'upl'];
const NUM = new Intl.NumberFormat('it-IT', { useGrouping: 'always' });

const S = {
  index: null, citta: null, layout: null, livello: 'circ', vista: 'map', colore: 'alt', raggruppa: false, lato: true,
  sel: null, conf: null, isola: false, spente: new Set(), liveZoom: true, zonaHover: null, views: { sorted: { k: 1, tx: 0, ty: 0 } }, fitOrd: true,
  t: 0, lin: 0, anim: false, caricando: false, coda: [], dpr: 1, W: 0, H: 0, inset: 0, pw: 400, insetB: 0, gamma: 0, mediana: 0, tema: 'dark',
  colori: Render.COLORI, hover: -1,
};
let B, R;
const M = new Float64Array(6);
const stile = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();

/* ---------- stato di caricamento ---------- */
function mostra(t) { const e = $('stato'); e.querySelector('span').textContent = t; e.querySelector('.spinner').style.display = ''; e.hidden = false; $('riprova').hidden = true; }
function errore(t, riprova) {
  const e = $('stato'); e.querySelector('span').textContent = t; e.querySelector('.spinner').style.display = 'none'; e.hidden = false;
  const b = $('riprova'); b.hidden = !riprova; b.onclick = riprova ? () => { b.hidden = true; riprova(); } : null;
}
function avvisa(t) { const a = $('avviso'); a.textContent = t; a.hidden = false; clearTimeout(avvisa.t); avvisa.t = setTimeout(() => { a.hidden = true; }, 7000); }
function nascondi() { $('stato').hidden = true; }

/* ---------- dati ---------- */
function preparaZone(c) {
  for (const z of c.zone) {
    z.selM = z.sel.map(r => { const m = new Float64Array(r.length); for (let i = 0; i < r.length; i += 2) { const p = Geo.cittaToMerc(S.index, r[i], r[i + 1]); m[i] = p[0]; m[i + 1] = p[1]; } return m; });
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const r of z.selM) for (let i = 0; i < r.length; i += 2) { x0 = Math.min(x0, r[i]); x1 = Math.max(x1, r[i]); y0 = Math.min(y0, r[i + 1]); y1 = Math.max(y1, r[i + 1]); }
    z.bboxM = { x0, y0, x1, y1 }; z.centroM = [(x0 + x1) / 2, (y0 + y1) / 2]; z.larghM = x1 - x0;
  }
}

async function caricaLivello(liv) {
  S.evid = null;
  S.caricando = true;
  const prec = S.citta, precSel = S.sel;
  try {
    mostra('Caricamento…');
    S.citta = null; S.sel = null; S.conf = null; S.zonaHover = null; nascondiTip();
    const c = await Citta.carica(liv, S.index);
    preparaZone(c);
    S.citta = c; S.livello = liv;
    const a = Float64Array.from(c.items, b => b.area).sort(); S.mediana = a.length ? Math.round(a[a.length >> 1]) : 0;
    ricalcola(); minimappa(); nascondi(); aggiornaUI(); scriviHash();
  } catch (err) {
    S.citta = prec; S.sel = precSel;                                  // il livello precedente resta usabile
    throw err;
  } finally { S.caricando = false; }
  if (S.coda.length) svuotaCoda();
}

function ricalcola() {
  if (!S.citta) return;
  const it = S.citta.items, k = Render.KEY[S.colore];
  for (const b of it) { b.bw = S.lato ? b.lw : b.ow; b.bh = S.lato ? b.lh : b.oh; }
  const perZona = S.citta.perZona.map(p => {
    const items = p.indici.map(g => it[g]), ord = items.map((_, i) => i);
    if (S.raggruppa) ord.sort((a, b) => items[a].cls[k] - items[b].cls[k] || items[b].area - items[a].area);
    else ord.sort((a, b) => items[b].area - items[a].area);
    return { items, order: ord, group: S.raggruppa ? i => items[i].cls[k] : null, indici: p.indici };
  });
  S.layout = Blocchi.disponi(S.citta.zone, perZona, { margine: 4000, cittaH: S.index.h });
  S.views.sorted = R.adattaOrdinata(); S.fitOrd = true;
  R.carica();
  nascondiTip(); Pannello.aggiorna(S, azioni); R.disegna();
}

/* ---------- animazione Mappa ⇄ Ordinata ---------- */
const occupato = () => S.anim || S.caricando;
function inCoda(fn) { if (occupato()) { S.coda.push(fn); return true; } return false; }
let svuotando = false;
/* i comandi in coda partono uno alla volta, ciascuno dopo la fine di animazione e caricamento del precedente */
async function svuotaCoda() {
  if (svuotando) return;
  svuotando = true;
  try {
    while (S.coda.length) {
      while (occupato()) await new Promise(r => setTimeout(r, 16));
      await S.coda.shift()();
    }
  } finally { svuotando = false; }
}

function vaiA(verso) {
  if (inCoda(() => vaiA(verso))) return;
  if (!S.citta) return;
  S.vista = verso; aggiornaUI();
  const target = verso === 'sorted' ? 1 : 0;
  if (verso === 'sorted') S.evid = null;                                        // l'evidenziazione vale solo in Mappa
  if (S.lin === target) { S.lin = S.t = target; impostaInterazione(); R.disegna(); scriviHash(); return; }
  S.anim = true; impostaInterazione(); nascondiTip();
  let prev = performance.now();
  (function passo(now) {
    const d = (now - prev) / DUR; prev = now;
    S.lin = target > S.lin ? Math.min(target, S.lin + d) : Math.max(target, S.lin - d);
    S.t = ease(S.lin); R.disegna();
    if (S.lin === target) { S.anim = false; impostaInterazione(); scriviHash(); if (S.coda.length) svuotaCoda(); return; }
    requestAnimationFrame(passo);
  })(prev);
}

/* in vista Mappa guida MapLibre; in vista Ordinata il canvas (la base e' nascosta) */
function impostaInterazione() {
  const mappa = S.vista === 'map' && !S.anim;
  for (const h of ['dragPan', 'scrollZoom', 'boxZoom', 'touchZoomRotate', 'keyboard']) {
    const m = B.map[h]; if (m) (mappa ? m.enable() : m.disable());
  }
  B.map.touchZoomRotate.disableRotation(); B.map.keyboard.disableRotation();
  document.body.classList.toggle('vista-ordinata', S.vista === 'sorted' && !S.anim);
}

/* riquadro Mercator dell'intera citta' (dai quattro angoli) */
function bboxCitta() {
  const c = [[0, 0], [S.index.w, 0], [0, S.index.h], [S.index.w, S.index.h]].map(([x, y]) => Geo.cittaToMerc(S.index, x, y));
  return { x0: Math.min(...c.map(p => p[0])), x1: Math.max(...c.map(p => p[0])), y0: Math.min(...c.map(p => p[1])), y1: Math.max(...c.map(p => p[1])) };
}

/* ---------- selezione zone ---------- */
function bboxBlocco(zi) {
  const b = S.layout.blocchi[zi], m = 30, Wd = Math.max(S.W - S.inset, 100), Hd = Math.max(S.H - S.insetB, 100);
  const k = Math.min((Wd - 2 * m) / b.w, (Hd - 2 * m) / b.h);
  return { k, tx: (Wd - b.w * k) / 2 - b.x * k, ty: (Hd - b.h * k) / 2 - b.y * k };
}
function animaOrd(verso) {
  const da = { ...S.views.sorted }, t0 = performance.now(), D = ridotto() ? 1 : 450;
  S.fitOrd = false;
  (function p(now) {
    const u = Math.min((now - t0) / D, 1), e = ease(u);
    S.views.sorted = { k: da.k + (verso.k - da.k) * e, tx: da.tx + (verso.tx - da.tx) * e, ty: da.ty + (verso.ty - da.ty) * e };
    R.disegna(); if (u < 1) requestAnimationFrame(p);
  })(t0);
}
function seleziona(zi, zoom = true) {
  S.sel = zi === null || zi < 0 ? null : zi;
  if (S.isola) R.ricolora();
  scriviHash(); Pannello.aggiorna(S, azioni); Cerca.aggiorna(); marcaMini();
  if (S.sel !== null && zoom && !S.anim) {
    if (S.vista === 'map') B.vaiA(S.citta.zone[S.sel].bboxM, true, S.inset);
    else animaOrd(bboxBlocco(S.sel));
  }
  R.disegna();
}
/* confronto di due zone: le porta in primo piano in mappa (a, b = indici zona; a === null = esce dal confronto) e inquadra entrambe */
function confronta(a, b) {
  if (!S.citta) return;
  S.conf = a === null ? null : { a, b };
  R.ricolora(); nascondiTip(); Pannello.aggiorna(S, azioni); R.disegna();
  if (!S.anim) inquadraVisibili();
}
/* ---------- filtro per classe dalla legenda + Live Zoom ---------- */
function inquadraVisibili() {
  if (!S.citta || S.anim) return;
  const r = R.riquadro(S.vista); if (!r) return;
  if (S.vista === 'map') { B.vaiA(r, true, S.inset, 17); return; }
  const m = 24, Wd = Math.max(S.W - S.inset, 100), Hd = Math.max(S.H - S.insetB, 100), w = r.x1 - r.x0, h = r.y1 - r.y0;
  const k = Math.min((Wd - 2 * m) / Math.max(w, 50), (Hd - 2 * m) / Math.max(h, 50), 40);   // minimo 5 m: un edificio solo non diventa enorme
  S.fitOrd = false;
  animaOrd({ k, tx: (Wd - w * k) / 2 - r.x0 * k, ty: (Hd - h * k) / 2 - r.y0 * k });
}
function filtra(cls) {
  if (!S.citta) return;
  if (S.spente.has(cls)) S.spente.delete(cls); else S.spente.add(cls);
  applicaFiltro();
}
function soloClasse(cls) {                                          // dalle barre quote: tiene accesa solo questa classe; secondo click = tutte
  if (!S.citta) return;
  const tutte = S.index.classi[S.colore].map((_, i) => i), gia = S.spente.size === tutte.length - 1 && !S.spente.has(cls);
  S.spente = gia ? new Set() : new Set(tutte.filter(i => i !== cls));
  applicaFiltro();
}
function azzeraFiltro() { if (!S.spente.size) return; S.spente.clear(); applicaFiltro(); }
function applicaFiltro() {
  scriviHash(); nascondiTip(); R.ricolora(); Pannello.aggiorna(S, azioni); R.disegna();
  if (S.liveZoom) inquadraVisibili();
}
/* porta alla zona di un qualunque livello: cambia livello se serve, poi la seleziona (usata dal cerca) */
async function vaiAZona(id) {
  if (inCoda(() => vaiAZona(id))) return;
  const z = S.index.zone.find(x => x.id === id); if (!z) return;
  if (z.level !== S.livello || !S.citta) await cambiaLivello(z.level);
  const zi = S.citta ? S.citta.zone.findIndex(x => x.id === id) : -1;
  if (zi >= 0) seleziona(zi);
}
/* civico trovato dal cerca: livello UPL, poi Mappa centrata sull'edificio (u = posizione dell'UPL, bi = posizione nel suo file) */
async function vaiAEdificio(u, bi) {
  if (inCoda(() => vaiAEdificio(u, bi))) return;
  if (S.livello !== 'upl' || !S.citta) await cambiaLivello('upl');
  if (!S.citta || S.livello !== 'upl') return;
  let i = bi; for (let k = 0; k < u; k++) i += S.citta.zone[k].n;
  if (S.citta.items[i]) tornaAlPoligono(i);
}
/* doppio click su una zona: la seleziona, anima Mappa → Ordinata, poi inquadra il blocco e apre il pannello */
/* doppio tap (su touch il dblclick non e' affidabile): due tocchi entro 350 ms e 30 px */
let ultimoTap = null, tapGestito = 0;
function doppioTap(x, y) {
  const t = performance.now(), d = ultimoTap && t - ultimoTap.t < 350 && Math.hypot(x - ultimoTap.x, y - ultimoTap.y) < 30;
  ultimoTap = d ? null : { t, x, y };
  if (d) tapGestito = t;
  return !!d;
}
function apriOrdinata(zi) {
  if (zi < 0 || S.anim || S.caricando) return;
  seleziona(zi, false); nascondiTip();
  const fine = () => { if (!mobile()) impostaPannello(true); animaOrd(bboxBlocco(zi)); };
  if (S.vista === 'sorted') { fine(); return; }
  vaiA('sorted'); S.coda.push(fine); svuotaCoda();
}
const azioni = { seleziona: (zi, z) => { if (mobile() && pannelloAperto()) impostaPannello(false); seleziona(zi, z); }, filtra, confronta, solo: soloClasse, azzera: azzeraFiltro, vaiAZona, vaiAEdificio, reset: resetTutto };

/* ---------- mini-mappa ---------- */
function minimappa() {
  const svg = $('mini'); svg.textContent = '';
  const W = S.index.w, H = S.index.h, NS = 'http://www.w3.org/2000/svg';
  svg.setAttribute('viewBox', `0 ${-H} ${W} ${H}`); svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
  S.miniVB = null;
  S.citta.zone.forEach((z, zi) => {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const r of z.sel) for (let i = 0; i < r.length; i += 2) { x0 = Math.min(x0, r[i]); x1 = Math.max(x1, r[i]); y0 = Math.min(y0, -r[i + 1]); y1 = Math.max(y1, -r[i + 1]); }
    z.bboxC = { x0, y0, x1, y1 };
    const p = document.createElementNS(NS, 'path'); let d = '';
    for (const r of z.sel) { for (let i = 0; i < r.length; i += 2) d += (i ? 'L' : 'M') + r[i] + ' ' + (-r[i + 1]); d += 'Z'; }
    p.setAttribute('d', d); p.setAttribute('fill-rule', 'evenodd'); p.dataset.z = zi;
    p.setAttribute('tabindex', '0'); p.setAttribute('role', 'button'); p.setAttribute('aria-label', z.name);
    const t = document.createElementNS(NS, 'title'); t.textContent = z.name; p.appendChild(t);
    p.addEventListener('click', () => seleziona(zi));
    p.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); seleziona(zi); } });
    svg.appendChild(p);
  });
  svg.removeAttribute('hidden'); marcaMini();
}
/* la mini-mappa mostra le zone sorelle della selezione (stesso genitore), inquadrate; senza selezione l'intero livello */
function marcaMini() {
  if (!S.citta) return;
  const Z = S.citta.zone, par = S.sel === null ? null : Z[S.sel].parent;
  const dentro = Z.map(z => par === null || z.parent === par);
  document.querySelectorAll('#mini path').forEach(p => { const i = +p.dataset.z; p.classList.toggle('on', i === S.sel); p.classList.toggle('fuori', !dentro[i]); });
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity, n = 0;
  Z.forEach((z, i) => { if (!dentro[i]) return; n++; const b = z.bboxC; x0 = Math.min(x0, b.x0); y0 = Math.min(y0, b.y0); x1 = Math.max(x1, b.x1); y1 = Math.max(y1, b.y1); });
  const pad = Math.max(x1 - x0, y1 - y0) * 0.05, vb = [x0 - pad, y0 - pad, x1 - x0 + 2 * pad, y1 - y0 + 2 * pad];
  const nomi = { circ: 'circoscrizioni', quar: 'quartieri', upl: 'UPL' };
  const gen = par === null ? null : S.index.zone.find(z => z.id === par);
  const cap = $('mini-cap'); cap.textContent = `${gen ? gen.name : 'Tutta Palermo'} · ${n} ${nomi[S.livello]}`; cap.hidden = false;
  animaVB(vb);
}
function animaVB(a) {
  const svg = $('mini'), da = S.miniVB, t0 = performance.now(), D = 320;
  const metti = v => svg.setAttribute('viewBox', v.join(' '));
  cancelAnimationFrame(animaVB.r);
  if (!da || ridotto()) { S.miniVB = a; metti(a); return; }
  (function p(now) {
    const u = Math.min((now - t0) / D, 1), e = ease(u);
    S.miniVB = da.map((v, i) => v + (a[i] - v) * e); metti(S.miniVB);
    if (u < 1) animaVB.r = requestAnimationFrame(p);
  })(t0);
}

/* ---------- hash ---------- */
function leggiHash() {
  const p = new URLSearchParams(location.hash.slice(1));
  const l = p.get('l'), v = p.get('v');
  const c = (p.get('c') || '').split('/').map(Number);                     // c = zoom/lat/lon (stesso formato dell'hash MapLibre)
  const cam = c.length === 3 && c.every(Number.isFinite) && Math.abs(c[1]) <= 85 && Math.abs(c[2]) <= 180 ? c : null;
  const k = p.get('k');
  const x = (p.get('x') || '').split(',').filter(Boolean).map(Number).filter(n => Number.isInteger(n) && n >= 0 && n < 32);
  const tab = p.get('p');
  return { l: LIVELLI.includes(l) ? l : 'circ', v: v === 'sorted' ? 'sorted' : 'map', z: p.get('z'), c: cam,
    k: ['uso', 'alt', 'sup'].includes(k) ? k : 'alt', x, g: p.get('g') === '1', s: p.get('s') !== '0', i: p.get('i') === '1',
    t: p.get('t') === 'light' || p.get('t') === 'dark' ? p.get('t') : null,
    p: tab && document.querySelector(`.tab-hdr[data-tab="${CSS.escape(tab)}"]`) ? tab : 'zone' };
}
function applicaCamera(c) { B.map.jumpTo({ zoom: c[0], center: [c[2], c[1]] }); }
/* L'hash descrive tutto cio' che l'utente vede (livello, vista, zona, camera, colore, filtri, opzioni, tema, tab): e' anche il link condiviso. */
function costruisciHash() {
  const z = S.sel === null ? '' : `&z=${encodeURIComponent(S.citta.zone[S.sel].id)}`;
  let c = '';
  if (S.vista === 'map' && B) { const m = B.map, ce = m.getCenter(); c = `&c=${m.getZoom().toFixed(2)}/${ce.lat.toFixed(4)}/${ce.lng.toFixed(4)}`; }
  const tab = document.querySelector('.tab-hdr.active'), p = tab && tab.dataset.tab !== 'zone' ? `&p=${tab.dataset.tab}` : '';
  const x = S.spente.size ? `&x=${[...S.spente].sort((a, b) => a - b).join(',')}` : '';
  return `l=${S.livello}&v=${S.vista}${z}${c}&k=${S.colore}${x}${S.raggruppa ? '&g=1' : ''}${S.lato ? '' : '&s=0'}${S.isola ? '&i=1' : ''}&t=${S.tema}${p}`;
}
function scriviHash() {
  if (!S.citta) return;
  history.replaceState(null, '', '#' + costruisciHash());
  if (window.parent !== window) window.parent.postMessage({ type: 'palermo-ordinata', hash: costruisciHash() }, '*');   // opzionale: la pagina ospite puo' specchiare l'URL
}

/* ---------- tooltip ---------- */
function mostraTip(x, y, cx, cy) {
  if (!S.citta || S.anim) return;
  const zh = R.zonaIn(x, y);
  if ((zh >= 0 ? zh : null) !== S.zonaHover) { S.zonaHover = zh >= 0 ? zh : null; if (S.vista === 'map') R.disegna(); }
  const i = R.hit(x, y);
  if (i === S.hover) { if (i >= 0) postaTip(cx, cy); return; }
  S.hover = i;
  const o = R.octx; o.setTransform(1, 0, 0, 1, 0, 0); o.clearRect(0, 0, ov.width, ov.height);
  if (i < 0) { tip.hidden = true; return; }
  const b = S.citta.items[i], dpr = S.dpr, C = S.index.classi;
  R.matrice(i, S.t, M);
  o.setTransform(M[0] * dpr, M[1] * dpr, M[2] * dpr, M[3] * dpr, M[4] * dpr, M[5] * dpr);
  o.lineWidth = 2.5 / Math.hypot(M[0], M[1]); o.strokeStyle = stile('--text'); o.lineJoin = 'round'; o.stroke(Citta.path(b));
  o.setTransform(1, 0, 0, 1, 0, 0);
  tip.textContent = '';
  const t1 = document.createElement('strong'); t1.textContent = C.uso[b.cls[0]].nome;
  const l2 = document.createElement('div'); l2.textContent = `Altezza: ${b.cls[1] === C.alt.length - 1 ? 'non disponibile' : b.h.toFixed(1).replace('.', ',') + ' m'}`;
  const l3 = document.createElement('div'); l3.textContent = `Superficie: ${NUM.format(b.area)} m²`;
  const l4 = document.createElement('div'); l4.className = 'z'; l4.textContent = S.citta.zone[b.z].name;
  tip.append(t1, l2, l3, l4); tip.hidden = false; postaTip(cx, cy);
}
function postaTip(cx, cy) {
  const w = tip.offsetWidth, h = tip.offsetHeight;
  let x = cx + 14, y = cy + 14;
  if (x + w > innerWidth - 4) x = cx - w - 14;
  if (y + h > innerHeight - 4) y = cy - h - 14;
  tip.style.left = Math.max(4, x) + 'px'; tip.style.top = Math.max(4, y) + 'px';
}
function nascondiTip() {
  S.hover = -1; tip.hidden = true;
  if (R) { R.octx.setTransform(1, 0, 0, 1, 0, 0); R.octx.clearRect(0, 0, ov.width, ov.height); }
}

/* ---------- vista Mappa: eventi MapLibre ---------- */
function collegaMappa() {
  B.suMovimento(() => { if (!S.anim && S.t < 1) R.disegna(); });
  B.map.on('mousemove', ev => { if (S.vista === 'map') mostraTip(ev.point.x, ev.point.y, ev.originalEvent.clientX, ev.originalEvent.clientY); });
  B.map.on('mouseout', () => { S.zonaHover = null; nascondiTip(); if (S.vista === 'map') R.disegna(); });
  B.map.on('movestart', nascondiTip);
  B.map.on('moveend', () => { if (!S.anim && S.citta) scriviHash(); });
  B.map.doubleClickZoom.disable();                                             // il doppio click apre la vista Ordinata della zona
  B.map.on('dblclick', ev => {
    if (S.vista !== 'map' || S.anim) return;
    ev.preventDefault(); apriOrdinata(R.zonaIn(ev.point.x, ev.point.y));
  });
  B.map.on('click', ev => {
    if (S.vista !== 'map' || S.anim) return;
    const zi = R.zonaIn(ev.point.x, ev.point.y);
    const pt = ev.originalEvent.pointerType;
    if (pt && pt !== 'mouse' && doppioTap(ev.point.x, ev.point.y)) { apriOrdinata(zi); return; }
    if (ev.originalEvent.pointerType && ev.originalEvent.pointerType !== 'mouse') mostraTip(ev.point.x, ev.point.y, ev.originalEvent.clientX, ev.originalEvent.clientY);
    seleziona(zi >= 0 ? zi : null, false);
  });
}

/* ---------- vista Ordinata: pan / zoom / tocco sul canvas ---------- */
const ptr = new Map();
let gesto = null;
const pos = e => { const r = cv.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
function zoomOrd(x, y, f) {
  const v = S.views.sorted, k = Math.min(Math.max(v.k * f, 0.0004), 40);
  S.views.sorted = { k, tx: x - (x - v.tx) * k / v.k, ty: y - (y - v.ty) * k / v.k };
  S.fitOrd = false; nascondiTip(); R.disegna();
}
function zoomBottone(f) {
  if (S.anim) return;
  if (S.vista === 'map') { if (f > 1) B.map.zoomIn(); else B.map.zoomOut(); return; }
  zoomOrd((cv.clientWidth - S.inset) / 2, (cv.clientHeight - S.insetB) / 2, f);
}

cv.addEventListener('wheel', e => { e.preventDefault(); if (S.anim) return; const p = pos(e); zoomOrd(p.x, p.y, Math.exp(-e.deltaY * 0.0015)); }, { passive: false });
cv.addEventListener('pointerdown', e => {
  cv.setPointerCapture(e.pointerId); ptr.set(e.pointerId, pos(e));
  const v = S.views.sorted;
  if (ptr.size === 1) gesto = { tipo: 'pan', x: e.clientX, y: e.clientY, tx: v.tx, ty: v.ty, mosso: false, touch: e.pointerType !== 'mouse' };
  else if (ptr.size === 2) { const [a, b] = [...ptr.values()]; gesto = { tipo: 'pinch', d: Math.hypot(a.x - b.x, a.y - b.y), mosso: true }; }
});
cv.addEventListener('pointermove', e => {
  const p = pos(e); if (ptr.has(e.pointerId)) ptr.set(e.pointerId, p);
  if (gesto && !S.anim) {
    if (gesto.tipo === 'pan' && ptr.size === 1) {
      const dx = e.clientX - gesto.x, dy = e.clientY - gesto.y;
      if (Math.abs(dx) + Math.abs(dy) > 4) gesto.mosso = true;
      if (gesto.mosso) { const v = S.views.sorted; v.tx = gesto.tx + dx; v.ty = gesto.ty + dy; S.fitOrd = false; nascondiTip(); R.disegna(); }
    } else if (gesto.tipo === 'pinch' && ptr.size === 2) {
      const [a, b] = [...ptr.values()], d = Math.hypot(a.x - b.x, a.y - b.y);
      if (gesto.d > 0) zoomOrd((a.x + b.x) / 2, (a.y + b.y) / 2, d / gesto.d);
      gesto.d = d;
    }
    return;
  }
  if (!gesto && e.pointerType === 'mouse') mostraTip(p.x, p.y, e.clientX, e.clientY);
});
function fineGesto(e) {
  const era = gesto; ptr.delete(e.pointerId);
  if (ptr.size === 0) {
    gesto = null;
    if (era && era.tipo === 'pan' && !era.mosso && !S.anim) {
      const p = pos(e);
      if (era.touch && doppioTap(p.x, p.y)) { nascondiTip(); doppioOrdinata(p); return; }
      if (era.touch) mostraTip(p.x, p.y, e.clientX, e.clientY);
      seleziona(R.zonaIn(p.x, p.y), false);
    }
  } else gesto = { tipo: 'pan', ...(() => { const v = S.views.sorted, [q] = [...ptr.values()]; return { x: q.x, y: q.y, tx: v.tx, ty: v.ty }; })(), mosso: true };
}
cv.addEventListener('pointerup', fineGesto);
cv.addEventListener('pointercancel', fineGesto);
cv.addEventListener('pointerleave', e => { if (e.pointerType === 'mouse') nascondiTip(); });
/* camera della mappa portata prima sul poligono (senza animare), poi l'animazione Ordinata → Mappa lo fa atterrare al centro */
function tornaAlPoligono(i) {
  const b = S.citta.items[i], mpu = Geo.metriPerUnitaMerc(R.LAT);
  const r = Math.max(25, Math.max(b.ow, b.oh) / 10 * 1.5) / mpu;               // metà lato del riquadro: almeno 25 m, o 1,5 volte il poligono
  seleziona(b.z, false); nascondiTip(); S.evid = i;
  B.vaiA({ x0: b.mx - r, x1: b.mx + r, y0: b.my - r, y1: b.my + r }, false, S.inset, 19);
  vaiA('map');
}
function doppioOrdinata(p) {
  if (S.anim) return;
  const i = R.hit(p.x, p.y);
  if (i >= 0) { tornaAlPoligono(i); return; }                                   // doppio click su un poligono: torna alla Mappa centrata su di lui
  const zi = R.zonaIn(p.x, p.y);
  if (zi >= 0) { apriOrdinata(zi); return; }
  S.views.sorted = R.adattaOrdinata(); S.fitOrd = true; nascondiTip(); R.disegna();
}
cv.addEventListener('dblclick', e => { if (performance.now() - tapGestito < 600) return; doppioOrdinata(pos(e)); });

/* ---------- comandi ---------- */
async function cambiaLivello(liv) {
  if (inCoda(() => cambiaLivello(liv))) return;
  if (liv === S.livello && S.citta) return;
  try { await caricaLivello(liv); }
  catch (err) {
    console.error(err);
    if (S.citta) { nascondi(); avvisa(`Caricamento dei dati non riuscito (${err.message}). Resta il livello precedente.`); R.disegna(); }
    else errore('Errore nel caricamento dei dati: ' + err.message, () => cambiaLivello(liv));
  }
}
function cambiaColore(c) {
  if (c === S.colore) return;
  S.colore = c; S.spente.clear(); aggiornaUI(); scriviHash();
  if (S.raggruppa) ricalcola(); else { R.ricolora(); Pannello.aggiorna(S, azioni); R.disegna(); }
}
function applicaTema(t, salva) {
  S.tema = t; document.documentElement.dataset.theme = t;
  if (B) B.setTema(t);
  if (salva) { try { localStorage.setItem('tema', t); } catch (_) {} }
  if (R && S.citta) R.disegna();
  scriviHash();
}
function temaIniziale() {
  try { const t = localStorage.getItem('tema'); if (t === 'light' || t === 'dark') return t; } catch (_) {}
  return 'dark';                                                                // base scura di default (scelta dell'utente)
}
function pannelloAperto() { return !$('side-panel').classList.contains('closed'); }
function impostaPannello(aperto) {
  $('side-panel').classList.toggle('closed', !aperto);
  document.body.classList.toggle('side-panel-open', aperto);
  $('panel-toggle').setAttribute('aria-expanded', String(aperto));
    if (S.citta && S.fitOrd) S.views.sorted = R.adattaOrdinata();
  if (aperto && mobile()) document.body.classList.remove('sheet-filtri');
  aggiornaTab(); aggiornaInset();
  if (R && S.citta) R.disegna();
}
/* mobile: la tab bar in basso alterna Mappa / Legenda / Zone (le ultime due sono bottom sheet) */
function impostaFiltri(aperto) {
  document.body.classList.toggle('sheet-filtri', aperto); aggiornaInset();
  if (S.citta && S.fitOrd) S.views.sorted = R.adattaOrdinata();
  if (R && S.citta) R.disegna();
}
/* spazio coperto dal pannello: a destra su desktop; su mobile i pannelli sono a tutto schermo, quindi nessun inset */
function aggiornaInset() {
  const m = mobile(), pan = pannelloAperto(), fil = document.body.classList.contains('sheet-filtri');
  const prima = S.inset || 0;
  S.inset = pan && !m ? S.pw : 0;
  /* vista mappa: il pannello cambia (apre/chiude/ridimensiona) -> il contenuto resta centrato nell'area libera, senza cambiare zoom */
  if (B && B.map && S.vista === 'map' && S.inset !== prima) B.map.panBy([(S.inset - prima) / 2, 0], { animate: false });
  S.insetB = 0;                                                                // mobile: i pannelli sono a tutto schermo, nascondono la mappa
  if (B) B.insetB = S.insetB;
}
/* larghezza pannello: base 400 px (350 + 50), regolabile fino a +100 px (500) trascinando il bordo sinistro */
const PW_MIN = 400, PW_MAX = 500;
function impostaLarghezza(w, salva) {
  S.pw = Math.min(PW_MAX, Math.max(PW_MIN, Math.round(w)));
  document.documentElement.style.setProperty('--pw', S.pw + 'px');
  if (salva) try { localStorage.setItem('pw', String(S.pw)); } catch (_) {}
  aggiornaInset();
  if (S.citta && S.fitOrd) S.views.sorted = R.adattaOrdinata();
  if (R && S.citta) R.disegna();
}
function initResizePannello() {
  let v = PW_MIN; try { v = +localStorage.getItem('pw') || PW_MIN; } catch (_) {}
  S.pw = Math.min(PW_MAX, Math.max(PW_MIN, v)); document.documentElement.style.setProperty('--pw', S.pw + 'px');
  const h = $('panel-resize'); let on = false;
  h.addEventListener('pointerdown', e => { if (mobile()) return; on = true; h.setPointerCapture(e.pointerId); document.body.classList.add('pw-drag'); e.preventDefault(); });
  h.addEventListener('pointermove', e => { if (on) impostaLarghezza(window.innerWidth - e.clientX, false); });
  const fine = e => { if (!on) return; on = false; document.body.classList.remove('pw-drag'); impostaLarghezza(window.innerWidth - e.clientX, true); };
  h.addEventListener('pointerup', fine); h.addEventListener('pointercancel', fine);
}
function aggiornaTab() {
  const t = pannelloAperto() && mobile() ? (document.querySelector('.tab-hdr.active')?.dataset.tab === 'guida' ? 'guida' : 'zone') : document.body.classList.contains('sheet-filtri') ? 'filtri' : 'mappa';
  document.querySelectorAll('#m-tabs button').forEach(b => { const on = b.dataset.t === t; b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); });
}
function aggiornaUI() {
  document.body.classList.toggle('vista-ordinata', S.vista === 'sorted' && !S.anim);
  document.querySelectorAll('.dial-item').forEach(b => {
    const a = b.dataset.action;
    const on = (a === 'vista' && b.dataset.v === S.vista) || (a === 'livello' && b.dataset.l === S.livello)
            || (a === 'colore' && b.dataset.c === S.colore);
    b.classList.toggle('active', !!on);
    if (a === 'vista' || a === 'livello' || a === 'colore') b.setAttribute('aria-pressed', String(!!on));
  });
  Pannello.controlli(S); Cerca.aggiorna();
}

/* X di chiusura: 20 px a destra del blocco selezionato, all'altezza del suo bordo alto; senza selezione resta a destra */
function posizionaX() {
  const x = $('torna-mappa'), b = S.sel !== null && S.layout && S.vista === 'sorted' ? S.layout.blocchi[S.sel] : null;
  if (!b) { x.style.left = x.style.top = ''; x.style.right = ''; return; }
  const v = S.views.sorted, Wd = Math.max(S.W - S.inset, 100);
  const l = Math.min(v.tx + (b.x + b.w) * v.k + 20, Wd - 56), t = Math.min(Math.max(v.ty + b.y * v.k, 12), S.H - S.insetB - 56) + (mobile() ? document.getElementById('cv').offsetTop : 0);
  x.style.right = 'auto'; x.style.left = Math.max(l, 12) + 'px'; x.style.top = t + 'px';
}
/* Condivisione: l'app gira in iframe su palermohub.opendatasicilia.it, quindi si condivide l'URL della pagina ospite con lo stato
   nell'hash; la pagina ospite lo gira all'iframe (vedi docs/embed-iframe.md). Menu di link + copia: niente SDK, niente tracker, funziona anche con iframe senza allow="web-share". */
const URL_APP = 'https://palermohub.opendatasicilia.it/palermo-ordinata.html';
const urlCondivisione = () => { scriviHash(); return URL_APP + '#' + costruisciHash(); };
const TESTO_CONDIVISIONE = 'Palermo, ordinata: gli edifici zona per zona, dal più grande al più piccolo';
function linkSocial(r) {
  const u = encodeURIComponent(urlCondivisione()), t = encodeURIComponent(TESTO_CONDIVISIONE);
  return { whatsapp: `https://wa.me/?text=${t}%20${u}`, telegram: `https://t.me/share/url?url=${u}&text=${t}`,
    facebook: `https://www.facebook.com/sharer/sharer.php?u=${u}`, x: `https://twitter.com/intent/tweet?url=${u}&text=${t}`,
    linkedin: `https://www.linkedin.com/sharing/share-offsite/?url=${u}`, mail: `mailto:?subject=${t}&body=${u}` }[r];
}
function chiudiCondividi() { const m = $('share-menu'); if (m.hidden) return; m.hidden = true; $('share-btn').setAttribute('aria-expanded', 'false'); }
function menuCondividi() {
  const m = $('share-menu'), b = $('share-btn');
  if (!m.hidden) { chiudiCondividi(); return; }
  const r = b.getBoundingClientRect();
  m.querySelectorAll('a[data-s]').forEach(a => { a.href = linkSocial(a.dataset.s); });
  m.hidden = false; b.setAttribute('aria-expanded', 'true');
  m.style.left = Math.min(r.right + 8, innerWidth - m.offsetWidth - 8) + 'px';
  m.style.top = Math.max(8, Math.min(r.top, innerHeight - m.offsetHeight - 8)) + 'px';
}
function collegaCondividi() {
  const m = $('share-menu');
  m.querySelectorAll('a[data-s]').forEach(a => { a.href = linkSocial(a.dataset.s); a.addEventListener('click', chiudiCondividi); });
  m.querySelector('[data-s="copia"]').addEventListener('click', async e => {
    const el = e.currentTarget, URL_CONDIVISIONE = urlCondivisione(); let ok = false;
    try { await navigator.clipboard.writeText(URL_CONDIVISIONE); ok = true; } catch (_) {
      const t = document.createElement('textarea'); t.value = URL_CONDIVISIONE; t.style.position = 'fixed'; t.style.opacity = '0';
      document.body.appendChild(t); t.select(); try { ok = document.execCommand('copy'); } catch (_) {} t.remove();
    }
    el.textContent = ok ? 'Link copiato ✓' : URL_CONDIVISIONE;
    setTimeout(() => { el.textContent = 'Copia link'; chiudiCondividi(); }, ok ? 1200 : 4000);
  });
  document.addEventListener('pointerdown', e => { if (!m.hidden && !m.contains(e.target) && !$('share-btn').contains(e.target)) chiudiCondividi(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') chiudiCondividi(); });
  window.addEventListener('resize', chiudiCondividi);
}
function collegaInterfaccia() {
  $('torna-mappa').addEventListener('click', () => vaiA('map'));
  document.addEventListener('keydown', e => { if ((e.key === 'm' || e.key === 'M') && !e.target.matches('input,textarea') && !e.ctrlKey && !e.metaKey && S.vista === 'sorted') vaiA('map'); });
  collegaCondividi();
  $('dial-fab').addEventListener('click', () => {
    const aperto = $('dial-items').classList.toggle('open'); $('dial-fab').setAttribute('aria-expanded', String(aperto));
  });
  document.querySelectorAll('.dial-item').forEach(b => b.addEventListener('click', () => {
    switch (b.dataset.action) {
      case 'vista': vaiA(b.dataset.v); break;
      case 'livello': cambiaLivello(b.dataset.l); break;
      case 'colore': cambiaColore(b.dataset.c); break;
      case 'home': vaiHome(); break;
      case 'zoom-piu': zoomBottone(1.5); break;
      case 'zoom-meno': zoomBottone(1 / 1.5); break;
      case 'tema': applicaTema(S.tema === 'dark' ? 'light' : 'dark', true); break;
      case 'schermo': if (document.fullscreenElement) document.exitFullscreen(); else document.documentElement.requestFullscreen().catch(() => {}); break;
      case 'pannello': impostaPannello(!pannelloAperto()); break;
      case 'condividi': menuCondividi(); break;
    }
  }));
  document.querySelectorAll('#seg-livello button, #seg-livello-mini button').forEach(b => b.addEventListener('click', () => cambiaLivello(b.dataset.l)));
  document.querySelectorAll('#seg-colore button').forEach(b => b.addEventListener('click', () => cambiaColore(b.dataset.c)));
  $('raggruppa').addEventListener('change', e => { S.raggruppa = e.target.checked; scriviHash(); ricalcola(); });
  $('lato').addEventListener('change', e => { S.lato = e.target.checked; scriviHash(); ricalcola(); });
  try { S.liveZoom = localStorage.getItem('live-zoom') !== '0'; } catch (_) {}
  $('live-zoom').checked = S.liveZoom;
  $('live-zoom').addEventListener('change', e => { S.liveZoom = e.target.checked; try { localStorage.setItem('live-zoom', S.liveZoom ? '1' : '0'); } catch (_) {} });
  $('isola').addEventListener('change', e => { S.isola = e.target.checked; scriviHash(); nascondiTip(); R.ricolora(); R.disegna(); if (S.isola && S.sel !== null) seleziona(S.sel); });
  $('filtri-toggle').addEventListener('click', () => { const c = $('filtri').classList.toggle('chiuso'); $('filtri-toggle').setAttribute('aria-expanded', String(!c)); });
  initResizePannello();
  $('panel-toggle').addEventListener('click', () => impostaPannello(!pannelloAperto()));
  document.querySelectorAll('#m-tabs button').forEach(b => b.addEventListener('click', () => {
    const t = b.dataset.t;
    if (t === 'filtri') { const a = !document.body.classList.contains('sheet-filtri'); impostaFiltri(a); if (a) { $('filtri').classList.remove('chiuso'); impostaPannello(false); } }
    else if (t === 'zone' || t === 'guida') {                                    // stesso pannello, tab interno diverso
      impostaFiltri(false);
      const hdr = document.querySelector('.tab-hdr.active'), inGuida = !!hdr && hdr.dataset.tab === 'guida';
      const aperto = pannelloAperto() && (t === 'guida' ? inGuida : !inGuida);    // il bottone è già "acceso" -> secondo tocco chiude
      if (t === 'guida' && !inGuida) document.querySelector('.tab-hdr[data-tab="guida"]').click();
      if (t === 'zone' && inGuida) document.querySelector('.tab-hdr[data-tab="zone"]').click();
      impostaPannello(!aperto);
    }
    else { impostaFiltri(false); impostaPannello(false); }
    aggiornaTab();
  }));
  const corpo = $('panel-body'), su = $('torna-su');
  corpo.addEventListener('scroll', () => su.classList.toggle('on', corpo.scrollTop > 120), { passive: true });
  su.addEventListener('click', () => corpo.scrollTo({ top: 0, behavior: 'smooth' }));
  $('panel-close-mobile').addEventListener('click', () => impostaPannello(false));
  document.querySelectorAll('.tab-hdr').forEach(b => b.addEventListener('click', () => {
    document.querySelectorAll('.tab-hdr').forEach(x => { const on = x === b; x.classList.toggle('active', on); x.setAttribute('aria-selected', String(on)); });
    document.querySelectorAll('.tab-content').forEach(c => c.classList.toggle('active', c.id === 'tab-' + b.dataset.tab));
    corpo.scrollTop = 0; su.classList.remove('on'); scriviHash();
  }));
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !e.target.matches('input')) seleziona(null); });
  window.addEventListener('hashchange', async () => {
    const h = leggiHash();
    if (h.l !== S.livello) await cambiaLivello(h.l);
    if (h.v !== S.vista) vaiA(h.v);
    const zi = S.citta ? S.citta.zone.findIndex(z => z.id === h.z) : -1;
    if (zi !== (S.sel === null ? -1 : S.sel)) seleziona(zi >= 0 ? zi : null, false);
    if (h.c && h.v === 'map') applicaCamera(h.c);
  });
}

/* reset dalla barra di ricerca: toglie filtri di classe, ricerca del pannello e selezione, poi riporta la mappa allo zoom iniziale */
function resetTutto() {
  if (!S.citta || S.anim) return;
  S.spente.clear(); S.sel = null;
  nascondiTip(); R.ricolora(); scriviHash(); Pannello.aggiorna(S, azioni); Cerca.aggiorna(); marcaMini();
  vaiHome();
}
function vaiHome() {                                                           // Palermo sempre al centro dell'area visibile, a ogni risoluzione
  if (!S.citta) return;
  if (S.vista !== 'map') vaiA('map');
  B.vaiA(bboxCitta(), true, S.inset);
}

function ridimensiona() {
  if (B) B.limiti();
  S.dpr = window.devicePixelRatio || 1; S.W = $('map').clientWidth || innerWidth; S.H = $('map').clientHeight || innerHeight;
  aggiornaInset();
  if (!R || !S.citta) return;
  if (S.fitOrd) S.views.sorted = R.adattaOrdinata();
  R.disegna();
}

(async function avvio() {
  try {
    const h = leggiHash();
    S.tema = h.t || temaIniziale(); document.documentElement.dataset.theme = S.tema;
    S.dpr = window.devicePixelRatio || 1; S.W = $('map').clientWidth || innerWidth; S.H = $('map').clientHeight || innerHeight;
    S.index = await (await fetch('data/index.json')).json();
    S.gamma = Geo.convergenza(S.index);
    B = Base.crea($('map'), S.tema);
    R = Render.crea(S, B, cv, ov);
    const disegnaOrig = R.disegna;                                              // la X segue il blocco selezionato a ogni ridisegno
    R.disegna = (...args) => { const r = disegnaOrig.apply(R, args); posizionaX(); return r; };
    collegaMappa(); collegaInterfaccia(); Cerca.init(S, azioni);
    $('map').addEventListener('base-offline', () => avvisa('Mappa di base non raggiungibile: restano visibili gli edifici.'));
    S.colore = h.k; S.spente = new Set(h.x); S.raggruppa = h.g; S.lato = h.s; S.isola = h.i;
    $('raggruppa').checked = h.g; $('lato').checked = h.s; $('isola').checked = h.i;
    document.querySelector(`.tab-hdr[data-tab="${h.p}"]`).click();
    impostaPannello(!mobile());
    B.limiti();
    new ResizeObserver(ridimensiona).observe(document.body);
    await caricaLivello(h.l);
    const zi = S.citta.zone.findIndex(z => z.id === h.z);
    if (zi >= 0) { S.sel = zi; Pannello.aggiorna(S, azioni); marcaMini(); B.vaiA(S.citta.zone[zi].bboxM, false, S.inset); }
    else B.vaiA(bboxCitta(), false, S.inset);                                   // all'avvio tutta la citta' e' inquadrata
    if (h.c) applicaCamera(h.c);                                                // camera esplicita nell'hash: prevale sull'inquadratura
    S.vista = h.v; S.lin = S.t = h.v === 'sorted' ? 1 : 0;
    impostaInterazione(); aggiornaUI(); R.disegna(); scriviHash();
  } catch (err) { errore('Errore nel caricamento dei dati: ' + err.message); console.error(err); }
})();
