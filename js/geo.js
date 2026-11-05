/* Proiezioni: UTM 32N (EPSG:32632) -> lon/lat WGS84 -> Mercator normalizzato (0..1, y verso sud,
   come MapLibre). Formule inverse della trasversa di Mercatore (Snyder, serie al 4o ordine in e'^2).
   Nessuna dipendenza: usabile nel browser (globale Geo) e in node (require). */
(function (root) {
  const A = 6378137, F = 1 / 298.257223563, E2 = F * (2 - F), EP2 = E2 / (1 - E2);
  const K0 = 0.9996, FE = 500000, LON0 = 9 * Math.PI / 180;
  const RAD = Math.PI / 180;
  const M_EQUATORE = 40075016.686;

  function utmToLngLat(e, n) {
    const x = e - FE, M = n / K0;
    const mu = M / (A * (1 - E2 / 4 - 3 * E2 * E2 / 64 - 5 * E2 * E2 * E2 / 256));
    const e1 = (1 - Math.sqrt(1 - E2)) / (1 + Math.sqrt(1 - E2));
    const fi1 = mu
      + (3 * e1 / 2 - 27 * Math.pow(e1, 3) / 32) * Math.sin(2 * mu)
      + (21 * e1 * e1 / 16 - 55 * Math.pow(e1, 4) / 32) * Math.sin(4 * mu)
      + (151 * Math.pow(e1, 3) / 96) * Math.sin(6 * mu)
      + (1097 * Math.pow(e1, 4) / 512) * Math.sin(8 * mu);
    const s = Math.sin(fi1), c = Math.cos(fi1), t = Math.tan(fi1);
    const C1 = EP2 * c * c, T1 = t * t;
    const N1 = A / Math.sqrt(1 - E2 * s * s);
    const R1 = A * (1 - E2) / Math.pow(1 - E2 * s * s, 1.5);
    const D = x / (N1 * K0);
    const lat = fi1 - (N1 * t / R1) * (D * D / 2
      - (5 + 3 * T1 + 10 * C1 - 4 * C1 * C1 - 9 * EP2) * Math.pow(D, 4) / 24
      + (61 + 90 * T1 + 298 * C1 + 45 * T1 * T1 - 252 * EP2 - 3 * C1 * C1) * Math.pow(D, 6) / 720);
    const lon = LON0 + (D - (1 + 2 * T1 + C1) * Math.pow(D, 3) / 6
      + (5 - 2 * C1 + 28 * T1 - 3 * C1 * C1 + 8 * EP2 + 24 * T1 * T1) * Math.pow(D, 5) / 120) / c;
    return [lon / RAD, lat / RAD];
  }

  function lngLatToMerc(lon, lat) {
    const x = lon / 360 + 0.5;
    const s = Math.sin(lat * RAD);
    const y = 0.5 - 0.25 * Math.log((1 + s) / (1 - s)) / Math.PI;
    return [x, y];
  }

  /* X, Y in dm dall'angolo SW della citta' (stesso riferimento di index.origin e di zona.ox/oy) */
  function cittaToMerc(index, X, Y) {
    const [lon, lat] = utmToLngLat(index.origin[0] + X / 10, index.origin[1] + Y / 10);
    return lngLatToMerc(lon, lat);
  }

  /* angolo (rad, orario) fra il nord UTM e il nord vero al centro della citta' */
  function convergenza(index) {
    const cx = index.w / 2, cy = index.h / 2;
    const a = cittaToMerc(index, cx, cy), b = cittaToMerc(index, cx, cy + 10000);   // 1 km a nord
    return Math.atan2(b[0] - a[0], -(b[1] - a[1]));
  }

  function metriPerUnitaMerc(lat) { return M_EQUATORE * Math.cos(lat * RAD); }

  const Geo = { utmToLngLat, lngLatToMerc, cittaToMerc, convergenza, metriPerUnitaMerc };
  if (typeof module !== 'undefined' && module.exports) module.exports = Geo;
  else root.Geo = Geo;
})(typeof window !== 'undefined' ? window : globalThis);
