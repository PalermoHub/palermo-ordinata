/* Livello vettoriale dei lotti catastali sulla Mappa (MapLibre + PMTiles: data/lotti.pmtiles, generato da scripts/09_lotti.py).
   LottiMappa.crea(map) -> {accendi(on), acceso(), kSotto(point), evidenzia(k|null), seleziona(k|null), legenda(el)}.
   kSotto(point) -> {k, props}|null: la particella sotto il punto (px CSS) con le proprieta' dei tile (k, foglio, Paricella, m2, cop, n, lib, cav).
   I layer stanno sotto le etichette della base e sotto il canvas degli edifici; si reinstallano da soli al cambio di stile (tema). */
(function (root) {
  const SORGENTE = 'lotti', FILL = 'lotti-fill', LINEA = 'lotti-line', HOVER = 'lotti-hover', SEL = 'lotti-sel';
  const MIN_ZOOM = 12;
  let protocolloOk = false;

  function registraProtocollo() {
    if (protocolloOk) return;
    if (!root.pmtiles) throw new Error('libreria pmtiles non caricata');
    root.maplibregl.addProtocol('pmtiles', new root.pmtiles.Protocol().tile);
    protocolloOk = true;
  }

  /* indice di classe (0..4) del lotto: stesse soglie di Lotti.classe */
  function indiceClasse() {
    const C = root.Lotti.CLASSI;
    return ['case', ['==', ['get', 'nt'], 0], 0, ['<=', ['get', 'cop'], C[1].max], 1, ['<=', ['get', 'cop'], C[2].max], 2, ['<=', ['get', 'cop'], C[3].max], 3, 4];
  }
  function coloreClasse() {
    return ['match', indiceClasse(), ...root.Lotti.CLASSI.flatMap((c, i) => [i, c.colore]), '#94a3b8'];
  }

  function crea(map, suErrore) {                                         // suErrore(err): chiamata una volta se i tile dei lotti non arrivano
    let on = false, hover = -1, sel = -1, erroreDato = false, accese = null;        // accese: classi dei lotti da mostrare (null = tutte)
    const nessuno = ['==', ['get', 'k'], -1];

    const filtroClassi = () => accese ? ['match', indiceClasse(), accese.length ? accese : [-1], true, false] : null;

    function installa() {
      if (map.getSource(SORGENTE)) return;
      registraProtocollo();
      const url = 'pmtiles://' + new URL('data/lotti.pmtiles', root.location.href).href;
      map.addSource(SORGENTE, { type: 'vector', url, minzoom: MIN_ZOOM, maxzoom: 17, attribution: 'Catasto: Agenzia delle Entrate, settembre 2026' });
      const primoSimbolo = (map.getStyle().layers.find(l => l.type === 'symbol') || {}).id;
      const l = (def) => map.addLayer({ source: SORGENTE, 'source-layer': 'particelle', minzoom: MIN_ZOOM, ...def }, primoSimbolo);
      const filtro = filtroClassi();
      l({ id: FILL, ...(filtro ? { filter: filtro } : {}), type: 'fill', paint: { 'fill-color': coloreClasse(), 'fill-opacity': ['case', ['==', ['get', 'nt'], 0], 0.2, 0.5] } });
      l({ id: LINEA, ...(filtro ? { filter: filtro } : {}), type: 'line', paint: { 'line-color': 'rgba(226,232,240,.45)', 'line-width': ['interpolate', ['linear'], ['zoom'], 12, 0.15, 17, 0.9] } });
      l({ id: HOVER, type: 'line', filter: hover >= 0 ? ['==', ['get', 'k'], hover] : nessuno, layout: { 'line-join': 'round' }, paint: { 'line-color': '#fff', 'line-width': 2.5 } });
      l({ id: SEL, type: 'line', filter: sel >= 0 ? ['==', ['get', 'k'], sel] : nessuno, layout: { 'line-join': 'round' }, paint: { 'line-color': '#f5a623', 'line-width': 3.5 } });
    }
    function rimuovi() {
      for (const id of [SEL, HOVER, LINEA, FILL]) if (map.getLayer(id)) map.removeLayer(id);
      if (map.getSource(SORGENTE)) map.removeSource(SORGENTE);
    }
    /* setStyle (cambio tema) cancella sorgenti e layer; con la diff attiva MapLibre non emette 'style.load', solo 'styledata':
       si ascoltano entrambi e installa() e' idempotente */
    const ripristina = () => { if (on && map.isStyleLoaded() && !map.getSource(SORGENTE)) { try { installa(); } catch (e) { console.error(e); } } };
    map.on('error', e => { if (on && !erroreDato && e && e.sourceId === SORGENTE) { erroreDato = true; if (suErrore) suErrore(e.error || e); } });
    map.on('style.load', ripristina); map.on('styledata', ripristina); map.on('idle', ripristina);   // 'idle': dopo la diff lo stile puo' non essere ancora pronto a styledata

    function filtro(id, k) { if (map.getLayer(id)) map.setFilter(id, k >= 0 ? ['==', ['get', 'k'], k] : nessuno); }
    return {
      accendi(v) {
        if (v) { on = true; erroreDato = false; if (map.isStyleLoaded()) installa(); }   // stile non pronto: ci pensa ripristina() su styledata/idle
        else { on = false; rimuovi(); }
      },
      acceso: () => on,
      /* mostra solo le classi indicate (indici 0..4 di Lotti.CLASSI), null = tutte; vale per riempimento e contorni, non per hover/selezione */
      filtra(lista) {
        accese = lista;
        for (const id of [FILL, LINEA]) if (map.getLayer(id)) map.setFilter(id, filtroClassi());
      },
      kSotto(point) {
        if (!on || !map.getLayer(FILL)) return null;
        const f = map.queryRenderedFeatures(Array.isArray(point) ? point : [point.x, point.y], { layers: [FILL] })[0];   // un {x,y} semplice verrebbe letto come opzioni
        return f ? { k: f.properties.k, props: f.properties } : null;
      },
      evidenzia(k) { hover = k == null ? -1 : k; filtro(HOVER, hover); },
      seleziona(k) { sel = k == null ? -1 : k; filtro(SEL, sel); },
      /* legenda dei lotti; con `filtro` ({spente:Set, clic(i, evento)}) le righe sono pulsanti: clic = solo questa classe, Maiusc+clic = accendi/spegni */
      legenda(el, filtro) {
        el.textContent = '';
        const t = document.createElement('div'); t.className = 'lotti-leg-titolo'; t.textContent = 'Lotti: rapporto di copertura'; el.append(t);
        const C = root.Lotti.CLASSI;
        C.forEach((c, i) => {
          const spenta = !!(filtro && filtro.spente.has(i));
          const r = document.createElement(filtro ? 'button' : 'div'); r.className = 'lotti-leg-riga' + (spenta ? ' off' : '');
          if (filtro) {
            const sola = !spenta && filtro.spente.size === root.Lotti.CLASSI_EDIFICI.length - 1;   // stessa regola della legenda principale: tutte le altre spente
            r.type = 'button'; r.setAttribute('aria-pressed', String(!spenta));
            r.title = sola ? 'Mostra tutte le classi (Maiusc+clic: nascondi solo questa)' : 'Mostra solo questa classe di lotti (Maiusc+clic: accendi/spegni senza isolare)';
            r.addEventListener('click', e => filtro.clic(i, e));
          }
          const s = document.createElement('i'); s.style.background = c.colore;
          r.append(s, document.createTextNode(c.nome)); el.append(r);
        });
      },
    };
  }

  root.LottiMappa = { crea };
})(typeof window !== 'undefined' ? window : globalThis);
