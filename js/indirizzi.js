/* Indirizzi (via + civico) di un edificio per il tooltip, in Mappa e in Ordinata.
   Indirizzi.carica(livello, index) -> Promise: scarica civici.json (+ perm-livelli.json se il livello non e' UPL) e costruisce l'indice inverso.
   Indirizzi.testo(i) -> stringa (vuota se nessun civico agganciato); i = posizione dell'edificio in Citta.items del livello caricato.
   I civici sono agganciati all'edificio piu' vicino: l'indirizzo e' "probabile", non certo. */
(function (root) {
  const MAX_VIE = 3, MAX_NUM = 6;
  const MINUSC = new Set(['di', 'del', 'della', 'dei', 'delle', 'degli', 'dello', 'da', 'e', 'al', 'alla', 'in']);
  const bello = n => n.toLowerCase().replace(/[^\s'’.-]+/g, (w, i) => (i && MINUSC.has(w)) ? w : w.charAt(0).toUpperCase() + w.slice(1));
  let pronto = false, inv = null, perm = null, civ = null, perms = null;          // inv: Map(indice edificio UPL concatenato -> [[via, civico]])

  async function json(url) { const r = await fetch(url); if (!r.ok) throw new Error(url + ': HTTP ' + r.status); return r.json(); }

  async function carica(livello, index) {
    pronto = false;                                                 // finche' perm non corrisponde al livello caricato niente indirizzi
    try {
      if (!civ) civ = await json('data/civici.json');
      if (!inv) {
        const off = []; let s = 0;
        for (const z of index.zone) if (z.level === 'upl') { off.push(s); s += z.n; }
        inv = new Map();
        for (const via in civ) {
          const [nn, u, bi] = civ[via];
          for (let k = 0; k < nn.length; k++) {
            const g = off[u[k]] + bi[k], l = inv.get(g);
            if (l) l.push([via, nn[k]]); else inv.set(g, [[via, nn[k]]]);
          }
        }
      }
      if (livello === 'upl') perm = null;
      else { if (!perms) perms = await json('data/perm-livelli.json'); perm = perms[livello]; }
      pronto = true;
    } catch (e) { inv = null; perm = null; }                       // senza indirizzi il tooltip resta com'era
  }

  function testo(i) {
    if (!pronto) return '';
    const l = inv.get(perm ? perm[i] : i);
    if (!l) return '';
    const per = new Map();
    for (const [via, n] of l) { const a = per.get(via); if (a) a.push(n); else per.set(via, [n]); }
    let resto = l.length, out = [];
    for (const [via, nn] of per) {
      if (out.length >= MAX_VIE) break;
      const mostra = nn.slice(0, MAX_NUM); resto -= mostra.length;
      out.push(`${bello(via)} ${mostra.join(', ')}${nn.length > mostra.length ? '…' : ''}`);
    }
    return out.join(' · ') + (resto > 0 ? ` (+${resto})` : '');
  }

  root.Indirizzi = { carica, testo };
})(typeof window !== 'undefined' ? window : globalThis);
