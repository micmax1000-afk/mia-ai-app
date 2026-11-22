/* Mia AI - gestione classe sheet-open sul body quando si aprono/chiudono i pannelli */
(function () {
  'use strict';

  function updateSheetOpen() {
    const openSheet = document.querySelector('.sheet:not([hidden])');
    document.body.classList.toggle('sheet-open', !!openSheet);
  }

  const observer = new MutationObserver(function (mutations) {
    for (const m of mutations) {
      if (m.type === 'attributes' && m.attributeName === 'hidden') {
        updateSheetOpen();
        break;
      }
    }
  });

  observer.observe(document.body, { subtree: true, attributes: true });

  // Inizializza all'avvio
  updateSheetOpen();
})();
