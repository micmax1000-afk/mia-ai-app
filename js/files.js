/* Mia AI — file creati dagli strumenti: archivio (IndexedDB) e condivisione/salvataggio */
(function (global) {
  'use strict';

  const DB_NAME = 'miaai_files';
  const STORE = 'files';
  let dbPromise = null;

  function db() {
    if (!dbPromise) {
      dbPromise = new Promise((resolve, reject) => {
        let req;
        try {
          req = indexedDB.open(DB_NAME, 1);
        } catch (e) {
          return reject(e);
        }
        req.onupgradeneeded = () => req.result.createObjectStore(STORE);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error || new Error('Archivio file non disponibile'));
      });
    }
    return dbPromise;
  }

  async function tx(mode, fn) {
    const d = await db();
    return new Promise((resolve, reject) => {
      const t = d.transaction(STORE, mode);
      const req = fn(t.objectStore(STORE));
      t.oncomplete = () => resolve(req && req.result);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error || new Error('Operazione annullata'));
    });
  }

  const put = (id, blob) => tx('readwrite', (s) => s.put(blob, id));
  const get = (id) => tx('readonly', (s) => s.get(id));
  const del = (id) => tx('readwrite', (s) => s.delete(id));

  function blobToBase64(blob) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result).split(',')[1] || '');
      r.onerror = () => reject(r.error || new Error('Lettura file non riuscita'));
      r.readAsDataURL(blob);
    });
  }

  function native() {
    const C = window.Capacitor;
    return !!(C && C.isNativePlatform && C.isNativePlatform() && C.Plugins && C.Plugins.Filesystem && C.Plugins.Share);
  }

  function downloadBlob(blob, name) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }

  /**
   * Condivide/salva un file. Su Android apre il pannello «Condividi» (da lì: Salva su Drive, File, WhatsApp…).
   * Nel browser usa la condivisione di sistema se c'è, altrimenti scarica il file.
   * Restituisce 'shared' | 'downloaded'.
   */
  async function share(meta) {
    const blob = await get(meta.id);
    if (!blob) throw new Error('File non più disponibile su questo dispositivo.');
    if (native()) {
      const { Filesystem, Share } = window.Capacitor.Plugins;
      const safe = String(meta.name).replace(/[\\/:*?"<>|]+/g, '_');
      const w = await Filesystem.writeFile({ path: safe, data: await blobToBase64(blob), directory: 'CACHE' });
      try {
        await Share.share({ title: meta.name, files: [w.uri], dialogTitle: 'Salva o condividi ' + meta.name });
      } catch (e) {
        if (!/cancel/i.test(String((e && e.message) || e))) throw e; // chiusura del pannello = nessun errore
      }
      return 'shared';
    }
    try {
      const file = new File([blob], meta.name, { type: meta.mime || blob.type });
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: meta.name });
        return 'shared';
      }
    } catch (e) {
      if (e && e.name === 'AbortError') return 'shared';
    }
    downloadBlob(blob, meta.name);
    return 'downloaded';
  }

  global.MiaFiles = { put, get, del, share };
})(window);
