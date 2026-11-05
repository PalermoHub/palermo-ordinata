/* Cerca intelligente in basso al centro: circoscrizione, quartiere e UPL in un'unica casella.
   - la gerarchia (circoscrizione > quartiere > UPL) viene da `parent` in data/index.json, quindi vale per tutti i livelli senza caricarli;
   - a scalare: con una zona selezionata i suggerimenti partono dalle zone che ne dipendono (poi quelle fuori ambito, attenuate);
   - ← / → (anche da tastiera) scorrono le zone sorelle, le stesse mostrate dalla mini-mappa.
   Cerca.init(S, azioni) una volta; Cerca.aggiorna() a ogni cambio di selezione o livello.
   azioni = {vaiAZona(id), seleziona(zi | null)}. */
(function (root) {
  const $ = id => document.getElementById(id);
  const SIGLA = { circ: 'Circ.', quar: 'Quartiere', upl: 'UPL' };
  const MAX = 10;
  const norm = s => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const breve = z => z.level === 'circ' ? z.name.replace(/^Circoscrizione\s+/i, 'Circ. ') : z.name;

  let S, az, zone = [], per = new Map(), opz = [], att = -1, pronto = false;

  function init(stato, azioni) {
    S = stato; az = azioni;
    zone = S.index.zone.map((z, ord) => ({ id: z.id, level: z.level, name: z.name, parent: z.parent, ord, hay: norm(z.name), lvl: norm(SIGLA[z.level]) }));
    per = new Map(zone.map(z => [z.id, z]));
    collega(); pronto = true; aggiorna();
  }

  /* ---------- gerarchia ---------- */
  const selId = () => S.citta && S.sel !== null ? S.citta.zone[S.sel].id : null;
  function catena(id) { const c = []; for (let z = per.get(id); z; z = per.get(z.parent)) c.unshift(z); return c; }
  function discende(z, avo) { for (let p = per.get(z.parent); p; p = per.get(p.parent)) if (p.id === avo) return true; return false; }
  /* zone sorelle (stesso livello, stesso genitore) nell'ordine dell'indice; senza selezione: tutto il livello corrente */
  function sorelle(id) {
    const z = id && per.get(id);
    return z ? zone.filter(x => x.level === z.level && x.parent === z.parent) : zone.filter(x => x.level === S.livello);
  }
  /* radice dell'ambito dei suggerimenti: la zona selezionata, o il suo genitore se e' una foglia (UPL) */
  function ambito(id) {
    const z = id && per.get(id); if (!z) return null;
    return z.level === 'upl' ? z.parent : z.id;
  }

  /* ---------- passi avanti / indietro ---------- */
  function passo(dir) {
    if (!pronto || !S.citta) return;
    const id = selId(), l = sorelle(id);
    if (!l.length) return;
    const i = id ? l.findIndex(z => z.id === id) : -1;
    const t = id ? l[(i + dir + l.length) % l.length] : (dir > 0 ? l[0] : l[l.length - 1]);
    if (t.id !== id) az.vaiAZona(t.id);
  }

  /* ---------- suggerimenti ---------- */
  function suggerimenti(q) {
    const id = selId(), amb = ambito(id), qn = norm(q.trim());
    const dentro = z => !amb || z.parent === amb || discende(z, amb);
    if (!qn) {
      if (!amb) return zone.filter(z => z.level === 'circ').map(z => ({ z, in: true }));
      return zone.filter(z => z.id !== id && dentro(z) && z.parent === amb).map(z => ({ z, in: true }));
    }
    const punti = z => {
      const t = qn.split(/\s+/);
      const parole = z.hay.split(/[^a-z0-9]+/);                        // ogni termine deve iniziare una parola (cosi' "iii" non trova "viii")
      if (!t.every(p => parole.some(w => w.startsWith(p)) || z.lvl.startsWith(p))) return -1;
      return z.hay.startsWith(t[0]) ? 0 : 1;
    };
    const r = [];
    for (const z of zone) { if (z.id === id) continue; const p = punti(z); if (p >= 0) r.push({ z, p, in: dentro(z) }); }
    r.sort((a, b) => (b.in - a.in) || (a.p - b.p) || (a.z.ord - b.z.ord));
    return r.slice(0, MAX);
  }

  /* ---------- disegno ---------- */
  function el(tag, cls, testo) { const e = document.createElement(tag); if (cls) e.className = cls; if (testo !== undefined) e.textContent = testo; return e; }

  function elenco() {
    const ul = $('cerca-lista'); ul.textContent = '';
    opz.forEach((o, i) => {
      if (!o.in && (i === 0 || opz[i - 1].in)) ul.append(Object.assign(el('li', 'sep', 'Fuori da questo ambito'), { role: 'presentation' }));
      const li = el('li', 'opz' + (o.in ? '' : ' fuori')); li.id = 'opz-' + i; li.setAttribute('role', 'option'); li.setAttribute('aria-selected', String(i === att));
      const b = el('span', 'lv ' + o.z.level, SIGLA[o.z.level]);
      const n = el('span', 'nm', o.z.name);
      const pa = catena(o.z.id).slice(0, -1).map(breve).join(' › ');
      li.append(b, n); if (pa) li.append(el('span', 'pa', pa));
      li.addEventListener('mousedown', e => { e.preventDefault(); scegli(i); });
      ul.append(li);
    });
    if (!opz.length) ul.append(Object.assign(el('li', 'vuoto', 'Nessuna zona trovata'), { role: 'presentation' }));
  }
  function evidenzia(i) {
    att = i;
    const inp = $('cerca-zona');
    document.querySelectorAll('#cerca-lista .opz').forEach((li, k) => li.setAttribute('aria-selected', String(k === i)));
    if (i >= 0) { inp.setAttribute('aria-activedescendant', 'opz-' + i); $('opz-' + i).scrollIntoView({ block: 'nearest' }); } else inp.removeAttribute('aria-activedescendant');
  }
  function apri() {
    opz = suggerimenti($('cerca-zona').value); att = opz.length ? 0 : -1;
    elenco(); $('cerca-lista').hidden = false; $('cerca-zona').setAttribute('aria-expanded', 'true'); evidenzia(att);
  }
  function chiudi() { $('cerca-lista').hidden = true; $('cerca-zona').setAttribute('aria-expanded', 'false'); $('cerca-zona').removeAttribute('aria-activedescendant'); att = -1; }
  function scegli(i) {
    const o = opz[i]; if (!o) return;
    $('cerca-zona').value = ''; chiudi(); az.vaiAZona(o.z.id);
  }

  function aggiorna() {
    if (!pronto) return;
    const id = selId(), cr = $('cerca-briciole'); cr.textContent = '';
    if (id) {
      const c = catena(id);
      c.forEach((z, k) => {
        if (k) cr.append(el('span', 'sp', '›'));
        const b = el('button', 'bri' + (z.id === id ? ' cur' : ''), breve(z)); b.type = 'button';
        b.title = z.id === id ? z.name : 'Vai a ' + z.name; if (z.id === id) b.setAttribute('aria-current', 'true');
        b.addEventListener('click', () => { if (z.id !== id) az.vaiAZona(z.id); });
        cr.append(b);
      });
      const x = el('button', 'bri-x', '×'); x.type = 'button'; x.title = 'Togli la selezione (Esc)'; x.setAttribute('aria-label', 'Togli la selezione');
      x.addEventListener('click', () => az.seleziona(null)); cr.append(x);
    }
    cr.hidden = !id;
    const l = sorelle(id), i = id ? l.findIndex(z => z.id === id) : -1;
    $('cerca-pos').textContent = id ? `${i + 1}/${l.length}` : `${l.length}`;
    const solo = l.length < 2 && !!id;
    $('cerca-prec').disabled = $('cerca-succ').disabled = solo;
    $('cerca-prec').title = 'Zona precedente (←)'; $('cerca-succ').title = 'Zona successiva (→)';
    if (!$('cerca-lista').hidden) apri();
  }

  /* ---------- eventi ---------- */
  function collega() {
    const inp = $('cerca-zona');
    $('cerca-prec').addEventListener('click', () => passo(-1));
    $('cerca-succ').addEventListener('click', () => passo(1));
    $('cerca-reset').addEventListener('click', () => { inp.value = ''; chiudi(); inp.blur(); az.reset(); });
    inp.addEventListener('focus', apri);
    inp.addEventListener('click', () => { if ($('cerca-lista').hidden) apri(); });
    inp.addEventListener('input', apri);
    inp.addEventListener('blur', chiudi);
    inp.addEventListener('keydown', e => {
      const aperta = !$('cerca-lista').hidden;
      switch (e.key) {
        case 'ArrowDown': e.preventDefault(); if (!aperta) apri(); else if (opz.length) evidenzia((att + 1) % opz.length); break;
        case 'ArrowUp': e.preventDefault(); if (!aperta) apri(); else if (opz.length) evidenzia((att - 1 + opz.length) % opz.length); break;
        case 'Enter': if (aperta && att >= 0) { e.preventDefault(); scegli(att); } break;
        case 'Escape': e.preventDefault(); e.stopPropagation(); if (inp.value) { inp.value = ''; apri(); } else if (aperta) chiudi(); else inp.blur(); break;
        case 'ArrowLeft': case 'ArrowRight':                       // con la casella vuota le frecce scorrono le zone invece di muovere il cursore
          if (!inp.value && !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey) { e.preventDefault(); passo(e.key === 'ArrowRight' ? 1 : -1); }
          break;
      }
    });
    /* frecce da tastiera ovunque nella pagina (in fase di cattura: prima dei tasti di MapLibre, che altrimenti sposterebbe la mappa) */
    document.addEventListener('keydown', e => {
      const t = e.target;
      if (e.key === '/' && !(t.matches && t.matches('input,textarea,select,[contenteditable]'))) { e.preventDefault(); inp.focus(); return; }
      if ((e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') || e.shiftKey || e.ctrlKey || e.metaKey || e.altKey) return;
      if (t.matches && t.matches('input,textarea,select,[contenteditable]')) return;
      if (selId() === null) return;                               // senza selezione le frecce restano alla mappa
      e.preventDefault(); e.stopPropagation(); passo(e.key === 'ArrowRight' ? 1 : -1);
    }, true);
  }

  root.Cerca = { init, aggiorna };
})(typeof window !== 'undefined' ? window : globalThis);
