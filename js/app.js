/* Mia AI — logica dell'app */
(function () {
  'use strict';

  const P = window.MiaProviders;
  const MD = window.MiaMarkdown;
  const GH = window.MiaGitHub;
  const $ = (s) => document.querySelector(s);

  const LS_SETTINGS = 'miaai_v1_settings';
  const LS_CONVS = 'miaai_v1_conversations';
  const LS_CURRENT = 'miaai_v1_current';
  const MAX_HISTORY = 40; // messaggi inviati al modello come contesto
  const MAX_TEXT_FILE = 200 * 1024; // caratteri massimi di un file di testo
  const MAX_BINARY = 8 * 1024 * 1024; // byte massimi di un PDF
  const IMAGE_MAX_SIDE = 1280; // le foto vengono ridimensionate
  const TEXT_EXT = /\.(txt|md|markdown|csv|tsv|json|xml|html?|css|js|mjs|ts|jsx|tsx|py|java|kt|c|h|cpp|cs|go|rs|rb|php|sh|sql|yaml|yml|ini|toml|log|srt)$/i;

  // ─── Stato ────────────────────────────────────────────────
  const DEFAULT_SETTINGS = {
    provider: 'gemini',
    profiles: {}, // { [provider]: { baseUrl, apiKey, model } }
    systemPrompt: 'Sei Mia, un assistente utile e cordiale. Rispondi in italiano, in modo chiaro e conciso, salvo richiesta diversa.',
    temperature: 0.7,
    theme: 'auto',
    favorites: [], // [{ provider, model }] — modelli per il cambio rapido
    autoFallback: true, // se il modello è occupato, prova da solo gli altri dell'elenco
    githubToken: '',
    githubRepo: ''
  };

  function load(key, fallback) {
    try {
      const v = localStorage.getItem(key);
      return v ? JSON.parse(v) : fallback;
    } catch (_) {
      return fallback;
    }
  }
  function save(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (_) {
      toast('Memoria piena: elimina qualche chat.');
    }
  }

  let settings = Object.assign({}, DEFAULT_SETTINGS, load(LS_SETTINGS, {}));
  if (!Array.isArray(settings.favorites)) settings.favorites = [];
  if (typeof settings.githubRepo !== 'string') settings.githubRepo = '';
  let conversations = load(LS_CONVS, []);
  let currentId = load(LS_CURRENT, null);
  let busy = false;

  function profile(provider) {
    const pr = provider || settings.provider;
    const preset = P.PRESETS[pr] || P.PRESETS.custom;
    const saved = settings.profiles[pr] || {};
    return {
      baseUrl: saved.baseUrl || preset.baseUrl,
      apiKey: saved.apiKey || '',
      model: saved.model != null && saved.model !== '' ? saved.model : preset.model
    };
  }

  /** Config per la chiamata: provider/modello attivi, oppure quelli di `pick` ({provider, model}). */
  function chatConfig(pick) {
    const provider = (pick && pick.provider) || settings.provider;
    const cfg = Object.assign({ provider }, profile(provider), {
      systemPrompt: settings.systemPrompt,
      temperature: Number(settings.temperature)
    });
    if (pick && pick.model) cfg.model = pick.model;
    return cfg;
  }

  function isConfigured(pick) {
    const provider = (pick && pick.provider) || settings.provider;
    const preset = P.PRESETS[provider] || P.PRESETS.custom;
    const p = profile(provider);
    const model = (pick && pick.model) || p.model;
    return !!model && (!preset.needsKey || !!p.apiKey);
  }

  function modelLabel(provider, model) {
    const preset = P.PRESETS[provider] || P.PRESETS.custom;
    return (preset.short || preset.label) + ' · ' + model;
  }

  function addFavorite(provider, model) {
    if (!provider || !model) return;
    if (settings.favorites.some((f) => f.provider === provider && f.model === model)) return;
    settings.favorites.push({ provider, model });
    if (settings.favorites.length > 20) settings.favorites.shift();
  }

  function selectModel(provider, model) {
    settings.provider = provider;
    const prof = Object.assign({}, settings.profiles[provider] || profile(provider));
    prof.model = model;
    settings.profiles[provider] = prof;
    save(LS_SETTINGS, settings);
    updateHeader();
  }

  function current() {
    return conversations.find((c) => c.id === currentId) || null;
  }

  function persistConvs() {
    save(LS_CURRENT, currentId);
    try {
      localStorage.setItem(LS_CONVS, JSON.stringify(conversations));
      return;
    } catch (_) {}
    // Memoria piena: elimina i dati degli allegati più vecchi (resta solo il nome)
    const all = [];
    conversations.forEach((c) =>
      c.messages.forEach((m) => (m.attachments || []).forEach((a) => a.data && all.push({ a, t: c.updated })))
    );
    all.sort((x, y) => x.t - y.t);
    for (const { a } of all) {
      delete a.data;
      delete a.thumb;
      a.dropped = true;
      try {
        localStorage.setItem(LS_CONVS, JSON.stringify(conversations));
        toast('Memoria quasi piena: rimossi gli allegati più vecchi');
        return;
      } catch (_) {}
    }
    toast('Memoria piena: elimina qualche chat.');
  }

  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  // ─── UI helpers ───────────────────────────────────────────
  let toastTimer = null;
  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (t.hidden = true), 2200);
  }

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
    } catch (_) {
      const ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand('copy');
      } catch (_) {}
      ta.remove();
    }
    toast('Copiato');
  }

  function applyTheme() {
    document.documentElement.dataset.theme = settings.theme;
    const dark =
      settings.theme === 'dark' ||
      (settings.theme === 'auto' && !window.matchMedia('(prefers-color-scheme: light)').matches);
    $('#themeColor').setAttribute('content', dark ? '#000000' : '#ffffff');
    const sb = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.StatusBar;
    if (sb && window.Capacitor.isNativePlatform()) {
      try {
        sb.setStyle({ style: dark ? 'DARK' : 'LIGHT' });
        sb.setBackgroundColor({ color: dark ? '#000000' : '#ffffff' });
      } catch (_) {}
    }
  }

  function updateHeader() {
    const c = current();
    const titled = c && c.messages && c.messages.length && c.title;
    $('#chatTitle').textContent = titled ? c.title : '';
    const p = profile();
    $('#micBtn').hidden = !canUseMic();
    const ready = isConfigured();
    $('#modelHint').textContent = ready ? modelLabel(settings.provider, p.model) : 'Scegli il modello';
    $('#setupHint').hidden = isConfigured();
  }

  function scrollToBottom(force) {
    const box = $('#messages');
    const near = box.scrollHeight - box.scrollTop - box.clientHeight < 140;
    if (force || near) box.scrollTop = box.scrollHeight;
  }

  // ─── Rendering messaggi ───────────────────────────────────
  function messageEl(msg, index) {
    const wrap = document.createElement('div');
    wrap.className = 'msg ' + msg.role + (msg.error ? ' error' : '');
    wrap.dataset.index = index;
    const bubble = document.createElement('div');
    bubble.className = 'bubble';
    if (msg.attachments && msg.attachments.length) wrap.appendChild(attachmentsEl(msg.attachments, false));
    if (msg.role === 'user' || msg.error) bubble.textContent = msg.content;
    else bubble.innerHTML = MD.render(msg.content);
    if (msg.content || msg.role !== 'user') wrap.appendChild(bubble);

    const actions = document.createElement('div');
    actions.className = 'msg-actions';
    if (!msg.error) actions.innerHTML = '<button type="button" data-act="copy">Copia</button>';
    if (msg.role === 'user') actions.innerHTML += '<button type="button" data-act="edit">Modifica</button>';
    else {
      actions.innerHTML +=
        '<button type="button" data-act="retry">Rigenera</button>' +
        '<button type="button" data-act="retry-with">Prova con…</button>';
      if (msg.content && !msg.error) {
        actions.innerHTML +=
          '<button type="button" data-act="share">Condividi</button>' +
          '<button type="button" data-act="push">Su GitHub</button>' +
          '<button type="button" data-act="read">Ascolta</button>';
      }
      if (msg.model) {
        const tag = document.createElement('span');
        tag.className = 'model-tag';
        tag.textContent = msg.model;
        actions.appendChild(tag);
      }
    }
    wrap.appendChild(actions);
    return wrap;
  }

  /** Anteprime degli allegati: nel messaggio (removable=false) o nel composer (true). */
  function attachmentsEl(list, removable) {
    const box = document.createElement('div');
    box.className = 'attachments';
    list.forEach((a, i) => {
      const el = document.createElement('div');
      el.className = 'att ' + a.kind + (a.dropped ? ' dropped' : '');
      if (a.kind === 'image' && (a.thumb || a.data)) {
        const img = document.createElement('img');
        img.src = 'data:image/jpeg;base64,' + (a.thumb || a.data);
        img.alt = a.name;
        el.appendChild(img);
      } else {
        const icon = document.createElement('span');
        icon.className = 'att-icon';
        icon.textContent = a.kind === 'pdf' ? '📕' : a.kind === 'image' ? '🖼' : '📄';
        const name = document.createElement('span');
        name.className = 'att-name';
        name.textContent = a.name;
        el.append(icon, name);
      }
      if (removable) {
        const x = document.createElement('button');
        x.type = 'button';
        x.className = 'att-remove';
        x.dataset.removeAtt = i;
        x.setAttribute('aria-label', 'Rimuovi allegato');
        x.textContent = '✕';
        el.appendChild(x);
      }
      box.appendChild(el);
    });
    return box;
  }

  // ─── Allegati nel composer ────────────────────────────────
  let pending = []; // allegati pronti per il prossimo messaggio

  function renderPending() {
    const box = $('#pendingAtt');
    box.innerHTML = '';
    box.hidden = !pending.length;
    if (pending.length) box.appendChild(attachmentsEl(pending, true));
  }

  function readAs(file, how) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = () => reject(r.error || new Error('Lettura file non riuscita'));
      if (how === 'text') r.readAsText(file);
      else r.readAsDataURL(file);
    });
  }

  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('Immagine non leggibile'));
      img.src = src;
    });
  }

  function scaleToJpeg(img, maxSide, quality) {
    const k = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.max(1, Math.round(img.naturalWidth * k));
    const h = Math.max(1, Math.round(img.naturalHeight * k));
    const cv = document.createElement('canvas');
    cv.width = w;
    cv.height = h;
    const ctx = cv.getContext('2d');
    ctx.fillStyle = '#fff'; // sfondo bianco per PNG trasparenti
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);
    return cv.toDataURL('image/jpeg', quality).split(',')[1];
  }

  async function fileToAttachment(file) {
    const name = file.name || 'file';
    if (/^image\//.test(file.type)) {
      const img = await loadImage(await readAs(file, 'dataurl'));
      return {
        kind: 'image',
        name,
        mime: 'image/jpeg',
        data: scaleToJpeg(img, IMAGE_MAX_SIDE, 0.85),
        thumb: scaleToJpeg(img, 240, 0.7)
      };
    }
    if (file.type === 'application/pdf' || /\.pdf$/i.test(name)) {
      if (file.size > MAX_BINARY) throw new Error('PDF troppo grande (max 8 MB): ' + name);
      return { kind: 'pdf', name, mime: 'application/pdf', data: (await readAs(file, 'dataurl')).split(',')[1] };
    }
    if (/^text\//.test(file.type) || /json|xml|javascript/.test(file.type) || TEXT_EXT.test(name)) {
      let text = await readAs(file, 'text');
      if (text.length > MAX_TEXT_FILE) text = text.slice(0, MAX_TEXT_FILE) + '\n[…file troncato…]';
      return { kind: 'text', name, mime: file.type || 'text/plain', text };
    }
    throw new Error('Tipo di file non supportato: ' + name + ' (usa immagini, PDF o file di testo)');
  }

  async function addFiles(files) {
    for (const f of Array.from(files || [])) {
      if (pending.length >= 6) {
        toast('Massimo 6 allegati per messaggio');
        break;
      }
      try {
        pending.push(await fileToAttachment(f));
      } catch (e) {
        toast(e.message || 'File non leggibile');
      }
    }
    renderPending();
  }

  function renderMessages() {
    const box = $('#messages');
    const c = current();
    box.querySelectorAll('.msg').forEach((n) => n.remove());
    const msgs = (c && c.messages) || [];
    $('#emptyState').hidden = msgs.length > 0;
    msgs.forEach((m, i) => box.appendChild(messageEl(m, i)));
    // mostra «Rigenera» solo sull'ultima risposta
    ['retry', 'retry-with'].forEach((act) => {
      box.querySelectorAll('.msg.assistant [data-act="' + act + '"]').forEach((b, i, all) => {
        b.hidden = i !== all.length - 1 || busy;
      });
    });
    box.querySelectorAll('[data-act="edit"]').forEach((b) => (b.hidden = busy));
    updateHeader();
    scrollToBottom(true);
  }

  function renderConvList() {
    const ul = $('#convList');
    ul.innerHTML = '';
    if (!conversations.length) {
      ul.innerHTML = '<li class="hint" style="padding:10px">Nessuna conversazione.</li>';
      return;
    }
    const order = ['Oggi', 'Ieri', 'Ultimi 7 giorni', 'Precedenti'];
    const groups = {};
    [...conversations]
      .sort((a, b) => b.updated - a.updated)
      .forEach((c) => {
        const label = dayGroup(c.updated);
        (groups[label] || (groups[label] = [])).push(c);
      });
    order.forEach((label) => {
      const list = groups[label];
      if (!list) return;
      const head = document.createElement('li');
      head.className = 'conv-label';
      head.textContent = label;
      ul.appendChild(head);
      list.forEach((c) => {
        const li = document.createElement('li');
        if (c.id === currentId) li.className = 'active';
        const open = document.createElement('button');
        open.type = 'button';
        open.className = 'open-conv';
        open.dataset.id = c.id;
        const title = document.createElement('span');
        title.textContent = c.title || 'Nuova chat';
        open.appendChild(title);
        const del = document.createElement('button');
        del.type = 'button';
        del.className = 'del-conv';
        del.dataset.del = c.id;
        del.setAttribute('aria-label', 'Elimina');
        del.textContent = '×';
        li.append(open, del);
        ul.appendChild(li);
      });
    });
  }

  function dayGroup(ts) {
    const d = new Date(ts);
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const then = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    const days = Math.round((start - then) / 86400000);
    if (days <= 0) return 'Oggi';
    if (days === 1) return 'Ieri';
    if (days < 7) return 'Ultimi 7 giorni';
    return 'Precedenti';
  }

  // ─── Chat ─────────────────────────────────────────────────
  function newChat() {
    if (busy) P.abort();
    const c = current();
    if (c && !c.messages.length) {
      closeDrawer();
      $('#input').focus();
      return; // già vuota
    }
    currentId = null;
    save(LS_CURRENT, currentId);
    renderMessages();
    closeDrawer();
    $('#input').focus();
  }

  function ensureConversation(firstText) {
    let c = current();
    if (!c) {
      c = { id: uid(), title: '', messages: [], created: Date.now(), updated: Date.now() };
      conversations.push(c);
      currentId = c.id;
    }
    if (!c.title && firstText) c.title = firstText.replace(/\s+/g, ' ').trim().slice(0, 48);
    return c;
  }

  function setBusy(v) {
    busy = v;
    const btn = $('#sendBtn');
    btn.classList.toggle('stop', v);
    btn.textContent = v ? '■' : '↑';
    btn.setAttribute('aria-label', v ? 'Ferma' : 'Invia');
  }

  async function runAssistant(c, pick) {
    const cfg = chatConfig(pick);
    // rimuovi eventuali errori precedenti in coda
    while (c.messages.length && c.messages[c.messages.length - 1].error) c.messages.pop();
    const history = c.messages
      .filter((m) => !m.error)
      .slice(-MAX_HISTORY)
      .map((m) => ({
        role: m.role,
        content: m.context ? m.content + '\n\n' + m.context : m.content,
        attachments: m.attachments
      }));

    setBusy(true);
    renderMessages();

    const box = $('#messages');
    const wrap = document.createElement('div');
    wrap.className = 'msg assistant';
    const bubble = document.createElement('div');
    bubble.className = 'bubble';
    bubble.innerHTML = '<span class="typing"><i></i><i></i><i></i></span>';
    wrap.appendChild(bubble);
    box.appendChild(wrap);
    scrollToBottom(true);

    // Modelli da provare: quello scelto, poi (se attivo) gli altri dell'elenco ▾ già configurati
    const attempts = [cfg];
    if (settings.autoFallback !== false) {
      settings.favorites
        .filter(
          (f) =>
            !(f.provider === cfg.provider && f.model === cfg.model) &&
            isConfigured(f) &&
            (P.isSpecialized(cfg.model) || !P.isSpecialized(f.model)) // niente modelli per il codice come ripiego
        )
        .slice(0, 3)
        .forEach((f) => attempts.push(chatConfig(f)));
    }

    let tag = modelLabel(cfg.provider, cfg.model);
    let partial = '';
    let frame = 0;
    try {
      let text = null;
      for (let i = 0; i < attempts.length && text === null; i++) {
        const a = attempts[i];
        tag = modelLabel(a.provider, a.model);
        try {
          text = await P.chat(a, history, (full) => {
            partial = full;
            if (!frame) {
              frame = requestAnimationFrame(() => {
                frame = 0;
                bubble.innerHTML = partial ? MD.render(partial) : '<span class="typing"><i></i><i></i><i></i></span>';
                scrollToBottom(false);
              });
            }
          });
          addFavorite(a.provider, a.model);
        } catch (err) {
          const next = attempts[i + 1];
          if (!next || partial || !P.isBusyError(err)) throw err;
          toast(a.model + ' è occupato: provo ' + next.model);
        }
      }
      const usedFallback = tag !== modelLabel(cfg.provider, cfg.model);
      c.messages.push({ role: 'assistant', content: text, model: (usedFallback ? '↪ ' : '') + tag });
      if (usedFallback) toast('Ha risposto ' + tag + ' perché ' + cfg.model + ' era occupato');
      save(LS_SETTINGS, settings);
    } catch (e) {
      if (e && e.name === 'AbortError') {
        if (partial.trim()) c.messages.push({ role: 'assistant', content: partial + '\n\n_(interrotto)_', model: tag });
      } else {
        if (partial.trim()) c.messages.push({ role: 'assistant', content: partial, model: tag });
        const label = (P.PRESETS[cfg.provider] || {}).label + ' (' + cfg.model + ')';
        let msg = '⚠️ ' + P.friendlyError(e, label);
        if (attempts.length > 1 && P.isBusyError(e)) msg += ' Ho provato anche: ' + attempts.slice(1).map((a) => a.model).join(', ') + '.';
        else if (attempts.length === 1 && P.isBusyError(e))
          msg += ' Suggerimento: aggiungi un secondo modello (es. Gemini) e l\'app passerà da sola a quello quando questo è occupato.';
        c.messages.push({ role: 'assistant', content: msg, error: true });
      }
    } finally {
      if (frame) cancelAnimationFrame(frame);
      c.updated = Date.now();
      persistConvs();
      setBusy(false);
      renderMessages();
      renderConvList();
    }
  }

  function needsWeb(text) {
    return /\b(cerca|sul web|su internet|notizie|meteo|prezzo|oggi|attual)/i.test(text);
  }

  async function webNotes(text) {
    const q = text.replace(/^(per favore\s+)?(cerca( sul web| su internet)?)\s+/i, '').trim().slice(0, 180);
    if (!q) return '';
    toast('Cerco sul web…');
    const parts = [];
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8000);
    try {
      const res = await fetch(
        'https://api.duckduckgo.com/?format=json&no_html=1&skip_disambig=1&q=' + encodeURIComponent(q),
        { signal: ctrl.signal }
      );
      if (res.ok) {
        const d = await res.json();
        if (d.AbstractText) parts.push((d.Heading ? d.Heading + '\n' : '') + d.AbstractText);
        (d.RelatedTopics || []).slice(0, 4).forEach((t) => {
          if (t && t.Text) parts.push(t.Text);
        });
      }
    } catch (_) {}
    try {
      const res = await fetch(
        'https://it.wikipedia.org/w/api.php?action=opensearch&limit=2&namespace=0&format=json&origin=*&search=' +
          encodeURIComponent(q),
        { signal: ctrl.signal }
      );
      if (res.ok) {
        const d = await res.json();
        (d[1] || []).forEach((title, i) => {
          parts.push(title + (d[2] && d[2][i] ? ': ' + d[2][i] : '') + (d[3] && d[3][i] ? '\n' + d[3][i] : ''));
        });
      }
    } catch (_) {}
    clearTimeout(timer);
    return parts.join('\n\n').slice(0, 6000);
  }

  async function shareText(text) {
    const body = String(text || '').trim();
    if (!body) return;
    const Share = nativePlugin('Share');
    try {
      if (Share) {
        await Share.share({ title: 'Mia', text: body.slice(0, 8000), dialogTitle: 'Condividi con…' });
        return;
      }
      if (navigator.share) {
        await navigator.share({ title: 'Mia', text: body.slice(0, 8000) });
        return;
      }
    } catch (e) {
      if (e && e.name === 'AbortError') return;
    }
    copyText(body);
    toast('Copiato. Da qui puoi incollarlo in un’altra app.');
  }

  async function pushAnswer(text) {
    const body = String(text || '').trim();
    if (!body) return;
    if (!settings.githubToken || !settings.githubRepo || settings.githubRepo.indexOf('/') < 1) {
      toast('In Impostazioni scegli il token e il repository');
      openSettings();
      return;
    }
    const slash = settings.githubRepo.indexOf('/');
    const owner = settings.githubRepo.slice(0, slash);
    const repo = settings.githubRepo.slice(slash + 1);
    const path = 'note/mia-' + new Date().toISOString().slice(0, 10) + '-' + Date.now() + '.md';
    toast('Invio su GitHub…');
    try {
      await GH.putFile(settings.githubToken, owner, repo, path, body, 'Risposta da Mia');
      toast('Salvato in ' + settings.githubRepo);
    } catch (e) {
      toast(e.message || 'Push non riuscito');
    }
  }

  function asksRepo(text) {
    return /repo|github|progetto/i.test(text) && /controll|guarda|leggi|analizz|revision|spieg|dimmi|vedi/i.test(text);
  }

  function repoNamedIn(text) {
    const m = String(text || '').match(/\b([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)\b/);
    return m ? m[1] : '';
  }

  async function send(text) {
    text = (text || '').trim();
    if ((!text && !pending.length) || busy) return;
    if (!isConfigured()) {
      toast('Configura prima il provider');
      openSettings();
      return;
    }
    let context = '';
    if (asksRepo(text)) {
      const full = repoNamedIn(text) || settings.githubRepo || (($('#ghRepo') && $('#ghRepo').value) || '');
      if (!settings.githubToken) {
        toast('Serve il token GitHub in Impostazioni');
        openSettings();
        return;
      }
      if (!full || full.indexOf('/') < 1) {
        toast('Scegli il repository in Impostazioni, poi riprova');
        openSettings();
        return;
      }
      toast('Leggo ' + full + '…');
      try {
        context =
          'Questi file li ha scaricati l\'app da GitHub. Sono già qui: non dire che non hai accesso a siti esterni. Di\' cosa fa il progetto e cosa sistemare.\n\n' +
          (await GH.readRepo(settings.githubToken, full));
        settings.githubRepo = full;
        save(LS_SETTINGS, settings);
      } catch (e) {
        toast(e.message || 'GitHub non raggiungibile');
        return;
      }
    }
    if (!context && needsWeb(text)) {
      try {
        const notes = await webNotes(text);
        if (notes) {
          context =
            'Queste note le ha cercate l\'app sul web. Usale se servono. Non dire che non hai accesso a siti esterni.\n\n' +
            notes;
        }
      } catch (_) {}
    }
    const c = ensureConversation(text || pending.map((a) => a.name).join(', '));
    const msg = { role: 'user', content: text };
    if (context) msg.context = context;
    if (pending.length) msg.attachments = pending;
    c.messages.push(msg);
    pending = [];
    renderPending();
    c.updated = Date.now();
    persistConvs();
    $('#input').value = '';
    autoGrow();
    await runAssistant(c);
  }

  function retryLast(pick) {
    const c = current();
    if (!c || busy) return;
    if (pick && !isConfigured(pick)) {
      toast('Manca la chiave per ' + (P.PRESETS[pick.provider] || {}).label);
      return;
    }
    while (c.messages.length && c.messages[c.messages.length - 1].role === 'assistant') c.messages.pop();
    if (!c.messages.length) return;
    runAssistant(c, pick);
  }

  // ─── Cambio rapido modello ────────────────────────────────
  let pickerMode = 'switch'; // 'switch' = cambia modello attivo, 'retry' = rigenera l'ultima risposta

  function openPicker(mode) {
    pickerMode = mode || 'switch';
    $('#pickerTitle').textContent = pickerMode === 'retry' ? 'Rigenera la risposta con…' : 'Scegli il modello';
    const ul = $('#pickerList');
    ul.innerHTML = '';
    const p = profile();
    if (isConfigured()) addFavorite(settings.provider, p.model);
    if (!settings.favorites.length) {
      ul.innerHTML = '<li class="hint" style="padding:10px">Nessun modello: aggiungine uno da Impostazioni.</li>';
    }
    settings.favorites.forEach((f, i) => {
      const li = document.createElement('li');
      const active = f.provider === settings.provider && f.model === p.model;
      if (active) li.className = 'active';
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'pick';
      b.dataset.pick = i;
      const name = document.createElement('span');
      name.textContent = f.model;
      const prov = document.createElement('small');
      const preset = P.PRESETS[f.provider] || P.PRESETS.custom;
      prov.textContent = preset.label + (isConfigured(f) ? '' : ' · manca la chiave');
      b.append(name, prov);
      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'del-conv';
      del.dataset.unfav = i;
      del.setAttribute('aria-label', 'Rimuovi');
      del.textContent = '✕';
      li.append(b, del);
      if (active) {
        const ok = document.createElement('span');
        ok.className = 'check';
        ok.textContent = '✓';
        b.appendChild(ok);
      }
      ul.appendChild(li);
    });
    $('#picker').hidden = false;
  }

  function closePicker() {
    $('#picker').hidden = true;
  }

  function editMessage(index) {
    const c = current();
    if (!c || busy) return;
    const msg = c.messages[index];
    if (!msg || msg.role !== 'user') return;
    $('#input').value = msg.content;
    pending = (msg.attachments || []).filter((a) => !a.dropped);
    renderPending();
    c.messages = c.messages.slice(0, index);
    c.updated = Date.now();
    persistConvs();
    renderMessages();
    autoGrow();
    $('#input').focus();
  }

  // ─── Drawer ───────────────────────────────────────────────
  function openDrawer() {
    renderConvList();
    $('#drawer').classList.add('open');
    $('#drawer').setAttribute('aria-hidden', 'false');
    $('#scrim').hidden = false;
  }
  function closeDrawer() {
    $('#drawer').classList.remove('open');
    $('#drawer').setAttribute('aria-hidden', 'true');
    $('#scrim').hidden = true;
  }

  // ─── Impostazioni ─────────────────────────────────────────
  function fillProviderFields() {
    const preset = P.PRESETS[$('#provider').value] || P.PRESETS.custom;
    const p = profile($('#provider').value);
    $('#baseUrl').value = p.baseUrl;
    $('#apiKey').value = p.apiKey;
    $('#model').value = p.model;
    $('#keyOptional').hidden = !!preset.needsKey;
    loadedModels = [];
    $('#modelBrowser').hidden = true;
    $('#modelsStatus').textContent = '';
    const hint = $('#providerHint');
    hint.textContent = '';
    if (preset.hint) {
      hint.textContent = preset.hint;
    } else if (preset.keyUrl) {
      hint.append('Chiave: ');
      const a = document.createElement('a');
      a.href = preset.keyUrl;
      a.target = '_blank';
      a.rel = 'noopener';
      a.textContent = preset.keyUrl.replace(/^https:\/\//, '');
      hint.appendChild(a);
    }
  }

  function openSettings() {
    closeDrawer();
    closePicker();
    $('#provider').value = settings.provider;
    fillProviderFields();
    $('#systemPrompt').value = settings.systemPrompt;
    $('#temperature').value = settings.temperature;
    $('#tempValue').textContent = Number(settings.temperature).toFixed(1);
    $('#theme').value = settings.theme;
    $('#autoFallback').checked = settings.autoFallback !== false;
    const gt = $('#githubToken');
    if (gt) gt.value = settings.githubToken || '';
    const sel = $('#ghRepo');
    if (sel && settings.githubRepo) {
      if (![...sel.options].some((o) => o.value === settings.githubRepo)) {
        const o = document.createElement('option');
        o.value = settings.githubRepo;
        o.textContent = settings.githubRepo;
        sel.appendChild(o);
      }
      sel.value = settings.githubRepo;
    }
    $('#settings').hidden = false;
    document.body.classList.add('sheet-open');
  }

  function saveProviderFields() {
    const pr = $('#provider').value;
    settings.provider = pr;
    settings.profiles[pr] = {
      baseUrl: $('#baseUrl').value.trim(),
      apiKey: $('#apiKey').value.trim(),
      model: $('#model').value.trim()
    };
  }

  function closeSettings() {
    saveProviderFields();
    settings.systemPrompt = $('#systemPrompt').value;
    settings.temperature = Number($('#temperature').value);
    settings.theme = $('#theme').value;
    settings.autoFallback = $('#autoFallback').checked;
    const gt = $('#githubToken');
    if (gt) settings.githubToken = gt.value.trim();
    const sel = $('#ghRepo');
    if (sel && sel.value) settings.githubRepo = sel.value;
    if (isConfigured()) addFavorite(settings.provider, profile().model);
    save(LS_SETTINGS, settings);
    applyTheme();
    updateHeader();
    $('#settings').hidden = true;
    document.body.classList.remove('sheet-open');
  }

  let loadedModels = [];

  function renderModelResults() {
    const ul = $('#modelResults');
    const q = $('#modelSearch').value.trim().toLowerCase();
    const onlyFree = $('#onlyFree').checked;
    const current = $('#model').value.trim();
    const list = loadedModels.filter(
      (m) => (!onlyFree || m.free === true) && (!q || (m.id + ' ' + m.name).toLowerCase().includes(q))
    );
    ul.innerHTML = '';
    if (!list.length) {
      ul.innerHTML = '<li class="hint" style="padding:10px">Nessun modello corrisponde.</li>';
      return;
    }
    list.slice(0, 300).forEach((m) => {
      const li = document.createElement('li');
      const b = document.createElement('button');
      b.type = 'button';
      b.dataset.model = m.id;
      if (m.id === current) b.className = 'selected';
      const title = document.createElement('span');
      title.textContent = m.name || m.id;
      const id = document.createElement('small');
      id.textContent = m.name ? m.id : '';
      const tags = document.createElement('span');
      tags.className = 'tags';
      if (m.free === true) tags.innerHTML += '<i class="tag free">gratis</i>';
      if (m.vision === true) tags.innerHTML += '<i class="tag">🖼 immagini</i>';
      b.append(title, id, tags);
      li.appendChild(b);
      ul.appendChild(li);
    });
  }

  async function loadModels() {
    saveProviderFields();
    const status = $('#modelsStatus');
    status.textContent = 'Caricamento…';
    try {
      const cfg = Object.assign({ provider: settings.provider }, profile());
      loadedModels = await P.listModels(cfg);
      const nFree = loadedModels.filter((m) => m.free === true).length;
      status.textContent = loadedModels.length
        ? loadedModels.length +
          ' modelli per chattare' +
          (nFree ? ', di cui ' + nFree + ' gratuiti' : '') +
          '. Tocca un modello per sceglierlo.'
        : 'Nessun modello restituito dal server.';
      $('#onlyFree').checked = nFree > 0;
      $('#onlyFree').parentElement.hidden = nFree === 0;
      $('#modelSearch').value = '';
      $('#modelBrowser').hidden = !loadedModels.length;
      renderModelResults();
    } catch (e) {
      status.textContent = P.friendlyError(e, (P.PRESETS[settings.provider] || {}).label);
    }
  }

  function exportChats() {
    const blob = new Blob([JSON.stringify(conversations, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'mia-ai-chat-' + new Date().toISOString().slice(0, 10) + '.json';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }

  // ─── Composer ─────────────────────────────────────────────
  function autoGrow() {
    const ta = $('#input');
    ta.style.height = 'auto';
    ta.style.height = Math.min(ta.scrollHeight, window.innerHeight * 0.4) + 'px';
    $('#composer').classList.toggle('has-text', !!ta.value.trim());
  }

  // ─── Eventi ───────────────────────────────────────────────
  function bind() {
    $('#composer').addEventListener('submit', (e) => {
      e.preventDefault();
      if (busy) P.abort();
      else send($('#input').value);
    });
    $('#input').addEventListener('input', autoGrow);
    $('#micBtn').addEventListener('click', toggleMicrophone);
    $('#attachBtn').addEventListener('click', () => !busy && $('#fileInput').click());
    $('#fileInput').addEventListener('change', async (e) => {
      await addFiles(e.target.files);
      e.target.value = '';
    });
    $('#pendingAtt').addEventListener('click', (e) => {
      const x = e.target.closest('[data-remove-att]');
      if (!x) return;
      pending.splice(Number(x.dataset.removeAtt), 1);
      renderPending();
    });
    $('#input').addEventListener('paste', (e) => {
      const files = Array.from((e.clipboardData && e.clipboardData.files) || []);
      if (files.length) {
        e.preventDefault();
        addFiles(files);
      }
    });
    $('#input').addEventListener('keydown', (e) => {
      // Invio = invia su desktop; su telefono Invio va a capo
      const touch = window.matchMedia('(pointer: coarse)').matches;
      if (e.key === 'Enter' && !e.shiftKey && !touch && !e.isComposing) {
        e.preventDefault();
        $('#composer').requestSubmit();
      }
    });

    $('#menuBtn').addEventListener('click', openDrawer);
    $('#scrim').addEventListener('click', closeDrawer);
    $('#newChatBtn').addEventListener('click', newChat);
    $('#drawerNew').addEventListener('click', newChat);

    $('#convList').addEventListener('click', (e) => {
      const open = e.target.closest('[data-id]');
      const del = e.target.closest('[data-del]');
      if (del) {
        if (!confirm('Eliminare questa conversazione?')) return;
        if (del.dataset.del === currentId) {
          if (busy) P.abort();
          currentId = null;
        }
        conversations = conversations.filter((c) => c.id !== del.dataset.del);
        persistConvs();
        renderConvList();
        renderMessages();
      } else if (open) {
        if (busy) P.abort();
        currentId = open.dataset.id;
        save(LS_CURRENT, currentId);
        renderMessages();
        closeDrawer();
      }
    });

    $('#messages').addEventListener('click', (e) => {
      const chip = e.target.closest('[data-prompt]');
      if (chip) return send(chip.dataset.prompt);
      const cc = e.target.closest('.copy-code');
      if (cc) return copyText(cc.closest('.code').querySelector('code').textContent);
      const act = e.target.closest('[data-act]');
      if (!act) return;
      const index = Number(act.closest('.msg').dataset.index);
      const c = current();
      if (act.dataset.act === 'copy' && c) copyText(c.messages[index].content);
      else if (act.dataset.act === 'retry') retryLast();
      else if (act.dataset.act === 'retry-with') openPicker('retry');
      else if (act.dataset.act === 'read' && c) readAloud(c.messages[index].content);
      else if (act.dataset.act === 'share' && c) shareText(c.messages[index].content);
      else if (act.dataset.act === 'push' && c) pushAnswer(c.messages[index].content);
      else if (act.dataset.act === 'edit') editMessage(index);
    });

    document.addEventListener('click', (e) => {
      if (e.target.closest('[data-open-settings]')) openSettings();
    });
    $('#closeSettings').addEventListener('click', closeSettings);

    $('#modelBtn').addEventListener('click', () => (isConfigured() ? openPicker('switch') : openSettings()));
    $('#closePicker').addEventListener('click', closePicker);
    $('#picker').addEventListener('click', (e) => {
      if (e.target.id === 'picker') return closePicker();
      const un = e.target.closest('[data-unfav]');
      const pk = e.target.closest('[data-pick]');
      if (un) {
        settings.favorites.splice(Number(un.dataset.unfav), 1);
        save(LS_SETTINGS, settings);
        openPicker(pickerMode);
      } else if (pk) {
        const f = settings.favorites[Number(pk.dataset.pick)];
        if (!f) return;
        closePicker();
        if (pickerMode === 'retry') retryLast(f);
        else {
          if (!isConfigured(f)) {
            selectModel(f.provider, f.model);
            toast('Inserisci la chiave per questo provider');
            openSettings();
            return;
          }
          selectModel(f.provider, f.model);
          toast('Modello: ' + modelLabel(f.provider, f.model));
        }
      }
    });
    $('#settings').addEventListener('click', (e) => {
      if (e.target.id === 'settings') closeSettings();
    });
    $('#provider').addEventListener('change', () => {
      // salva i campi del provider precedente prima di cambiare
      const prev = settings.provider;
      settings.profiles[prev] = {
        baseUrl: $('#baseUrl').value.trim(),
        apiKey: $('#apiKey').value.trim(),
        model: $('#model').value.trim()
      };
      settings.provider = $('#provider').value;
      fillProviderFields();
    });
    $('#toggleKey').addEventListener('click', () => {
      const k = $('#apiKey');
      k.type = k.type === 'password' ? 'text' : 'password';
    });
    $('#loadModels').addEventListener('click', loadModels);
    $('#modelSearch').addEventListener('input', renderModelResults);
    $('#onlyFree').addEventListener('change', renderModelResults);
    $('#modelResults').addEventListener('click', (e) => {
      const b = e.target.closest('[data-model]');
      if (!b) return;
      $('#model').value = b.dataset.model;
      saveProviderFields();
      renderModelResults();
      toast('Modello scelto: ' + b.dataset.model);
    });
    $('#temperature').addEventListener('input', (e) => {
      $('#tempValue').textContent = Number(e.target.value).toFixed(1);
    });
    $('#exportBtn').addEventListener('click', exportChats);
    $('#clearAll').addEventListener('click', () => {
      if (!confirm('Eliminare TUTTE le conversazioni? Non si può annullare.')) return;
      if (busy) P.abort();
      conversations = [];
      currentId = null;
      persistConvs();
      renderMessages();
      toast('Chat eliminate');
    });

    window.matchMedia('(prefers-color-scheme: light)').addEventListener('change', applyTheme);

    function paintNet() {
      document.documentElement.dataset.offline = navigator.onLine ? '0' : '1';
    }
    paintNet();
    window.addEventListener('online', paintNet);
    window.addEventListener('offline', () => {
      paintNet();
      toast('Connessione assente. I messaggi ripartono quando torni online.');
    });

    // Tasto «indietro» Android
    const App = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.App;
    if (App && window.Capacitor.isNativePlatform()) {
      App.addListener('backButton', () => {
        if (!$('#picker').hidden) closePicker();
        else if (!$('#settings').hidden) closeSettings();
        else if ($('#drawer').classList.contains('open')) closeDrawer();
        else if (busy) P.abort();
        else App.exitApp();
      });
    }
  }

  // ─── Avvio ────────────────────────────────────────────────
  function init() {
    const sel = $('#provider');
    Object.entries(P.PRESETS).forEach(([id, p]) => {
      const o = document.createElement('option');
      o.value = id;
      o.textContent = p.label;
      sel.appendChild(o);
    });
    if (!P.PRESETS[settings.provider]) settings.provider = 'gemini';
    if (currentId && !current()) currentId = null;
    applyTheme();
    bind();
    renderMessages();
    initSpeechRecognition();
  }


  // ─── Voce: microfono e lettura ────────────────────────────
  let recognition = null;
  let isListening = false;
  let speaking = false;
  let currentUtterance = null;
  const nativePlugins = {};

  function isNative() {
    return !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
  }

  function nativePlugin(name) {
    if (!isNative() || !window.Capacitor.registerPlugin) return null;
    if (!Object.prototype.hasOwnProperty.call(nativePlugins, name)) {
      try {
        nativePlugins[name] = window.Capacitor.registerPlugin(name);
      } catch (_) {
        nativePlugins[name] = null;
      }
    }
    return nativePlugins[name];
  }

  function canUseMic() {
    return !!nativePlugin('SpeechRecognition') || 'webkitSpeechRecognition' in window || 'SpeechRecognition' in window;
  }

  function plainSpeech(text) {
    return String(text || '')
      .replace(/```[\s\S]*?```/g, ' ')
      .replace(/[#>*_`[\]]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 3500);
  }

  function initSpeechRecognition() {
    if (!('webkitSpeechRecognition' in window) && !('SpeechRecognition' in window)) return false;
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    recognition = new SpeechRecognition();
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.lang = 'it-IT';
    recognition.onstart = function () {
      isListening = true;
      $('#micBtn').classList.add('listening');
      toast('Ascoltando…');
    };
    recognition.onend = function () {
      isListening = false;
      $('#micBtn').classList.remove('listening');
    };
    recognition.onresult = function (event) {
      const transcript = event.results[0][0].transcript;
      const input = $('#input');
      input.value = ((input.value || '').trim() + ' ' + transcript).trim();
      input.focus();
      input.dispatchEvent(new Event('input', { bubbles: true }));
    };
    recognition.onerror = function (event) {
      isListening = false;
      $('#micBtn').classList.remove('listening');
      if (event.error === 'not-allowed') toast('Permesso microfono negato');
      else if (event.error === 'service-not-allowed' || event.error === 'language-not-supported') {
        toast('Manca il riconoscimento vocale di Google');
      } else if (event.error !== 'no-speech' && event.error !== 'aborted') {
        toast('Errore microfono: ' + event.error);
      }
    };
    return true;
  }

  async function toggleMicrophone() {
    const SR = nativePlugin('SpeechRecognition');
    if (SR) {
      if (isListening) {
        isListening = false;
        $('#micBtn').classList.remove('listening');
        try {
          await SR.stop();
        } catch (_) {}
        return;
      }
      try {
        const avail = await SR.available();
        if (avail && avail.available === false) {
          toast('Installa il riconoscimento vocale di Google');
          return;
        }
        const perm = await SR.requestPermissions();
        const state = perm && (perm.speechRecognition || perm.recordAudio);
        if (state && state !== 'granted') {
          toast('Permesso microfono negato. Attivalo nelle impostazioni dell’app.');
          return;
        }
        isListening = true;
        $('#micBtn').classList.add('listening');
        toast('Parla…');
        const result = await SR.start({
          language: 'it-IT',
          maxResults: 3,
          prompt: 'Parla in italiano',
          partialResults: false,
          popup: true
        });
        const said = result && result.matches && result.matches[0];
        if (said) {
          const input = $('#input');
          input.value = ((input.value || '').trim() + ' ' + said).trim();
          input.dispatchEvent(new Event('input', { bubbles: true }));
        } else toast('Non ho sentito nulla');
      } catch (e) {
        const msg = String((e && (e.message || e.errorMessage)) || '');
        if (/permission/i.test(msg)) toast('Permesso microfono negato');
        else if (/not available|unavailable|no match/i.test(msg)) toast('Riconoscimento vocale non disponibile');
        else toast('Microfono non disponibile');
      } finally {
        isListening = false;
        $('#micBtn').classList.remove('listening');
      }
      return;
    }

    if (!recognition && !initSpeechRecognition()) {
      toast('Microfono non supportato su questo telefono');
      return;
    }
    if (isListening) recognition.stop();
    else {
      try {
        recognition.start();
      } catch (_) {
        toast('Impossibile avviare il microfono');
      }
    }
  }

  function speakWeb(plain) {
    const synth = window.speechSynthesis;
    if (!synth) {
      toast('Lettura vocale non disponibile');
      return;
    }
    if (synth.speaking || speaking) {
      speaking = false;
      synth.cancel();
      toast('Lettura ferma');
      return;
    }
    const run = () => {
      const utterance = new SpeechSynthesisUtterance(plain);
      currentUtterance = utterance;
      utterance.lang = 'it-IT';
      utterance.rate = 1;
      const voices = synth.getVoices();
      const voice =
        voices.find((v) => /^it([-_]|$)/i.test(v.lang)) ||
        voices.find((v) => /google/i.test(v.name));
      if (voice) utterance.voice = voice;
      utterance.onstart = () => {
        speaking = true;
      };
      utterance.onend = () => {
        speaking = false;
      };
      utterance.onerror = () => {
        speaking = false;
        toast('Lettura non riuscita. Controlla la sintesi vocale di Google.');
      };
      try {
        synth.resume();
      } catch (_) {}
      synth.speak(utterance);
    };
    synth.cancel();
    setTimeout(run, 150);
  }

  async function readAloud(text) {
    const plain = plainSpeech(text);
    if (!plain) return;
    const TTS = nativePlugin('TextToSpeech');
    if (TTS) {
      try {
        if (speaking) {
          speaking = false;
          await TTS.stop();
          toast('Lettura ferma');
          return;
        }
        speaking = true;
        toast('Leggo…');
        await TTS.speak({
          text: plain,
          lang: 'it-IT',
          rate: 1.0,
          pitch: 1.0,
          volume: 1.0,
          category: 'playback'
        });
      } catch (e) {
        const msg = String((e && (e.message || e.errorMessage)) || '');
        if (/not supported|unavailable|language/i.test(msg)) {
          toast('Installa la voce italiana della sintesi vocale di Google');
        } else toast('Lettura non disponibile');
      } finally {
        speaking = false;
      }
      return;
    }
    speakWeb(plain);
  }

  if (window.speechSynthesis) {
    window.speechSynthesis.onvoiceschanged = function () {};
  }

  init();
})();
