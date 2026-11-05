/* Renderer degli edifici sul canvas sopra la base MapLibre.
   e = progresso Mappa(0) -> Ordinata(1). Ogni edificio ha due posizioni: proiettata dalla camera di MapLibre (Mercator)
   e slot nel blocco della sua zona (vista Ordinata); la posizione, la scala e la rotazione sono interpolate.
   Gli anelli (Path2D) sono relativi al centroide dell'edificio. LOD: sotto 10 px si disegna un rettangolo
   (un solo fill per colore), altrimenti il poligono vero. */
(function (root) {
  const COLORI = {
    uso: ['#f2b134', '#4fb3d9', '#e58fb0', '#b07cf0', '#ef6f6c', '#5fd38d', '#7e9cf5', '#9bc53d', '#5a6070'],
    alt: ['#35476b', '#3f78a8', '#3fa7a0', '#8fcf6a', '#f2d04b', '#f27a45', '#5a6070'],
    sup: ['#3f78a8', '#3fa7a0', '#f2d04b', '#f27a45'],
  };
  const KEY = { uso: 0, alt: 1, sup: 2 };
  const NUM = new Intl.NumberFormat('it-IT', { useGrouping: 'always' });
  const COL_B = '#38bdf8';                                                  // seconda zona del confronto (la prima usa l'accento)
  const LAT = 38.1394, SOGLIA_PX = 10, CELLA_M = 150;

  function crea(S, B, cv, ov) {
    const ctx = cv.getContext('2d'), octx = ov.getContext('2d');
    const M = new Float64Array(6);
    let n = 0, MX, MY, SX, SY, OW, OH, SW, SH, SCX, SCY, ANG1, ZI, PER = [], grigliaMap = null, grigliaOrd = null, grandiMap = [], grandiOrd = [], VIS = new Uint8Array(0);
    const stile = nome => getComputedStyle(document.documentElement).getPropertyValue(nome).trim();

    /* ricostruisce gli array tipizzati da S.citta e S.layout (dopo caricamento, layout, lato, colore) */
    function carica() {
      const it = S.citta.items; n = it.length;
      const reale = !!(S.layout && S.layout.reale);                                       // nel lotto e nella vista Ordinata dei lotti gli edifici restano nella posizione e nell'orientamento reali
      MX = new Float64Array(n); MY = new Float64Array(n); SX = new Float64Array(n); SY = new Float64Array(n);
      OW = new Float32Array(n); OH = new Float32Array(n); SW = new Float32Array(n); SH = new Float32Array(n);
      SCX = new Float32Array(n); SCY = new Float32Array(n); ANG1 = new Float32Array(n); ZI = new Int16Array(n);
      for (let i = 0; i < n; i++) {
        const b = it[i];
        MX[i] = b.mx; MY[i] = b.my; ZI[i] = b.z;
        SX[i] = S.layout.pos[2 * i]; SY[i] = S.layout.pos[2 * i + 1];
        OW[i] = b.ow; OH[i] = b.oh;
        if (S.lato && !reale) { SW[i] = b.lw; SH[i] = b.lh; SCX[i] = b.lcx; SCY[i] = b.lcy; ANG1[i] = b.ang; }
        else { SW[i] = b.ow; SH[i] = b.oh; SCX[i] = b.ocx; SCY[i] = b.ocy; ANG1[i] = 0; }
      }
      ricolora();
      costruisciGriglie();
    }
    /* zone in primo piano: le due del confronto (S.conf) oppure la zona selezionata. fuori(zi) = da attenuare/nascondere; colFuoco(zi) = colore del bordo */
    const inFuoco = () => !!S.conf || S.sel !== null;
    const fuori = zi => S.conf ? zi !== S.conf.a && zi !== S.conf.b : S.sel !== null && zi !== S.sel;
    const evid = zi => S.conf ? zi === S.conf.a || zi === S.conf.b : S.sel === zi;
    const colFuoco = zi => S.conf && zi === S.conf.b ? COL_B : stile('--accent');
    function ricolora() {
      const k = KEY[S.colore], ncl = COLORI[S.colore].length, tmp = Array.from({ length: ncl }, () => []);
      const it = S.citta.items, spente = S.spente, iso = S.isola && inFuoco(), foc = S.isoFocus !== null ? S.isoSet : null;
      const lotOff = S.lotti && S.isoFocus === null && S.lottiOff.size ? S.lottiOff : null;      // filtro per classe di lotto (indipendente dal colore)
      VIS = new Uint8Array(n);                                                           // 0 = classe spenta dalla legenda (o edificio fuori dall'isolato in primo piano): non si disegna e non risponde al cursore
      for (let i = 0; i < n; i++) { if (foc && !foc[i]) continue; if (iso && fuori(ZI[i])) continue; const c = it[i].cls[k]; if (spente.has(c) || (lotOff && root.Lotti.nascosto(it[i], lotOff))) continue; VIS[i] = 1; tmp[c].push(i); }
      PER = tmp.map(a => Int32Array.from(a));
      if (S.layout && S.layout.lotti) for (const c of S.layout.lotti) c.vis = c.ids.some(i => VIS[i]);     // il contorno di un lotto resta solo se ha edifici visibili
    }

    /* riquadro degli edifici visibili (della zona selezionata, se c'e'): Mercator in vista Mappa, dm del layout in Ordinata; null se non resta nulla */
    function riquadro(vista) {
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (let i = 0; i < n; i++) {
        if (!VIS[i] || fuori(ZI[i])) continue;
        const hw = vista === 'map' ? 0 : SW[i] / 2, hh = vista === 'map' ? 0 : SH[i] / 2;
        const x = vista === 'map' ? MX[i] : SX[i], y = vista === 'map' ? MY[i] : SY[i];
        if (x - hw < x0) x0 = x - hw; if (x + hw > x1) x1 = x + hw;
        if (y - hh < y0) y0 = y - hh; if (y + hh > y1) y1 = y + hh;
      }
      return x0 <= x1 ? { x0, y0, x1, y1 } : null;
    }

    function costruisciGriglie() {
      const it = S.citta.items, cm = CELLA_M / Geo.metriPerUnitaMerc(LAT);
      grigliaMap = new Map(); grandiMap = []; grigliaOrd = new Map(); grandiOrd = [];
      const cellaOrd = CELLA_M * 4;                                                     // dm
      for (let i = 0; i < n; i++) {
        const b = it[i];
        if (Math.max(b.ow, b.oh) > CELLA_M * 10 * 0.8) grandiMap.push(i);
        else { const kk = Math.floor(MX[i] / cm) * 1000003 + Math.floor(MY[i] / cm); (grigliaMap.get(kk) || grigliaMap.set(kk, []).get(kk)).push(i); }
        if (Math.max(SW[i], SH[i]) > cellaOrd * 0.8) grandiOrd.push(i);
        else { const kk = Math.floor(SX[i] / cellaOrd) * 1000003 + Math.floor(SY[i] / cellaOrd); (grigliaOrd.get(kk) || grigliaOrd.set(kk, []).get(kk)).push(i); }
      }
      grigliaMap.cella = cm; grigliaOrd.cella = cellaOrd;
    }

    const kMappa = v => v.world / (Geo.metriPerUnitaMerc(LAT) * 10);                     // px per dm in vista Mappa

    /* adatta la vista Ordinata allo spazio disponibile (esclude il pannello se aperto) */
    function adattaOrdinata() {
      const w = S.layout.w, h = S.layout.h, m = 24, Wd = Math.max(S.W - S.inset, 100), Hd = Math.max(S.H - S.insetB, 100);
      const k = Math.min((Wd - 2 * m) / w, (Hd - 2 * m) / h);
      return { k, tx: (Wd - w * k) / 2, ty: (Hd - h * k) / 2 };
    }

    /* matrice del singolo edificio al progresso e (stessa forma dell'originale: posizione, scala, rotazione) */
    function matrice(i, e, out) {
      const v = B.vista(), vs = S.views.sorted, k0 = kMappa(v), k1 = vs.k, b = S.citta.items[i];
      const P0x = (MX[i] - v.cx) * v.world + v.W / 2, P0y = (MY[i] - v.cy) * v.world + v.H / 2;
      const Q1x = vs.tx + SX[i] * k1, Q1y = vs.ty + SY[i] * k1;
      const a1 = ANG1[i], a = S.gamma + (a1 - S.gamma) * e, k = k0 + (k1 - k0) * e;
      const T1x = Q1x - k1 * SCX[i], T1y = Q1y - k1 * SCY[i];
      out[0] = Math.cos(a) * k; out[1] = Math.sin(a) * k; out[2] = -out[1]; out[3] = out[0];
      out[4] = P0x + (T1x - P0x) * e; out[5] = P0y + (T1y - P0y) * e;
      return out;
    }

    function disegna() {
      if (!S.citta) return;
      const v = B.vista(), dpr = S.dpr, e = S.t, vs = S.views.sorted;
      if (cv.width !== Math.round(v.W * dpr) || cv.height !== Math.round(v.H * dpr)) {
        cv.width = ov.width = Math.round(v.W * dpr); cv.height = ov.height = Math.round(v.H * dpr);
      }
      ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, cv.width, cv.height);
      const cont = B.map.getContainer();                                                  // la base sfuma insieme agli edifici
      cont.style.opacity = String(1 - 0.97 * e);
      cont.style.visibility = e >= 0.999 ? 'hidden' : 'visible';
      cont.classList.toggle('nascosta', e >= 0.999);                                      // anche i controlli (attribuzione) sono nascosti

      const W = v.W, H = v.H, wd = v.world, k0 = kMappa(v), k1 = vs.k, k = k0 + (k1 - k0) * e;
      scala(k);
      if (e < 0.999) disegnaConfini(v, 1 - e);
      if (e > 0.001) disegnaBlocchi(vs, e);
      if (e > 0.001 && S.isoFocus !== null && S.isoTipo === 'lotto' && S.lottoAnelli) disegnaLotto(vs, e);
      else if (e > 0.001 && S.layout.lotti) disegnaLottiOrd(vs, e, v);

      const soloLotti = S.lotti && S.edifici === false && e < 0.001;                      // interruttore «Edifici sui lotti» spento (solo Mappa)
      const sel = inFuoco() ? 1 : null, ncl = PER.length, cols = COLORI[S.colore];
      const grandi = [];
      for (let cl = 0; cl < ncl; cl++) {
        const pa = new Path2D(), pb = new Path2D(), ids = soloLotti ? [] : PER[cl];
        for (let j = 0; j < ids.length; j++) {
          const i = ids[j];
          let x = (MX[i] - v.cx) * wd + W / 2, y = (MY[i] - v.cy) * wd + H / 2;
          if (e > 0) { x += (vs.tx + SX[i] * k1 - x) * e; y += (vs.ty + SY[i] * k1 - y) * e; }
          const w = OW[i] + (SW[i] - OW[i]) * e, h = OH[i] + (SH[i] - OH[i]) * e;
          if (w * k < SOGLIA_PX && h * k < SOGLIA_PX) {
            if (x < -60 || y < -60 || x > W + 60 || y > H + 60) continue;                // i piccoli: scarto sul centroide
            const pw = Math.max(w * k, 1.5), ph = Math.max(h * k, 1.5);
            (sel !== null && fuori(ZI[i]) ? pa : pb).rect((x - pw / 2) * dpr, (y - ph / 2) * dpr, pw * dpr, ph * dpr);
          } else grandi.push(i);
        }
        ctx.fillStyle = cols[cl];
        if (sel !== null) { ctx.globalAlpha = 0.35; ctx.fill(pa); ctx.globalAlpha = 1; }
        ctx.fill(pb);
      }
      const it = S.citta.items;
      for (const i of grandi) {
        matrice(i, e, M);
        const r = Math.hypot(Math.max(OW[i], SW[i]), Math.max(OH[i], SH[i])) * k + 20;   // i grandi: scarto solo se l'intero edificio e' fuori
        if (M[4] < -r || M[5] < -r || M[4] > W + r || M[5] > H + r) continue;
        ctx.globalAlpha = sel !== null && fuori(ZI[i]) ? 0.35 : 1;
        ctx.fillStyle = cols[it[i].cls[KEY[S.colore]]];
        ctx.setTransform(M[0] * dpr, M[1] * dpr, M[2] * dpr, M[3] * dpr, M[4] * dpr, M[5] * dpr);
        ctx.fill(Citta.path(it[i]), 'evenodd');
      }
      ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = 1;
      if (S.isolati && root.Isolati && root.Isolati.pronto() && e < 0.999) disegnaIsolati(v, 1 - e);
      if (!soloLotti && S.evid != null && S.citta.items[S.evid] && VIS[S.evid]) {                        // poligono evidenziato: bordo spesso, scuro sotto e chiaro sopra
        const i = S.evid; matrice(i, e, M);
        const kk = Math.hypot(M[0], M[1]) || 1, P = Citta.path(it[i]);
        ctx.setTransform(M[0] * dpr, M[1] * dpr, M[2] * dpr, M[3] * dpr, M[4] * dpr, M[5] * dpr);
        ctx.lineJoin = 'round';
        ctx.strokeStyle = 'rgba(0,0,0,.75)'; ctx.lineWidth = 7 / kk; ctx.stroke(P);
        ctx.strokeStyle = '#fff'; ctx.lineWidth = 3.5 / kk; ctx.stroke(P);
      }
      ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = 1;
      if (e > 0.6 && S.raggruppa) disegnaEtichetteGruppo(vs, (e - 0.6) / 0.4);
    }

    /* contorni degli isolati: tutti (tratteggio sottile) solo se abbastanza grandi sullo schermo; sempre quello sotto il cursore e quello scelto */
    function disegnaIsolati(v, alfa) {
      const dpr = S.dpr, wd = v.world, L = root.Isolati.lista, W = v.W, H = v.H;
      const pxm = wd / Geo.metriPerUnitaMerc(LAT);                                          // px per metro
      const traccia = (k) => {
        for (const r of L[k].anelli) for (let i = 0; i < r.length; i += 2) {
          const X = ((r[i] - v.cx) * wd + W / 2) * dpr, Y = ((r[i + 1] - v.cy) * wd + H / 2) * dpr;
          i ? ctx.lineTo(X, Y) : ctx.moveTo(X, Y);
        }
      };
      ctx.save(); ctx.globalAlpha = alfa; ctx.lineJoin = 'round';
      if (pxm >= 0.25) {
        const x0 = v.cx - W / 2 / wd, x1 = v.cx + W / 2 / wd, y0 = v.cy - H / 2 / wd, y1 = v.cy + H / 2 / wd;
        ctx.beginPath();
        for (let k = 0; k < L.length; k++) {
          const b = L[k].bbox;
          if (b.x1 < x0 || b.x0 > x1 || b.y1 < y0 || b.y0 > y1) continue;
          traccia(k); ctx.closePath();
        }
        ctx.strokeStyle = stile('--accent'); ctx.globalAlpha = alfa * 0.55; ctx.lineWidth = 1 * dpr; ctx.setLineDash([3 * dpr, 2 * dpr]); ctx.stroke();
        ctx.setLineDash([]); ctx.globalAlpha = alfa;
      }
      for (const [k, spesso] of [[S.isoHover, false], [S.isoSel, true]]) {
        if (k == null || k < 0 || !L[k]) continue;
        ctx.beginPath(); traccia(k); ctx.closePath();
        ctx.fillStyle = 'rgba(245,166,35,.16)'; ctx.fill('evenodd');
        ctx.strokeStyle = 'rgba(0,0,0,.7)'; ctx.lineWidth = (spesso ? 6 : 5) * dpr; ctx.stroke();
        ctx.strokeStyle = stile('--accent'); ctx.lineWidth = (spesso ? 3 : 2) * dpr; ctx.stroke();
      }
      ctx.restore();
    }

    /* isolato sotto il cursore (x, y in px CSS), solo in vista Mappa */
    function isolatoIn(x, y) {
      if (!S.isolati || !root.Isolati || !root.Isolati.pronto() || S.t >= 0.5) return -1;
      const v = B.vista();
      return root.Isolati.hit((x - v.W / 2) / v.world + v.cx, (y - v.H / 2) / v.world + v.cy);
    }

    function proietta(m) { const v = B.vista(); return [(m[0] - v.cx) * v.world + v.W / 2, (m[1] - v.cy) * v.world + v.H / 2]; }

    function disegnaConfini(v, alfa) {
      const dpr = S.dpr, wd = v.world;
      ctx.save(); ctx.globalAlpha = alfa; ctx.lineJoin = 'round';
      const iso = S.isola && inFuoco();
      S.citta.zone.forEach((z, zi) => {
        if (iso && fuori(zi)) return;
        const sel = evid(zi), hov = S.zonaHover === zi;
        ctx.beginPath();
        for (const r of z.selM) for (let i = 0; i < r.length; i += 2) {
          const X = ((r[i] - v.cx) * wd + v.W / 2) * dpr, Y = ((r[i + 1] - v.cy) * wd + v.H / 2) * dpr;
          i ? ctx.lineTo(X, Y) : ctx.moveTo(X, Y);
        }
        ctx.closePath();
        if (sel || hov) { ctx.fillStyle = sel ? (S.conf && zi === S.conf.b ? 'rgba(56,189,248,.12)' : 'rgba(245,166,35,.10)') : 'rgba(255,255,255,.05)'; ctx.fill('evenodd'); }
        ctx.strokeStyle = sel ? colFuoco(zi) : stile('--zone-line'); ctx.lineWidth = (sel ? 2.4 : 1.2) * dpr;
        ctx.setLineDash(sel ? [] : [5 * dpr, 4 * dpr]); ctx.stroke();
      });
      ctx.setLineDash([]);
      // nomi delle zone al centro del riquadro, solo se la zona e' abbastanza grande sullo schermo
      ctx.fillStyle = stile('--text'); ctx.font = `600 ${12 * dpr}px system-ui, sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.lineWidth = 3 * dpr; ctx.strokeStyle = stile('--bg');
      S.citta.zone.forEach((z, zi) => {
        if (iso && fuori(zi)) return;
        const [x, y] = proietta(z.centroM), pw = z.larghM * wd;
        if (pw < 110 || x < -50 || y < -50 || x > v.W + 50 || y > v.H + 50) return;
        ctx.strokeText(z.name, x * dpr, y * dpr); ctx.fillText(z.name, x * dpr, y * dpr);
      });
      ctx.restore();
    }

    function disegnaBlocchi(vs, alfa) {
      const dpr = S.dpr, k = vs.k;
      ctx.save(); ctx.globalAlpha = alfa;
      ctx.textAlign = 'left'; ctx.textBaseline = 'bottom'; ctx.font = `600 ${12 * dpr}px system-ui, sans-serif`;
      S.layout.blocchi.forEach((b, zi) => {
        if (S.isola && inFuoco() && fuori(zi)) return;
        const x = (vs.tx + b.x * k) * dpr, y = (vs.ty + b.y * k) * dpr, w = b.w * k * dpr, h = b.h * k * dpr, sel = evid(zi);
        ctx.strokeStyle = sel ? colFuoco(zi) : stile('--zone-line'); ctx.lineWidth = (sel ? 2.4 : 1) * dpr;
        ctx.strokeRect(x, y, w, h);
        const z = S.citta.zone[zi], testo = S.isoFocus !== null ? S.isoTitolo : (b.testo || `${z.name} · ${NUM.format(z.n)}`);
        if (w > 40 * dpr && ctx.measureText(testo).width <= w * 1.6) {                    // etichetta solo se non invade i vicini
          ctx.fillStyle = sel ? colFuoco(zi) : stile('--text-dim');
          ctx.fillText(testo, x, y - 4 * dpr);
        }
      });
      ctx.restore();
    }

    /* contorno della particella nel blocco del lotto (sotto gli edifici) */
    function disegnaLotto(vs, alfa) {
      const dpr = S.dpr, k = vs.k;
      ctx.save(); ctx.globalAlpha = alfa; ctx.lineJoin = 'round';
      ctx.beginPath();
      for (const a of S.lottoAnelli) {
        for (let i = 0; i < a.length; i += 2) { const X = (vs.tx + a[i] * k) * dpr, Y = (vs.ty + a[i + 1] * k) * dpr; i ? ctx.lineTo(X, Y) : ctx.moveTo(X, Y); }
        ctx.closePath();
      }
      ctx.fillStyle = 'rgba(245,166,35,.10)'; ctx.fill('evenodd');
      ctx.strokeStyle = stile('--accent'); ctx.lineWidth = 2.2 * dpr; ctx.stroke();
      ctx.restore();
    }

    /* contorni dei lotti nella vista Ordinata dei lotti: tutti in un solo tracciato, solo quelli nel riquadro visibile e abbastanza grandi */
    function disegnaLottiOrd(vs, alfa, v) {
      const dpr = S.dpr, k = vs.k, x0 = -vs.tx / k, y0 = -vs.ty / k, x1 = (v.W - vs.tx) / k, y1 = (v.H - vs.ty) / k;
      const p = new Path2D();
      for (const c of S.layout.lotti) {
        if (!c.vis || !c.anelli.length || c.x > x1 || c.x + c.w < x0 || c.y > y1 || c.y + c.h < y0 || (c.w * k < 5 && c.h * k < 5)) continue;
        for (const a of c.anelli) {
          for (let i = 0; i < a.length; i += 2) { const X = (vs.tx + a[i] * k) * dpr, Y = (vs.ty + a[i + 1] * k) * dpr; i ? p.lineTo(X, Y) : p.moveTo(X, Y); }
          p.closePath();
        }
      }
      ctx.save(); ctx.globalAlpha = alfa; ctx.lineJoin = 'round';
      ctx.fillStyle = 'rgba(245,166,35,.08)'; ctx.fill(p, 'evenodd');
      ctx.strokeStyle = stile('--accent'); ctx.globalAlpha = alfa * 0.7; ctx.lineWidth = 1.2 * dpr; ctx.stroke(p);
      ctx.restore();
    }

    function disegnaEtichetteGruppo(vs, alfa) {
      const dpr = S.dpr, k = vs.k, nomi = S.index.classi[S.colore];
      if (Layout.LABEL_H * k < 11) return;                                                 // etichetta piu' alta dello spazio: si vede solo da vicino
      ctx.save(); ctx.globalAlpha = alfa; ctx.fillStyle = stile('--text-dim'); ctx.textBaseline = 'top';
      ctx.font = `${11 * dpr}px system-ui, sans-serif`;
      for (const b of S.layout.blocchi) {
        if (b.w * k < 60) continue;
        for (const l of b.etichette) ctx.fillText(nomi[l.cls].nome, (vs.tx + l.x * k) * dpr, (vs.ty + l.y * k) * dpr);
      }
      ctx.restore();
    }

    function scala(k) {
      const pxm = k * 10, bar = document.getElementById('scalaBar'), txt = document.getElementById('scalaTxt');
      if (!bar) return;
      const m = [10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000].find(x => x * pxm >= 60) || 10000;
      bar.style.width = (m * pxm) + 'px'; txt.textContent = m >= 1000 ? `${m / 1000} km` : `${m} m`;
    }

    /* edificio sotto il cursore (x, y in px CSS); solo a riposo (e = 0 o 1) */
    function hit(x, y) {
      if (!S.citta || S.anim) return -1;
      const e = S.t, dpr = S.dpr, v = B.vista(), vs = S.views.sorted, it = S.citta.items;
      let cand = [];
      if (e < 0.5) {
        const mx = (x - v.W / 2) / v.world + v.cx, my = (y - v.H / 2) / v.world + v.cy, c = grigliaMap.cella;
        const gx = Math.floor(mx / c), gy = Math.floor(my / c);
        for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) { const l = grigliaMap.get((gx + a) * 1000003 + gy + b); if (l) cand.push(...l); }
        cand.push(...grandiMap);
      } else {
        const sx = (x - vs.tx) / vs.k, sy = (y - vs.ty) / vs.k, c = grigliaOrd.cella;
        const gx = Math.floor(sx / c), gy = Math.floor(sy / c);
        for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) { const l = grigliaOrd.get((gx + a) * 1000003 + gy + b); if (l) cand.push(...l); }
        cand.push(...grandiOrd);
      }
      let best = -1, bd = 6;
      for (const i of cand) {
        if (!VIS[i]) continue;
        matrice(i, e, M);
        const b = it[i], cxs = M[0] * b.ocx + M[2] * b.ocy + M[4], cys = M[1] * b.ocx + M[3] * b.ocy + M[5];
        const raggio = 0.5 * Math.hypot(b.ow, b.oh) * Math.hypot(M[0], M[1]), d = Math.hypot(x - cxs, y - cys);
        if (d > raggio + 6) continue;
        ctx.setTransform(M[0] * dpr, M[1] * dpr, M[2] * dpr, M[3] * dpr, M[4] * dpr, M[5] * dpr);
        if (ctx.isPointInPath(Citta.path(b), x * dpr, y * dpr, 'evenodd')) { ctx.setTransform(1, 0, 0, 1, 0, 0); return i; }
        if (d < bd) { bd = d; best = i; }
      }
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      return best;
    }

    /* zona sotto il cursore: poligono (vista Mappa) o blocco (vista Ordinata) */
    function zonaIn(x, y) {
      if (!S.citta || S.isoFocus !== null) return -1;                                     // con un isolato in primo piano non ci sono zone da scegliere
      const v = B.vista(), vs = S.views.sorted;
      if (S.t < 0.5) {
        const mx = (x - v.W / 2) / v.world + v.cx, my = (y - v.H / 2) / v.world + v.cy;
        for (let zi = 0; zi < S.citta.zone.length; zi++) if (dentro(S.citta.zone[zi].selM, mx, my)) return zi;
        return -1;
      }
      const sx = (x - vs.tx) / vs.k, sy = (y - vs.ty) / vs.k;
      return S.layout.blocchi.findIndex(b => sx >= b.x && sx <= b.x + b.w && sy >= b.y && sy <= b.y + b.h);
    }
    function dentro(anelli, px, py) {                                                      // pari-dispari su tutti gli anelli
      let c = false;
      for (const r of anelli) for (let i = 0, j = r.length - 2; i < r.length; j = i, i += 2) {
        if (((r[i + 1] > py) !== (r[j + 1] > py)) && (px < (r[j] - r[i]) * (py - r[i + 1]) / (r[j + 1] - r[i + 1]) + r[i])) c = !c;
      }
      return c;
    }

    return { carica, ricolora, riquadro, disegna, matrice, hit, zonaIn, isolatoIn, adattaOrdinata, kMappa, octx, COLORI, KEY, LAT };
  }
  root.Render = { crea, COLORI, KEY };
})(typeof window !== 'undefined' ? window : globalThis);
