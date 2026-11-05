/* Mappa di base MapLibre (OpenFreeMap) sotto il canvas degli edifici.
   Base.crea(contenitore, tema) -> {map, vista(), setTema(t), setSatellite(on), vaiA(bbox, animato), suMovimento(cb), offline}
   vista() -> {cx, cy, world, W, H}: schermo x = (mx - cx) * world + W/2, y = (my - cy) * world + H/2. */
(function (root) {
  const STILI = { dark: 'https://tiles.openfreemap.org/styles/dark', light: 'https://tiles.openfreemap.org/styles/positron' };
  const SAT = ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'];

  function crea(contenitore, tema) {
    const base = { offline: false, satellite: false, tema };
    const map = new maplibregl.Map({
      container: contenitore, style: STILI[tema], center: [13.3476, 38.1394], zoom: 11.3, maxZoom: 17,
      dragRotate: false, pitchWithRotate: false, maxPitch: 0, fadeDuration: 0,
      attributionControl: { compact: true, customAttribution: '© OpenStreetMap contributors' },
    });
    map.touchZoomRotate.disableRotation();
    map.keyboard.disableRotation();                                  // il canvas degli edifici non gestisce il bearing
    base.map = map;

    function applicaSatellite() {
      if (map.getLayer('sat')) map.removeLayer('sat');
      if (map.getSource('sat')) map.removeSource('sat');
      if (!base.satellite) return;
      map.addSource('sat', { type: 'raster', tiles: SAT, tileSize: 256, maxzoom: 19, attribution: 'Esri World Imagery' });
      const primoSimbolo = (map.getStyle().layers.find(l => l.type === 'symbol') || {}).id;
      map.addLayer({ id: 'sat', type: 'raster', source: 'sat' }, primoSimbolo);
    }
    map.on('style.load', applicaSatellite);
    let stileCaricato = false;
    map.on('style.load', () => { stileCaricato = true; });
    setTimeout(() => {                                                // base non arrivata entro 8 s: restano i dati su fondo tinta unita
      if (stileCaricato || base.offline) return;
      base.offline = true; contenitore.classList.add('base-offline'); contenitore.dispatchEvent(new CustomEvent('base-offline'));
    }, 8000);
    map.on('error', e => {                                        // base non raggiungibile: restano i dati su fondo tinta unita
      const u = (e && e.error && (e.error.url || e.error.message)) || '';
      if (!map.isStyleLoaded() && /openfreemap|style|Failed to fetch|NetworkError/i.test(String(u))) {
        base.offline = true; contenitore.classList.add('base-offline');
        contenitore.dispatchEvent(new CustomEvent('base-offline'));
      }
    });

    base.vista = () => {
      const c = maplibregl.MercatorCoordinate.fromLngLat(map.getCenter());
      const cv = map.getCanvas();
      return { cx: c.x, cy: c.y, world: 512 * Math.pow(2, map.getZoom()), W: cv.clientWidth, H: cv.clientHeight };
    };
    base.setTema = t => { base.tema = t; map.setStyle(STILI[t]); };
    base.setSatellite = on => { base.satellite = !!on; if (map.isStyleLoaded()) applicaSatellite(); };
    base.vaiA = (bb, animato, inset, maxZoom) => {
      const a = new maplibregl.MercatorCoordinate(bb.x0, bb.y1, 0).toLngLat();     // SW (y Mercator verso sud)
      const b = new maplibregl.MercatorCoordinate(bb.x1, bb.y0, 0).toLngLat();     // NE
      map.fitBounds([[a.lng, a.lat], [b.lng, b.lat]], { padding: { top: 40, bottom: 40 + (base.insetB || 0), left: 40, right: 40 + (inset || 0) }, animate: !!animato, duration: 700, ...(maxZoom ? { maxZoom } : {}) });
    };
    /* limiti di navigazione: Terrasini a sx, Cefalu' a dx. Lo zoom minimo fa entrare esattamente quella fascia di
       longitudine nella larghezza dello schermo (qualsiasi risoluzione); l'altezza segue le proporzioni del device. */
    const LON_W = 13.07, LON_E = 14.03, LAT_C = 38.1394;
    base.limiti = () => {
      const cv = map.getCanvas(), W = cv.clientWidth, H = cv.clientHeight; if (!W || !H) return;
      const mw = maplibregl.MercatorCoordinate.fromLngLat([LON_W, LAT_C]), me = maplibregl.MercatorCoordinate.fromLngLat([LON_E, LAT_C]);
      const larg = me.x - mw.x, alt = Math.max(larg * H / W, larg * 0.6), cy = mw.y;
      const sud = new maplibregl.MercatorCoordinate(mw.x, cy + alt / 2, 0).toLngLat(), nord = new maplibregl.MercatorCoordinate(mw.x, cy - alt / 2, 0).toLngLat();
      map.setMinZoom(Math.max(0, Math.log2(W / (512 * larg))));
      map.setMaxBounds([[LON_W, sud.lat], [LON_E, nord.lat]]);
    };
    base.suMovimento = cb => map.on('render', cb);
    return base;
  }
  root.Base = { crea };
})(typeof window !== 'undefined' ? window : globalThis);
