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

  /** Rende interrompibile una promessa (su Android la richiesta nativa non si ferma con l'AbortSignal): al segnale fallisce subito con AbortError. */
  function raceAbort(promise, signal) {
    if (!signal) return promise;
    return new Promise((resolve, reject) => {
      const stop = () => reject(Object.assign(new Error('Interrotto'), { name: 'AbortError' }));
      if (signal.aborted) return stop();
      signal.addEventListener('abort', stop, { once: true });
      promise.then(
        (v) => {
          signal.removeEventListener('abort', stop);
          resolve(v);
        },
        (e) => {
          signal.removeEventListener('abort', stop);
          reject(e);
        }
      );
    });
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

  // ─── Limite al repository selezionato ─────────────────────
  // Con ctx.repoLock l'agente può usare GitHub SOLO sul repository scelto nelle Impostazioni (ctx.repoScope = «proprietario/nome»):
  // owner/repo omessi si completano, un altro repository viene rifiutato, la ricerca nel codice è sempre limitata a quel repository.
  const REPO_SCOPED = ['github_read_file', 'github_write_file', 'github_delete_file', 'github_create_branch', 'github_list_branches_commits', 'github_issues', 'github_pull_requests', 'github_actions', 'github_edit_file', 'github_delete_lines', 'github_compare', 'github_outline', 'github_edit_structure'];
  function applyScope(name, args, ctx) {
    if (!ctx || !ctx.repoLock || !/^github_/.test(name)) return args;
    const sel = str(ctx.repoScope).trim();
    if (!/^[\w.-]+\/[\w.-]+$/.test(sel))
      throw new Error('Nessun repository selezionato in questa chat: l\'agente usa GitHub solo sul repository scelto (riquadro «📁» sopra la casella di scrittura). Chiedi all\'utente di sceglierlo.');
    const [owner, repo] = sel.split('/');
    if (name === 'github_create_repo') throw new Error('Non consentito: l\'agente può lavorare solo sul repository selezionato (' + sel + ') e non può crearne altri.');
    if (name === 'github_list_repos') return args;
    const a = Object.assign({}, args);
    if (name === 'github_search_code') {
      a.owner = owner;
      a.repo = repo;
      return a;
    }
    if (REPO_SCOPED.includes(name)) {
      if (!str(a.owner).trim()) a.owner = owner;
      if (!str(a.repo).trim()) a.repo = repo;
      if (str(a.owner).toLowerCase() !== owner.toLowerCase() || str(a.repo).toLowerCase() !== repo.toLowerCase())
        throw new Error('Repository non consentito: «' + str(a.owner) + '/' + str(a.repo) + '». L\'agente può leggere e modificare solo il repository selezionato (' + sel + ').');
    }
    return a;
  }

  // ─── Branch di lavoro ──────────────────────────────────────
  // Con ctx.workBranch le scritture dell'agente vanno SEMPRE su quel branch (mai sul principale) e le letture
  // partono da lì; il branch si crea da solo dal principale e, se non ha commit propri, viene riallineato al principale.
  const BRANCH_WRITES = ['github_write_file', 'github_edit_file', 'github_delete_file', 'github_delete_lines', 'github_edit_structure'];
  function applyBranch(name, args, ctx) {
    const wb = ctx && str(ctx.workBranch).trim();
    if (!wb) return args;
    if (BRANCH_WRITES.includes(name)) return Object.assign({}, args, { branch: wb });
    if ((name === 'github_read_file' || name === 'github_outline') && !str(args.ref).trim()) return Object.assign({}, args, { ref: wb, _workRef: true });
    return args;
  }
  const branchReady = {};
  async function ensureWorkBranch(ctx, base, branch) {
    const key = base + '#' + branch;
    if (branchReady[key]) return;
    const repo = await gh(ctx, base);
    const main = repo.default_branch;
    if (branch === main) throw new Error('Il branch di lavoro non può essere il branch principale («' + main + '»).');
    const mainRef = await gh(ctx, base + '/git/ref/heads/' + encPath(main));
    const existing = await gh(ctx, base + '/git/ref/heads/' + encPath(branch), { allow404: true });
    if (!existing) {
      await gh(ctx, base + '/git/refs', { method: 'POST', body: { ref: 'refs/heads/' + branch, sha: mainRef.object.sha } });
    } else if (existing.object && existing.object.sha !== mainRef.object.sha) {
      // nessun commit proprio sul branch ma il principale è andato avanti (es. dopo l'unione): si riallinea, senza forzare
      const cmp = await gh(ctx, base + '/compare/' + encodeURIComponent(main) + '...' + encodeURIComponent(branch), { allow404: true });
      if (cmp && cmp.ahead_by === 0 && cmp.behind_by > 0)
        await gh(ctx, base + '/git/refs/heads/' + encPath(branch), { method: 'PATCH', body: { sha: mainRef.object.sha, force: false } });
    }
    branchReady[key] = true;
  }

  // ─── Leggere prima di scrivere ─────────────────────────────
  // ctx.readGuard attiva il controllo; ctx.readState = { read:Set, full:Set } (chiavi «owner/repo/path» in minuscolo) viene ricavato dall'app
  // dalla cronologia della chat: read = file letto (anche solo in parte o con find) o creato/modificato dal modello, full = letto per intero.
  const fileKey = (a) => (str(a.owner) + '/' + str(a.repo) + '/' + encPath(a.path)).toLowerCase();
  function needRead(ctx, args, full, what) {
    if (!ctx || !ctx.readGuard || !ctx.readState) return;
    const key = fileKey(args);
    if (full ? ctx.readState.full.has(key) : ctx.readState.read.has(key)) return;
    throw new Error(
      full
        ? 'Non ho scritto nulla: «' + str(args.path) + '» esiste già e in questa chat non l\'hai letto per intero (la lettura può essere parziale). Non sostituire il file intero: leggilo con github_read_file e cambia solo le parti necessarie con github_edit_file (o github_delete_lines).'
        : 'Non ho ' + what + ' nulla: in questa chat non hai ancora letto «' + str(args.path) + '». Leggilo prima con github_read_file (o cerca con «find» la parte da cambiare), poi riprova.'
    );
  }

  // ─── Regole sul contenuto: «quante volte compare un testo» ─
  const MUST_COUNT = {
    type: 'array',
    description:
      'Regole da rispettare (consigliate per i file di dati): dopo l\'operazione ogni «text» deve comparire «equals» volte nel file, oppure variare di «change» rispetto a prima. Se una regola non è rispettata non si salva nulla. Esempio: [{"text":"front:","equals":4012}].',
    items: {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'Testo da contare (per esempio «front:»).' },
        equals: { type: 'integer', description: 'Numero esatto di occorrenze dopo l\'operazione.' },
        change: { type: 'integer', description: 'Variazione rispetto a prima (per esempio -1003).' }
      },
      required: ['text']
    }
  };
  const countOcc = (t, s) => (s ? str(t).split(s).length - 1 : 0);
  function checkMustCount(rules, before, after, path) {
    if (!Array.isArray(rules) || !rules.length) return;
    rules.forEach((r, i) => {
      const text = str(r && r.text);
      if (!text) throw new Error('Regola ' + (i + 1) + ': «text» è vuoto.');
      const hasEq = r.equals != null && r.equals !== '';
      const hasCh = r.change != null && r.change !== '';
      if (!hasEq && !hasCh) throw new Error('Regola ' + (i + 1) + ' («' + text + '»): serve «equals» oppure «change».');
      const b = countOcc(before, text);
      const a = countOcc(after, text);
      const bad = hasEq ? a !== Number(r.equals) : a - b !== Number(r.change);
      if (bad)
        throw new Error(
          'Modifica NON salvata: la regola su «' + oneLine(text, 40) + '» non è rispettata (' + str(path) + '): prima compariva ' + b + ' volte, dopo ' + a + ' volte, ' +
            (hasEq ? 'attese ' + Number(r.equals) : 'attesa una variazione di ' + Number(r.change) + ' (è ' + (a - b) + ')') + '. Il file su GitHub non è cambiato. Controlla cosa stai cambiando.'
        );
    });
  }

  // ─── Regole del progetto (file nel repository) ─────────────
  const rulesCache = {};
  /** Legge MIA.md (o AGENTS.md, CLAUDE.md) dal branch principale del repository: regole che valgono per quel progetto. Restituisce { name, text } o null. */
  async function projectRules(ctx, sel) {
    if (!/^[\w.-]+\/[\w.-]+$/.test(str(sel)) || !ctx.token) return null;
    const hit = rulesCache[sel];
    if (hit && Date.now() - hit.t < 300000) return hit.v;
    let v = null;
    for (const name of ['MIA.md', 'AGENTS.md', 'CLAUDE.md']) {
      try {
        const d = await gh(ctx, '/repos/' + sel + '/contents/' + name, { allow404: true });
        if (d && d.content && !Array.isArray(d)) {
          v = { name, text: clip(base64ToUtf8(d.content), 4000) };
          break;
        }
      } catch (_) {
        break; // niente token valido o rete: nessuna regola, il lavoro continua
      }
    }
    rulesCache[sel] = { t: Date.now(), v };
    return v;
  }

  // ─── Controllo della sintassi (js/json) prima di salvare ──
  // Con acorn (caricato solo quando serve, vedi warmAcorn) si controllano anche i moduli (import/export) e si dà la posizione dell'errore;
  // senza acorn (non ancora caricato o caricamento fallito) resta il vecchio controllo con new Function.
  // Restituisce null se il testo è valido, il messaggio d'errore se non lo è, oppure undefined se non si può controllare.
  const JS_EXT = /^(js|cjs|mjs)$/;
  function acornOpts(type) {
    return { ecmaVersion: 'latest', sourceType: type, allowHashBang: true, allowAwaitOutsideFunction: true, allowReturnOutsideFunction: type === 'script' };
  }
  function acornMessage(err) {
    const loc = err && err.loc;
    const msg = str(err && err.message).replace(/\s*\(\d+:\d+\)\s*$/, '');
    return msg + (loc ? ' (riga ' + loc.line + ', colonna ' + (loc.column + 1) + ')' : '');
  }
  /** Analizza un file js/mjs/cjs con acorn: restituisce { ast, type } oppure lancia l'errore di acorn (quello più probabile). */
  function parseJs(text) {
    const A = global.acorn;
    const looksModule = /^\s*(import|export)\b/m.test(text);
    const order = looksModule ? ['module', 'script'] : ['script', 'module'];
    let first = null;
    for (const type of order) {
      try {
        return { ast: A.parse(text, acornOpts(type)), type };
      } catch (err) {
        if (!first) first = err;
      }
    }
    throw first;
  }
  function syntaxError(path, text) {
    const ext = (/\.([a-z0-9]+)$/i.exec(str(path)) || [])[1];
    if (!ext) return undefined;
    const e = ext.toLowerCase();
    try {
      if (e === 'json') {
        JSON.parse(text);
        return null;
      }
      if (JS_EXT.test(e)) {
        if (global.acorn && global.acorn.parse) {
          try {
            parseJs(text);
            return null;
          } catch (err) {
            if (err && err.loc) return acornMessage(err);
            return undefined;
          }
        }
        if (/^\s*(import|export)\b/m.test(text)) return undefined; // moduli: senza acorn non controllabili
        try {
          new Function(text); // solo analisi: il codice NON viene eseguito
        } catch (err) {
          if (!(err instanceof SyntaxError)) return undefined;
          const AsyncFn = Object.getPrototypeOf(async function () {}).constructor;
          new AsyncFn(text); // ammette «await» al primo livello
        }
        return null;
      }
    } catch (err) {
      if (err instanceof SyntaxError) return err.message;
      return undefined;
    }
    return undefined;
  }
  function checkSyntaxOrThrow(path, before, after) {
    const now = syntaxError(path, after);
    if (now === undefined || now === null) return '';
    const prev = before == null ? null : syntaxError(path, before);
    if (prev === null)
      throw new Error(
        'Modifica NON salvata: dopo la modifica «' + path + '» non sarebbe più valido (' + now + '). Il file su GitHub non è cambiato. ' +
          'Rileggi la zona interessata (find/start) e riprova con frammenti corretti.'
      );
    return ' Attenzione: il file non risulta valido (' + now + ')' + (prev ? ', ma non lo era nemmeno prima.' : '.');
  }
  const lineCount = (t) => (t ? str(t).split('\n').length : 0);

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
    const method = opts.method || 'GET';
    // anteprima (preview): nessuna scrittura; la scrittura che lo strumento farebbe viene «catturata» per mostrare le differenze
    if (ctx.preview && method !== 'GET') {
      if (/\/contents\//.test(path) && (method === 'PUT' || method === 'DELETE')) throw Object.assign(new Error('anteprima'), { previewSignal: { method, body: opts.body || {} } });
      throw new Error('Anteprima non disponibile per questa azione.');
    }
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
      else if (res.status === 403 || res.status === 404) {
        msg += ' (se il repository esiste, il token potrebbe non avere accesso o i permessi necessari)';
        // dettagli per capire quale permesso manca
        const h = (n) => {
          try {
            return res.headers.get(n);
          } catch (_) {
            return null;
          }
        };
        const kind = /^github_pat_/.test(ctx.token) ? 'fine-grained' : /^gh[pousr]_/.test(ctx.token) ? 'classic o altro' : 'sconosciuto';
        const needP = h('x-accepted-github-permissions');
        const scopes = h('x-oauth-scopes');
        msg += ' — richiesta: ' + (opts.method || 'GET') + ' ' + path.split('?')[0] + ' · token: ' + kind;
        if (needP) msg += ' · permessi richiesti da GitHub: ' + needP;
        if (scopes !== null && scopes !== undefined) msg += ' · scope del token: ' + (scopes || 'nessuno');
        if (data && data.documentation_url) msg += ' · guida: ' + data.documentation_url;
      }
      throw new Error(msg + ' [HTTP ' + res.status + ']');
    }
    // ogni commit fatto su un file viene comunicato all'app (serve ad «Annulla le modifiche»)
    if (ctx.onCommit && (method === 'PUT' || method === 'DELETE') && /\/contents\//.test(path)) {
      try {
        const [b, rest] = path.split('/contents/');
        const body = opts.body || {};
        ctx.onCommit({
          base: b,
          path: rest.split('?')[0].split('/').map(decodeURIComponent).join('/'),
          branch: str(body.branch),
          oldSha: body.sha || null,
          newSha: method === 'DELETE' ? null : (data && data.content && data.content.sha) || null,
          commit: (data && data.commit && data.commit.sha) || '',
          deleted: method === 'DELETE'
        });
      } catch (_) {}
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
      if (ctx.repoLock) return 'L\'agente lavora solo sul repository selezionato: ' + (str(ctx.repoScope) || '(nessuno: sceglilo in Impostazioni → GitHub)') + '.';
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
    maxResult: 45000,
    description:
      'Legge un file di testo di un repository oppure elenca il contenuto di una cartella (path vuoto = radice del repository). ' +
      'Restituisce al massimo ~12000 caratteri per volta: se il file è più lungo l\'esito dice «FILE INCOMPLETO»; leggi il resto con «start», oppure cerca una parola con «find» (restituisce le righe con il numero).',
    parameters: {
      type: 'object',
      properties: Object.assign({}, REPO_PROPS, {
        path: { type: 'string', description: 'Percorso del file o della cartella, es. «src/index.js». Vuoto per la radice.' },
        ref: { type: 'string', description: 'Branch, tag o commit (facoltativo, predefinito: branch principale).' },
        start: { type: 'integer', description: 'Carattere da cui iniziare a leggere (per i file lunghi; predefinito 0).' },
        length: { type: 'integer', description: 'Quanti caratteri leggere (500–40000, predefinito 12000).' },
        find: { type: 'string', description: 'Testo da cercare: restituisce le righe che lo contengono, con il numero di riga (senza leggere tutto il file).' }
      }),
      required: ['owner', 'repo']
    },
    title: (a) => 'Leggi ' + (str(a.path) || '/') + ' in ' + str(a.owner) + '/' + str(a.repo),
    async run(args, ctx) {
      const { base } = repoArgs(args);
      const q = args.ref ? '?ref=' + encodeURIComponent(args.ref) : '';
      let d = await gh(ctx, base + '/contents/' + encPath(args.path) + q, { allow404: !!args._workRef });
      if (!d && args._workRef) d = await gh(ctx, base + '/contents/' + encPath(args.path)); // il branch di lavoro non esiste ancora: si legge il principale
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
      const total = text.length;
      const head = 'File ' + d.path + ' (' + d.size + ' byte, ' + total + ' caratteri)';
      if (args.find) {
        const needle = str(args.find).toLowerCase();
        const lines = text.split('\n');
        const hits = [];
        lines.forEach((l, i) => l.toLowerCase().includes(needle) && hits.push('riga ' + (i + 1) + ': ' + clip(l.trim(), 200)));
        if (!hits.length) return head + '\n\nNessuna riga contiene «' + str(args.find) + '».';
        return head + ' — ' + lines.length + ' righe\n\n' + hits.slice(0, 60).join('\n') + (hits.length > 60 ? '\n[…altre ' + (hits.length - 60) + ' righe…]' : '');
      }
      const start = Math.min(Math.max(parseInt(args.start, 10) || 0, 0), total);
      const len = Math.min(Math.max(parseInt(args.length, 10) || MAX_RESULT, 500), 40000);
      let end = Math.min(start + len, total);
      if (end < total) {
        const nl = text.lastIndexOf('\n', end - 1); // si taglia a fine riga
        if (nl > start + len / 2) end = nl + 1;
      }
      let out = head + (start > 0 || end < total ? ' — MOSTRATI i caratteri ' + start + '–' + end + ' di ' + total : '') + '\n\n' + text.slice(start, end);
      if (end < total)
        out +=
          '\n\n[FILE INCOMPLETO: restano ' + (total - end) + ' caratteri. Leggi il resto con start=' + end + ' oppure cerca con «find». ' +
          'NON riscrivere questo file con github_write_file (perderesti la parte che non hai letto): per cambiarlo usa github_edit_file.]';
      return out;
    }
  });

  // 4 — crea o modifica file
  def('github_write_file', {
    description:
      'Crea un nuovo file o sostituisce per intero il contenuto di un file esistente, con un commit. ' +
      'Per cambiare poche righe di un file esistente usa invece github_edit_file. Sostituisci un file per intero solo se lo hai letto TUTTO (se la lettura dice «FILE INCOMPLETO» non farlo): ' +
      'se il nuovo contenuto è molto più corto dell\'originale l\'utente dovrà confermare di nuovo.',
    write: true,
    parameters: {
      type: 'object',
      properties: Object.assign({}, REPO_PROPS, {
        path: { type: 'string', description: 'Percorso del file, es. «docs/guida.md».' },
        content: { type: 'string', description: 'Contenuto COMPLETO del file.' },
        must_count: MUST_COUNT,
        message: { type: 'string', description: 'Messaggio del commit.' },
        branch: { type: 'string', description: 'Branch di destinazione (facoltativo, predefinito: branch principale).' }
      }),
      required: ['owner', 'repo', 'path', 'content', 'message']
    },
    title: (a) => 'Scrivi «' + str(a.path) + '» in ' + str(a.owner) + '/' + str(a.repo) + (a.branch ? ' (branch ' + a.branch + ')' : ''),
    details: (a) => 'Commit: ' + str(a.message) + (a.branch ? '\nBranch: ' + a.branch : '') + '\nNuovo contenuto: ' + lineCount(a.content) + ' righe, ' + str(a.content).length + ' caratteri\n\n' + clip(str(a.content), 1200),
    async run(args, ctx) {
      const { base } = repoArgs(args);
      const path = need(args, 'path');
      const message = need(args, 'message');
      if (typeof args.content !== 'string') throw new Error('Parametro mancante: «content».');
      if (ctx.workBranch && args.branch === ctx.workBranch) await ensureWorkBranch(ctx, base, args.branch);
      const refQ = args.branch ? '?ref=' + encodeURIComponent(args.branch) : '';
      const url = base + '/contents/' + encPath(path);
      const existing = await gh(ctx, url + refQ, { allow404: true });
      if (existing && Array.isArray(existing)) throw new Error('«' + path + '» è una cartella, non un file.');
      let oldText = null;
      if (existing && existing.content) {
        try {
          oldText = base64ToUtf8(existing.content);
        } catch (_) {}
      }
      if (existing && existing.sha) needRead(ctx, Object.assign({}, args, { path }), true);
      checkMustCount(args.must_count, oldText || '', args.content, path);
      await warmAcorn();
      const note = checkSyntaxOrThrow(path, oldText, args.content);
      // protezione: un file esistente che si riduce di molto di solito è una riscrittura parziale (il modello ha letto solo l'inizio):
      // si chiede all'utente una seconda conferma, con le dimensioni, e senza conferma non si scrive.
      if (existing && existing.content) {
        let oldLen = 0;
        try {
          oldLen = base64ToUtf8(existing.content).length;
        } catch (_) {}
        const newLen = args.content.length;
        if (oldLen > 2000 && newLen < oldLen * 0.5) {
          const ok = ctx.confirm
            ? await ctx.confirm({
                title: 'ATTENZIONE: «' + path + '» passa da ' + oldLen + ' a ' + newLen + ' caratteri (−' + Math.round(100 - (newLen * 100) / oldLen) + '%)',
                details: 'Il file esistente verrebbe SOSTITUITO da uno molto più corto: se non te l\'aspetti, rifiuta. Il vecchio contenuto resta comunque nella cronologia di GitHub.',
                danger: true
              })
            : false;
          if (!ok)
            throw new Error(
              'Scrittura annullata: «' + path + '» passerebbe da ' + oldLen + ' a ' + newLen + ' caratteri (sembra una riscrittura parziale). ' +
                'Non riscrivere il file: leggilo per intero (start/find) e cambia solo le parti necessarie con github_edit_file.'
            );
        }
      }
      const body = { message, content: utf8ToBase64(args.content) };
      if (args.branch) body.branch = args.branch;
      if (existing && existing.sha) body.sha = existing.sha;
      const r = await gh(ctx, url, { method: 'PUT', body });
      return (
        (existing ? 'File aggiornato: ' : 'File creato: ') + path + (args.branch ? ' (branch ' + args.branch + ')' : '') + ' — commit ' + short(r.commit && r.commit.sha) +
        ' — righe: ' + (oldText != null ? lineCount(oldText) + ' → ' : '') + lineCount(args.content) + '.' + note + ' — ' + (r.content && r.content.html_url)
      );
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
      if (ctx.workBranch && args.branch === ctx.workBranch) await ensureWorkBranch(ctx, base, args.branch);
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
      'Note personali salvate sul telefono: «save» (salva o aggiorna una nota per titolo), «list» (elenco), «read» (legge per titolo), «delete» (elimina per titolo), «search» (cerca parole nel titolo e nel testo di tutte le note).',
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['save', 'list', 'read', 'delete', 'search'], description: 'Azione da eseguire.' },
        query: { type: 'string', description: 'Parole da cercare nei titoli e nei testi delle note (per search).' },
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
      if (a.action === 'search') return 'Cerca «' + str(a.query) + '» nelle note';
      return 'Elenca le note';
    },
    async run(args) {
      const list = loadNotes();
      const find = (t) => list.findIndex((n) => n.title.toLowerCase() === str(t).trim().toLowerCase());
      if (args.action === 'list') {
        if (!list.length) return 'Nessuna nota.';
        return list.map((n) => '• ' + n.title + ' (' + new Date(n.updated).toLocaleDateString('it-IT') + ')').join('\n');
      }
      if (args.action === 'search') {
        const words = need(args, 'query').toLowerCase().split(/\s+/).filter(Boolean);
        const hits = list.filter((n) => words.every((w) => (n.title + '\n' + n.text).toLowerCase().includes(w)));
        if (!hits.length) return 'Nessuna nota contiene «' + str(args.query) + '».';
        return hits.map((n) => '• ' + n.title + ': ' + clip(str(n.text).replace(/\s+/g, ' ').slice(0, 160))).join('\n');
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
      throw new Error('Azione non valida: usa save, list, read, delete o search.');
    }
  });

  // ─── Ricerca nelle chat e Memoria ─────────────────────────
  def('search_chats', {
    description: 'Cerca parole nelle conversazioni salvate sul dispositivo (titoli, messaggi, nomi degli allegati). Restituisce titolo, data e un estratto.',
    parameters: { type: 'object', properties: { query: { type: 'string', description: 'Parole da cercare (devono comparire tutte).' } }, required: ['query'] },
    title: (a) => 'Cerca «' + str(a.query) + '» nelle chat',
    async run(args, ctx) {
      const found = ctx.searchChats ? ctx.searchChats(need(args, 'query')) : [];
      if (!found.length) return 'Nessuna chat contiene «' + str(args.query) + '».';
      return found.map((r) => '• ' + r.title + ' (' + new Date(r.updated).toLocaleDateString('it-IT') + ')' + (r.snippet ? ': ' + r.snippet : '')).join('\n');
    }
  });

  def('memory', {
    description:
      'Memoria personale dell\'utente (fatti stabili: nome, preferenze, progetti), aggiunta a ogni conversazione. «add» aggiunge una riga, «list» la elenca, «remove» toglie le righe che contengono il testo dato. Salva solo ciò che l\'utente chiede di ricordare o che è chiaramente stabile; mai password o dati sensibili.',
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['add', 'list', 'remove'], description: 'Azione da eseguire.' },
        text: { type: 'string', description: 'Il fatto da ricordare (add) o parte del testo da togliere (remove).' }
      },
      required: ['action']
    },
    write: (a) => a.action === 'add' || a.action === 'remove',
    title: (a) => (a.action === 'add' ? 'Ricorda: «' + str(a.text) + '»' : a.action === 'remove' ? 'Dimentica: «' + str(a.text) + '»' : 'Mostra la memoria'),
    async run(args, ctx) {
      if (!ctx.getMemory) throw new Error('Memoria non disponibile.');
      const lines = ctx.getMemory().split('\n').map((l) => l.trim()).filter(Boolean);
      if (args.action === 'list') return lines.length ? lines.map((l) => '• ' + l).join('\n') : 'La memoria è vuota.';
      const text = need(args, 'text').trim().replace(/\s*\n\s*/g, ' ');
      if (args.action === 'add') {
        if (lines.some((l) => l.toLowerCase() === text.toLowerCase())) return 'Già in memoria: ' + text;
        if (lines.join('\n').length + text.length > 3800) throw new Error('Memoria piena: togli qualche riga prima.');
        lines.push(text);
        ctx.setMemory(lines.join('\n'));
        return 'Ricordato: ' + text;
      }
      if (args.action === 'remove') {
        const keep = lines.filter((l) => !l.toLowerCase().includes(text.toLowerCase()));
        if (keep.length === lines.length) return 'Nessuna riga contiene «' + text + '».';
        ctx.setMemory(keep.join('\n'));
        return 'Tolte ' + (lines.length - keep.length) + ' righe dalla memoria.';
      }
      throw new Error('Azione non valida: usa add, list o remove.');
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
  /** Carica acorn (analizzatore di JavaScript) se serve; se non si riesce a caricare si continua senza (vecchio controllo). */
  async function warmAcorn() {
    try {
      if (!global.acorn) await loadScript('js/vendor/acorn.js');
    } catch (_) {}
    return global.acorn || null;
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
  /** Riconosce png/jpeg/webp dai primi byte di un'immagine in base64. */
  function sniffImage(b64) {
    let head = '';
    try {
      head = atob(String(b64).slice(0, 24));
    } catch (_) {}
    if (head.startsWith('\x89PNG')) return 'image/png';
    if (head.startsWith('\xff\xd8')) return 'image/jpeg';
    if (head.startsWith('RIFF') && head.slice(8, 12) === 'WEBP') return 'image/webp';
    return 'image/png';
  }

  async function geminiImage(prompt, ctx) {
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
      if (res.status === 429 || /quota|limit/i.test(m)) hint = ' Il piano gratuito potrebbe non includere la generazione di immagini o aver raggiunto il limite.';
      else if (res.status === 404 || /not found|not supported/i.test(m)) hint = ' Controlla il nome del «Modello immagini» in Impostazioni.';
      throw new Error('Gemini: ' + m + ' [HTTP ' + res.status + ']' + hint);
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
      throw new Error('Gemini non ha restituito un\'immagine' + (why ? ' (' + why + ')' : '') + (text ? ': ' + oneLine(text, 200) : '') + '.');
    }
    return { data: img.data, mime: img.mime, note: text ? 'Nota del modello: ' + oneLine(text, 300) : '', who: 'Gemini' };
  }

  // FLUX.1 schnell sul servizio ospitato da NVIDIA. Schema ufficiale (build.nvidia.com → API Reference): la richiesta accetta SOLO
  // prompt (richiesto, max 10000), width e height (768…1344 a passi di 64), steps (1-4), cfg_scale, mode, samples; non esiste «seed»
  // e ogni altro campo dà 422. Risposta: { artifacts: [{ base64 (JPEG), finishReason: SUCCESS | ERROR | CONTENT_FILTERED }] }.
  // Per sicurezza si accettano anche altre forme di risposta e si tolgono da soli i campi che il servizio dovesse rifiutare.
  async function nvidiaImage(prompt, ctx, size) {
    // modelli scelti nelle Impostazioni: schnell (veloce, 1-4 passi) o dev (più dettagliato, 5-100 passi). Stesso schema di richiesta.
    const dev = ctx.nvidiaImageModel === 'flux.1-dev';
    const url = 'https://ai.api.nvidia.com/v1/genai/black-forest-labs/' + (dev ? 'flux.1-dev' : 'flux.1-schnell');
    const post = async (body) => {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json', Authorization: 'Bearer ' + ctx.nvidiaKey },
        body: JSON.stringify(body),
        signal: ctx.signal
      });
      let data = null;
      try {
        data = await res.json();
      } catch (_) {}
      return { res, data };
    };
    // Il servizio convalida la richiesta e rifiuta i campi che non conosce (422 «extra_forbidden»): si leggono dall'errore
    // i campi opzionali che non vanno bene e si riprova senza, fino a 5 volte. Il testo («prompt») non si tocca mai.
    // FLUX.1-dev: la pagina ufficiale elenca 768…1344 ma nel testo scrive «solo 1024»: se il formato non va, il ciclo qui sotto toglie width/height (si usa 1024×1024)
    const body = { prompt: prompt.slice(0, 10000), width: size[0], height: size[1], steps: dev ? 30 : 4 };
    let res;
    let data;
    for (let i = 0; i < 5; i++) {
      ({ res, data } = await post(body));
      if (res.status !== 422) break;
      const list = Array.isArray(data) ? data : data && Array.isArray(data.detail) ? data.detail : data && Array.isArray(data.errors) ? data.errors : [];
      const bad = [];
      list.forEach((e) => {
        const f = e && Array.isArray(e.loc) ? e.loc[e.loc.length - 1] : null;
        if (typeof f === 'string' && f !== 'prompt' && Object.prototype.hasOwnProperty.call(body, f)) bad.push(f);
      });
      if (!bad.length) break;
      bad.forEach((f) => delete body[f]);
      if (bad.includes('width') || bad.includes('height')) {
        delete body.width; // il formato è una coppia: o tutti e due o nessuno (si usa 1024×1024)
        delete body.height;
      }
    }
    if (!res.ok) {
      let m = '';
      if (data) {
        const arr = Array.isArray(data) ? data : Array.isArray(data.detail) ? data.detail : null;
        if (arr) m = arr.map((e) => (e && e.loc ? e.loc.join('.') + ': ' : '') + ((e && (e.msg || e.message)) || JSON.stringify(e))).join('; ');
        else m = data.detail || data.message || data.title || (data.error && (data.error.message || data.error)) || '';
      }
      if (typeof m !== 'string') m = JSON.stringify(m);
      const st = res.status;
      let hint = '';
      if (st === 401 || st === 403) hint = ' La chiave NVIDIA non è valida o non ha accesso a questo modello.';
      else if (st === 402 || /credit|quota|billing|payment/i.test(m)) hint = ' I crediti gratuiti NVIDIA potrebbero essere finiti: controlla il saldo su build.nvidia.com.';
      else if (st === 429) hint = ' Troppe richieste: riprova tra poco.';
      else if (st === 404) hint = ' Il servizio immagini non risulta disponibile per questa chiave.';
      throw new Error('NVIDIA FLUX: ' + (m ? oneLine(m, 240) : 'errore') + ' [HTTP ' + st + ']' + hint);
    }
    const d = data || {};
    const first = (Array.isArray(d.artifacts) && d.artifacts[0]) || (Array.isArray(d.images) && d.images[0]) || (Array.isArray(d.data) && d.data[0]) || d;
    const why = first && typeof first === 'object' && (first.finishReason || first.finish_reason);
    if (why && !/^(success|stop)$/i.test(String(why)))
      throw new Error(
        'NVIDIA FLUX: immagine non generata (' + why + ')' +
          (/FILTER/i.test(String(why)) ? ': il testo potrebbe essere stato bloccato dai filtri del servizio.' : ': errore del servizio, riprova.')
      );
    let b64 = typeof first === 'string' ? first : first.base64 || first.b64_json || first.image || first.b64 || d.image || d.base64 || '';
    if (typeof b64 === 'string') b64 = b64.replace(/^data:image\/[a-z]+;base64,/i, '');
    if (!b64 || typeof b64 !== 'string') throw new Error('NVIDIA FLUX: risposta senza immagine (campi ricevuti: ' + Object.keys(d).join(', ').slice(0, 120) + ').');
    return { data: b64, mime: sniffImage(b64), note: '', who: dev ? 'NVIDIA FLUX.1 dev' : 'NVIDIA FLUX.1 schnell' };
  }

  // OCR di NVIDIA (nemoretriever-ocr, servizio di prova). Richiesta dalla pagina del modello su build.nvidia.com:
  // POST https://ai.api.nvidia.com/v1/cv/nvidia/nemoretriever-ocr con { input: [{ type: 'image_url', url: 'data:image/…;base64,…' }] };
  // l'immagine in base64 deve stare sotto i 180000 caratteri. La forma della risposta NON è documentata per il servizio ospitato:
  // si leggono le forme note (data[].content, text_detections[].text_prediction.text, text).
  function ocrTextOf(d) {
    const texts = [];
    const fromDetections = (list) => {
      (list || []).forEach((t) => {
        const s = t && ((t.text_prediction && t.text_prediction.text) || t.text || t.content);
        if (typeof s === 'string' && s.trim()) texts.push(s.trim());
      });
    };
    if (d && Array.isArray(d.text_detections)) fromDetections(d.text_detections);
    (d && Array.isArray(d.data) ? d.data : []).forEach((it) => {
      if (!it) return;
      if (Array.isArray(it.text_detections)) return fromDetections(it.text_detections);
      let c = it.content != null ? it.content : it.text;
      if (typeof c === 'string') {
        try {
          const j = JSON.parse(c);
          if (j && Array.isArray(j.text_detections)) return fromDetections(j.text_detections);
        } catch (_) {}
        if (c.trim()) texts.push(c.trim());
      }
    });
    if (!texts.length && d && typeof d.text === 'string' && d.text.trim()) texts.push(d.text.trim());
    return texts.join('\n');
  }

  /** items: [{ page, dataUrl }] → testo con «[Pagina N]». Una pagina che non riesce si segnala senza fermare le altre. */
  async function ocrImages(items, ctx) {
    if (!ctx.nvidiaKey) throw new Error('Manca la chiave NVIDIA (Impostazioni → provider NVIDIA).');
    const parts = [];
    let failed = 0;
    let firstError = '';
    for (const it of items) {
      try {
        const res = await fetch('https://ai.api.nvidia.com/v1/cv/nvidia/nemoretriever-ocr', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json', Authorization: 'Bearer ' + ctx.nvidiaKey },
          body: JSON.stringify({ input: [{ type: 'image_url', url: it.dataUrl }] }),
          signal: ctx.signal
        });
        let data = null;
        try {
          data = await res.json();
        } catch (_) {}
        if (!res.ok) {
          const st = res.status;
          const m = data && (data.detail || data.message || data.title);
          throw new Error(
            'OCR NVIDIA [HTTP ' + st + ']' + (m ? ': ' + oneLine(typeof m === 'string' ? m : JSON.stringify(m), 160) : '') +
              (st === 401 || st === 403 ? ' — la chiave NVIDIA non è valida o non ha accesso a questo modello.' : st === 402 || st === 429 ? ' — crediti finiti o troppe richieste.' : '')
          );
        }
        const t = ocrTextOf(data);
        if (t) parts.push('[Pagina ' + it.page + ']\n' + t);
      } catch (e) {
        if (e && e.name === 'AbortError') throw e;
        failed++;
        if (!firstError) firstError = (e && e.message) || 'errore';
        if (failed >= 2 && !parts.length) break; // non insistere se i primi tentativi falliscono
      }
    }
    if (!parts.length) throw new Error(firstError || 'L\'OCR non ha riconosciuto testo.');
    return { text: parts.join('\n\n'), failed };
  }

  // Pollinations: gratuito e senza chiave (progetto di comunità, nessuna garanzia di disponibilità).
  // Dal browser l'indirizzo può non permettere la lettura (CORS): con ctx.allowLink si restituisce allora il solo link, che l'<img> sa mostrare.
  async function pollinationsImage(prompt, ctx, size) {
    const url =
      'https://image.pollinations.ai/prompt/' +
      encodeURIComponent(prompt.slice(0, 900)) +
      '?width=' + size[0] + '&height=' + size[1] + '&nologo=true&model=flux&seed=' +
      Math.floor(Math.random() * 1e9);
    let res;
    try {
      res = await fetch(url, { signal: ctx.signal });
    } catch (e) {
      if (e && e.name === 'AbortError') throw e;
      if (ctx.allowLink) return { url, mime: 'image/jpeg', note: 'Immagine mostrata come collegamento (non salvabile da qui).', who: 'Pollinations' };
      throw new Error('Pollinations non raggiungibile da qui (rete, o regole CORS del browser).');
    }
    if (!res.ok) {
      if (res.status === 429) throw new Error('Pollinations: troppe richieste, riprova tra qualche secondo [HTTP 429]');
      throw new Error('Pollinations: errore [HTTP ' + res.status + ']');
    }
    const blob = await res.blob();
    if (!/^image\//.test(blob.type) || blob.size < 200) throw new Error('Pollinations non ha restituito un\'immagine.');
    return { blob, mime: blob.type, note: '', who: 'Pollinations (FLUX)' };
  }

  def('generate_image', {
    description:
      'Genera con l\'intelligenza artificiale una foto o un\'illustrazione a partire da una descrizione (NVIDIA FLUX.1 schnell, Gemini o Pollinations, secondo le impostazioni). ' +
      'Scrivi la descrizione in inglese per risultati migliori. Per loghi, schemi e grafici precisi è meglio create_svg.',
    parameters: {
      type: 'object',
      properties: {
        prompt: { type: 'string', description: 'Descrizione dettagliata dell\'immagine da creare (stile, soggetto, colori, inquadratura).' },
        filename: { type: 'string', description: 'Nome del file senza estensione (facoltativo).' },
        aspect: { type: 'string', enum: ['square', 'landscape', 'portrait'], description: 'Formato: square (1024x1024, predefinito), landscape (orizzontale 1344x768) o portrait (verticale 768x1344).' }
      },
      required: ['prompt']
    },
    title: (a) => 'Genera un\'immagine: «' + oneLine(a.prompt, 80) + '»',
    async run(args, ctx) {
      const prompt = need(args, 'prompt');
      const SIZES = { square: [1024, 1024], landscape: [1344, 768], portrait: [768, 1344] }; // risoluzioni supportate da FLUX (NVIDIA)
      const size = SIZES[args.aspect] || SIZES.square;
      const choice = ctx.imageProvider || 'auto';
      const order = ['nvidia', 'gemini', 'pollinations'].includes(choice) ? [choice] : ['nvidia', 'gemini', 'pollinations'];
      const usable = order.filter((k) => (k === 'nvidia' ? ctx.nvidiaKey : k === 'gemini' ? ctx.geminiKey : true));
      if (!usable.length) {
        throw new Error(choice === 'nvidia' ? 'Serve la chiave NVIDIA: inseriscila in Impostazioni (provider NVIDIA).' : 'Serve la chiave Gemini: inseriscila in Impostazioni (provider Google Gemini).');
      }
      let img = null;
      const failures = [];
      for (const k of usable) {
        try {
          img = await (k === 'nvidia' ? nvidiaImage : k === 'gemini' ? geminiImage : pollinationsImage)(prompt, ctx, size);
          break;
        } catch (e) {
          if (e && e.name === 'AbortError') throw e;
          failures.push((e && e.message) || String(e));
        }
      }
      if (!img) throw new Error(failures.join(' | '));
      const first = failures.length ? 'Il primo servizio ha fallito (' + oneLine(failures[0], 120) + '): ho usato ' + img.who + '.' : 'Creata con ' + img.who + '.';
      if (img.url) return { text: 'Immagine generata con ' + img.who + ' (solo collegamento). ' + first, files: [], imageUrl: img.url };
      const ext = /jpe?g/i.test(img.mime) ? 'jpg' : /webp/i.test(img.mime) ? 'webp' : 'png';
      const name = safeName(str(args.filename).trim() || 'immagine-' + new Date().toISOString().slice(0, 16).replace(/[-:T]/g, ''), ext);
      const blob = img.blob || base64ToBlob(img.data, img.mime);
      return fileResult('Immagine generata', [{ name, mime: img.mime, blob }], [img.note, first].filter(Boolean).join(' '));
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
      '«run_workflow» (avvia un workflow su un branch), «rerun_failed» (rilancia i job falliti), «branch_status» (esito dei test e dei build sull\'ultimo commit di un branch: di serie il branch di lavoro; usalo a fine lavoro prima di proporre la pull request).',
    parameters: {
      type: 'object',
      properties: Object.assign({}, REPO_PROPS, {
        action: { type: 'string', enum: ['list_runs', 'read_run', 'run_workflow', 'rerun_failed', 'branch_status'], description: 'Azione da eseguire.' },
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
      if (a.action === 'branch_status') return 'Controlla i test del branch ' + (str(a.ref) || 'di lavoro') + ' in ' + r;
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
      if (action === 'branch_status') {
        let br = str(args.ref).trim() || str(ctx.workBranch).trim();
        if (!br) br = (await gh(ctx, base)).default_branch;
        const ref = await gh(ctx, base + '/git/ref/heads/' + encPath(br), { allow404: true });
        if (!ref) return 'Il branch «' + br + '» non esiste ancora (nessuna modifica è stata fatta).';
        const sha = ref.object.sha;
        const d = await gh(ctx, base + '/actions/runs?head_sha=' + sha + '&per_page=20');
        const runs = d.workflow_runs || [];
        if (!runs.length)
          return 'Branch «' + br + '», commit ' + short(sha) + ': nessun test o build risulta avviato per questo commit. Se il repository ha dei workflow potrebbero non partire sui branch (controlla i trigger) oppure essere ancora in coda: riprova tra poco. Non dire che i test sono passati.';
        const line = (r) => '  ' + r.name + ' · ' + (r.status === 'completed' ? r.conclusion : r.status) + ' · id ' + r.id;
        const running = runs.filter((r) => r.status !== 'completed');
        const failed = runs.filter((r) => r.status === 'completed' && !['success', 'skipped', 'neutral'].includes(r.conclusion));
        const verdict = running.length ? 'ANCORA IN CORSO: aspetta e riprova prima di dire il risultato.' : failed.length ? 'FALLITI: leggi gli errori con read_run e correggi, oppure dillo all\'utente.' : 'Tutti passati.';
        return 'Branch «' + br + '», commit ' + short(sha) + ': ' + verdict + '\n' + runs.map(line).join('\n');
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
      throw new Error('Azione non valida: usa list_runs, read_run, run_workflow, rerun_failed o branch_status.');
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
      try {
        if (!worker) {
          worker = new Worker(URL.createObjectURL(new Blob([workerSrc], { type: 'text/javascript' })));
          worker.onmessage = (m) => parent.postMessage(m.data, '*');
          worker.onerror = (ev) => parent.postMessage({ t: 'done', id: e.data && e.data.id, ok: false, error: String(ev.message || 'Errore'), files: [] }, '*');
        }
        worker.postMessage(e.data);
      } catch (err) {
        parent.postMessage({ t: 'done', id: e.data && e.data.id, ok: false, error: 'Ambiente isolato non disponibile: ' + err.message, files: [] }, '*');
      }
    });
  }

  function sandboxHtml(csp, workerSrc) {
    return (
      '<!doctype html><meta http-equiv="Content-Security-Policy" content="' + csp + '">' +
      '<script>(' + frameMain.toString() + ')(' + JSON.stringify(workerSrc) + ')<\/script>'
    );
  }

  const SANDBOX_HTML = sandboxHtml(
    "default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval' blob:; worker-src blob:",
    '(' + workerMain.toString() + ')()'
  );

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

  // ─── Esecuzione di Python (Pyodide) in ambiente isolato ───
  const PY_BASE = (global.MIA_PYODIDE_BASE) || 'https://cdn.jsdelivr.net/pyodide/v314.0.8/full/';

  function pyWorkerMain(base) {
    let py = null;
    async function init() {
      importScripts(base + 'pyodide.js');
      py = await loadPyodide({ indexURL: base });
      py.setStdout({ batched: (s) => postMessage({ t: 'log', line: s }) });
      py.setStderr({ batched: (s) => postMessage({ t: 'log', line: '[stderr] ' + s }) });
      py.runPython("import os\nos.environ['MPLBACKEND'] = 'AGG'\nos.makedirs('/out', exist_ok=True)");
    }
    self.onmessage = async (e) => {
      const id = e.data.id;
      try {
        if (!py) await init();
        await py.loadPackagesFromImports(e.data.code);
        py.runPython("import os, shutil\nshutil.rmtree('/out', ignore_errors=True)\nos.makedirs('/out', exist_ok=True)");
        const r = await py.runPythonAsync(e.data.code);
        let result;
        if (r !== undefined && r !== null) {
          result = String(r);
          if (r.destroy) r.destroy();
        }
        const files = [];
        for (const n of py.FS.readdir('/out')) {
          if (n === '.' || n === '..') continue;
          try {
            files.push({ name: n, data: py.FS.readFile('/out/' + n) });
          } catch (_) {}
        }
        postMessage({ t: 'done', id, ok: true, result, files });
      } catch (err) {
        let msg = String((err && err.message) || err);
        const at = msg.indexOf('File "<exec>"'); // mostra solo il codice dell'utente, non le righe interne di Pyodide
        if (at >= 0) msg = 'Traceback (most recent call last):\n  ' + msg.slice(at);
        postMessage({ t: 'done', id, ok: false, error: msg.slice(-2000), files: [] });
      }
    };
  }

  const PY_HTML = sandboxHtml(
    "default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval' blob: https://cdn.jsdelivr.net; worker-src blob:; connect-src https://cdn.jsdelivr.net",
    '(' + pyWorkerMain.toString() + ')(' + JSON.stringify(PY_BASE) + ')'
  );

  let pySess = null; // sessione Python riutilizzata tra le esecuzioni (le variabili restano); si chiude dopo 5 min di inattività
  let pyNext = 1;

  function pyKill() {
    if (!pySess) return;
    clearTimeout(pySess.idle);
    pySess.frame.remove();
    pySess = null;
  }

  function pyRun(code, timeoutMs, signal) {
    if (!pySess) {
      const frame = document.createElement('iframe');
      frame.setAttribute('sandbox', 'allow-scripts');
      frame.style.display = 'none';
      frame.srcdoc = PY_HTML;
      pySess = { frame, idle: null, ready: new Promise((res) => (frame.onload = res)) };
      document.body.appendChild(frame);
    }
    const s = pySess;
    clearTimeout(s.idle);
    return new Promise((resolve, reject) => {
      const id = pyNext++;
      const logs = [];
      let chars = 0;
      let done = false;
      let timer = null;
      const finish = (fn, v, kill) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        window.removeEventListener('message', onMsg);
        if (signal) signal.removeEventListener('abort', onAbort);
        if (kill) pyKill();
        else s.idle = setTimeout(pyKill, 5 * 60 * 1000);
        fn(v);
      };
      const onMsg = (e) => {
        if (e.source !== s.frame.contentWindow || !e.data) return;
        if (e.data.t === 'log') {
          if (chars < 30000) {
            logs.push(String(e.data.line));
            chars += String(e.data.line).length;
          }
        } else if (e.data.t === 'done' && e.data.id === id) finish(resolve, Object.assign({ logs }, e.data));
      };
      const onAbort = () => finish(reject, abortError(), true);
      timer = setTimeout(
        () => finish(resolve, { logs, ok: false, files: [], error: 'Tempo scaduto dopo ' + timeoutMs / 1000 + ' secondi: Python interrotto (le variabili sono andate perse).' }, true),
        timeoutMs
      );
      window.addEventListener('message', onMsg);
      if (signal) {
        if (signal.aborted) return onAbort();
        signal.addEventListener('abort', onAbort);
      }
      s.ready.then(() => s.frame.contentWindow && s.frame.contentWindow.postMessage({ id, code }, '*'));
    });
  }

  def('run_python', {
    description:
      'Esegue codice Python (Pyodide, Python 3 nel telefono) in un ambiente isolato, senza internet. Utile per analisi di dati, statistica, grafici, elaborazione di testi e file. ' +
      'Librerie come numpy, pandas, matplotlib, scipy si caricano da sole con import (la prima volta serve qualche decina di secondi e di MB). ' +
      'Stampa con print(); l\'ultima espressione viene restituita. Per creare file salvali nella cartella /out/ (es. plt.savefig("/out/grafico.png"), df.to_csv("/out/dati.csv")): ' +
      'compariranno in chat con Condividi/Salva. Le variabili restano tra un\'esecuzione e l\'altra finché la sessione è attiva.',
    parameters: {
      type: 'object',
      properties: {
        code: { type: 'string', description: 'Codice Python da eseguire.' },
        timeout_seconds: { type: 'integer', description: 'Tempo massimo in secondi (5-180, predefinito 90; la prima esecuzione include il caricamento).' }
      },
      required: ['code']
    },
    title: (a) => 'Esegui codice Python (' + str(a.code).split('\n').length + ' righe)',
    async run(args, ctx) {
      const code = need(args, 'code');
      const secs = Math.min(180, Math.max(5, Math.floor(Number(args.timeout_seconds)) || 90));
      const t0 = Date.now();
      const r = await pyRun(code, secs * 1000, ctx.signal);
      const out = r.logs.length ? 'Output:\n' + r.logs.join('\n') : '';
      if (!r.ok) throw new Error((r.error || 'Errore') + (out ? '\n' + out : ''));
      const files = (r.files || [])
        .map((f) => {
          const name = safeName(f.name);
          if (/\.(exe|apk|bat|cmd|msi|scr|com|dll|jar)$/i.test(name)) return null;
          return { name, mime: mimeFor(name), blob: new Blob([f.data], { type: mimeFor(name) }) };
        })
        .filter(Boolean);
      let text = 'Eseguito in ' + Math.round((Date.now() - t0) / 100) / 10 + ' s.' + (out ? '\n' + out : '') + (r.result !== undefined ? '\nValore restituito:\n' + r.result : '');
      if (!out && r.result === undefined && !files.length) text += '\n(nessun output: usa print() oppure scrivi un\'espressione alla fine)';
      return files.length ? fileResult('Python eseguito, file creati', files, text) : text;
    }
  });

  // ─── Modifica precisa di un file GitHub ────────────────────
  // 22 — github_edit_file
  // Confronto tra due branch (o di un file tra due branch): solo lettura. Serve a controllare il lavoro: file cambiati, righe, conteggi.
  def('github_compare', {
    description:
      'Confronta (sola lettura) il branch di lavoro con il principale. Senza «path» elenca i file cambiati (con righe aggiunte e tolte); con «path» confronta quel file nei due branch (righe, caratteri) e conta quante volte compaiono i testi indicati in «count» (per esempio «front:» per contare le carte). ' +
      'Usalo alla fine di un lavoro per controllare che i numeri siano quelli attesi.',
    parameters: {
      type: 'object',
      properties: Object.assign({}, REPO_PROPS, {
        path: { type: 'string', description: 'File da confrontare (facoltativo: senza, si elencano i file cambiati).' },
        base: { type: 'string', description: 'Branch di riferimento (facoltativo, predefinito: principale).' },
        head: { type: 'string', description: 'Branch da controllare (facoltativo, predefinito: branch di lavoro).' },
        count: { type: 'array', items: { type: 'string' }, description: 'Testi da contare nel file nei due branch (con path).' }
      }),
      required: ['owner', 'repo']
    },
    title: (a) => 'Confronta ' + (str(a.path) ? '«' + str(a.path) + '»' : 'i branch') + ' in ' + str(a.owner) + '/' + str(a.repo),
    async run(args, ctx) {
      const { base: api } = repoArgs(args);
      const repo = await gh(ctx, api);
      const baseB = str(args.base).trim() || repo.default_branch;
      const headB = str(args.head).trim() || str(ctx.workBranch).trim() || repo.default_branch;
      if (baseB === headB) return 'Base e head sono lo stesso branch («' + baseB + '»): non c\'è niente da confrontare.';
      if (!str(args.path).trim()) {
        const d = await gh(ctx, api + '/compare/' + encodeURIComponent(baseB) + '...' + encodeURIComponent(headB), { allow404: true });
        if (!d) return 'Il branch «' + headB + '» non esiste ancora (nessuna modifica è stata fatta).';
        const files = d.files || [];
        if (!files.length) return 'Nessuna differenza tra «' + baseB + '» e «' + headB + '» (' + (d.ahead_by || 0) + ' commit avanti, ' + (d.behind_by || 0) + ' indietro).';
        const add = files.reduce((s, f) => s + (f.additions || 0), 0);
        const del = files.reduce((s, f) => s + (f.deletions || 0), 0);
        return (
          '«' + headB + '» rispetto a «' + baseB + '»: ' + (d.ahead_by || 0) + ' commit avanti, ' + (d.behind_by || 0) + ' indietro; ' + files.length + ' file cambiati (+' + add + ' −' + del + ' righe)\n' +
          files.slice(0, 60).map((f) => '  ' + f.status + ' ' + f.filename + ' (+' + (f.additions || 0) + ' −' + (f.deletions || 0) + ')').join('\n') + (files.length > 60 ? '\n  […altri ' + (files.length - 60) + ' file…]' : '')
        );
      }
      const path = need(args, 'path');
      const get = async (ref) => {
        const f = await gh(ctx, api + '/contents/' + encPath(path) + '?ref=' + encodeURIComponent(ref), { allow404: true });
        if (!f || Array.isArray(f) || !f.content) return null;
        return base64ToUtf8(f.content);
      };
      const [a, b] = [await get(baseB), await get(headB)];
      if (a == null && b == null) return '«' + path + '» non esiste né in «' + baseB + '» né in «' + headB + '» (o è troppo grande per essere letto).';
      const stat = (t) => (t == null ? 'non esiste' : lineCount(t) + ' righe, ' + t.length + ' caratteri');
      let out = '«' + path + '»\n  ' + baseB + ': ' + stat(a) + '\n  ' + headB + ': ' + stat(b);
      if (a != null && b != null) out += '\n  differenza: ' + (lineCount(b) - lineCount(a) >= 0 ? '+' : '') + (lineCount(b) - lineCount(a)) + ' righe, ' + (b.length - a.length >= 0 ? '+' : '') + (b.length - a.length) + ' caratteri' + (a === b ? ' (file identico)' : '');
      (Array.isArray(args.count) ? args.count : []).slice(0, 10).forEach((t) => {
        const x = str(t);
        if (x) out += '\n  «' + oneLine(x, 40) + '» compare: ' + baseB + ' ' + (a == null ? '—' : countOcc(a, x)) + ' volte → ' + headB + ' ' + (b == null ? '—' : countOcc(b, x)) + ' volte';
      });
      return out;
    }
  });

  // Cancella un intervallo di righe (per togliere blocchi lunghi, come un mazzo di carte, senza far riscrivere al modello centinaia di righe).
  // Protezioni: servono il testo atteso della prima e dell'ultima riga (letti prima con find/start), con «dry_run» si vedono i bordi
  // dell'intervallo senza scrivere, il controllo della sintassi vale come per le altre modifiche, e dal 20 righe in su la conferma è rossa.
  def('github_delete_lines', {
    description:
      'Cancella le righe da «from_line» a «to_line» (comprese, numerate da 1 come in github_read_file con «find») di un file di GitHub, senza riscrivere il resto. ' +
      'Prima cerca con «find» le righe di inizio e fine, poi chiama con dry_run=true per vedere i bordi dell\'intervallo, poi chiama senza dry_run. ' +
      '«expect_first» e «expect_last» sono pezzi di testo che devono comparire nella prima e nell\'ultima riga da cancellare: se non corrispondono non si cancella nulla. ' +
      'Dopo una cancellazione i numeri di riga cambiano: rifai la ricerca prima della cancellazione successiva.',
    write: (a) => !a.dry_run,
    danger: (a) => !a.dry_run && Number(a.to_line) - Number(a.from_line) + 1 >= 20,
    parameters: {
      type: 'object',
      properties: Object.assign({}, REPO_PROPS, {
        path: { type: 'string', description: 'Percorso del file.' },
        from_line: { type: 'integer', description: 'Prima riga da cancellare (da 1).' },
        to_line: { type: 'integer', description: 'Ultima riga da cancellare (compresa).' },
        expect_first: { type: 'string', description: 'Testo che deve comparire nella riga from_line (copialo da github_read_file).' },
        expect_last: { type: 'string', description: 'Testo che deve comparire nella riga to_line.' },
        dry_run: { type: 'boolean', description: 'Se true non scrive nulla: mostra solo le righe ai bordi dell\'intervallo.' },
        must_count: MUST_COUNT,
        message: { type: 'string', description: 'Messaggio del commit (non serve con dry_run).' },
        branch: { type: 'string', description: 'Branch (facoltativo).' }
      }),
      required: ['owner', 'repo', 'path', 'from_line', 'to_line', 'expect_first', 'expect_last']
    },
    title: (a) => {
      const n = Number(a.to_line) - Number(a.from_line) + 1;
      return (a.dry_run ? 'Controlla le righe ' : n >= 20 ? 'ATTENZIONE: cancella ' + n + ' righe — ' : 'Cancella le righe ') + str(a.from_line) + '–' + str(a.to_line) + ' di «' + str(a.path) + '» in ' + str(a.owner) + '/' + str(a.repo);
    },
    details: (a) =>
      'Commit: ' + str(a.message) + (a.branch ? '\nBranch: ' + a.branch : '') + '\nRighe: −' + (Number(a.to_line) - Number(a.from_line) + 1) + ' / +0' +
      '\n\nPrima riga: ' + clip(str(a.expect_first), 120) + '\nUltima riga: ' + clip(str(a.expect_last), 120) + '\n(il testo viene verificato prima di cancellare)',
    async run(args, ctx) {
      const { base } = repoArgs(args);
      const path = need(args, 'path');
      const from = parseInt(args.from_line, 10);
      const to = parseInt(args.to_line, 10);
      if (!(from >= 1) || !(to >= from)) throw new Error('Intervallo non valido: from_line e to_line devono essere numeri da 1 e to_line ≥ from_line.');
      if (to - from + 1 > 5000) throw new Error('Troppe righe in una volta (massimo 5000): fai più cancellazioni.');
      const efirst = need(args, 'expect_first');
      const elast = need(args, 'expect_last');
      const dry = !!args.dry_run;
      if (!dry) needRead(ctx, args, false, 'cancellato');
      const message = dry ? '' : need(args, 'message');
      if (!dry && ctx.workBranch && args.branch === ctx.workBranch) await ensureWorkBranch(ctx, base, args.branch);
      let file = await gh(ctx, base + '/contents/' + encPath(path) + (args.branch ? '?ref=' + encodeURIComponent(args.branch) : ''), { allow404: dry && !!args.branch });
      if (!file && dry) file = await gh(ctx, base + '/contents/' + encPath(path)); // il branch di lavoro non esiste ancora: si guarda il principale
      if (Array.isArray(file) || file.type !== 'file' || !file.content) throw new Error('«' + path + '» non è un file di testo leggibile.');
      const original = base64ToUtf8(file.content);
      if (original.includes('\u0000')) throw new Error('File binario: non modificabile.');
      const lines = original.split('\n');
      if (to > lines.length) throw new Error('Il file ha ' + lines.length + ' righe: to_line (' + to + ') è oltre la fine.');
      const show = (a, b) => lines.slice(a - 1, b).map((l, k) => String(a + k).padStart(6) + ' | ' + clip(l, 160)).join('\n');
      const norm = (t) => str(t).replace(/\s+/g, ' ').trim().toLowerCase();
      const okFirst = norm(lines[from - 1]).includes(norm(efirst));
      const okLast = norm(lines[to - 1]).includes(norm(elast));
      const borders = 'Primo bordo (righe ' + Math.max(1, from - 2) + '–' + Math.min(lines.length, from + 2) + '):\n' + show(Math.max(1, from - 2), Math.min(lines.length, from + 2)) +
        '\nUltimo bordo (righe ' + Math.max(1, to - 2) + '–' + Math.min(lines.length, to + 2) + '):\n' + show(Math.max(1, to - 2), Math.min(lines.length, to + 2));
      if (!okFirst || !okLast)
        throw new Error(
          'Righe diverse da quelle attese: ' + (okFirst ? '' : 'la riga ' + from + ' non contiene «' + clip(efirst, 80) + '». ') + (okLast ? '' : 'la riga ' + to + ' non contiene «' + clip(elast, 80) + '». ') +
            'Non ho cancellato nulla. Rifai la ricerca con find (i numeri cambiano dopo ogni cancellazione).\n' + borders
        );
      const n = to - from + 1;
      if (dry) return 'Controllo riuscito: le righe ' + from + '–' + to + ' (' + n + ' righe) corrispondono a quanto atteso. Il file ha ' + lines.length + ' righe. Non ho scritto nulla.\n' + borders;
      const next = lines.slice(0, from - 1).concat(lines.slice(to)).join('\n');
      checkMustCount(args.must_count, original, next, path);
      await warmAcorn();
      const note = checkSyntaxOrThrow(path, original, next);
      const body = { message, content: utf8ToBase64(next), sha: file.sha };
      if (args.branch) body.branch = args.branch;
      const r = await gh(ctx, base + '/contents/' + encPath(path), { method: 'PUT', body });
      const after = next.split('\n');
      const c0 = Math.max(1, from - 3);
      const c1 = Math.min(after.length, from + 2);
      return (
        'Cancellate ' + n + ' righe (' + from + '–' + to + ') di ' + path + (args.branch ? ' (branch ' + args.branch + ')' : '') + ' — righe ' + lines.length + ' → ' + after.length +
        ' — commit ' + short(r.commit && r.commit.sha) + '.' + note + '\nCosì com\'è ora intorno al punto (righe ' + c0 + '–' + c1 + '):\n' +
        after.slice(c0 - 1, c1).map((l, k) => String(c0 + k).padStart(6) + ' | ' + clip(l, 160)).join('\n') + '\nI numeri di riga sono cambiati: rifai la ricerca prima di un\'altra cancellazione.'
      );
    }
  });

  // ─── Mappa del file e modifiche sulla struttura (con acorn) ─
  // github_outline: elenco di funzioni, classi, variabili, elementi di array e chiavi di oggetto con i numeri di riga, senza leggere il file intero.
  // github_edit_structure: toglie/aggiunge un elemento di un array o una proprietà, o toglie una dichiarazione, trovandola dal sintassi (non dal testo).
  const ID_KEYS = ['id', 'name', 'key', 'slug', 'code', 'title', 'label'];
  function lineIndex(text) {
    const a = [0];
    for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) a.push(i + 1);
    return a;
  }
  function lineAt(idx, off) {
    let lo = 0;
    let hi = idx.length - 1;
    while (lo < hi) {
      const m = (lo + hi + 1) >> 1;
      if (idx[m] <= off) lo = m;
      else hi = m - 1;
    }
    return lo + 1;
  }
  const propKey = (p) => (p.computed ? undefined : p.key.type === 'Identifier' ? p.key.name : p.key.value);
  function litValue(n) {
    if (!n) return undefined;
    if (n.type === 'Literal') return n.value;
    if (n.type === 'TemplateLiteral' && !n.expressions.length) return n.quasis[0].value.cooked;
    if (n.type === 'UnaryExpression' && n.operator === '-' && n.argument.type === 'Literal' && typeof n.argument.value === 'number') return -n.argument.value;
    return undefined;
  }
  /** Analizza js/mjs/cjs o json. Restituisce { kind, text, body?, root? }. */
  function parseStruct(path, text) {
    const A = global.acorn;
    if (!A || !A.parse) throw new Error('Il controllo della struttura non è disponibile (libreria acorn non caricata).');
    const e = ((/\.([a-z0-9]+)$/i.exec(str(path)) || [])[1] || '').toLowerCase();
    try {
      if (e === 'json') {
        const root = A.parseExpressionAt(text, 0, { ecmaVersion: 'latest' });
        if (text.slice(root.end).trim()) throw Object.assign(new SyntaxError('Testo dopo la fine del JSON'), { loc: null });
        return { kind: 'json', text, root };
      }
      if (JS_EXT.test(e)) return { kind: 'js', text, body: parseJs(text).ast.body };
    } catch (err) {
      throw new Error('Impossibile analizzare «' + str(path) + '»: ' + (err && err.loc ? acornMessage(err) : str(err && err.message)) + '.');
    }
    throw new Error('Struttura disponibile solo per file .js, .mjs, .cjs e .json (questo è «' + str(path) + '»).');
  }
  function iifeFn(e) {
    if (!e) return null;
    if (e.type === 'UnaryExpression') return iifeFn(e.argument);
    if (e.type === 'CallExpression') {
      let c = e.callee;
      if (c.type === 'MemberExpression' && c.property && /^(call|apply)$/.test(c.property.name)) c = c.object;
      if (c.type === 'FunctionExpression' || c.type === 'ArrowFunctionExpression') return c;
    }
    return null;
  }
  /** Istruzioni di primo livello (anche dentro una funzione richiamata subito, come «(function(){…})()»). */
  function topStatements(body, depth, out) {
    out = out || [];
    (body || []).forEach((st) => {
      let node = st;
      if ((st.type === 'ExportNamedDeclaration' || st.type === 'ExportDefaultDeclaration') && st.declaration) node = st.declaration;
      out.push({ node, stmt: st, depth: depth || 0 });
      if (st.type === 'ExpressionStatement') {
        const f = iifeFn(st.expression);
        if (f && f.body && f.body.type === 'BlockStatement') topStatements(f.body.body, (depth || 0) + 1, out);
      }
    });
    return out;
  }
  function elemLabel(el, text) {
    if (!el) return '(vuoto)';
    if (el.type === 'ObjectExpression') {
      const props = el.properties.filter((p) => p.type === 'Property');
      for (const k of ID_KEYS) {
        const p = props.find((x) => propKey(x) === k && litValue(x.value) !== undefined);
        if (p) return k + '=' + oneLine(String(litValue(p.value)), 50);
      }
      const p = props.find((x) => litValue(x.value) !== undefined);
      if (p) return str(propKey(p)) + '=' + oneLine(String(litValue(p.value)), 50);
      return 'oggetto';
    }
    const v = litValue(el);
    return v !== undefined ? oneLine(JSON.stringify(v), 60) : oneLine(text.slice(el.start, el.end), 60);
  }
  function fnHead(n, text, name) {
    const ps = n.params || [];
    const p = ps.length ? oneLine(text.slice(ps[0].start, ps[ps.length - 1].end), 60) : '';
    return (n.async ? 'async ' : '') + (n.type === 'ArrowFunctionExpression' ? '(' + p + ') =>' : 'function ' + (name || '') + '(' + p + ')');
  }
  function outlineJs(body, text, idx, o) {
    const out = [];
    const L = (n) => {
      const a = lineAt(idx, n.start);
      const b = lineAt(idx, n.end);
      return (a === b ? String(a) : a + '–' + b).padStart(11) + '  ';
    };
    const cap = o.maxItems;
    const lists = (items, ind, label, make) => {
      const n = items.length;
      const show = n > cap ? items.slice(0, Math.ceil(cap / 2)).map((x, i) => [x, i]).concat([[null, -1]], items.slice(n - Math.floor(cap / 2)).map((x, i) => [x, n - Math.floor(cap / 2) + i])) : items.map((x, i) => [x, i]);
      show.forEach(([x, i]) => {
        if (!x) out.push(' '.repeat(11) + '  ' + ind + '  […' + (n - cap) + ' ' + label + ' non mostrati: cerca con find o usa max_items…]');
        else out.push(L(x) + ind + '  ' + make(x, i));
      });
    };
    const value = (name, v, ind) => {
      if (!v) return name;
      if (v.type === 'ArrayExpression') {
        const els = v.elements.filter(Boolean);
        return { head: name + ' = [' + els.length + ' elementi]', kids: () => lists(els, ind, 'elementi', (x, i) => '[' + i + '] ' + elemLabel(x, text)) };
      }
      if (v.type === 'ObjectExpression') {
        const ps = v.properties.filter((p) => p.type === 'Property');
        return {
          head: name + ' = {' + ps.length + ' chiavi}',
          kids: () =>
            lists(ps, ind, 'chiavi', (p) => {
              const k = propKey(p);
              const pv = p.value;
              const t = pv.type === 'FunctionExpression' || pv.type === 'ArrowFunctionExpression' ? fnHead(pv, text, '') : pv.type === 'ArrayExpression' ? '[' + pv.elements.length + ']' : pv.type === 'ObjectExpression' ? '{…}' : oneLine(text.slice(pv.start, pv.end), 40);
              return str(k) + ': ' + t;
            })
        };
      }
      if (v.type === 'FunctionExpression' || v.type === 'ArrowFunctionExpression') return name + ' = ' + fnHead(v, text, '');
      if (v.type === 'ClassExpression') return name + ' = class';
      if (v.type === 'CallExpression') return name + ' = ' + oneLine(text.slice(v.callee.start, v.callee.end), 40) + '(…)';
      return name + ' = ' + oneLine(text.slice(v.start, v.end), 40);
    };
    topStatements(body, 0).forEach((it) => {
      const n = it.node;
      const ind = '  '.repeat(it.depth);
      const emit = (r, where) => {
        const e = typeof r === 'string' ? { head: r } : r;
        if (o.symbol && !e.head.toLowerCase().includes(o.symbol)) return;
        out.push(L(where) + ind + e.head);
        if (e.kids && (o.symbol || it.depth <= 1)) e.kids();
      };
      if (n.type === 'FunctionDeclaration') emit(fnHead(n, text, n.id && n.id.name), it.stmt);
      else if (n.type === 'ClassDeclaration') {
        emit('class ' + (n.id ? n.id.name : '(anonima)'), it.stmt);
        if (!o.symbol || (n.id && n.id.name.toLowerCase().includes(o.symbol)))
          n.body.body.forEach((m) => out.push(L(m) + ind + '  ' + (m.static ? 'static ' : '') + (m.kind && m.kind !== 'method' ? m.kind + ' ' : '') + str(m.key && (m.key.name || m.key.value)) + (m.value && m.value.params ? '(' + m.value.params.length + ' parametri)' : '')));
      } else if (n.type === 'VariableDeclaration') n.declarations.forEach((d) => emit(value(n.kind + ' ' + (d.id.type === 'Identifier' ? d.id.name : '{destrutturazione}'), d.init, ind), n.declarations.length === 1 ? it.stmt : d));
      else if (it.stmt.type === 'ExpressionStatement') {
        const e = it.stmt.expression;
        if (e.type === 'AssignmentExpression') emit(value(oneLine(text.slice(e.left.start, e.left.end), 50) || '(radice)', e.right, ind), it.stmt);
        else if (e.type === 'CallExpression' && e.arguments[0] && litValue(e.arguments[0]) !== undefined && typeof litValue(e.arguments[0]) === 'string' && !iifeFn(e))
          emit(oneLine(text.slice(e.callee.start, e.callee.end), 30) + '(' + JSON.stringify(litValue(e.arguments[0])) + ', …)', it.stmt);
      }
    });
    return out;
  }
  function outlineMd(text) {
    const out = [];
    let fence = false;
    text.split('\n').forEach((l, i) => {
      if (/^\s*(```|~~~)/.test(l)) fence = !fence;
      else if (!fence && /^#{1,6}\s/.test(l)) out.push(String(i + 1).padStart(11) + '  ' + l.trim());
    });
    return out;
  }

  /** Cerca nell'albero il valore indicato da «nome» o «nome.chiave.chiave» (variabile, assegnazione, «default» o la radice di un json). */
  function findTarget(parsed, name) {
    const text = parsed.text;
    const parts = str(name).trim().split('.').filter(Boolean);
    if (parsed.kind === 'json') {
      let node = parsed.root;
      parts.filter((p) => p !== '$' && p !== 'root').forEach((p) => (node = descend(node, p, name)));
      return node;
    }
    if (!parts.length) throw new Error('Manca il nome (target).');
    const items = topStatements(parsed.body, 0);
    const names = [];
    let node = null;
    let used = 1;
    for (const it of items) {
      const n = it.node;
      if (n.type === 'VariableDeclaration') {
        n.declarations.forEach((d) => {
          if (d.id.type === 'Identifier') {
            names.push(d.id.name);
            if (!node && d.id.name === parts[0] && d.init) node = d.init;
          }
        });
      } else if (it.stmt.type === 'ExpressionStatement' && it.stmt.expression.type === 'AssignmentExpression') {
        const e = it.stmt.expression;
        const left = text.slice(e.left.start, e.left.end);
        names.push(left);
        // «window.DECKS = [...]» si indica con «window.DECKS» oppure solo «DECKS»
        for (let k = parts.length; k >= 1 && !node; k--) {
          const cand = parts.slice(0, k).join('.');
          if (left === cand || left.endsWith('.' + cand)) {
            node = e.right;
            used = k;
          }
        }
      } else if (it.stmt.type === 'ExportDefaultDeclaration' && parts[0] === 'default' && !node) node = n;
    }
    if (!node) throw new Error('Non trovo «' + parts[0] + '» tra le dichiarazioni di primo livello. Trovate: ' + (names.slice(0, 40).join(', ') || '(nessuna)') + '. Usa github_outline per vedere la mappa.');
    parts.slice(used).forEach((p) => (node = descend(node, p, name)));
    return node;
  }
  function descend(node, key, full) {
    if (!node || node.type !== 'ObjectExpression') throw new Error('«' + str(full) + '»: prima di «' + key + '» non c\'è un oggetto.');
    const p = node.properties.find((x) => x.type === 'Property' && propKey(x) === key);
    if (!p) throw new Error('«' + str(full) + '»: la chiave «' + key + '» non esiste (chiavi: ' + node.properties.map((x) => str(propKey(x))).slice(0, 30).join(', ') + ').');
    return p.value;
  }
  function matchEl(el, match, text) {
    if (match !== null && typeof match === 'object') {
      if (!el || el.type !== 'ObjectExpression') return false;
      const keys = Object.keys(match);
      if (!keys.length) return false;
      return keys.every((k) => {
        const p = el.properties.find((x) => x.type === 'Property' && propKey(x) === k);
        const v = p && litValue(p.value);
        return v !== undefined && String(v) === String(match[k]);
      });
    }
    const v = litValue(el);
    return v !== undefined && String(v) === String(match);
  }
  /** Tolta l'elemento i da una lista (array o proprietà di un oggetto): via anche la virgola, il resto non si tocca. */
  function removeFromList(text, items, i) {
    let a;
    let b;
    if (items.length === 1) {
      a = items[0].start;
      b = items[0].end;
      const m = /^\s*,/.exec(text.slice(b));
      if (m) b += m[0].length;
    } else if (i < items.length - 1) {
      a = items[i].start;
      b = items[i + 1].start;
    } else {
      a = items[i - 1].end;
      b = items[i].end;
    }
    return { a, b, text: text.slice(0, a) + text.slice(b) };
  }
  function indentOf(text, off) {
    const ls = text.lastIndexOf('\n', off - 1) + 1;
    const m = /^[ \t]*/.exec(text.slice(ls, off));
    return m ? m[0] : '';
  }
  function insertInList(text, arr, items, afterIdx, element) {
    // afterIdx: -1 = all'inizio, altrimenti dopo l'elemento con quell'indice
    if (!items.length) return { at: arr.start + 1, text: text.slice(0, arr.start + 1) + element + text.slice(arr.end - 1) , replaced: arr.end - 1 };
    const multi = /\n/.test(text.slice(arr.start, items[0].start));
    const ind = indentOf(text, items[Math.max(0, afterIdx)].start);
    if (afterIdx < 0) {
      const at = items[0].start;
      return { at, text: text.slice(0, at) + element + ',' + (multi ? '\n' + ind : ' ') + text.slice(at) };
    }
    const it = items[afterIdx];
    const m = /^(\s*),/.exec(text.slice(it.end, arr.end));
    if (afterIdx < items.length - 1 || m) {
      const at = it.end + (m ? m[0].length : 0);
      return { at, text: text.slice(0, at) + (multi ? '\n' + ind : ' ') + element + ',' + text.slice(at) };
    }
    return { at: it.end, text: text.slice(0, it.end) + ',' + (multi ? '\n' + ind : ' ') + element + text.slice(it.end) };
  }

  /** Applica una operazione e restituisce { text, report }. «path» serve a rianalizzare il testo dopo ogni passo. */
  function applyStructOp(path, text, op, k) {
    const idx = lineIndex(text);
    const parsed = parseStruct(path, text);
    const kind = str(op && op.op);
    const lbl = 'Operazione ' + (k + 1) + ' (' + kind + '): ';
    try {
      if (kind === 'remove_element' || kind === 'remove_property') {
        const arr = findTarget(parsed, op.target);
        const isArr = arr.type === 'ArrayExpression';
        if (kind === 'remove_element' && !isArr) throw new Error('«' + str(op.target) + '» non è un array.');
        if (kind === 'remove_property' && arr.type !== 'ObjectExpression') throw new Error('«' + str(op.target) + '» non è un oggetto.');
        const items = isArr ? arr.elements.filter(Boolean) : arr.properties.filter((p) => p.type === 'Property' || p.type === 'SpreadElement');
        let hits;
        if (isArr) {
          if (op.match === undefined || op.match === null || op.match === '') throw new Error('Manca «match» (per esempio {"id":"de"}).');
          hits = items.map((x, i) => i).filter((i) => matchEl(items[i], op.match, text));
        } else {
          if (!str(op.key)) throw new Error('Manca «key» (nome della proprietà da togliere).');
          hits = items.map((x, i) => i).filter((i) => items[i].type === 'Property' && String(propKey(items[i])) === str(op.key));
        }
        const exp = op.expect_matches != null && op.expect_matches !== '' ? Number(op.expect_matches) : op.all ? null : 1;
        if (!hits.length) throw new Error('Nessun elemento corrisponde a ' + JSON.stringify(isArr ? op.match : op.key) + '. Elementi presenti: ' + items.slice(0, 15).map((x) => elemLabel(x.type === 'Property' ? x.key && { type: 'Literal', value: propKey(x), start: x.start, end: x.end } : x, text)).join(', ') + (items.length > 15 ? ', … (' + items.length + ' in tutto)' : '') + '.');
        if (exp !== null && hits.length !== exp) throw new Error('Corrispondono ' + hits.length + ' elementi, attesi ' + exp + ' (se vuoi toglierli tutti passa all=true o expect_matches). Righe: ' + hits.map((i) => lineAt(idx, items[i].start)).join(', ') + '.');
        if (hits.length > 200) throw new Error('Troppi elementi (' + hits.length + '): massimo 200 per operazione.');
        // si toglie dall'ultimo al primo: gli indici dei precedenti non cambiano
        let cur = text;
        const lines = hits.map((i) => lineAt(idx, items[i].start) + '–' + lineAt(idx, items[i].end) + ' ' + elemLabel(items[i], text));
        for (let n = hits.length - 1; n >= 0; n--) {
          const itemsNow = n === hits.length - 1 ? items : null;
          if (itemsNow) cur = removeFromList(cur, items, hits[n]).text;
          else {
            const p2 = parseStruct(path, cur);
            const t2 = findTarget(p2, op.target);
            const l2 = isArr ? t2.elements.filter(Boolean) : t2.properties.filter((p) => p.type === 'Property' || p.type === 'SpreadElement');
            cur = removeFromList(cur, l2, hits[n]).text;
          }
        }
        return { text: cur, report: lbl + 'tolti ' + hits.length + ' elementi da «' + str(op.target) + '» (' + items.length + ' → ' + (items.length - hits.length) + '):\n   righe ' + lines.join('\n   righe ') };
      }
      if (kind === 'add_element') {
        const arr = findTarget(parsed, op.target);
        if (arr.type !== 'ArrayExpression') throw new Error('«' + str(op.target) + '» non è un array.');
        const el = str(op.element).trim();
        if (!el) throw new Error('Manca «element» (il testo del nuovo elemento).');
        let elNode;
        try {
          elNode = global.acorn.parseExpressionAt('(' + el + ')', 0, { ecmaVersion: 'latest' });
        } catch (err) {
          throw new Error('Il nuovo elemento non è valido: ' + (err && err.loc ? acornMessage(err) : str(err && err.message)));
        }
        const items = arr.elements.filter(Boolean);
        const inner = elNode.type === 'ParenthesizedExpression' ? elNode.expression : elNode;
        if (inner.type === 'ObjectExpression') {
          const dupKey = ID_KEYS.find((kk) => inner.properties.some((p) => p.type === 'Property' && propKey(p) === kk && litValue(p.value) !== undefined));
          if (dupKey) {
            const val = litValue(inner.properties.find((p) => propKey(p) === dupKey).value);
            if (items.some((x) => matchEl(x, { [dupKey]: val }, text))) throw new Error('Esiste già un elemento con ' + dupKey + '=' + val + ': non aggiungo un doppione (toglilo prima, se vuoi sostituirlo).');
          }
        }
        let afterIdx = items.length - 1;
        const pos = op.position;
        if (pos === 'start') afterIdx = -1;
        else if (pos && typeof pos === 'object' && pos.after !== undefined) {
          afterIdx = items.findIndex((x) => matchEl(x, pos.after, text));
          if (afterIdx < 0) throw new Error('Non trovo l\'elemento dopo cui inserire (' + JSON.stringify(pos.after) + ').');
        } else if (pos && pos !== 'end') throw new Error('«position» deve essere «start», «end» oppure {"after": {…}}.');
        const r = insertInList(text, arr, items, afterIdx, el);
        const at = lineAt(idx, r.at);
        const nt = r.replaced !== undefined ? text.slice(0, arr.start + 1) + el + text.slice(arr.end - 1) : r.text;
        return { text: nt, report: lbl + 'aggiunto un elemento a «' + str(op.target) + '» (' + items.length + ' → ' + (items.length + 1) + ') alla riga ' + at + ' circa.' };
      }
      if (kind === 'remove_declaration') {
        const name = str(op.name).trim();
        if (!name) throw new Error('Manca «name».');
        const cands = topStatements(parsed.body, 0).filter((it) => {
          const n = it.node;
          if ((n.type === 'FunctionDeclaration' || n.type === 'ClassDeclaration') && n.id && n.id.name === name) return true;
          return n.type === 'VariableDeclaration' && n.declarations.some((d) => d.id.type === 'Identifier' && d.id.name === name);
        });
        if (!cands.length) throw new Error('Non trovo una funzione, classe o variabile «' + name + '» di primo livello. Usa github_outline.');
        if (cands.length > 1) throw new Error('«' + name + '» compare ' + cands.length + ' volte (righe ' + cands.map((c) => lineAt(idx, c.stmt.start)).join(', ') + '): non so quale togliere.');
        const it = cands[0];
        if (it.node.type === 'VariableDeclaration' && it.node.declarations.length > 1) throw new Error('«' + name + '» è dichiarata insieme ad altre variabili nella stessa istruzione: usa github_edit_file.');
        let a = it.stmt.start;
        let b = it.stmt.end;
        const ls = text.lastIndexOf('\n', a - 1) + 1;
        if (!text.slice(ls, a).trim()) a = ls;
        const m = /^[ \t]*\r?\n/.exec(text.slice(b));
        if (m) b += m[0].length;
        return { text: text.slice(0, a) + text.slice(b), report: lbl + 'tolta «' + name + '» (righe ' + lineAt(idx, it.stmt.start) + '–' + lineAt(idx, it.stmt.end) + ').' };
      }
    } catch (err) {
      throw new Error(lbl + str(err && err.message));
    }
    throw new Error(lbl + 'operazione sconosciuta. Valide: remove_element, remove_property, add_element, remove_declaration.');
  }

  const OP_DOC =
    'Operazioni (applicate in ordine; il file viene rianalizzato dopo ognuna): ' +
    '{"op":"remove_element","target":"DECKS","match":{"id":"de"}} toglie l\'elemento dell\'array «target» con quelle proprietà (deve corrisponderne uno solo, salvo all=true o expect_matches=N); ' +
    '{"op":"add_element","target":"DECKS","element":"{id:\\"fr\\", …}","position":"end"|"start"|{"after":{"id":"de"}}} aggiunge un elemento (testo esatto); ' +
    '{"op":"remove_property","target":"CONFIG","key":"vecchia"} toglie una proprietà da un oggetto; ' +
    '{"op":"remove_declaration","name":"vecchiaFunzione"} toglie una funzione, classe o variabile di primo livello. ' +
    '«target» può essere un percorso come «window.DECKS» o «DATA.mazzi». Per un file .json la radice è «$».';

  def('github_outline', {
    description:
      'Mappa di un file di GitHub (sola lettura): funzioni, classi, variabili, elementi di array (con id/nome) e chiavi di oggetto con i numeri di riga — per i file .js/.mjs/.cjs/.json; titoli per i .md. ' +
      'Usala PRIMA di leggere o modificare un file lungo: ti dice dov\'è ogni cosa senza doverlo rileggere tutto (poi leggi solo il pezzo che serve con github_read_file, start o find). ' +
      'Con «symbol» mostra solo ciò che contiene quel nome, con tutti gli elementi.',
    parameters: {
      type: 'object',
      properties: Object.assign({}, REPO_PROPS, {
        path: { type: 'string', description: 'Percorso del file.' },
        symbol: { type: 'string', description: 'Facoltativo: mostra solo le voci con questo nome (per esempio «DECKS»), con tutti i loro elementi.' },
        max_items: { type: 'integer', description: 'Elementi mostrati per array/oggetto (da 5 a 500, predefinito 40; oltre, si vedono i primi e gli ultimi).' },
        ref: { type: 'string', description: 'Branch o commit (facoltativo).' }
      }),
      required: ['owner', 'repo', 'path']
    },
    title: (a) => 'Mappa di «' + str(a.path) + '» in ' + str(a.owner) + '/' + str(a.repo),
    maxResult: 30000,
    async run(args, ctx) {
      const { base } = repoArgs(args);
      const path = need(args, 'path');
      const q = args.ref ? '?ref=' + encodeURIComponent(args.ref) : '';
      let d = await gh(ctx, base + '/contents/' + encPath(path) + q, { allow404: !!args._workRef });
      if (!d && args._workRef) d = await gh(ctx, base + '/contents/' + encPath(path));
      if (Array.isArray(d)) throw new Error('«' + path + '» è una cartella: elenca i file con github_read_file.');
      if (d.type !== 'file' || !d.content) throw new Error('File troppo grande o non leggibile via API (' + d.size + ' byte).');
      const text = base64ToUtf8(d.content);
      const idx = lineIndex(text);
      const e = ((/\.([a-z0-9]+)$/i.exec(path) || [])[1] || '').toLowerCase();
      const head = '«' + path + '» — ' + idx.length + ' righe, ' + text.length + ' caratteri';
      const opts = { symbol: str(args.symbol).trim().toLowerCase(), maxItems: args.symbol ? 500 : Math.min(Math.max(parseInt(args.max_items, 10) || 40, 5), 500) };
      if (args.max_items && args.symbol) opts.maxItems = Math.min(Math.max(parseInt(args.max_items, 10) || 500, 5), 500);
      let lines;
      if (e === 'md' || e === 'markdown') lines = outlineMd(text);
      else {
        await warmAcorn();
        const p = parseStruct(path, text);
        if (p.kind === 'json') {
          const dummy = [{ type: 'ExpressionStatement', start: p.root.start, end: p.root.end, expression: { type: 'AssignmentExpression', left: { start: p.root.start, end: p.root.start }, right: p.root } }];
          lines = outlineJs(dummy, text, idx, opts).map((l) => l.replace(/ = /, ' = '));
        } else lines = outlineJs(p.body, text, idx, opts);
      }
      if (!lines.length) return head + '\nNessuna voce trovata' + (opts.symbol ? ' con «' + args.symbol + '»' : '') + '.';
      const cut = lines.length > 500;
      return head + (d.sha ? '' : '') + '\n(riga di inizio–fine, voce; numeri come in github_read_file con «find»)\n' + lines.slice(0, 500).join('\n') + (cut ? '\n[…altre ' + (lines.length - 500) + ' voci: usa «symbol»…]' : '');
    }
  });

  def('github_edit_structure', {
    description:
      'Modifica un file .js/.mjs/.cjs/.json sulla STRUTTURA (con l\'analisi del codice), senza riscrivere o ricopiare il testo: toglie o aggiunge un elemento di un array (per esempio un mazzo), toglie una proprietà o una funzione/variabile. ' +
      'Più sicuro delle cancellazioni per righe: trova da solo dove inizia e finisce l\'elemento, toglie anche la virgola e controlla la sintassi. ' +
      'Prima usa github_outline, poi chiama con dry_run=true (non scrive e non chiede conferma) per vedere cosa toglieresti, poi senza dry_run. ' + OP_DOC,
    write: (a) => !a.dry_run,
    danger: (a) => !a.dry_run && (Array.isArray(a.operations) ? a.operations : []).some((o) => o && (o.op === 'remove_declaration' || o.all)),
    parameters: {
      type: 'object',
      properties: Object.assign({}, REPO_PROPS, {
        path: { type: 'string', description: 'Percorso del file.' },
        operations: {
          type: 'array',
          description: 'Elenco delle operazioni (vedi la descrizione dello strumento).',
          items: {
            type: 'object',
            properties: {
              op: { type: 'string', description: 'remove_element | add_element | remove_property | remove_declaration' },
              target: { type: 'string', description: 'Array o oggetto su cui agire (nome o percorso con punti).' },
              match: { type: 'object', description: 'Proprietà dell\'elemento da togliere, per esempio {"id":"de"}.' },
              key: { type: 'string', description: 'Nome della proprietà da togliere (remove_property).' },
              name: { type: 'string', description: 'Nome della dichiarazione da togliere (remove_declaration).' },
              element: { type: 'string', description: 'Testo del nuovo elemento (add_element).' },
              position: { type: 'string', description: 'add_element: «end» (predefinito) o «start»; per «dopo un elemento» usa after_match.' },
              after_match: { type: 'object', description: 'add_element: inserisci dopo l\'elemento con queste proprietà.' },
              all: { type: 'boolean', description: 'Togli tutti gli elementi che corrispondono (altrimenti ne deve corrispondere uno solo).' },
              expect_matches: { type: 'integer', description: 'Numero esatto di elementi che devono corrispondere.' }
            },
            required: ['op']
          }
        },
        dry_run: { type: 'boolean', description: 'Se true non scrive nulla: mostra cosa cambierebbe.' },
        must_count: MUST_COUNT,
        message: { type: 'string', description: 'Messaggio del commit (non serve con dry_run).' },
        branch: { type: 'string', description: 'Branch (facoltativo).' }
      }),
      required: ['owner', 'repo', 'path', 'operations']
    },
    title: (a) => (a.dry_run ? 'Anteprima struttura di «' : 'Modifica la struttura di «') + str(a.path) + '» in ' + str(a.owner) + '/' + str(a.repo) + ' (' + (Array.isArray(a.operations) ? a.operations.length : 0) + ' operazioni)',
    details: (a) =>
      'Commit: ' + str(a.message) + (a.branch ? '\nBranch: ' + a.branch : '') + '\n\n' +
      (Array.isArray(a.operations) ? a.operations : []).map((o, i) => (i + 1) + '. ' + clip(JSON.stringify(o), 300)).join('\n') + '\n\n(il file viene analizzato, la sintassi controllata prima di salvare)',
    async run(args, ctx) {
      const { base } = repoArgs(args);
      const path = need(args, 'path');
      const ops = Array.isArray(args.operations) ? args.operations : [];
      if (!ops.length) throw new Error('Manca «operations» (almeno un\'operazione).');
      if (ops.length > 20) throw new Error('Troppe operazioni in una volta (massimo 20).');
      // alcuni modelli mettono «after» dentro «position»: si normalizza
      const norm = ops.map((o) => {
        const c = Object.assign({}, o);
        if (c.after_match && !c.position) c.position = { after: c.after_match };
        return c;
      });
      const dry = !!args.dry_run;
      if (!dry) needRead(ctx, args, false, 'modificato');
      const message = dry ? '' : need(args, 'message');
      await warmAcorn();
      if (!dry && ctx.workBranch && args.branch === ctx.workBranch) await ensureWorkBranch(ctx, base, args.branch);
      let file = await gh(ctx, base + '/contents/' + encPath(path) + (args.branch ? '?ref=' + encodeURIComponent(args.branch) : ''), { allow404: dry && !!args.branch });
      if (!file && dry) file = await gh(ctx, base + '/contents/' + encPath(path));
      if (Array.isArray(file) || file.type !== 'file' || !file.content) throw new Error('«' + path + '» non è un file di testo leggibile.');
      const original = base64ToUtf8(file.content);
      if (original.includes('\u0000')) throw new Error('File binario: non modificabile.');
      let cur = original;
      const reports = [];
      norm.forEach((op, k) => {
        const r = applyStructOp(path, cur, op, k);
        cur = r.text;
        reports.push(r.report);
      });
      checkMustCount(args.must_count, original, cur, path);
      const bad = syntaxError(path, cur);
      if (bad) throw new Error('Modifica NON salvata: dopo l\'operazione «' + path + '» non risulterebbe valido (' + bad + '). Il file su GitHub non è cambiato.');
      const b = original.split('\n').length;
      const a = cur.split('\n').length;
      const summary = reports.join('\n') + '\nRighe ' + b + ' → ' + a + ' (' + (a - b >= 0 ? '+' : '') + (a - b) + '), caratteri ' + original.length + ' → ' + cur.length + '. Il file risultante è sintatticamente valido.';
      if (dry) return 'ANTEPRIMA (non ho scritto nulla):\n' + summary;
      const body = { message, content: utf8ToBase64(cur), sha: file.sha };
      if (args.branch) body.branch = args.branch;
      const r = await gh(ctx, base + '/contents/' + encPath(path), { method: 'PUT', body });
      return 'Fatto: ' + path + (args.branch ? ' (branch ' + args.branch + ')' : '') + ' — commit ' + short(r.commit && r.commit.sha) + '.\n' + summary + '\nI numeri di riga sono cambiati: rifai github_outline prima di un\'altra modifica.';
    }
  });

  /** Righe tolte e aggiunte da un insieme di sostituzioni (per la conferma). */
  function editLines(a) {
    let removed = 0;
    let added = 0;
    // righe toccate: gli «a capo» del frammento (almeno 1 se il frammento non è vuoto)
    const n = (t) => (t ? Math.max(1, str(t).split('\n').length - 1) : 0);
    (Array.isArray(a && a.edits) ? a.edits : []).forEach((e) => {
      removed += n(e && e.old_text);
      added += n(e && e.new_text);
    });
    return { removed, added, net: added - removed };
  }

  def('github_edit_file', {
    description:
      'Modifica un file di GitHub sostituendo frammenti di testo esatti (come un «trova e sostituisci»), senza riscrivere tutto il file. ' +
      'Ogni «old_text» deve comparire UNA sola volta nel file: copialo esattamente da github_read_file e aggiungi contesto se serve. ' +
      'Preferiscilo a github_write_file per cambiare poche righe di file esistenti.',
    write: true,
    // una modifica che cancella molte righe è segnalata in rosso nella conferma
    danger: (a) => editLines(a).net <= -20,
    parameters: {
      type: 'object',
      properties: Object.assign({}, REPO_PROPS, {
        path: { type: 'string', description: 'Percorso del file da modificare.' },
        edits: {
          type: 'array',
          description: 'Sostituzioni da fare, in ordine.',
          items: {
            type: 'object',
            properties: {
              old_text: { type: 'string', description: 'Testo esatto da sostituire (unico nel file).' },
              new_text: { type: 'string', description: 'Testo nuovo (vuoto per cancellare).' }
            },
            required: ['old_text', 'new_text']
          }
        },
        must_count: MUST_COUNT,
        message: { type: 'string', description: 'Messaggio del commit.' },
        branch: { type: 'string', description: 'Branch (facoltativo, predefinito: branch principale).' }
      }),
      required: ['owner', 'repo', 'path', 'edits', 'message']
    },
    title: (a) => (editLines(a).net <= -20 ? 'ATTENZIONE: cancella ' + -editLines(a).net + ' righe — ' : '') + 'Modifica «' + str(a.path) + '» in ' + str(a.owner) + '/' + str(a.repo) + ' (' + ((a.edits && a.edits.length) || 0) + ' sostituzioni)',
    details: (a) =>
      'Commit: ' + str(a.message) + (a.branch ? '\nBranch: ' + a.branch : '') + '\nRighe: −' + editLines(a).removed + ' / +' + editLines(a).added + '\n' +
      (Array.isArray(a.edits) ? a.edits : [])
        .map((e, i) => '\n@@ ' + (i + 1) + ' @@\n' + clip(str(e && e.old_text).replace(/^/gm, '- '), 500) + '\n' + clip(str(e && e.new_text).replace(/^/gm, '+ '), 500))
        .join('\n')
        .slice(0, 2500),
    async run(args, ctx) {
      const { base } = repoArgs(args);
      const path = need(args, 'path');
      const message = need(args, 'message');
      const edits = Array.isArray(args.edits) ? args.edits : [];
      if (!edits.length) throw new Error('Nessuna modifica: «edits» è vuoto.');
      needRead(ctx, args, false, 'modificato');
      if (ctx.workBranch && args.branch === ctx.workBranch) await ensureWorkBranch(ctx, base, args.branch);
      const refQ = args.branch ? '?ref=' + encodeURIComponent(args.branch) : '';
      const url = base + '/contents/' + encPath(path);
      const file = await gh(ctx, url + refQ);
      if (Array.isArray(file) || file.type !== 'file' || !file.content) throw new Error('«' + path + '» non è un file di testo leggibile.');
      const original = base64ToUtf8(file.content);
      if (original.includes('\u0000')) throw new Error('File binario: non modificabile.');
      const crlf = original.includes('\r\n');
      let text = original;
      const spots = []; // dove sono finite le sostituzioni (per mostrarle al modello)
      edits.forEach((e, i) => {
        let oldT = str(e && e.old_text);
        let newT = str(e && e.new_text);
        if (!oldT) throw new Error('Modifica ' + (i + 1) + ': «old_text» è vuoto.');
        if (crlf) {
          // il file usa «a capo» di Windows: adatta il testo cercato
          oldT = oldT.replace(/\r?\n/g, '\r\n');
          newT = newT.replace(/\r?\n/g, '\r\n');
        }
        const n = text.split(oldT).length - 1;
        if (n === 0) throw new Error('Modifica ' + (i + 1) + ': testo non trovato nel file. Rileggilo con github_read_file e copia il frammento esatto.');
        if (n > 1) throw new Error('Modifica ' + (i + 1) + ': il testo compare ' + n + ' volte. Aggiungi più righe di contesto per renderlo unico.');
        const at = text.indexOf(oldT);
        text = text.slice(0, at) + newT + text.slice(at + oldT.length);
        const shift = newT.length - oldT.length;
        spots.forEach((p) => p.at > at && (p.at += shift));
        spots.push({ at, len: newT.length });
      });
      if (text === original) throw new Error('Le sostituzioni non cambiano il file.');
      checkMustCount(args.must_count, original, text, path);
      await warmAcorn();
      const note = checkSyntaxOrThrow(path, original, text);
      const body = { message, content: utf8ToBase64(text), sha: file.sha };
      if (args.branch) body.branch = args.branch;
      const r = await gh(ctx, url, { method: 'PUT', body });
      const delta = text.length - original.length;
      const lines = text.split('\n');
      const ctxLines = spots
        .map((p, i) => {
          const first = text.slice(0, p.at).split('\n').length;
          const last = first + Math.max(0, text.slice(p.at, p.at + p.len).split('\n').length - 1);
          const from = Math.max(1, first - 3);
          const to = Math.min(lines.length, last + 3);
          return '@@ sostituzione ' + (i + 1) + ', righe ' + from + '–' + to + ' dopo la modifica @@\n' +
            lines.slice(from - 1, to).map((l, k) => String(from + k).padStart(5) + ' | ' + clip(l, 200)).join('\n');
        })
        .join('\n');
      return (
        'File modificato: ' + path + (args.branch ? ' (branch ' + args.branch + ')' : '') + ' — ' + edits.length + ' sostituzioni, ' +
        (delta >= 0 ? '+' : '') + delta + ' caratteri, righe ' + lineCount(original) + ' → ' + lineCount(text) +
        ' (' + (lineCount(text) - lineCount(original) >= 0 ? '+' : '') + (lineCount(text) - lineCount(original)) + ') — commit ' + short(r.commit && r.commit.sha) + '.' + note +
        '\nControlla qui sotto che il risultato sia quello voluto (se non lo è, correggilo subito):\n' + clip(ctxLines, 6000)
      );
    }
  });

  // ─── Ricerca web ───────────────────────────────────────────
  // 23 — web_search (Google/Gemini, DuckDuckGo, Tavily, Serper o Exa)
  def('web_search', {
    description:
      'Cerca sul web (Google, DuckDuckGo, Tavily, Serper o Exa secondo le impostazioni) e restituisce una risposta o titoli, indirizzi ed estratti, con le fonti. Usalo per notizie, fatti recenti, documentazione, prezzi. ' +
      'Poi puoi leggere una pagina intera con read_webpage.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Cosa cercare, scritto come una ricerca (meglio in poche parole).' },
        limit: { type: 'integer', description: 'Quanti risultati (1-10, predefinito 6).' }
      },
      required: ['query']
    },
    title: (a) => 'Cerca sul web: «' + oneLine(a.query, 80) + '»',
    async run(args, ctx) {
      const q = need(args, 'query');
      const n = Math.min(10, Math.max(1, Math.floor(Number(args.limit)) || 6));
      const provider = ctx.searchProvider;
      if (!provider) throw new Error('La ricerca web è disattivata: in Impostazioni → Ricerca web scegli un servizio.');
      if (provider === 'gemini' && !ctx.geminiKey) throw new Error('Per la ricerca di Google serve la chiave Gemini: inseriscila in Impostazioni (provider Google Gemini), oppure scegli un altro servizio.');
      if (!['gemini', 'ddg'].includes(provider) && !ctx.searchKey) throw new Error('Manca la chiave della ricerca web: in Impostazioni → Ricerca web incollala.');
      const strip = (s) => oneLine(str(s).replace(/<[^>]+>/g, ''), 300);
      const fail = async (res, who) => {
        let m = '';
        try {
          const d = await res.json();
          m = (d.error && (d.error.message || d.error)) || d.detail || d.message || '';
          if (typeof m !== 'string') m = JSON.stringify(m);
        } catch (_) {}
        if (res.status === 401 || res.status === 403) throw new Error(who + ': chiave non valida o non autorizzata [HTTP ' + res.status + ']');
        if (res.status === 429) throw new Error(who + ': limite di ricerche raggiunto, riprova più tardi.');
        throw new Error(who + ': errore' + (m ? ' — ' + oneLine(m, 160) : '') + ' [HTTP ' + res.status + ']');
      };
      if (provider === 'gemini') {
        // Gemini cerca su Google da solo («grounding») e risponde con le fonti: usa la chiave Gemini già inserita
        const model = /^gemini/i.test(ctx.searchModel || '') ? ctx.searchModel : 'gemini-2.5-flash';
        const base = String(ctx.geminiBase || 'https://generativelanguage.googleapis.com/v1beta').replace(/\/+$/, '');
        const res = await fetch(base + '/models/' + encodeURIComponent(model) + ':generateContent', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-goog-api-key': ctx.geminiKey },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: 'Cerca sul web e rispondi in modo fattuale e sintetico, nella lingua della domanda, citando i dati e le date importanti.' }] },
            contents: [{ role: 'user', parts: [{ text: q }] }],
            tools: [{ google_search: {} }]
          }),
          signal: ctx.signal
        });
        if (!res.ok) {
          let m = '';
          try {
            m = ((await res.json()).error || {}).message || '';
          } catch (_) {}
          if (res.status === 429 || /quota|rate/i.test(m)) throw new Error('Ricerca Google: limite del piano raggiunto (le ricerche con Google hanno una quota a parte). Riprova più tardi o scegli un altro servizio. [HTTP ' + res.status + ']');
          if (res.status === 400 || res.status === 403 || res.status === 404) throw new Error('Ricerca Google non disponibile con questa chiave o modello: ' + oneLine(m, 160) + ' — scegli un altro servizio. [HTTP ' + res.status + ']');
          throw new Error('Ricerca Google: errore ' + oneLine(m, 160) + ' [HTTP ' + res.status + ']');
        }
        const d = await res.json();
        const cand = d.candidates && d.candidates[0];
        const answer = ((cand && cand.content && cand.content.parts) || []).map((p) => p.text || '').join('').trim();
        const gm = (cand && cand.groundingMetadata) || {};
        const sources = [];
        (gm.groundingChunks || []).forEach((c) => c.web && c.web.uri && !sources.some((x) => x.uri === c.web.uri) && sources.push(c.web));
        if (!answer) throw new Error('La ricerca non ha restituito una risposta' + ((d.promptFeedback && d.promptFeedback.blockReason) ? ' (' + d.promptFeedback.blockReason + ')' : '') + '.');
        return (
          answer +
          (gm.webSearchQueries && gm.webSearchQueries.length ? '\n\nRicerche fatte: ' + gm.webSearchQueries.slice(0, 4).join('; ') : '') +
          (sources.length ? '\n\nFonti:\n' + sources.slice(0, n).map((x, i) => i + 1 + '. ' + oneLine(x.title || x.uri, 100) + ' — ' + x.uri).join('\n') : '\n\n(nessuna fonte indicata)')
        );
      }
      if (provider === 'ddg') {
        // Non ufficiale: legge la versione HTML di DuckDuckGo. Può smettere di funzionare o chiedere una verifica anti-robot.
        let res;
        try {
          res = await fetch('https://html.duckduckgo.com/html/', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: 'q=' + encodeURIComponent(q) + '&kl=it-it',
            signal: ctx.signal
          });
        } catch (e) {
          if (e && e.name === 'AbortError') throw e;
          throw new Error('DuckDuckGo non raggiungibile da qui: nel browser è bloccato dalle regole CORS (funziona nell\'app Android). Scegli un altro servizio in Impostazioni → Ricerca web.');
        }
        const blocked = 'DuckDuckGo ha bloccato la richiesta (verifica anti-robot o troppe ricerche). Riprova più tardi o scegli un altro servizio in Impostazioni → Ricerca web.';
        if ([202, 403, 429].includes(res.status)) throw new Error(blocked + ' [HTTP ' + res.status + ']');
        if (!res.ok) throw new Error('DuckDuckGo: errore [HTTP ' + res.status + ']');
        const html = await res.text();
        const doc = new DOMParser().parseFromString(html, 'text/html');
        const items = [];
        doc.querySelectorAll('.result').forEach((el) => {
          if (el.classList.contains('result--ad')) return; // pubblicità
          const a = el.querySelector('a.result__a');
          if (!a) return;
          let href = a.getAttribute('href') || '';
          const m = /[?&]uddg=([^&]+)/.exec(href); // il collegamento passa da un reindirizzamento di DuckDuckGo
          if (m) {
            try {
              href = decodeURIComponent(m[1]);
            } catch (_) {}
          } else if (href.startsWith('//')) href = 'https:' + href;
          if (!/^https?:\/\//i.test(href) || /duckduckgo\.com\/y\.js/.test(href)) return;
          const sn = el.querySelector('.result__snippet');
          items.push({ title: a.textContent, url: href, snippet: sn ? sn.textContent : '' });
        });
        if (!items.length) {
          if (/anomaly|captcha|bots use DuckDuckGo/i.test(html)) throw new Error(blocked);
          return 'Nessun risultato.';
        }
        return items.slice(0, n).map((r, i) => i + 1 + '. ' + oneLine(r.title, 120) + '\n   ' + r.url + '\n   ' + oneLine(r.snippet, 300)).join('\n');
      }
      if (provider === 'tavily') {
        const res = await fetch('https://api.tavily.com/search', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + ctx.searchKey },
          body: JSON.stringify({ query: q, max_results: n, include_answer: true }),
          signal: ctx.signal
        });
        if (!res.ok) await fail(res, 'Tavily');
        const d = await res.json();
        const list = d.results || [];
        if (!list.length) return 'Nessun risultato.';
        return (d.answer ? 'Sintesi: ' + oneLine(d.answer, 600) + '\n\n' : '') + list.map((r, i) => i + 1 + '. ' + oneLine(r.title, 120) + '\n   ' + r.url + '\n   ' + strip(r.content)).join('\n');
      }
      if (provider === 'serper') {
        const res = await fetch('https://google.serper.dev/search', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-API-KEY': ctx.searchKey },
          body: JSON.stringify({ q, num: n, gl: 'it', hl: 'it' }),
          signal: ctx.signal
        });
        if (!res.ok) await fail(res, 'Serper');
        const d = await res.json();
        const list = d.organic || [];
        const box = d.answerBox && (d.answerBox.answer || d.answerBox.snippet || d.answerBox.title);
        const kg = d.knowledgeGraph && d.knowledgeGraph.description ? (d.knowledgeGraph.title ? d.knowledgeGraph.title + ': ' : '') + d.knowledgeGraph.description : '';
        if (!list.length && !box && !kg) return 'Nessun risultato.';
        return (
          (box ? 'Risposta diretta: ' + oneLine(box, 400) + '\n\n' : '') +
          (kg ? oneLine(kg, 400) + '\n\n' : '') +
          list.slice(0, n).map((r, i) => i + 1 + '. ' + oneLine(r.title, 120) + '\n   ' + r.link + '\n   ' + strip(r.snippet)).join('\n')
        ).trim();
      }
      if (provider === 'exa') {
        const res = await fetch('https://api.exa.ai/search', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-api-key': ctx.searchKey },
          body: JSON.stringify({ query: q, numResults: n, contents: { text: { maxCharacters: 400 } } }),
          signal: ctx.signal
        });
        if (!res.ok) await fail(res, 'Exa');
        const d = await res.json();
        const list = d.results || [];
        if (!list.length) return 'Nessun risultato.';
        return list.map((r, i) => i + 1 + '. ' + oneLine(r.title || r.url, 120) + '\n   ' + r.url + (r.publishedDate ? ' (' + String(r.publishedDate).slice(0, 10) + ')' : '') + '\n   ' + strip(r.text)).join('\n');
      }
      throw new Error('Servizio di ricerca sconosciuto: ' + provider);
    }
  });

  // ─── Piano di lavoro ───────────────────────────────────────
  // 24 — update_plan (nessun effetto: serve a organizzarsi e a mostrare i progressi)
  function planProgress(a) {
    const steps = Array.isArray(a && a.steps) ? a.steps : [];
    return { total: steps.length, done: steps.filter((s) => s && s.status === 'done').length };
  }
  def('update_plan', {
    description:
      'Scrive o aggiorna l\'elenco dei passi di un compito con più passaggi (visibile all\'utente). ' +
      'Usalo all\'inizio di un lavoro lungo e aggiornalo man mano che completi i passi. Non fa altro: dopo averlo chiamato continua con il lavoro vero.',
    parameters: {
      type: 'object',
      properties: {
        steps: {
          type: 'array',
          description: 'L\'elenco completo e aggiornato dei passi.',
          items: {
            type: 'object',
            properties: {
              text: { type: 'string', description: 'Cosa fare in questo passo.' },
              status: { type: 'string', enum: ['pending', 'in_progress', 'done'], description: 'Stato del passo.' }
            },
            required: ['text', 'status']
          }
        }
      },
      required: ['steps']
    },
    title: (a) => {
      const p = planProgress(a);
      return 'Piano di lavoro: ' + p.done + '/' + p.total + ' passi completati';
    },
    async run(args) {
      const steps = Array.isArray(args.steps) ? args.steps : [];
      if (!steps.length) throw new Error('Il piano è vuoto.');
      const p = planProgress(args);
      return 'Piano aggiornato: ' + p.done + '/' + p.total + ' completati. Continua con il prossimo passo.';
    }
  });

  // ─── Strumenti dei connettori MCP (registrati a runtime) ──
  const DYN = {}; // nome → strumento
  const DYN_BY_SERVER = {}; // id server → [nomi]

  /** Rende lo schema accettabile da Gemini e dalle API OpenAI (toglie parole chiave non supportate). */
  function cleanSchema(s, defs, depth) {
    if (!s || typeof s !== 'object' || depth > 8) return { type: 'string' };
    if (s.$ref) return cleanSchema((defs || {})[String(s.$ref).split('/').pop()] || {}, defs, depth + 1);
    let t = s.type;
    if (Array.isArray(t)) t = t.find((x) => x !== 'null') || 'string';
    const alt = s.anyOf || s.oneOf || s.allOf;
    if (!t && Array.isArray(alt)) {
      const first = alt.find((x) => x && x.type !== 'null') || {};
      const c = cleanSchema(first, defs, depth + 1);
      if (s.description && !c.description) c.description = String(s.description).slice(0, 300);
      return c;
    }
    if (!t) t = s.properties ? 'object' : s.items ? 'array' : 'string';
    const out = { type: ['string', 'number', 'integer', 'boolean', 'object', 'array'].includes(t) ? t : 'string' };
    if (s.description) out.description = String(s.description).slice(0, 300);
    if (out.type === 'string' && Array.isArray(s.enum)) out.enum = s.enum.map(String);
    if (out.type === 'object') {
      const keys = Object.keys(s.properties || {});
      if (depth > 0 && !keys.length) return { type: 'string', description: (out.description ? out.description + ' ' : '') + '(oggetto JSON scritto come testo)' };
      out.properties = {};
      keys.forEach((k) => (out.properties[k] = cleanSchema(s.properties[k], defs, depth + 1)));
      if (Array.isArray(s.required)) {
        const req = s.required.filter((k) => keys.includes(k));
        if (req.length) out.required = req;
      }
    }
    if (out.type === 'array') out.items = cleanSchema(s.items || { type: 'string' }, defs, depth + 1);
    return out;
  }

  function mcpContent(result) {
    const texts = [];
    const files = [];
    (result.content || []).forEach((c) => {
      if (c.type === 'text') texts.push(c.text);
      else if (c.type === 'image' && c.data) {
        const mime = c.mimeType || 'image/png';
        files.push({ name: 'immagine-mcp-' + (files.length + 1) + '.' + (/jpe?g/.test(mime) ? 'jpg' : /webp/.test(mime) ? 'webp' : 'png'), mime, blob: base64ToBlob(c.data, mime) });
        texts.push('[immagine allegata]');
      } else if (c.type === 'resource' && c.resource) texts.push(c.resource.text || '[risorsa ' + (c.resource.uri || '') + ']');
      else if (c.type === 'resource_link') texts.push('[collegamento: ' + (c.name || '') + ' ' + (c.uri || '') + ']');
      else if (c.type === 'audio') texts.push('[audio non mostrabile]');
    });
    if (!texts.length && result.structuredContent) texts.push(JSON.stringify(result.structuredContent, null, 2));
    return { text: texts.join('\n') || '(nessun contenuto)', files };
  }

  /** Sostituisce gli strumenti di un connettore. `disabled` = nomi da non esporre. */
  function setMcpTools(server, tools, disabled) {
    clearMcp(server.id);
    const label = server.name || str(server.url).replace(/^https?:\/\//, '').split('/')[0];
    const slug = str(label).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 12) || 'srv';
    const names = [];
    (tools || []).forEach((t) => {
      if ((disabled || []).includes(t.name)) return;
      let name = ('mcp_' + slug + '_' + t.name.replace(/[^A-Za-z0-9_-]+/g, '_')).slice(0, 64);
      while (TOOLS[name] || DYN[name]) name = name.slice(0, 60) + Math.random().toString(36).slice(2, 5);
      const readOnly = !!(t.annotations && t.annotations.readOnlyHint === true);
      const params = cleanSchema(t.inputSchema || { type: 'object', properties: {} }, (t.inputSchema && (t.inputSchema.$defs || t.inputSchema.definitions)) || {}, 0);
      if (params.type !== 'object') params.type = 'object';
      if (!params.properties) params.properties = {};
      DYN[name] = {
        name,
        mcp: true,
        description: ('[' + label + '] ' + str(t.description || t.title || t.name)).slice(0, 700),
        parameters: params,
        write: !readOnly, // senza l'indicazione «sola lettura» dal server, chiede sempre conferma
        title: () => label + ' → ' + (t.title || t.name),
        details: (a) => clip(JSON.stringify(a, null, 2), 1200),
        async run(args, ctx) {
          const r = await global.MiaMcp.call(server, t.name, args, ctx.signal);
          const out = mcpContent(r);
          if (r.isError) throw new Error(out.text);
          return out;
        }
      };
      names.push(name);
    });
    DYN_BY_SERVER[server.id] = names;
    return names.length;
  }

  function clearMcp(serverId) {
    (DYN_BY_SERVER[serverId] || []).forEach((n) => delete DYN[n]);
    delete DYN_BY_SERVER[serverId];
  }

  // ─── API pubblica ─────────────────────────────────────────
  function get(name) {
    if (Object.prototype.hasOwnProperty.call(TOOLS, name)) return TOOLS[name];
    return Object.prototype.hasOwnProperty.call(DYN, name) ? DYN[name] : null;
  }

  /** Strumenti di ricerca/lettura web offerti dai connettori: { search, fetch } (nomi) o null. */
  function connectorWeb() {
    const names = Object.keys(DYN);
    const search = names.find((n) => /_web_search$/.test(n)) || null;
    const fetchT = names.find((n) => /_web_fetch$/.test(n)) || null;
    return { search, fetch: fetchT };
  }

  /**
   * Schemi da inviare al modello. Con opts.preferConnectors, se un connettore offre una ricerca (o una lettura) web,
   * gli strumenti equivalenti di Mia vengono nascosti, così il modello non deve scegliere tra due.
   */
  function definitions(opts) {
    const hide = new Set();
    if (opts && opts.preferConnectors) {
      const w = connectorWeb();
      if (w.search) hide.add('web_search');
      if (w.fetch) hide.add('read_webpage');
    }
    return Object.values(TOOLS)
      .concat(Object.values(DYN))
      .filter((t) => !hide.has(t.name))
      .map((t) => ({ name: t.name, description: t.description, parameters: t.parameters }));
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
  // ─── Anteprima delle modifiche, differenze, prova del codice ─
  const PREVIEWABLE = ['github_write_file', 'github_edit_file', 'github_delete_lines', 'github_edit_structure', 'github_delete_file'];
  /** Calcola cosa cambierebbe uno strumento di scrittura SENZA scrivere: { path, branch, before, after } (after null = file eliminato), { error } oppure null. */
  async function preview(name, args, ctx) {
    if (!PREVIEWABLE.includes(name) || !args || args.dry_run) return null;
    const t = get(name);
    const a = Object.assign({}, args);
    const { base } = repoArgs(a);
    const path = need(a, 'path');
    let ref = str(a.branch).trim();
    if (ref) {
      const ex = await gh(ctx, base + '/git/ref/heads/' + encPath(ref), { allow404: true });
      if (!ex) {
        delete a.branch; // il branch di lavoro non esiste ancora: verrà creato dal principale
        ref = '';
      }
    }
    const cur = await gh(ctx, base + '/contents/' + encPath(path) + (ref ? '?ref=' + encodeURIComponent(ref) : ''), { allow404: true });
    let before = null;
    if (cur && !Array.isArray(cur) && cur.content) {
      try {
        before = base64ToUtf8(cur.content);
      } catch (_) {}
    }
    const pctx = Object.assign({}, ctx, { preview: true, workBranch: '', onCommit: null, confirm: async () => true });
    await warmAcorn();
    try {
      await t.run(a, pctx);
      return null;
    } catch (e) {
      const sig = e && e.previewSignal;
      if (!sig) return { path, error: str(e && e.message) };
      return { path, branch: ref, before, after: sig.method === 'DELETE' ? null : base64ToUtf8(sig.body.content || '') };
    }
  }

  /** Differenze riga per riga: { lines:[{t:'+'|'-'|' '|'…', a, b, text}], add, del, cut }. */
  function lineDiff(beforeText, afterText, ctxN, maxShow) {
    ctxN = ctxN == null ? 3 : ctxN;
    maxShow = maxShow || 400;
    const A = beforeText == null ? [] : str(beforeText).split('\n');
    const B = afterText == null ? [] : str(afterText).split('\n');
    let p = 0;
    while (p < A.length && p < B.length && A[p] === B[p]) p++;
    let s = 0;
    while (s < A.length - p && s < B.length - p && A[A.length - 1 - s] === B[B.length - 1 - s]) s++;
    const a1 = A.slice(p, A.length - s);
    const b1 = B.slice(p, B.length - s);
    let mid = [];
    const n = a1.length;
    const m = b1.length;
    if (n && m && n * m <= 2000000) {
      const w = m + 1;
      const T = new Uint32Array((n + 1) * w);
      for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) T[i * w + j] = a1[i] === b1[j] ? T[(i + 1) * w + j + 1] + 1 : Math.max(T[(i + 1) * w + j], T[i * w + j + 1]);
      let i = 0;
      let j = 0;
      while (i < n && j < m) {
        if (a1[i] === b1[j]) {
          mid.push([' ', a1[i]]);
          i++;
          j++;
        } else if (T[(i + 1) * w + j] >= T[i * w + j + 1]) mid.push(['-', a1[i++]]);
        else mid.push(['+', b1[j++]]);
      }
      while (i < n) mid.push(['-', a1[i++]]);
      while (j < m) mid.push(['+', b1[j++]]);
    } else mid = a1.map((l) => ['-', l]).concat(b1.map((l) => ['+', l]));
    const all = A.slice(0, p).map((l) => [' ', l]).concat(mid, A.slice(A.length - s).map((l) => [' ', l]));
    // numeri di riga e righe da mostrare (le modifiche con ctxN righe intorno)
    let ai = 0;
    let bi = 0;
    const num = all.map(([t, l]) => {
      const o = { t, text: l, a: t === '+' ? null : ++ai, b: t === '-' ? null : ++bi };
      if (t === '+') o.a = null;
      return o;
    });
    const keep = new Uint8Array(num.length);
    num.forEach((o, k) => {
      if (o.t !== ' ') for (let x = Math.max(0, k - ctxN); x <= Math.min(num.length - 1, k + ctxN); x++) keep[x] = 1;
    });
    const lines = [];
    let gap = false;
    let cut = false;
    for (let k = 0; k < num.length; k++) {
      if (!keep[k]) {
        gap = true;
        continue;
      }
      if (gap && lines.length) lines.push({ t: '…', text: '' });
      gap = false;
      if (lines.length >= maxShow) {
        cut = true;
        break;
      }
      lines.push(num[k]);
    }
    const add = mid.filter((x) => x[0] === '+').length;
    const del = mid.filter((x) => x[0] === '-').length;
    return { lines, add, del, cut };
  }
  /** Le differenze come testo (per il revisore e per i test). */
  function diffText(d, max) {
    const out = d.lines.map((o) => (o.t === '…' ? '…' : o.t + ' ' + (o.t === '+' ? o.b : o.a) + ' | ' + o.text)).join('\n');
    return clip(out, max || 6000) + (d.cut ? '\n[…altre differenze non mostrate…]' : '');
  }

  /** Conteggi delle variabili di primo livello (array → elementi, oggetti → chiavi), per confrontare prima e dopo. */
  function topCounts(path, text) {
    const out = {};
    if (text == null || !global.acorn) return out;
    let p;
    try {
      p = parseStruct(path, text);
    } catch (_) {
      return null;
    }
    const put = (name, v) => {
      if (!v || !name) return;
      if (v.type === 'ArrayExpression') out[name] = v.elements.length + (v.elements.length === 1 ? ' elemento' : ' elementi');
      else if (v.type === 'ObjectExpression') out[name] = v.properties.length + (v.properties.length === 1 ? ' chiave' : ' chiavi');
    };
    if (p.kind === 'json') put('(radice)', p.root);
    else
      topStatements(p.body, 0).forEach((it) => {
        const n = it.node;
        if (n.type === 'VariableDeclaration') n.declarations.forEach((d) => d.id.type === 'Identifier' && put(d.id.name, d.init));
        else if (n.type === 'FunctionDeclaration' && n.id) out[n.id.name + '()'] = 'funzione';
        else if (it.stmt.type === 'ExpressionStatement' && it.stmt.expression.type === 'AssignmentExpression') {
          const e = it.stmt.expression;
          put(text.slice(e.left.start, e.left.end), e.right);
        }
      });
    return out;
  }
  /** Prova del file modificato: si esegue (isolato, senza rete) prima e dopo, e si confrontano i conteggi. Restituisce { ok, text } o null. */
  async function codeCheck(path, before, after, signal) {
    const e = ((/\.([a-z0-9]+)$/i.exec(str(path)) || [])[1] || '').toLowerCase();
    if (!/^(js|cjs|mjs|json)$/.test(e) || after == null) return null;
    await warmAcorn();
    const cb = topCounts(path, before);
    const ca = topCounts(path, after);
    const parts = [];
    let ok = true;
    if (ca === null) return { ok: false, text: 'Il file modificato non si riesce ad analizzare (sintassi non valida).' };
    // esecuzione isolata: solo script (non moduli), file non troppo grandi
    const isModule = /^\s*(import|export)\b/m.test(after);
    if (/^(js|cjs)$/.test(e) && !isModule && after.length < 1500000) {
      const runIt = async (t) => {
        if (t == null) return null;
        try {
          const r = await runSandbox('var window = (typeof window !== "undefined") ? window : globalThis;\n' + t + '\n;return "ok";', 4000, signal);
          return r.ok ? '' : str(r.error || 'errore');
        } catch (err) {
          if (err && err.name === 'AbortError') throw err;
          return str(err && err.message);
        }
      };
      const ea = await runIt(after);
      const eb = before == null ? null : await runIt(before);
      if (ea === '') parts.push('si esegue senza errori' + (eb ? ' (prima della modifica invece dava errore)' : ''));
      else if (eb === '') {
        ok = false;
        parts.push('⚠️ PRIMA si eseguiva, DOPO la modifica dà errore: ' + clip(ea, 200));
      } else parts.push('non si può eseguire da solo (' + clip(ea, 120) + (eb ? '; anche prima' : '') + '): controllati solo struttura e conteggi');
    }
    const names = [...new Set(Object.keys(cb || {}).concat(Object.keys(ca)))];
    const changes = names
      .filter((k) => (cb || {})[k] !== ca[k])
      .map((k) => (cb && cb[k] && !ca[k] ? k + ': tolto (era ' + cb[k] + ')' : !(cb && cb[k]) ? k + ': nuovo (' + ca[k] + ')' : k + ': ' + cb[k] + ' → ' + ca[k]));
    if (changes.length) parts.push('cambiano: ' + changes.slice(0, 12).join(', ') + (changes.length > 12 ? '…' : ''));
    else if (names.length) parts.push('nessun conteggio cambiato (' + names.slice(0, 6).map((k) => k + ' ' + ca[k]).join(', ') + ')');
    if (!parts.length) return null;
    return { ok, text: 'Prova del codice: ' + parts.join('; ') + '.' };
  }

  // ─── Mappa del progetto (per non far esplorare il repository a ogni chat) ─
  const mapCache = {};
  async function projectMap(ctx, sel) {
    if (!/^[\w.-]+\/[\w.-]+$/.test(str(sel)) || !ctx.token) return '';
    const hit = mapCache[sel];
    if (hit && Date.now() - hit.t < 600000) return hit.v;
    let v = '';
    try {
      const base = '/repos/' + sel;
      const repo = await gh(ctx, base);
      const br = repo.default_branch;
      const tree = await gh(ctx, base + '/git/trees/' + encodeURIComponent(br) + '?recursive=1');
      const files = (tree && tree.tree ? tree.tree : []).filter((f) => f.type === 'blob' && !/(^|\/)(node_modules|\.git|dist|build|www)\//.test(f.path));
      if (!files.length) return '';
      const kb = (n) => (n >= 1024 ? Math.round(n / 1024) + ' KB' : (n || 0) + ' B');
      let list = files.map((f) => f.path + ' (' + kb(f.size) + ')').join('\n');
      if (list.length > 2500) list = files.slice(0, 120).map((f) => f.path).join('\n') + '\n[…altri ' + Math.max(0, files.length - 120) + ' file…]';
      v = 'Mappa del progetto «' + sel + '» (branch ' + br + ', ' + files.length + ' file' + (tree.truncated ? ', elenco incompleto' : '') + '):\n' + list;
      // i file di codice più grandi: solo le voci di primo livello (per sapere dove sono i dati senza leggerli)
      await warmAcorn();
      const big = files.filter((f) => /\.(js|json)$/i.test(f.path) && f.size > 200 && f.size < 400000).sort((x, y) => y.size - x.size).slice(0, 3);
      for (const f of big) {
        try {
          const d = await gh(ctx, base + '/contents/' + encPath(f.path));
          const c = topCounts(f.path, base64ToUtf8(d.content));
          const items = Object.keys(c || {}).map((k) => k + (c[k] === 'funzione' ? '' : ' [' + c[k] + ']'));
          if (items.length) v += '\n' + f.path + ' contiene: ' + clip(items.join(', '), 400);
        } catch (_) {}
      }
    } catch (_) {
      v = '';
    }
    mapCache[sel] = { t: Date.now(), v };
    return v;
  }

  // ─── Annulla le modifiche (commit registrati con ctx.onCommit) ─
  /** Per ogni file toccato: cosa fare per tornare a com'era prima e se è cambiato dopo. */
  async function undoPlan(ctx, commits) {
    const byPath = new Map();
    (commits || []).forEach((c) => {
      const k = c.base + '|' + c.branch + '|' + c.path;
      if (!byPath.has(k)) byPath.set(k, { base: c.base, branch: c.branch, path: c.path, oldSha: c.oldSha, last: c });
      else byPath.get(k).last = c;
    });
    const plan = [];
    for (const it of byPath.values()) {
      const cur = await gh(ctx, it.base + '/contents/' + encPath(it.path) + (it.branch ? '?ref=' + encodeURIComponent(it.branch) : ''), { allow404: true });
      const curSha = cur && !Array.isArray(cur) ? cur.sha : null;
      const changedAfter = it.last.deleted ? !!curSha : curSha !== it.last.newSha;
      plan.push(Object.assign(it, { curSha, changedAfter, action: it.oldSha ? 'ripristina' : 'elimina (era nuovo)' }));
    }
    return plan;
  }
  async function undoApply(ctx, plan, message) {
    const out = [];
    for (const it of plan) {
      const url = it.base + '/contents/' + encPath(it.path);
      if (!it.oldSha) {
        if (it.curSha) {
          const body = { message, sha: it.curSha };
          if (it.branch) body.branch = it.branch;
          await gh(ctx, url, { method: 'DELETE', body });
        }
        out.push(it.path + ': eliminato (era stato creato)');
        continue;
      }
      const blob = await gh(ctx, it.base + '/git/blobs/' + it.oldSha);
      const body = { message, content: str(blob.content).replace(/\s+/g, '') };
      if (it.curSha) body.sha = it.curSha;
      if (it.branch) body.branch = it.branch;
      await gh(ctx, url, { method: 'PUT', body });
      out.push(it.path + ': ripristinato');
    }
    return out;
  }

  async function run(name, args, ctx) {
    const t = get(name);
    if (!t) throw new Error('Strumento sconosciuto: ' + name);
    if (ctx && ctx.signal && ctx.signal.aborted) throw abortError();
    args = applyBranch(name, applyScope(name, args || {}, ctx), ctx);
    const out = await raceAbort(t.run(args, ctx || {}), ctx && ctx.signal);
    const max = t.maxResult || MAX_RESULT; // github_read_file gestisce da sé i tagli e li segnala («FILE INCOMPLETO»)
    if (out && typeof out === 'object' && typeof out.text === 'string') return { text: clip(out.text, max), files: out.files || [], imageUrl: out.imageUrl };
    return { text: clip(out, max), files: [] };
  }

  global.MiaTools = { projectRules, projectMap, preview, lineDiff, diffText, codeCheck, undoPlan, undoApply, applyScope, applyBranch, syntaxError, ocrImages, definitions, connectorWeb, get, needsConfirm, describe, run, whoami, needZip, setMcpTools, clearMcp, count: () => Object.keys(TOOLS).length };
})(window);
