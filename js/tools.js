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
          Accept: opts.accept || 'application/vnd.github+json',
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

  // ─── File creati (testo, zip, immagini, pdf, xlsx) ────────
  const TEXT_EXT = /\.(txt|md|markdown|csv|tsv|json|xml|html?|css|js|mjs|ts|py|java|kt|c|h|cpp|cs|go|rs|rb|php|sql|yaml|yml|ini|toml|log|srt|tex|swift|svg)$/i;
  const MIMES = {
    txt: 'text/plain', md: 'text/markdown', markdown: 'text/markdown', csv: 'text/csv', tsv: 'text/tab-separated-values',
    json: 'application/json', xml: 'application/xml', html: 'text/html', htm: 'text/html', css: 'text/css',
    js: 'text/javascript', svg: 'image/svg+xml', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp',
    pdf: 'application/pdf', zip: 'application/zip',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  };

  function mimeFor(name) {
    const m = /\.([A-Za-z0-9]+)$/.exec(name);
    return (m && MIMES[m[1].toLowerCase()]) || 'text/plain';
  }

  function safeName(name, ext) {
    let n = str(name)
      .trim()
      .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '_')
      .replace(/^\.+/, '');
    if (!n) n = 'file';
    if (ext && !/\.[A-Za-z0-9]{1,8}$/.test(n)) n += '.' + ext;
    else if (ext && !new RegExp('\\.' + ext + '$', 'i').test(n)) n += '.' + ext;
    return n.slice(0, 100);
  }

  function fmtSize(b) {
    return b < 1024 ? b + ' B' : b < 1048576 ? (b / 1024).toFixed(1) + ' KB' : (b / 1048576).toFixed(1) + ' MB';
  }

  function fileResult(verb, files, extra) {
    return {
      text:
        verb + ': ' + files.map((f) => '«' + f.name + '» (' + fmtSize(f.blob.size) + ')').join(', ') +
        '. L\'utente li vede in chat con i pulsanti Condividi/Salva: non incollare il contenuto nella risposta.' +
        (extra ? '\n' + extra : ''),
      files
    };
  }

  const scriptCache = {};
  function loadScript(src) {
    if (!scriptCache[src]) {
      scriptCache[src] = new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = src;
        s.onload = resolve;
        s.onerror = () => {
          delete scriptCache[src];
          reject(new Error('Impossibile caricare la libreria ' + src));
        };
        document.head.appendChild(s);
      });
    }
    return scriptCache[src];
  }
  async function needZip() {
    if (!global.JSZip) await loadScript('js/vendor/jszip.min.js');
    return global.JSZip;
  }
  async function needPdf() {
    if (!global.jspdf) await loadScript('js/vendor/jspdf.umd.min.js');
    return global.jspdf.jsPDF;
  }

  function base64ToBlob(b64, mime) {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new Blob([bytes], { type: mime });
  }

  // 11 — file di testo
  def('create_file', {
    description:
      'Crea un file di testo (txt, md, csv, json, html, xml, codice…) che l\'utente potrà salvare o condividere. ' +
      'Per pdf, xlsx, zip e immagini usa gli strumenti dedicati.',
    parameters: {
      type: 'object',
      properties: {
        filename: { type: 'string', description: 'Nome del file con estensione, es. «relazione.md» o «dati.csv».' },
        content: { type: 'string', description: 'Contenuto completo del file.' }
      },
      required: ['filename', 'content']
    },
    title: (a) => 'Crea il file ' + str(a.filename),
    async run(args) {
      const name = safeName(need(args, 'filename'));
      if (!TEXT_EXT.test(name)) throw new Error('Estensione non consentita per create_file. Usa create_pdf, create_xlsx, create_zip o create_svg.');
      if (typeof args.content !== 'string') throw new Error('Parametro mancante: «content».');
      const bom = /\.csv$/i.test(name) ? '﻿' : ''; // Excel legge così le lettere accentate
      const blob = new Blob([bom + args.content], { type: mimeFor(name) + ';charset=utf-8' });
      return fileResult('File creato', [{ name, mime: mimeFor(name), blob }]);
    }
  });

  // 12 — zip
  def('create_zip', {
    description: 'Crea un archivio .zip con più file di testo (anche in sottocartelle) che l\'utente potrà salvare o condividere.',
    parameters: {
      type: 'object',
      properties: {
        filename: { type: 'string', description: 'Nome dell\'archivio, es. «progetto.zip».' },
        files: {
          type: 'array',
          description: 'File da inserire nell\'archivio.',
          items: {
            type: 'object',
            properties: {
              path: { type: 'string', description: 'Percorso nel zip, es. «src/index.js».' },
              content: { type: 'string', description: 'Contenuto di testo del file.' }
            },
            required: ['path', 'content']
          }
        }
      },
      required: ['filename', 'files']
    },
    title: (a) => 'Crea l\'archivio ' + str(a.filename) + ' (' + ((a.files && a.files.length) || 0) + ' file)',
    async run(args) {
      const list = Array.isArray(args.files) ? args.files : [];
      if (!list.length) throw new Error('Nessun file da inserire nello zip.');
      if (list.length > 200) throw new Error('Troppi file (massimo 200).');
      const JSZip = await needZip();
      const zip = new JSZip();
      let total = 0;
      const used = new Set();
      list.forEach((f, i) => {
        let p = str(f && f.path)
          .replace(/\\/g, '/')
          .split('/')
          .filter((s) => s && s !== '.' && s !== '..')
          .join('/');
        if (!p) throw new Error('Percorso non valido nel file n. ' + (i + 1) + '.');
        if (used.has(p)) throw new Error('Percorso duplicato: ' + p);
        used.add(p);
        const content = str(f.content);
        total += content.length;
        if (total > 20 * 1024 * 1024) throw new Error('Contenuto troppo grande (massimo 20 MB).');
        zip.file(p, content);
      });
      const name = safeName(need(args, 'filename'), 'zip');
      const blob = await zip.generateAsync({ type: 'blob', mimeType: 'application/zip', compression: 'DEFLATE' });
      return fileResult('Archivio creato', [{ name, mime: 'application/zip', blob }], 'Contiene: ' + [...used].join(', '));
    }
  });

  // 13 — SVG (+ PNG)
  function prepareSvg(src) {
    const doc = new DOMParser().parseFromString(src, 'image/svg+xml');
    if (doc.querySelector('parsererror') || doc.documentElement.localName !== 'svg')
      throw new Error('SVG non valido: deve iniziare con <svg …> ed essere XML ben formato (tag chiusi, & scritto come &amp;).');
    const root = doc.documentElement;
    root.querySelectorAll('script,foreignObject').forEach((n) => n.remove());
    root.querySelectorAll('*').forEach((el) =>
      Array.from(el.attributes).forEach((a) => {
        if (/^on/i.test(a.name)) el.removeAttribute(a.name);
        else if (/^(xlink:)?href$/i.test(a.name) && /^\s*(https?:|javascript:)/i.test(a.value)) el.removeAttribute(a.name);
      })
    );
    if (!root.getAttribute('xmlns')) root.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    const dim = (k) => {
      const v = str(root.getAttribute(k));
      return v && !v.includes('%') ? parseFloat(v) : NaN;
    };
    let w = dim('width');
    let h = dim('height');
    const vb = str(root.getAttribute('viewBox')).trim().split(/[\s,]+/).map(Number);
    const hasVb = vb.length === 4 && vb[2] > 0 && vb[3] > 0;
    if (!(w > 0 && h > 0)) {
      w = hasVb ? vb[2] : 800;
      h = hasVb ? vb[3] : 600;
      if (!hasVb) root.setAttribute('viewBox', '0 0 800 600');
      root.setAttribute('width', w);
      root.setAttribute('height', h);
    }
    return { svg: new XMLSerializer().serializeToString(root), w, h };
  }

  function svgToPng(svg, w, h) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }));
      const img = new Image();
      img.onload = () => {
        try {
          const k = Math.min(4, Math.max(1, 1600 / Math.max(w, h)));
          const cv = document.createElement('canvas');
          cv.width = Math.round(w * k);
          cv.height = Math.round(h * k);
          const ctx = cv.getContext('2d');
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, cv.width, cv.height);
          ctx.drawImage(img, 0, 0, cv.width, cv.height);
          cv.toBlob((b) => (b ? resolve(b) : reject(new Error('Conversione in PNG non riuscita'))), 'image/png');
        } catch (e) {
          reject(e);
        } finally {
          URL.revokeObjectURL(url);
        }
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error('SVG non disegnabile'));
      };
      img.src = url;
    });
  }

  def('create_svg', {
    description:
      'Crea un\'immagine disegnata con codice SVG (loghi, icone, diagrammi, grafici, illustrazioni geometriche) e la salva anche come PNG. ' +
      'Scrivi SVG ben formato con viewBox, senza script, senza immagini esterne e senza font esterni.',
    parameters: {
      type: 'object',
      properties: {
        filename: { type: 'string', description: 'Nome del file senza estensione, es. «logo».' },
        svg: { type: 'string', description: 'Codice SVG completo, da <svg …> a </svg>.' }
      },
      required: ['filename', 'svg']
    },
    title: (a) => 'Disegna l\'immagine ' + str(a.filename),
    async run(args) {
      const base = safeName(need(args, 'filename')).replace(/\.(svg|png)$/i, '');
      const p = prepareSvg(need(args, 'svg'));
      const files = [{ name: base + '.png', mime: 'image/png', blob: null }];
      let note = '';
      try {
        files[0].blob = await svgToPng(p.svg, p.w, p.h);
      } catch (e) {
        files.shift();
        note = 'PNG non generato (' + ((e && e.message) || e) + '): disponibile solo l\'SVG.';
      }
      files.push({ name: base + '.svg', mime: 'image/svg+xml', blob: new Blob([p.svg], { type: 'image/svg+xml;charset=utf-8' }) });
      return fileResult('Immagine creata', files, note);
    }
  });

  // 14 — immagini generate dall'AI (Gemini)
  def('generate_image', {
    description:
      'Genera con l\'intelligenza artificiale una foto o un\'illustrazione a partire da una descrizione (usa il modello immagini di Gemini). ' +
      'Per loghi, schemi e grafici precisi è meglio create_svg.',
    parameters: {
      type: 'object',
      properties: {
        prompt: { type: 'string', description: 'Descrizione dettagliata dell\'immagine da creare (stile, soggetto, colori, inquadratura).' },
        filename: { type: 'string', description: 'Nome del file senza estensione (facoltativo).' }
      },
      required: ['prompt']
    },
    title: (a) => 'Genera un\'immagine: «' + oneLine(a.prompt, 80) + '»',
    async run(args, ctx) {
      const prompt = need(args, 'prompt');
      if (!ctx.geminiKey) throw new Error('Serve la chiave Gemini: inseriscila in Impostazioni (provider Google Gemini).');
      const model = ctx.imageModel || 'gemini-2.5-flash-image';
      const base = String(ctx.geminiBase || 'https://generativelanguage.googleapis.com/v1beta').replace(/\/+$/, '');
      const res = await fetch(base + '/models/' + encodeURIComponent(model) + ':generateContent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': ctx.geminiKey },
        body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { responseModalities: ['TEXT', 'IMAGE'] } }),
        signal: ctx.signal
      });
      let data = null;
      try {
        data = await res.json();
      } catch (_) {}
      if (!res.ok) {
        const m = (data && data.error && data.error.message) || 'Errore Gemini';
        let hint = '';
        if (res.status === 429 || /quota|limit/i.test(m))
          hint = ' Il piano gratuito potrebbe non includere la generazione di immagini o aver raggiunto il limite.';
        else if (res.status === 404 || /not found|not supported/i.test(m))
          hint = ' Controlla il nome del «Modello immagini» in Impostazioni.';
        throw new Error(m + ' [HTTP ' + res.status + ']' + hint);
      }
      const cand = data && data.candidates && data.candidates[0];
      const parts = (cand && cand.content && cand.content.parts) || [];
      let img = null;
      let text = '';
      parts.forEach((p) => {
        const inl = p.inlineData || p.inline_data;
        if (inl && inl.data && !img) img = { data: inl.data, mime: inl.mimeType || inl.mime_type || 'image/png' };
        else if (p.text) text += p.text;
      });
      if (!img) {
        const why = (data && data.promptFeedback && data.promptFeedback.blockReason) || (cand && cand.finishReason) || '';
        throw new Error('Il modello non ha restituito un\'immagine' + (why ? ' (' + why + ')' : '') + (text ? ': ' + oneLine(text, 200) : '') + '.');
      }
      const ext = /jpe?g/i.test(img.mime) ? 'jpg' : /webp/i.test(img.mime) ? 'webp' : 'png';
      const name = safeName(str(args.filename).trim() || 'immagine-' + new Date().toISOString().slice(0, 16).replace(/[-:T]/g, ''), ext);
      return fileResult('Immagine generata', [{ name, mime: img.mime, blob: base64ToBlob(img.data, img.mime) }], text ? 'Nota del modello: ' + oneLine(text, 300) : '');
    }
  });

  // 15 — PDF
  function pdfText(s) {
    return str(s)
      .replace(/[‘’‚]/g, '\'')
      .replace(/[“”„]/g, '"')
      .replace(/[–—−]/g, '-')
      .replace(/…/g, '...')
      .replace(/[•●▪]/g, '-')
      .replace(/[   ]/g, ' ')
      .replace(/[\u{10000}-\u{10FFFF}]/gu, '')
      .replace(/[^\u0009\u000a -ÿ€]/g, '');
  }

  def('create_pdf', {
    description:
      'Crea un documento PDF impaginato (A4) con titoli, paragrafi, elenchi e tabelle. ' +
      'Il PDF usa caratteri latini (accenti italiani ok): niente emoji né alfabeti non latini.',
    parameters: {
      type: 'object',
      properties: {
        filename: { type: 'string', description: 'Nome del file, es. «relazione.pdf».' },
        blocks: {
          type: 'array',
          description: 'Contenuto, nell\'ordine in cui compare nel documento.',
          items: {
            type: 'object',
            properties: {
              type: {
                type: 'string',
                enum: ['title', 'heading', 'subheading', 'paragraph', 'bullets', 'numbered', 'table', 'pagebreak'],
                description: 'Tipo di blocco.'
              },
              text: { type: 'string', description: 'Testo (per title, heading, subheading, paragraph).' },
              items: { type: 'array', items: { type: 'string' }, description: 'Voci (per bullets e numbered).' },
              rows: {
                type: 'array',
                description: 'Righe della tabella; la prima è l\'intestazione. Ogni cella è testo.',
                items: { type: 'array', items: { type: 'string' } }
              }
            },
            required: ['type']
          }
        }
      },
      required: ['filename', 'blocks']
    },
    title: (a) => 'Crea il PDF ' + str(a.filename),
    async run(args) {
      const blocks = Array.isArray(args.blocks) ? args.blocks : [];
      if (!blocks.length) throw new Error('Nessun contenuto: «blocks» è vuoto.');
      const jsPDF = await needPdf();
      const doc = new jsPDF({ unit: 'pt', format: 'a4' });
      const W = doc.internal.pageSize.getWidth();
      const H = doc.internal.pageSize.getHeight();
      const M = 56;
      const maxW = W - 2 * M;
      let y = M;
      const ensure = (h) => {
        if (y + h > H - M) {
          doc.addPage();
          y = M;
        }
      };
      const font = (size, bold) => {
        doc.setFont('helvetica', bold ? 'bold' : 'normal');
        doc.setFontSize(size);
      };
      const para = (text, size, bold, gap, x0, width) => {
        font(size, bold);
        const lh = size * 1.35;
        doc.splitTextToSize(pdfText(text), width || maxW).forEach((line) => {
          ensure(lh);
          doc.text(line, x0 == null ? M : x0, y + size);
          y += lh;
        });
        y += gap;
      };
      const firstTitle = blocks.find((b) => b && b.type === 'title');
      blocks.forEach((b) => {
        if (!b) return;
        const text = str(b.text);
        if (b.type === 'title') para(text, 22, true, 10);
        else if (b.type === 'heading') {
          y += 6;
          ensure(40);
          para(text, 16, true, 6);
        } else if (b.type === 'subheading') {
          y += 3;
          ensure(30);
          para(text, 13, true, 4);
        } else if (b.type === 'bullets' || b.type === 'numbered') {
          (Array.isArray(b.items) ? b.items : []).forEach((it, i) => {
            font(11, false);
            const lh = 11 * 1.35;
            const lines = doc.splitTextToSize(pdfText(it), maxW - 22);
            lines.forEach((line, k) => {
              ensure(lh);
              if (k === 0) doc.text(b.type === 'numbered' ? i + 1 + '.' : '-', M + 6, y + 11);
              doc.text(line, M + 22, y + 11);
              y += lh;
            });
            y += 2;
          });
          y += 6;
        } else if (b.type === 'table') {
          const rows = (Array.isArray(b.rows) ? b.rows : []).map((r) => (Array.isArray(r) ? r : [r]).map(pdfText));
          if (!rows.length) return;
          const cols = Math.max.apply(null, rows.map((r) => r.length));
          const weights = [];
          for (let c = 0; c < cols; c++) weights.push(Math.max(6, Math.min(40, Math.max.apply(null, rows.map((r) => (r[c] || '').length)))));
          const sum = weights.reduce((a, v) => a + v, 0);
          const widths = weights.map((w) => (w / sum) * maxW);
          const size = 10;
          const lh = size * 1.3;
          rows.forEach((r, ri) => {
            font(size, ri === 0);
            const cells = widths.map((w, c) => doc.splitTextToSize(r[c] || '', w - 8));
            const h = Math.max.apply(null, cells.map((l) => l.length)) * lh + 8;
            ensure(h);
            let x = M;
            cells.forEach((lines, c) => {
              if (ri === 0) {
                doc.setFillColor(235, 237, 245);
                doc.rect(x, y, widths[c], h, 'FD');
              } else doc.rect(x, y, widths[c], h);
              font(size, ri === 0);
              lines.forEach((line, k) => doc.text(line, x + 4, y + 4 + size + k * lh));
              x += widths[c];
            });
            y += h;
          });
          y += 10;
        } else if (b.type === 'pagebreak') {
          doc.addPage();
          y = M;
        } else if (text) para(text, 11, false, 8);
      });
      const n = doc.getNumberOfPages();
      for (let i = 1; i <= n; i++) {
        doc.setPage(i);
        font(9, false);
        doc.setTextColor(120);
        doc.text(i + ' / ' + n, W / 2, H - 28, { align: 'center' });
      }
      if (firstTitle) doc.setProperties({ title: pdfText(firstTitle.text) });
      const name = safeName(need(args, 'filename'), 'pdf');
      return fileResult('PDF creato', [{ name, mime: 'application/pdf', blob: doc.output('blob') }], n + ' pagine.');
    }
  });

  // 16 — Excel (.xlsx)
  const xe = (s) =>
    str(s)
      .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');

  function colName(i) {
    let s = '';
    for (i += 1; i > 0; i = Math.floor((i - 1) / 26)) s = String.fromCharCode(65 + ((i - 1) % 26)) + s;
    return s;
  }

  function sheetXml(rows, header) {
    const widths = [];
    let body = '';
    rows.forEach((row, r) => {
      let cells = '';
      (Array.isArray(row) ? row : [row]).forEach((raw, c) => {
        const v = str(raw);
        if (v === '') return;
        const ref = colName(c) + (r + 1);
        const st = header && r === 0 ? ' s="1"' : '';
        widths[c] = Math.max(widths[c] || 0, Math.min(60, v.length));
        if (v.length > 1 && v[0] === '=') cells += '<c r="' + ref + '"' + st + '><f>' + xe(v.slice(1)) + '</f></c>';
        else if (/^-?(0|[1-9]\d{0,14})([.,]\d{1,2})?$/.test(v) || /^-?(0|[1-9]\d{0,14})\.\d+$/.test(v))
          cells += '<c r="' + ref + '"' + st + '><v>' + v.replace(',', '.') + '</v></c>';
        else cells += '<c r="' + ref + '"' + st + ' t="inlineStr"><is><t xml:space="preserve">' + xe(v) + '</t></is></c>';
      });
      body += '<row r="' + (r + 1) + '">' + cells + '</row>';
    });
    const cols = widths.length
      ? '<cols>' + widths.map((w, i) => '<col min="' + (i + 1) + '" max="' + (i + 1) + '" width="' + Math.max(8, (w || 0) + 2) + '" customWidth="1"/>').join('') + '</cols>'
      : '';
    const view = header
      ? '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>'
      : '';
    return (
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' + view + cols + '<sheetData>' + body + '</sheetData></worksheet>'
    );
  }

  def('create_xlsx', {
    description:
      'Crea un foglio di calcolo Excel (.xlsx) con uno o più fogli. Numeri e formule (celle che iniziano con =, es. «=SUM(B2:B10)») sono riconosciuti; ' +
      'la prima riga è l\'intestazione in grassetto e bloccata.',
    parameters: {
      type: 'object',
      properties: {
        filename: { type: 'string', description: 'Nome del file, es. «spese.xlsx».' },
        sheets: {
          type: 'array',
          description: 'Fogli del file.',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string', description: 'Nome del foglio (max 31 caratteri).' },
              rows: {
                type: 'array',
                description: 'Righe del foglio; ogni cella è scritta come testo (i numeri come «12.5»; le formule iniziano con «=»).',
                items: { type: 'array', items: { type: 'string' } }
              }
            },
            required: ['name', 'rows']
          }
        }
      },
      required: ['filename', 'sheets']
    },
    title: (a) => 'Crea il foglio Excel ' + str(a.filename),
    async run(args) {
      const sheets = Array.isArray(args.sheets) ? args.sheets : [];
      if (!sheets.length) throw new Error('Nessun foglio: «sheets» è vuoto.');
      if (sheets.length > 20) throw new Error('Troppi fogli (massimo 20).');
      const JSZip = await needZip();
      const names = [];
      const prepared = sheets.map((s, i) => {
        let n = str(s && s.name).replace(/[\[\]:*?\/\\]+/g, ' ').trim().slice(0, 31) || 'Foglio' + (i + 1);
        while (names.some((x) => x.toLowerCase() === n.toLowerCase())) n = n.slice(0, 28) + '_' + (i + 1);
        names.push(n);
        const rows = Array.isArray(s && s.rows) ? s.rows : [];
        if (rows.length > 20000) throw new Error('Troppe righe nel foglio «' + n + '» (massimo 20000).');
        return { name: n, rows };
      });
      const NS = 'http://schemas.openxmlformats.org/';
      const zip = new JSZip();
      zip.file(
        '[Content_Types].xml',
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="' + NS + 'package/2006/content-types">' +
          '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
          '<Default Extension="xml" ContentType="application/xml"/>' +
          '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
          '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
          prepared.map((_, i) => '<Override PartName="/xl/worksheets/sheet' + (i + 1) + '.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>').join('') +
          '</Types>'
      );
      zip.file(
        '_rels/.rels',
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="' + NS + 'package/2006/relationships">' +
          '<Relationship Id="rId1" Type="' + NS + 'officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'
      );
      zip.file(
        'xl/workbook.xml',
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="' + NS + 'spreadsheetml/2006/main" xmlns:r="' + NS + 'officeDocument/2006/relationships"><sheets>' +
          prepared.map((s, i) => '<sheet name="' + xe(s.name) + '" sheetId="' + (i + 1) + '" r:id="rId' + (i + 1) + '"/>').join('') +
          '</sheets></workbook>'
      );
      zip.file(
        'xl/_rels/workbook.xml.rels',
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="' + NS + 'package/2006/relationships">' +
          prepared.map((_, i) => '<Relationship Id="rId' + (i + 1) + '" Type="' + NS + 'officeDocument/2006/relationships/worksheet" Target="worksheets/sheet' + (i + 1) + '.xml"/>').join('') +
          '<Relationship Id="rId' + (prepared.length + 1) + '" Type="' + NS + 'officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>'
      );
      zip.file(
        'xl/styles.xml',
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="' + NS + 'spreadsheetml/2006/main">' +
          '<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>' +
          '<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>' +
          '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
          '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
          '<cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs>' +
          '</styleSheet>'
      );
      prepared.forEach((s, i) => zip.file('xl/worksheets/sheet' + (i + 1) + '.xml', sheetXml(s.rows, true)));
      const name = safeName(need(args, 'filename'), 'xlsx');
      const blob = await zip.generateAsync({ type: 'blob', mimeType: MIMES.xlsx, compression: 'DEFLATE' });
      return fileResult('Foglio Excel creato', [{ name, mime: MIMES.xlsx, blob }], 'Fogli: ' + names.join(', ') + '.');
    }
  });

  // ─── GitHub avanzato: ricerca nel codice, pull request, workflow ─
  // 17 — cerca nel codice
  def('github_search_code', {
    description:
      'Cerca testo o codice nei repository GitHub (solo branch principale). Senza owner/repo cerca in tutti i repository dell\'utente.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Testo da cercare, es. «function login» o «TODO».' },
        owner: { type: 'string', description: 'Limita a un proprietario (facoltativo).' },
        repo: { type: 'string', description: 'Limita a un repository (facoltativo, richiede owner).' }
      },
      required: ['query']
    },
    title: (a) => 'Cerca «' + oneLine(a.query, 60) + '» nel codice' + (a.repo ? ' di ' + str(a.owner) + '/' + str(a.repo) : ''),
    async run(args, ctx) {
      const q = need(args, 'query');
      let scope = '';
      if (args.owner && args.repo) {
        repoArgs(args);
        scope = ' repo:' + args.owner + '/' + args.repo;
      } else if (args.owner) {
        if (!NAME_RE.test(str(args.owner))) throw new Error('Proprietario non valido.');
        scope = ' user:' + args.owner;
      } else {
        const me = await whoami(ctx.token, ctx.signal);
        if (me) scope = ' user:' + me;
      }
      const d = await gh(ctx, '/search/code?per_page=15&q=' + encodeURIComponent(q + scope), {
        accept: 'application/vnd.github.text-match+json'
      });
      if (!d.items || !d.items.length) return 'Nessun risultato.';
      return (
        d.total_count + ' risultati (primi ' + d.items.length + '):\n' +
        d.items
          .map((i) => {
            const frag = (i.text_matches && i.text_matches[0] && oneLine(i.text_matches[0].fragment, 160)) || '';
            return i.repository.full_name + ' · ' + i.path + (frag ? '\n   …' + frag + '…' : '');
          })
          .join('\n')
      );
    }
  });

  // 18 — pull request
  def('github_pull_requests', {
    description:
      'Gestisce le pull request: «list» (elenco), «read» (dettaglio con file modificati e diff), «create» (nuova PR da un branch), «comment» (commento), «merge» (unisce la PR).',
    parameters: {
      type: 'object',
      properties: Object.assign({}, REPO_PROPS, {
        action: { type: 'string', enum: ['list', 'read', 'create', 'comment', 'merge'], description: 'Azione da eseguire.' },
        number: { type: 'integer', description: 'Numero della PR (per read, comment, merge).' },
        title: { type: 'string', description: 'Titolo (per create).' },
        body: { type: 'string', description: 'Descrizione della PR o testo del commento.' },
        head: { type: 'string', description: 'Branch con le modifiche (per create).' },
        base: { type: 'string', description: 'Branch di destinazione (per create; predefinito: branch principale).' },
        method: { type: 'string', enum: ['merge', 'squash', 'rebase'], description: 'Per merge: tipo di unione (predefinito squash).' },
        state: { type: 'string', enum: ['open', 'closed', 'all'], description: 'Per list: stato (predefinito open).' }
      }),
      required: ['owner', 'repo', 'action']
    },
    write: (a) => ['create', 'comment', 'merge'].includes(a.action),
    danger: (a) => a.action === 'merge',
    title: (a) => {
      const r = str(a.owner) + '/' + str(a.repo);
      if (a.action === 'create') return 'Apri una pull request in ' + r + ': «' + str(a.title) + '» (' + str(a.head) + ' → ' + (str(a.base) || 'principale') + ')';
      if (a.action === 'merge') return 'UNISCI la pull request #' + str(a.number) + ' in ' + r + ' (' + (a.method || 'squash') + ')';
      if (a.action === 'comment') return 'Commenta la PR #' + str(a.number) + ' in ' + r;
      if (a.action === 'read') return 'Leggi la PR #' + str(a.number) + ' in ' + r;
      return 'Elenca le pull request di ' + r;
    },
    details: (a) => clip(str(a.body), 1200),
    async run(args, ctx) {
      const { base } = repoArgs(args);
      const action = args.action;
      if (action === 'list') {
        const state = ['open', 'closed', 'all'].includes(args.state) ? args.state : 'open';
        const list = await gh(ctx, base + '/pulls?per_page=20&state=' + state);
        if (!list.length) return 'Nessuna pull request (' + state + ').';
        return list
          .map((p) => '#' + p.number + ' [' + (p.merged_at ? 'merged' : p.state) + (p.draft ? ', bozza' : '') + '] ' + oneLine(p.title, 90) + ' — ' + p.user.login + ' (' + p.head.ref + ' → ' + p.base.ref + ')')
          .join('\n');
      }
      if (action === 'create') {
        const head = need(args, 'head');
        let baseBranch = str(args.base).trim();
        if (!baseBranch) baseBranch = (await gh(ctx, base)).default_branch;
        const p = await gh(ctx, base + '/pulls', {
          method: 'POST',
          body: { title: need(args, 'title'), head, base: baseBranch, body: str(args.body) }
        });
        return 'Pull request creata: #' + p.number + ' — ' + p.html_url;
      }
      const num = Math.floor(Number(args.number));
      if (!num || num < 1) throw new Error('Parametro mancante: «number».');
      if (action === 'comment') {
        const c = await gh(ctx, base + '/issues/' + num + '/comments', { method: 'POST', body: { body: need(args, 'body') } });
        return 'Commento aggiunto alla PR #' + num + ' — ' + c.html_url;
      }
      if (action === 'merge') {
        const method = ['merge', 'squash', 'rebase'].includes(args.method) ? args.method : 'squash';
        const r = await gh(ctx, base + '/pulls/' + num + '/merge', { method: 'PUT', body: { merge_method: method } });
        return (r && r.message) || 'Pull request #' + num + ' unita (' + method + ').';
      }
      if (action === 'read') {
        const p = await gh(ctx, base + '/pulls/' + num);
        const files = await gh(ctx, base + '/pulls/' + num + '/files?per_page=30');
        let out =
          '#' + p.number + ' [' + (p.merged ? 'merged' : p.state) + (p.draft ? ', bozza' : '') + '] ' + p.title +
          '\n' + p.head.ref + ' → ' + p.base.ref + ' · autore ' + p.user.login +
          (p.merged ? '' : ' · unibile: ' + (p.mergeable_state || 'n/d')) +
          '\n' + p.changed_files + ' file, +' + p.additions + ' −' + p.deletions +
          '\n\n' + clip(p.body || '(nessuna descrizione)', 2000) + '\n\nFile modificati:';
        files.forEach((f) => {
          out += '\n\n▸ ' + f.filename + ' (' + f.status + ', +' + f.additions + ' −' + f.deletions + ')' + (f.patch ? '\n' + clip(f.patch, 1800) : '');
        });
        return clip(out);
      }
      throw new Error('Azione non valida: usa list, read, create, comment o merge.');
    }
  });

  // 19 — GitHub Actions
  async function ghText(ctx, url) {
    const res = await fetch(url, {
      headers: { Authorization: 'Bearer ' + ctx.token, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' },
      signal: ctx.signal
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return res.text();
  }

  def('github_actions', {
    description:
      'GitHub Actions (test e build): «list_runs» (ultime esecuzioni), «read_run» (esito dei job, passaggi falliti e log degli errori), ' +
      '«run_workflow» (avvia un workflow su un branch), «rerun_failed» (rilancia i job falliti).',
    parameters: {
      type: 'object',
      properties: Object.assign({}, REPO_PROPS, {
        action: { type: 'string', enum: ['list_runs', 'read_run', 'run_workflow', 'rerun_failed'], description: 'Azione da eseguire.' },
        run_id: { type: 'integer', description: 'ID dell\'esecuzione (per read_run e rerun_failed; si ottiene da list_runs).' },
        workflow: { type: 'string', description: 'Nome del file del workflow, es. «build-apk.yml» (per run_workflow).' },
        ref: { type: 'string', description: 'Branch su cui avviare il workflow, o filtro per list_runs.' }
      }),
      required: ['owner', 'repo', 'action']
    },
    write: (a) => a.action === 'run_workflow' || a.action === 'rerun_failed',
    title: (a) => {
      const r = str(a.owner) + '/' + str(a.repo);
      if (a.action === 'run_workflow') return 'Avvia il workflow «' + str(a.workflow) + '» su ' + (str(a.ref) || 'branch principale') + ' in ' + r;
      if (a.action === 'rerun_failed') return 'Rilancia i job falliti dell\'esecuzione ' + str(a.run_id) + ' in ' + r;
      if (a.action === 'read_run') return 'Leggi l\'esecuzione ' + str(a.run_id) + ' di ' + r;
      return 'Elenca le esecuzioni di Actions in ' + r;
    },
    async run(args, ctx) {
      const { base } = repoArgs(args);
      const action = args.action;
      if (action === 'list_runs') {
        const q = '?per_page=10' + (args.ref ? '&branch=' + encodeURIComponent(args.ref) : '');
        const d = await gh(ctx, base + '/actions/runs' + q);
        if (!d.workflow_runs.length) return 'Nessuna esecuzione.';
        return d.workflow_runs
          .map((r) => r.id + ' · ' + r.name + ' · ' + r.head_branch + ' · ' + (r.status === 'completed' ? r.conclusion : r.status) + ' · ' + r.created_at.slice(0, 16).replace('T', ' ') + ' · ' + short(r.head_sha))
          .join('\n');
      }
      if (action === 'run_workflow') {
        const wf = need(args, 'workflow');
        if (!/^[A-Za-z0-9_.-]+$/.test(wf)) throw new Error('Nome del workflow non valido.');
        let ref = str(args.ref).trim();
        if (!ref) ref = (await gh(ctx, base)).default_branch;
        await gh(ctx, base + '/actions/workflows/' + encodeURIComponent(wf) + '/dispatches', { method: 'POST', body: { ref } });
        return 'Workflow «' + wf + '» avviato su ' + ref + '. Usa list_runs tra qualche secondo per vedere l\'esecuzione.';
      }
      const id = Math.floor(Number(args.run_id));
      if (!id || id < 1) throw new Error('Parametro mancante: «run_id» (si ottiene con list_runs).');
      if (action === 'rerun_failed') {
        await gh(ctx, base + '/actions/runs/' + id + '/rerun-failed-jobs', { method: 'POST' });
        return 'Rilanciati i job falliti dell\'esecuzione ' + id + '.';
      }
      if (action === 'read_run') {
        const run = await gh(ctx, base + '/actions/runs/' + id);
        const jobs = (await gh(ctx, base + '/actions/runs/' + id + '/jobs?per_page=30')).jobs;
        let out = run.name + ' · ' + run.head_branch + ' · ' + (run.status === 'completed' ? run.conclusion : run.status) + ' · ' + run.html_url;
        for (const j of jobs) {
          out += '\n\nJob «' + j.name + '»: ' + (j.status === 'completed' ? j.conclusion : j.status);
          const bad = (j.steps || []).filter((s) => s.conclusion === 'failure');
          if (bad.length) out += '\n  Passaggi falliti: ' + bad.map((s) => s.name).join('; ');
          if (j.conclusion === 'failure') {
            let detail = '';
            try {
              const log = await ghText(ctx, 'https://api.github.com' + base + '/actions/jobs/' + j.id + '/logs');
              detail = '\n  Ultime righe del log:\n' + log.split('\n').slice(-60).join('\n').slice(-3500);
            } catch (_) {
              try {
                const an = await gh(ctx, base + '/check-runs/' + j.id + '/annotations');
                if (an && an.length) detail = '\n  Errori segnalati:\n' + an.slice(0, 10).map((x) => '  - ' + oneLine(x.message, 300)).join('\n');
              } catch (_2) {}
              if (!detail) detail = '\n  (log non leggibile da qui: aprilo su ' + j.html_url + ')';
            }
            out += detail;
          }
        }
        return clip(out);
      }
      throw new Error('Azione non valida: usa list_runs, read_run, run_workflow o rerun_failed.');
    }
  });

  // ─── Esecuzione di JavaScript in ambiente isolato ─────────
  // iframe «sandbox» (origine opaca, nessun accesso ai dati dell'app) con CSP che blocca la rete,
  // dentro un Worker che si può terminare se il codice va in loop.
  function workerMain() {
    const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
    let lines = 0;
    let fileBytes = 0;
    const fmt = (a) =>
      a
        .map((x) => {
          if (typeof x === 'string') return x;
          try {
            return JSON.stringify(x, (k, v) => (typeof v === 'bigint' ? v.toString() : v));
          } catch (_) {
            return String(x);
          }
        })
        .join(' ');
    const log = (prefix) => (...a) => {
      if (++lines <= 500) postMessage({ t: 'log', line: prefix + fmt(a) });
    };
    const con = { log: log(''), info: log(''), debug: log(''), warn: log('[warn] '), error: log('[error] ') };
    const files = [];
    const saveFile = (name, content, mime) => {
      let data = content;
      if (typeof data !== 'string') {
        if (data instanceof ArrayBuffer) data = new Uint8Array(data.slice(0));
        else if (ArrayBuffer.isView(data)) data = new Uint8Array(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength));
        else data = JSON.stringify(data, null, 2);
      }
      fileBytes += typeof data === 'string' ? data.length : data.byteLength;
      if (fileBytes > 20 * 1024 * 1024) throw new Error('File troppo grandi (massimo 20 MB in totale).');
      if (files.length >= 10) throw new Error('Massimo 10 file per esecuzione.');
      files.push({ name: String(name), mime: mime ? String(mime) : '', data });
    };
    self.onmessage = async (e) => {
      try {
        const fn = new AsyncFunction('console', 'saveFile', e.data.code);
        const r = await fn(con, saveFile);
        let result;
        try {
          result = r === undefined ? undefined : JSON.stringify(r, (k, v) => (typeof v === 'bigint' ? v.toString() : v), 2);
        } catch (_) {
          result = String(r);
        }
        postMessage({ t: 'done', ok: true, result, files });
      } catch (err) {
        postMessage({ t: 'done', ok: false, error: String((err && err.message) || err), files: [] });
      }
    };
  }

  function frameMain(workerSrc) {
    let worker = null;
    window.addEventListener('message', (e) => {
      if (worker) return;
      try {
        worker = new Worker(URL.createObjectURL(new Blob([workerSrc], { type: 'text/javascript' })));
        worker.onmessage = (m) => parent.postMessage(m.data, '*');
        worker.onerror = (ev) => parent.postMessage({ t: 'done', ok: false, error: String(ev.message || 'Errore'), files: [] }, '*');
        worker.postMessage({ code: e.data.code });
      } catch (err) {
        parent.postMessage({ t: 'done', ok: false, error: 'Ambiente isolato non disponibile: ' + err.message, files: [] }, '*');
      }
    });
  }

  const SANDBOX_HTML =
    '<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; script-src \'unsafe-inline\' \'unsafe-eval\' blob:; worker-src blob:">' +
    '<script>(' + frameMain.toString() + ')(' + JSON.stringify('(' + workerMain.toString() + ')()') + ')<\/script>';

  function runSandbox(code, timeoutMs, signal) {
    return new Promise((resolve, reject) => {
      const frame = document.createElement('iframe');
      frame.setAttribute('sandbox', 'allow-scripts');
      frame.style.display = 'none';
      frame.srcdoc = SANDBOX_HTML;
      const logs = [];
      let chars = 0;
      let done = false;
      let timer = null;
      const finish = (fn, v) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        window.removeEventListener('message', onMsg);
        if (signal) signal.removeEventListener('abort', onAbort);
        frame.remove();
        fn(v);
      };
      const onMsg = (e) => {
        if (e.source !== frame.contentWindow || !e.data) return;
        if (e.data.t === 'log') {
          if (chars < 30000) {
            logs.push(String(e.data.line));
            chars += String(e.data.line).length;
          }
        } else if (e.data.t === 'done') finish(resolve, Object.assign({ logs }, e.data));
      };
      const onAbort = () => finish(reject, abortError());
      timer = setTimeout(
        () => finish(resolve, { logs, ok: false, files: [], error: 'Tempo scaduto dopo ' + timeoutMs / 1000 + ' secondi: esecuzione interrotta.' }),
        timeoutMs
      );
      window.addEventListener('message', onMsg);
      if (signal) {
        if (signal.aborted) return onAbort();
        signal.addEventListener('abort', onAbort);
      }
      frame.onload = () => frame.contentWindow.postMessage({ code }, '*');
      document.body.appendChild(frame);
    });
  }

  def('run_javascript', {
    description:
      'Esegue codice JavaScript in un ambiente isolato (senza internet, senza accesso al telefono né alla pagina) e restituisce output e risultato. ' +
      'Usalo per calcoli precisi, conversioni e analisi di dati, parsing, test di piccole funzioni, generazione di file. ' +
      'Il codice è il corpo di una funzione async: puoi usare await e «return valore». Stampa con console.log. ' +
      'Per creare un file chiama saveFile(nome, contenuto, mime): comparirà in chat con Condividi/Salva.',
    parameters: {
      type: 'object',
      properties: {
        code: { type: 'string', description: 'Codice JavaScript da eseguire (corpo di funzione).' },
        timeout_seconds: { type: 'integer', description: 'Tempo massimo in secondi (1-30, predefinito 10).' }
      },
      required: ['code']
    },
    title: (a) => 'Esegui codice JavaScript (' + str(a.code).split('\n').length + ' righe)',
    details: (a) => clip(str(a.code), 1500),
    async run(args, ctx) {
      const code = need(args, 'code');
      const secs = Math.min(30, Math.max(1, Math.floor(Number(args.timeout_seconds)) || 10));
      const t0 = Date.now();
      const r = await runSandbox(code, secs * 1000, ctx.signal);
      const out = r.logs.length ? 'Output:\n' + r.logs.join('\n') : '';
      if (!r.ok) throw new Error((r.error || 'Errore') + (out ? '\n' + out : ''));
      const files = (r.files || [])
        .map((f) => {
          const name = safeName(f.name || 'file');
          if (/\.(exe|apk|bat|cmd|msi|scr|com|dll|jar)$/i.test(name)) return null;
          const mime = f.mime || mimeFor(name);
          return { name, mime, blob: new Blob([f.data], { type: mime }) };
        })
        .filter(Boolean);
      let text = 'Eseguito in ' + (Date.now() - t0) + ' ms.' + (out ? '\n' + out : '') + (r.result !== undefined ? '\nValore restituito:\n' + r.result : '');
      if (!out && r.result === undefined && !files.length) text += '\n(nessun output: usa console.log o return per vedere un risultato)';
      return files.length ? fileResult('Codice eseguito, file creati', files, text) : text;
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
    const danger = t && (typeof t.danger === 'function' ? t.danger(args) : t.danger);
    return { title, details, danger: !!danger };
  }

  /** Esegue uno strumento. Restituisce { text, files: [{ name, mime, blob }] }. */
  async function run(name, args, ctx) {
    const t = get(name);
    if (!t) throw new Error('Strumento sconosciuto: ' + name);
    if (ctx && ctx.signal && ctx.signal.aborted) throw abortError();
    const out = await t.run(args || {}, ctx || {});
    if (out && typeof out === 'object' && typeof out.text === 'string') return { text: clip(out.text), files: out.files || [] };
    return { text: clip(out), files: [] };
  }

  global.MiaTools = { definitions, get, needsConfirm, describe, run, whoami, count: () => Object.keys(TOOLS).length };
})(window);
