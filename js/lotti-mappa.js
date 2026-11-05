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

  function coloreClasse() {
    const C = root.Lotti.CLASSI;
    return ['case', ['==', ['get', 'n'], 0], C[0].colore, ['<=', ['get', 'cop'], C[1].max], C[1].colore,
      ['<=', ['get', 'cop'], C[2].max], C[2].colore, ['<=', ['get', 'cop'], C[3].max], C[3].colore, C[4].colore];
  }

  function crea(map) {
    let on = false, hover = -1, sel = -1;
    const nessuno = ['==', ['get', 'k'], -1];

    function installa() {
      if (map.getSource(SORGENTE)) return;
      registraProtocollo();
      const url = 'pmtiles://' + new URL('data/lotti.pmtiles', root.location.href).href;
      map.addSource(SORGENTE, { type: 'vector', url, minzoom: MIN_ZOOM, maxzoom: 17, attribution: 'Catasto: Agenzia delle Entrate, settembre 2026' });
      const primoSimbolo = (map.getStyle().layers.find(l => l.type === 'symbol') || {}).id;
      const l = (def) => map.addLayer({ source: SORGENTE, 'source-layer': 'particelle', minzoom: MIN_ZOOM, ...def }, primoSimbolo);
      l({ id: FILL, type: 'fill', paint: { 'fill-color': coloreClasse(), 'fill-opacity': ['case', ['==', ['get', 'n'], 0], 0.2, 0.5] } });
      l({ id: LINEA, type: 'line', paint: { 'line-color': 'rgba(226,232,240,.45)', 'line-width': ['interpolate', ['linear'], ['zoom'], 12, 0.15, 17, 0.9] } });
      l({ id: HOVER, type: 'line', filter: hover >= 0 ? ['==', ['get', 'k'], hover] : nessuno, layout: { 'line-join': 'round' }, paint: { 'line-color': '#fff', 'line-width': 2.5 } });
      l({ id: SEL, type: 'line', filter: sel >= 0 ? ['==', ['get', 'k'], sel] : nessuno, layout: { 'line-join': 'round' }, paint: { 'line-color': '#f5a623', 'line-width': 3.5 } });
    }
    function rimuovi() {
      for (const id of [SEL, HOVER, LINEA, FILL]) if (map.getLayer(id)) map.removeLayer(id);
      if (map.getSource(SORGENTE)) map.removeSource(SORGENTE);
    }
    map.on('style.load', () => { if (on) installa(); });                 // setStyle (cambio tema) cancella sorgenti e layer

    function filtro(id, k) { if (map.getLayer(id)) map.setFilter(id, k >= 0 ? ['==', ['get', 'k'], k] : nessuno); }
    return {
      accendi(v) {
        if (v) { installa(); on = true; } else { on = false; rimuovi(); }
      },
      acceso: () => on,
      kSotto(point) {
        if (!on || !map.getLayer(FILL)) return null;
        const f = map.queryRenderedFeatures(point, { layers: [FILL] })[0];
        return f ? { k: f.properties.k, props: f.properties } : null;
      },
      evidenzia(k) { hover = k == null ? -1 : k; filtro(HOVER, hover); },
      seleziona(k) { sel = k == null ? -1 : k; filtro(SEL, sel); },
      legenda(el) {
        el.textContent = '';
        const t = document.createElement('div'); t.className = 'lotti-leg-titolo'; t.textContent = 'Lotti: rapporto di copertura'; el.append(t);
        for (const c of root.Lotti.CLASSI) {
          const r = document.createElement('div'); r.className = 'lotti-leg-riga';
          const s = document.createElement('i'); s.style.background = c.colore;
          r.append(s, document.createTextNode(c.nome)); el.append(r);
        }
      },
    };
  }

  root.LottiMappa = { crea };
})(typeof window !== 'undefined' ? window : globalThis);
