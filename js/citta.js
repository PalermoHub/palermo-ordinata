/* Caricamento di tutte le zone di un livello in un'unica lista di edifici, in coordinate cittadine.
   Citta.carica(livello, index) -> Promise<{zone, items, perZona}>
   item = {z, cls:[uso,alt,sup,lotto], area, h, ang, lw,lh,lcx,lcy, ow,oh,ocx,ocy, cx,cy, X,Y, mx,my, rings, path:null}
   rings/path: coordinate RELATIVE AL CENTROIDE dell'edificio (y verso il basso); cx,cy: centroide locale alla zona (y verso il basso); X,Y: dm dall'angolo SW della citta' (y verso nord);
   mx,my: Mercator normalizzato. Il Path2D si costruisce alla prima richiesta (Citta.path). */
(function (root) {
  const D = 10;                                   // dm per metro

  function costruisci(b, z, zona) {
    const rings = b[10], ang = b[5], c = Math.cos(ang), sn = Math.sin(ang);
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;       // riquadro non ruotato
    let u0 = Infinity, v0 = Infinity, u1 = -Infinity, v1 = -Infinity;       // riquadro ruotato di +ang
    for (const r of rings) {
      for (let i = 0; i < r.length; i += 2) {
        const x = r[i], y = -r[i + 1];
        if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
        const u = x * c - y * sn, v = x * sn + y * c;
        if (u < u0) u0 = u; if (u > u1) u1 = u; if (v < v0) v0 = v; if (v > v1) v1 = v;
      }
    }
    return { z, cls: [b[0], b[1], b[2], 5], area: b[3], h: b[4] / D, ang,
             lw: u1 - u0, lh: v1 - v0, lcx: (u0 + u1) / 2, lcy: (v0 + v1) / 2,
             ow: x1 - x0, oh: y1 - y0, ocx: (x0 + x1) / 2, ocy: (y0 + y1) / 2,
             cx: b[8], cy: -b[9], X: zona.ox + b[8], Y: zona.oy + b[9], mx: 0, my: 0, rings, path: null };
  }

  async function carica(livello, index) {
    const zone = index.zone.filter(z => z.level === livello).map(z => ({ ...z }));
    const docs = await Promise.all(zone.map(z => fetch(`data/zone/${z.id}.json`).then(r => {
      if (!r.ok) throw new Error(`${z.id}: HTTP ${r.status}`);
      return r.json();
    })));
    const items = [], perZona = [];
    docs.forEach((d, z) => {
      zone[z].w = d.w; zone[z].h = d.h;                       // dimensioni della zona in dm (servono a Blocchi)
      const indici = [];
      for (const b of d.b) {
        const it = costruisci(b, z, zone[z]);
        const m = Geo.cittaToMerc(index, it.X, it.Y);
        it.mx = m[0]; it.my = m[1];
        indici.push(items.length); items.push(it);
      }
      perZona.push({ indici });
    });
    return { zone, items, perZona };
  }

  function path(it) {
    if (it.path) return it.path;
    const p = new Path2D();
    for (const r of it.rings) {
      for (let i = 0; i < r.length; i += 2) {
        if (i === 0) p.moveTo(r[i], -r[i + 1]); else p.lineTo(r[i], -r[i + 1]);
      }
      p.closePath();
    }
    return (it.path = p);
  }

  root.Citta = { carica, path };
})(typeof window !== 'undefined' ? window : globalThis);
