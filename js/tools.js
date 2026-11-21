/* Mia AI — strumenti per la modalità agente (GitHub, web, note) */
(function (global) {
  'use strict';

  const MAX_RESULT = 12000; // caratteri massimi restituiti al modello per ogni strumento
  const LS_NOTES = 'miaai_v1_notes';
  const NAME_RE = /^[A-Za-z0-9_.-]+$/;

  // ─── Utilità ──────────────────────────────────────────────
  function clip(s, n) {
    s = String(s == null ? '' : s);
    const max = n || MAX_RESULT;
    return s.length > max ? s.slice(0, max) + '\n[…troncato: ' + (s.length - max) + ' caratteri in più…]' : s;
  }

  function str(v) {
    return v == null ? '' : String(v);
  }

  function need(args, key) {
    const v = str(args[key]).trim();
    if (!v) throw new Error('Parametro mancante: «' + key + '».');
    return v;
  }

  function repoArgs(args) {
    const owner = need(args, 'owner');
    const repo = need(args, 'repo');
    if (!NAME_RE.test(owner) || !NAME_RE.test(repo)) throw new Error('Nome di proprietario o repository non valido.');
    return { owner, repo, base: '/repos/' + owner + '/' + repo };
  }

  function encPath(p) {
    return str(p)
      .replace(/^\/+|\/+$/g, '')
      .split('/')
      .filter(Boolean)
      .map(encodeURIComponent)
      .join('/');
  }

  function utf8ToBase64(s) {
    const bytes = new TextEncoder().encode(s);
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(bin);
  }

  function base64ToUtf8(b64) {
    const bin = atob(String(b64).replace(/\s/g, ''));
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder('utf-8').decode(bytes);
  }

  function abortError() {
    const e = new Error('Interrotto');
    e.name = 'AbortError';
    return e;
  }

  // ─── GitHub ───────────────────────────────────────────────
  let cachedUser = null; // { token, login }

  async function gh(ctx, path, opts) {
    if (!ctx.token) throw new Error('Manca il token GitHub: inseriscilo in Impostazioni → Modalità agente.');
    opts = opts || {};
    const res = await fetch('https://api.github.com' + path, {
      method: opts.method || 'GET',
      headers: Object.assign(
        {
          Authorization: 'Bearer ' + ctx.token,
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28'
        },
        opts.body ? { 'Content-Type': 'application/json' } : {}
      ),
      body: opts.body ? JSON.stringify(opts.body) : undefined,
      signal: ctx.signal
    });
    if (res.status === 204) return null;
    let data = null;
    try {
      data = await res.json();
    } catch (_) {}
    if (!res.ok) {
      if (opts.allow404 && res.status === 404) return null;
      let msg = (data && data.message) || 'Errore GitHub';
      if (data && Array.isArray(data.errors) && data.errors.length)
        msg += ' — ' + data.errors.map((e) => (typeof e === 'string' ? e : e.message || e.code)).join('; ');
      if (res.status === 401) msg = 'Token GitHub non valido o scaduto (' + msg + ')';
      else if (res.status === 403 && /rate limit/i.test(msg)) msg = 'Limite di richieste GitHub raggiunto: riprova più tardi.';
      else if (res.status === 403 || res.status === 404)
        msg += ' (se il repository esiste, il token potrebbe non avere accesso o i permessi necessari)';
      throw new Error(msg + ' [HTTP ' + res.status + ']');
    }
    return data;
  }

  /** Login dell'utente GitHub (serve a dire al modello «chi sei») o null se il token non funziona. */
  async function whoami(token, signal) {
    if (!token) return null;
    if (cachedUser && cachedUser.token === token) return cachedUser.login;
    try {
      const u = await gh({ token, signal }, '/user');
      cachedUser = { token, login: u.login };
      return u.login;
    } catch (_) {
      return null;
    }
  }

  const short = (sha) => str(sha).slice(0, 7);
  const oneLine = (s, n) => str(s).replace(/\s+/g, ' ').trim().slice(0, n || 120);

  // ─── Definizione degli strumenti ──────────────────────────
  const TOOLS = {};

  function def(name, spec) {
    TOOLS[name] = Object.assign({ name }, spec);
  }

  const REPO_PROPS = {
    owner: { type: 'string', description: 'Proprietario del repository (utente o organizzazione GitHub).' },
    repo: { type: 'string', description: 'Nome del repository.' }
  };

  // 1 — elenco repository
  def('github_list_repos', {
    description: 'Elenca i repository GitHub dell\'utente (i più recentemente aggiornati per primi).',
    parameters: {
      type: 'object',
      properties: {
        visibility: { type: 'string', enum: ['all', 'public', 'private'], description: 'Filtro di visibilità (predefinito: all).' },
        limit: { type: 'integer', description: 'Quanti repository restituire (1-100, predefinito 30).' }
      }
    },
    title: () => 'Elenca i tuoi repository',
    async run(args, ctx) {
      const per = Math.min(100, Math.max(1, Number(args.limit) || 30));
      const vis = ['all', 'public', 'private'].includes(args.visibility) ? args.visibility : 'all';
      const list = await gh(ctx, '/user/repos?sort=updated&per_page=' + per + '&visibility=' + vis);
      if (!list.length) return 'Nessun repository.';
      return list
        .map(
          (r) =>
            r.full_name +
            (r.private ? ' [privato]' : ' [pubblico]') +
            (r.archived ? ' [archiviato]' : '') +
            ' · branch: ' +
            r.default_branch +
            (r.language ? ' · ' + r.language : '') +
            (r.description ? ' · ' + oneLine(r.description, 100) : '')
        )
        .join('\n');
    }
  });

  // 2 — crea repository
  def('github_create_repo', {
    description: 'Crea un nuovo repository GitHub per l\'utente, con un README iniziale. Privato per impostazione predefinita.',
    write: true,
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Nome del repository (lettere, numeri, trattini, punti).' },
        description: { type: 'string', description: 'Descrizione breve (facoltativa).' },
        private: { type: 'boolean', description: 'true = privato (predefinito), false = pubblico.' }
      },
      required: ['name']
    },
    title: (a) => 'Crea il repository «' + str(a.name) + '»',
    details: (a) => 'Visibilità: ' + (a.private === false ? 'PUBBLICO' : 'privato') + (a.description ? '\nDescrizione: ' + a.description : ''),
    async run(args, ctx) {
      const name = need(args, 'name');
      if (!NAME_RE.test(name)) throw new Error('Nome repository non valido (usa lettere, numeri, - _ .).');
      const r = await gh(ctx, '/user/repos', {
        method: 'POST',
        body: { name, description: str(args.description), private: args.private !== false, auto_init: true }
      });
      return 'Repository creato: ' + r.full_name + ' (' + (r.private ? 'privato' : 'pubblico') + ') — ' + r.html_url;
    }
  });

  // 3 — leggi file o cartella
  def('github_read_file', {
    description:
      'Legge un file di testo di un repository oppure elenca il contenuto di una cartella (path vuoto = radice del repository).',
    parameters: {
      type: 'object',
      properties: Object.assign({}, REPO_PROPS, {
        path: { type: 'string', description: 'Percorso del file o della cartella, es. «src/index.js». Vuoto per la radice.' },
        ref: { type: 'string', description: 'Branch, tag o commit (facoltativo, predefinito: branch principale).' }
      }),
      required: ['owner', 'repo']
    },
    title: (a) => 'Leggi ' + (str(a.path) || '/') + ' in ' + str(a.owner) + '/' + str(a.repo),
    async run(args, ctx) {
      const { base } = repoArgs(args);
      const q = args.ref ? '?ref=' + encodeURIComponent(args.ref) : '';
      const d = await gh(ctx, base + '/contents/' + encPath(args.path) + q);
      if (Array.isArray(d)) {
        if (!d.length) return 'Cartella vuota.';
        return d.map((f) => (f.type === 'dir' ? '📁 ' : '📄 ') + f.path + (f.type === 'file' ? ' (' + f.size + ' B)' : '')).join('\n');
      }
      if (d.type !== 'file') return 'Elemento di tipo «' + d.type + '»: non leggibile come testo.';
      if (!d.content) return 'File troppo grande o non leggibile via API (' + d.size + ' byte).';
      let text;
      try {
        text = base64ToUtf8(d.content);
      } catch (_) {
        return 'File binario: non leggibile come testo.';
      }
      if (text.includes('\u0000')) return 'File binario: non leggibile come testo.';
      return 'File ' + d.path + ' (' + d.size + ' byte)\n\n' + clip(text);
    }
  });

  // 4 — crea o modifica file
  def('github_write_file', {
    description:
      'Crea un nuovo file o sostituisce per intero il contenuto di un file esistente, con un commit. ' +
      'Per modificare un file esistente, leggilo prima con github_read_file e riscrivi il contenuto completo.',
    write: true,
    parameters: {
      type: 'object',
      properties: Object.assign({}, REPO_PROPS, {
        path: { type: 'string', description: 'Percorso del file, es. «docs/guida.md».' },
        content: { type: 'string', description: 'Contenuto COMPLETO del file.' },
        message: { type: 'string', description: 'Messaggio del commit.' },
        branch: { type: 'string', description: 'Branch di destinazione (facoltativo, predefinito: branch principale).' }
      }),
      required: ['owner', 'repo', 'path', 'content', 'message']
    },
    title: (a) => 'Scrivi «' + str(a.path) + '» in ' + str(a.owner) + '/' + str(a.repo) + (a.branch ? ' (branch ' + a.branch + ')' : ''),
    details: (a) => 'Commit: ' + str(a.message) + '\n\n' + clip(str(a.content), 1200),
    async run(args, ctx) {
      const { base } = repoArgs(args);
      const path = need(args, 'path');
      const message = need(args, 'message');
      if (typeof args.content !== 'string') throw new Error('Parametro mancante: «content».');
      const refQ = args.branch ? '?ref=' + encodeURIComponent(args.branch) : '';
      const url = base + '/contents/' + encPath(path);
      const existing = await gh(ctx, url + refQ, { allow404: true });
      if (existing && Array.isArray(existing)) throw new Error('«' + path + '» è una cartella, non un file.');
      const body = { message, content: utf8ToBase64(args.content) };
      if (args.branch) body.branch = args.branch;
      if (existing && existing.sha) body.sha = existing.sha;
      const r = await gh(ctx, url, { method: 'PUT', body });
      return (existing ? 'File aggiornato: ' : 'File creato: ') + path + ' — commit ' + short(r.commit && r.commit.sha) + ' — ' + (r.content && r.content.html_url);
    }
  });

  // 5 — elimina file
  def('github_delete_file', {
    description: 'Elimina un file da un repository, con un commit.',
    write: true,
    danger: true,
    parameters: {
      type: 'object',
      properties: Object.assign({}, REPO_PROPS, {
        path: { type: 'string', description: 'Percorso del file da eliminare.' },
        message: { type: 'string', description: 'Messaggio del commit.' },
        branch: { type: 'string', description: 'Branch (facoltativo, predefinito: branch principale).' }
      }),
      required: ['owner', 'repo', 'path', 'message']
    },
    title: (a) => 'ELIMINA «' + str(a.path) + '» da ' + str(a.owner) + '/' + str(a.repo),
    details: (a) => 'Commit: ' + str(a.message) + (a.branch ? '\nBranch: ' + a.branch : ''),
    async run(args, ctx) {
      const { base } = repoArgs(args);
      const path = need(args, 'path');
      const message = need(args, 'message');
      const refQ = args.branch ? '?ref=' + encodeURIComponent(args.branch) : '';
      const url = base + '/contents/' + encPath(path);
      const existing = await gh(ctx, url + refQ);
      if (Array.isArray(existing) || !existing.sha) throw new Error('«' + path + '» non è un file eliminabile.');
      const body = { message, sha: existing.sha };
      if (args.branch) body.branch = args.branch;
      const r = await gh(ctx, url, { method: 'DELETE', body });
      return 'File eliminato: ' + path + ' — commit ' + short(r.commit && r.commit.sha);
    }
  });

  // 6 — crea branch
  def('github_create_branch', {
    description: 'Crea un nuovo branch a partire da un branch esistente.',
    write: true,
    parameters: {
      type: 'object',
      properties: Object.assign({}, REPO_PROPS, {
        branch: { type: 'string', description: 'Nome del nuovo branch.' },
        from: { type: 'string', description: 'Branch di partenza (facoltativo, predefinito: branch principale).' }
      }),
      required: ['owner', 'repo', 'branch']
    },
    title: (a) => 'Crea il branch «' + str(a.branch) + '» in ' + str(a.owner) + '/' + str(a.repo),
    details: (a) => (a.from ? 'Parte da: ' + a.from : 'Parte dal branch principale'),
    async run(args, ctx) {
      const { base } = repoArgs(args);
      const branch = need(args, 'branch');
      let from = str(args.from).trim();
      if (!from) from = (await gh(ctx, base)).default_branch;
      const ref = await gh(ctx, base + '/git/ref/heads/' + encPath(from));
      await gh(ctx, base + '/git/refs', { method: 'POST', body: { ref: 'refs/heads/' + branch, sha: ref.object.sha } });
      return 'Branch creato: ' + branch + ' (da ' + from + ', ' + short(ref.object.sha) + ')';
    }
  });

  // 7 — branch e commit
  def('github_list_branches_commits', {
    description: 'Elenca i branch di un repository oppure gli ultimi commit di un branch.',
    parameters: {
      type: 'object',
      properties: Object.assign({}, REPO_PROPS, {
        what: { type: 'string', enum: ['branches', 'commits'], description: '«branches» per i branch, «commits» per gli ultimi commit.' },
        branch: { type: 'string', description: 'Solo per «commits»: branch (facoltativo, predefinito: principale).' },
        limit: { type: 'integer', description: 'Quanti elementi (1-50, predefinito 15).' }
      }),
      required: ['owner', 'repo', 'what']
    },
    title: (a) => (a.what === 'commits' ? 'Ultimi commit' : 'Branch') + ' di ' + str(a.owner) + '/' + str(a.repo),
    async run(args, ctx) {
      const { base } = repoArgs(args);
      const per = Math.min(50, Math.max(1, Number(args.limit) || 15));
      if (args.what === 'commits') {
        const q = '?per_page=' + per + (args.branch ? '&sha=' + encodeURIComponent(args.branch) : '');
        const list = await gh(ctx, base + '/commits' + q);
        if (!list.length) return 'Nessun commit.';
        return list
          .map((c) => short(c.sha) + ' · ' + str(c.commit.author && c.commit.author.date).slice(0, 10) + ' · ' + oneLine(c.commit.message, 100))
          .join('\n');
      }
      if (args.what !== 'branches') throw new Error('«what» deve essere «branches» o «commits».');
      const list = await gh(ctx, base + '/branches?per_page=' + per);
      return list.map((b) => b.name + (b.protected ? ' [protetto]' : '')).join('\n') || 'Nessun branch.';
    }
  });

  // 8 — issue
  def('github_issues', {
    description:
      'Gestisce le issue di un repository: «list» (elenco), «read» (dettaglio con commenti), «create» (nuova issue), «comment» (aggiunge un commento).',
    parameters: {
      type: 'object',
      properties: Object.assign({}, REPO_PROPS, {
        action: { type: 'string', enum: ['list', 'read', 'create', 'comment'], description: 'Azione da eseguire.' },
        number: { type: 'integer', description: 'Numero dell\'issue (per read e comment).' },
        title: { type: 'string', description: 'Titolo (per create).' },
        body: { type: 'string', description: 'Testo dell\'issue o del commento (per create e comment).' },
        state: { type: 'string', enum: ['open', 'closed', 'all'], description: 'Per list: stato (predefinito open).' }
      }),
      required: ['owner', 'repo', 'action']
    },
    write: (a) => a.action === 'create' || a.action === 'comment',
    title: (a) => {
      const r = str(a.owner) + '/' + str(a.repo);
      if (a.action === 'create') return 'Apri una issue in ' + r + ': «' + str(a.title) + '»';
      if (a.action === 'comment') return 'Commenta l\'issue #' + str(a.number) + ' in ' + r;
      if (a.action === 'read') return 'Leggi l\'issue #' + str(a.number) + ' in ' + r;
      return 'Elenca le issue di ' + r;
    },
    details: (a) => clip(str(a.body), 1200),
    async run(args, ctx) {
      const { base } = repoArgs(args);
      const action = args.action;
      if (action === 'list') {
        const state = ['open', 'closed', 'all'].includes(args.state) ? args.state : 'open';
        const list = await gh(ctx, base + '/issues?per_page=30&state=' + state);
        if (!list.length) return 'Nessuna issue (' + state + ').';
        return list
          .map((i) => '#' + i.number + (i.pull_request ? ' [PR]' : '') + ' [' + i.state + '] ' + oneLine(i.title, 100) + ' — ' + i.user.login)
          .join('\n');
      }
      if (action === 'create') {
        const i = await gh(ctx, base + '/issues', { method: 'POST', body: { title: need(args, 'title'), body: str(args.body) } });
        return 'Issue creata: #' + i.number + ' — ' + i.html_url;
      }
      const num = Math.floor(Number(args.number));
      if (!num || num < 1) throw new Error('Parametro mancante: «number».');
      if (action === 'comment') {
        const c = await gh(ctx, base + '/issues/' + num + '/comments', { method: 'POST', body: { body: need(args, 'body') } });
        return 'Commento aggiunto all\'issue #' + num + ' — ' + c.html_url;
      }
      if (action === 'read') {
        const i = await gh(ctx, base + '/issues/' + num);
        const cs = i.comments ? await gh(ctx, base + '/issues/' + num + '/comments?per_page=20') : [];
        let out = '#' + i.number + ' [' + i.state + '] ' + i.title + '\nAutore: ' + i.user.login + '\n\n' + clip(i.body || '(nessun testo)', 5000);
        cs.forEach((c) => (out += '\n\n— ' + c.user.login + ':\n' + clip(c.body, 1500)));
        return clip(out);
      }
      throw new Error('Azione non valida: usa list, read, create o comment.');
    }
  });

  // 9 — pagina web
  def('read_webpage', {
    description:
      'Legge il testo di una pagina web pubblica (http/https). Utile per documentazione, articoli, README. ' +
      'Prova prima l\'indirizzo diretto; se il sito lo blocca usa il servizio r.jina.ai.',
    parameters: {
      type: 'object',
      properties: { url: { type: 'string', description: 'Indirizzo completo, es. «https://example.com/pagina».' } },
      required: ['url']
    },
    title: (a) => 'Leggi la pagina ' + str(a.url),
    async run(args, ctx) {
      const url = need(args, 'url');
      if (!/^https?:\/\//i.test(url)) throw new Error('Servono indirizzi http:// o https://');
      let text = null;
      try {
        const res = await fetch(url, { signal: ctx.signal });
        if (res.ok) text = await res.text();
      } catch (e) {
        if (e && e.name === 'AbortError') throw e;
      }
      let via = 'diretto';
      if (text == null) {
        via = 'r.jina.ai';
        const res = await fetch('https://r.jina.ai/' + url, { signal: ctx.signal, headers: { Accept: 'text/plain' } });
        if (!res.ok) throw new Error('Pagina non raggiungibile [HTTP ' + res.status + ']');
        text = await res.text();
      } else if (/<html|<!doctype/i.test(text.slice(0, 500))) {
        // HTML grezzo: estrai il testo
        const doc = new DOMParser().parseFromString(text, 'text/html');
        doc.querySelectorAll('script,style,noscript,svg,nav,footer,header').forEach((n) => n.remove());
        text = (doc.title ? doc.title + '\n\n' : '') + (doc.body ? doc.body.innerText || doc.body.textContent : '');
        text = text.replace(/\n{3,}/g, '\n\n');
      }
      return '[' + url + ' — via ' + via + ']\n\n' + clip(text.trim() || '(pagina vuota)');
    }
  });

  // 10 — note locali
  function loadNotes() {
    try {
      const v = JSON.parse(localStorage.getItem(LS_NOTES) || '[]');
      return Array.isArray(v) ? v : [];
    } catch (_) {
      return [];
    }
  }
  function saveNotes(list) {
    try {
      localStorage.setItem(LS_NOTES, JSON.stringify(list));
    } catch (_) {
      throw new Error('Memoria piena: non riesco a salvare la nota.');
    }
  }

  def('notes', {
    description:
      'Note personali salvate sul telefono: «save» (salva o aggiorna una nota per titolo), «list» (elenco), «read» (legge per titolo), «delete» (elimina per titolo).',
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['save', 'list', 'read', 'delete'], description: 'Azione da eseguire.' },
        title: { type: 'string', description: 'Titolo della nota (per save, read, delete).' },
        text: { type: 'string', description: 'Testo della nota (per save).' }
      },
      required: ['action']
    },
    write: (a) => a.action === 'delete',
    title: (a) => {
      if (a.action === 'delete') return 'Elimina la nota «' + str(a.title) + '»';
      if (a.action === 'save') return 'Salva la nota «' + str(a.title) + '»';
      if (a.action === 'read') return 'Leggi la nota «' + str(a.title) + '»';
      return 'Elenca le note';
    },
    async run(args) {
      const list = loadNotes();
      const find = (t) => list.findIndex((n) => n.title.toLowerCase() === str(t).trim().toLowerCase());
      if (args.action === 'list') {
        if (!list.length) return 'Nessuna nota.';
        return list.map((n) => '• ' + n.title + ' (' + new Date(n.updated).toLocaleDateString('it-IT') + ')').join('\n');
      }
      if (args.action === 'save') {
        const title = need(args, 'title');
        const i = find(title);
        const note = { title, text: str(args.text), updated: Date.now() };
        if (i >= 0) list[i] = note;
        else list.push(note);
        saveNotes(list);
        return (i >= 0 ? 'Nota aggiornata: ' : 'Nota salvata: ') + title;
      }
      const i = find(need(args, 'title'));
      if (i < 0) throw new Error('Nota non trovata.');
      if (args.action === 'read') return list[i].title + '\n\n' + clip(list[i].text);
      if (args.action === 'delete') {
        const t = list[i].title;
        list.splice(i, 1);
        saveNotes(list);
        return 'Nota eliminata: ' + t;
      }
      throw new Error('Azione non valida: usa save, list, read o delete.');
    }
  });

  // ─── API pubblica ─────────────────────────────────────────
  function get(name) {
    return Object.prototype.hasOwnProperty.call(TOOLS, name) ? TOOLS[name] : null;
  }

  /** Schemi da inviare al modello. */
  function definitions() {
    return Object.values(TOOLS).map((t) => ({ name: t.name, description: t.description, parameters: t.parameters }));
  }

  function needsConfirm(name, args) {
    const t = get(name);
    if (!t) return false;
    return typeof t.write === 'function' ? !!t.write(args || {}) : !!t.write;
  }

  function describe(name, args) {
    const t = get(name);
    args = args || {};
    let title = name;
    let details = '';
    try {
      if (t && t.title) title = t.title(args);
      if (t && t.details) details = t.details(args);
    } catch (_) {}
    return { title, details, danger: !!(t && t.danger) };
  }

  async function run(name, args, ctx) {
    const t = get(name);
    if (!t) throw new Error('Strumento sconosciuto: ' + name);
    if (ctx && ctx.signal && ctx.signal.aborted) throw abortError();
    return clip(await t.run(args || {}, ctx || {}));
  }

  global.MiaTools = { definitions, get, needsConfirm, describe, run, whoami, count: () => Object.keys(TOOLS).length };
})(window);
