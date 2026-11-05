/* Galleria a schermo intero per le immagini del tab Guida: clic per aprire, frecce per scorrere, Esc per chiudere. */
(function () {
  const G = document.getElementById('galleria'); if (!G) return;
  const img = G.querySelector('img'), cap = G.querySelector('figcaption'), num = G.querySelector('.g-n');
  const voci = [...document.querySelectorAll('.gal')];
  let i = 0, da = null;
  function mostra(n) {
    i = (n + voci.length) % voci.length;
    const b = voci[i]; img.src = b.dataset.gal; img.alt = b.querySelector('img').alt; cap.textContent = b.dataset.cap || '';
    num.textContent = (i + 1) + ' / ' + voci.length;
  }
  function apri(n, origine) { da = origine; mostra(n); G.hidden = false; G.querySelector('.g-x').focus(); }
  function chiudi() { G.hidden = true; if (da) da.focus(); }
  voci.forEach((b, n) => b.addEventListener('click', () => apri(n, b)));
  G.querySelector('.g-x').addEventListener('click', chiudi);
  G.querySelector('.g-prec').addEventListener('click', () => mostra(i - 1));
  G.querySelector('.g-succ').addEventListener('click', () => mostra(i + 1));
  G.addEventListener('click', e => { if (e.target === G) chiudi(); });
  let x0 = null;                                                                // scorrimento col dito
  G.addEventListener('touchstart', e => { x0 = e.touches[0].clientX; }, { passive: true });
  G.addEventListener('touchend', e => { if (x0 === null) return; const d = e.changedTouches[0].clientX - x0; x0 = null; if (Math.abs(d) > 50) mostra(i + (d < 0 ? 1 : -1)); });
  /* in fase di cattura: con la galleria aperta le frecce non devono arrivare alla ricerca/mappa */
  document.addEventListener('keydown', e => {
    if (G.hidden) return;
    if (e.key === 'Escape') chiudi();
    else if (e.key === 'ArrowLeft') mostra(i - 1);
    else if (e.key === 'ArrowRight') mostra(i + 1);
    else if (e.key !== 'Tab') return;
    if (e.key !== 'Tab') { e.preventDefault(); e.stopImmediatePropagation(); }
  }, true);
})();
