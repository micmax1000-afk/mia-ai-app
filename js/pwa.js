/* Mia AI — registra il service worker solo nella versione web (browser), non nell'app Android. */
(function () {
  'use strict';
  if (!('serviceWorker' in navigator)) return;
  const C = window.Capacitor;
  if (C && typeof C.isNativePlatform === 'function' && C.isNativePlatform()) return;
  if (!/^https?:$/.test(location.protocol)) return;
  window.addEventListener('load', function () {
    navigator.serviceWorker.register('sw.js').catch(function () {});
  });
})();
