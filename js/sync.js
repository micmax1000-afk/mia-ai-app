/**
 * Sincronizzazione delle chat tra dispositivi tramite un repository GitHub PRIVATO dell'utente.
 * Un solo file (mia-chats.json) nel ramo predefinito. Le chiavi API e il token non vengono mai inviati.
 * Gli allegati binari (immagini, PDF) non si trasferiscono: restano sul dispositivo d'origine (si trasferisce il testo estratto).
 * Unione: per ogni chat vince la più recente; le chat eliminate restano come «lapidi» per 90 giorni, così non ricompaiono.
 */
(function () {
  'use strict';

  const FILE = 'mia-chats.json';
  const TOMBSTONE_DAYS = 90;
  const API = 'https://api.github.com';

  /** Copia della chat adatta al repository: senza dati binari degli allegati. */
  function stripConversation(c) {
    const copy = JSON.parse(JSON.stringify(c));
    (copy.messages || []).forEach((m) => {
      (m.attachments || []).forEach((a) => {
        if (a.data || a.thumb) {
          delete a.data;
          delete a.thumb;
          a.dropped = true;
        }
      });
    });
    return copy;
  }

  /**
   * Unisce stato locale e remoto. local/remote: { conversations, deleted:{id:ts}, memory:{text,updated} }.
   * Restituisce { conversations, deleted, memory, fromRemote:Set<id>, needPush }.
   */
  function merge(local, remote, now) {
    now = now || Date.now();
    const rc = (remote && remote.conversations) || [];
    const lc = (local && local.conversations) || [];
    const deleted = {};
    [(remote && remote.deleted) || {}, (local && local.deleted) || {}].forEach((d) => {
      Object.keys(d).forEach((id) => {
        const t = Number(d[id]) || 0;
        if (t > (deleted[id] || 0)) deleted[id] = t;
      });
    });
    const win = new Map();
    const fromRemote = new Set();
    lc.forEach((c) => win.set(c.id, c));
    rc.forEach((c) => {
      const ex = win.get(c.id);
      if (!ex || (c.updated || 0) > (ex.updated || 0)) {
        win.set(c.id, c);
        fromRemote.add(c.id);
      }
    });
    Object.keys(deleted).forEach((id) => {
      const c = win.get(id);
      if (c && (c.updated || 0) > deleted[id]) delete deleted[id]; // modificata dopo l'eliminazione: resta
      else {
        win.delete(id);
        fromRemote.delete(id);
      }
    });
    const limit = now - TOMBSTONE_DAYS * 86400000;
    Object.keys(deleted).forEach((id) => {
      if (deleted[id] < limit) delete deleted[id];
    });
    const lm = (local && local.memory) || { text: '', updated: 0 };
    const rm = (remote && remote.memory) || { text: '', updated: 0 };
    const memory = (rm.updated || 0) > (lm.updated || 0) ? { text: rm.text || '', updated: rm.updated } : { text: lm.text || '', updated: lm.updated || 0 };
    const memoryFromRemote = memory.updated === (rm.updated || 0) && memory.text === (rm.text || '') && (rm.updated || 0) > (lm.updated || 0);

    const conversations = [...win.values()];
    // serve un push se il remoto non contiene già tutto ciò che c'è nel risultato
    const remoteMap = new Map(rc.map((c) => [c.id, c.updated || 0]));
    const remoteDel = (remote && remote.deleted) || {};
    let needPush = conversations.some((c) => remoteMap.get(c.id) !== (c.updated || 0));
    if (!needPush) needPush = rc.some((c) => !win.has(c.id));
    if (!needPush) needPush = Object.keys(deleted).some((id) => remoteDel[id] !== deleted[id]) || Object.keys(remoteDel).some((id) => !(id in deleted));
    if (!needPush) needPush = !memoryFromRemote && (memory.text !== (rm.text || ''));
    return { conversations, deleted, memory, fromRemote, memoryFromRemote, needPush };
  }

  function b64encode(text) {
    const bytes = new TextEncoder().encode(text);
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(bin);
  }
  function b64decode(b64) {
    const bin = atob(String(b64).replace(/\s+/g, ''));
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  }

  async function gh(opts, path, init) {
    const res = await fetch(API + path, {
      method: (init && init.method) || 'GET',
      headers: Object.assign(
        {
          Authorization: 'Bearer ' + opts.token,
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28'
        },
        init && init.headers
      ),
      body: init && init.body,
      signal: opts.signal
    });
    return res;
  }

  function explain(res, what) {
    if (res.status === 401) return 'Token GitHub non valido o scaduto.';
    if (res.status === 403 || res.status === 404)
      return (
        what +
        ': GitHub risponde ' +
        res.status +
        '. Controlla che il nome del repository sia giusto e che il token abbia accesso a QUESTO repository con «Contents» in lettura e scrittura (fine-grained: Repository access → seleziona il repository).'
      );
    if (res.status === 429) return 'Troppe richieste a GitHub: riprova tra poco.';
    return what + ': errore GitHub ' + res.status + '.';
  }

  /**
   * Sincronizza. opts: { token, repo:'owner/nome', signal, local:{conversations,deleted,memory}, clean:(conv)=>conv|null }
   * Restituisce il risultato di merge() più { pushed, pulled }.
   */
  async function sync(opts) {
    const repo = String(opts.repo || '').trim();
    if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) throw new Error('Scrivi il repository nel formato «nome-utente/nome-repository».');
    if (!opts.token) throw new Error('Manca il token GitHub (Impostazioni → Modalità agente).');

    // 1) il repository deve esistere, essere PRIVATO e scrivibile
    const info = await gh(opts, '/repos/' + repo);
    if (!info.ok) throw new Error(explain(info, 'Repository «' + repo + '»'));
    const meta = await info.json();
    if (!meta.private) throw new Error('Il repository «' + repo + '» è pubblico: le chat non vengono inviate. Usa un repository PRIVATO.');
    if (meta.permissions && meta.permissions.push === false) throw new Error('Il token non può scrivere nel repository «' + repo + '» (serve «Contents» in scrittura).');

    for (let attempt = 0; attempt < 4; attempt++) {
      // 2) leggi il file remoto (se esiste)
      let sha = null;
      let remote = null;
      const get = await gh(opts, '/repos/' + repo + '/contents/' + FILE);
      if (get.status === 404) remote = null;
      else if (!get.ok) throw new Error(explain(get, 'Lettura di ' + FILE));
      else {
        const j = await get.json();
        sha = j.sha;
        let text;
        if (j.content && j.encoding === 'base64') text = b64decode(j.content);
        else {
          const raw = await gh(opts, '/repos/' + repo + '/contents/' + FILE, { headers: { Accept: 'application/vnd.github.raw+json' } });
          if (!raw.ok) throw new Error(explain(raw, 'Lettura di ' + FILE));
          text = await raw.text();
        }
        try {
          remote = JSON.parse(text);
        } catch (_) {
          throw new Error('Il file ' + FILE + ' nel repository non è valido: non lo sovrascrivo.');
        }
        if (!remote || remote.app !== 'mia-ai') throw new Error('Il file ' + FILE + ' nel repository non è di Mia: non lo sovrascrivo.');
      }
      const remoteState = {
        conversations: ((remote && remote.conversations) || []).map(opts.clean).filter(Boolean),
        deleted: (remote && remote.deleted) || {},
        memory: (remote && remote.memory) || { text: '', updated: 0 }
      };
      const m = merge(opts.local, remoteState);
      if (!m.needPush && remote) return Object.assign(m, { pushed: false, pulled: m.fromRemote.size });

      // 3) scrivi (con lo sha letto: se nel frattempo un altro dispositivo ha scritto, GitHub risponde 409/422 e si riprova)
      const payload = {
        app: 'mia-ai',
        version: 1,
        updated: new Date().toISOString(),
        conversations: m.conversations.map(stripConversation),
        deleted: m.deleted,
        memory: m.memory
      };
      const body = { message: 'Sincronizzazione Mia', content: b64encode(JSON.stringify(payload)) };
      if (sha) body.sha = sha;
      const put = await gh(opts, '/repos/' + repo + '/contents/' + FILE, { method: 'PUT', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } });
      if (put.ok) return Object.assign(m, { pushed: true, pulled: m.fromRemote.size });
      if (put.status === 409 || put.status === 422) continue;
      throw new Error(explain(put, 'Scrittura di ' + FILE));
    }
    throw new Error('Un altro dispositivo sta scrivendo: riprova tra qualche secondo.');
  }

  window.MiaSync = { sync, merge, stripConversation, FILE };
})();
