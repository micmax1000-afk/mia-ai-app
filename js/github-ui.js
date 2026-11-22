/* Mia AI — pannello GitHub nelle Impostazioni */
(function () {
  'use strict';

  const GH = window.MiaGitHub;
  const $ = (s) => document.querySelector(s);

  function toast(msg) {
    const t = $('#toast');
    if (!t) return;
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toast._t);
    toast._t = setTimeout(() => (t.hidden = true), 2400);
  }

  function settings() {
    try {
      return JSON.parse(localStorage.getItem('miaai_v1_settings') || '{}');
    } catch (_) {
      return {};
    }
  }

  function saveToken(token) {
    const s = settings();
    s.githubToken = token;
    try {
      localStorage.setItem('miaai_v1_settings', JSON.stringify(s));
    } catch (_) {}
  }

  function token() {
    const field = $('#githubToken');
    return ((field && field.value) || settings().githubToken || '').trim();
  }

  function status(msg) {
    const el = $('#ghStatus');
    if (el) el.textContent = msg;
  }

  function selectedRepo() {
    const v = ($('#ghRepo') && $('#ghRepo').value) || '';
    const i = v.indexOf('/');
    if (i < 1) return null;
    return { owner: v.slice(0, i), repo: v.slice(i + 1) };
  }

  function currentChatMarkdown() {
    try {
      const convs = JSON.parse(localStorage.getItem('miaai_v1_conversations') || '[]');
      const raw = localStorage.getItem('miaai_v1_current');
      const curId = raw && raw[0] === '"' ? JSON.parse(raw) : raw;
      const c = convs.find((x) => x.id === curId) || null;
      if (!c || !c.messages || !c.messages.length) return null;
      let md = '# ' + (c.title || 'Chat') + '\n\n';
      md += '_Esportata da Mia il ' + new Date().toLocaleString('it-IT') + '_\n\n';
      c.messages.forEach((m) => {
        if (m.error || m.role === 'tool' || !(m.content || '').trim()) return; // salta i risultati degli strumenti e i passaggi senza testo
        md += (m.role === 'user' ? '**Tu**' : '**Mia**') + '\n\n' + (m.content || '') + '\n\n';
      });
      const slug = (c.title || 'chat').replace(/[^a-z0-9\-_]+/gi, '-').replace(/^-|-$/g, '').slice(0, 48) || 'chat';
      return { md, slug };
    } catch (_) {
      return null;
    }
  }

  async function put(path, content, message) {
    const tok = token();
    const repo = selectedRepo();
    if (!tok) throw new Error('Inserisci il token GitHub');
    if (!repo) throw new Error('Scegli un repository');
    if (!path) throw new Error('Scrivi il percorso del file');
    saveToken(tok);
    let sha;
    try {
      const existing = await GH.getFile(tok, repo.owner, repo.repo, path);
      sha = existing.sha;
    } catch (e) {
      if (e.status !== 404) throw e;
    }
    await GH.putFile(tok, repo.owner, repo.repo, path, content, message, sha);
  }

  function init() {
    const testBtn = $('#testGithub');
    const tokenInput = $('#githubToken');
    if (!testBtn || !tokenInput || !GH) return;

    tokenInput.addEventListener('change', () => saveToken(tokenInput.value.trim()));

    testBtn.addEventListener('click', async () => {
      const tok = tokenInput.value.trim();
      if (!tok) return toast('Inserisci il token');
      saveToken(tok);
      try {
        const u = await GH.me(tok);
        toast('GitHub: ' + u.login);
        status('Connesso come ' + u.login);
      } catch (e) {
        toast('Token non valido');
        status(e.message || 'Errore');
      }
    });

    $('#ghLoadRepos').addEventListener('click', async () => {
      const tok = token();
      if (!tok) return toast('Inserisci il token');
      saveToken(tok);
      status('Carico i repository…');
      try {
        const repos = await GH.listRepos(tok);
        const sel = $('#ghRepo');
        const current = sel.value;
        sel.innerHTML = '<option value="">Scegli un repository</option>';
        (repos || []).forEach((r) => {
          const o = document.createElement('option');
          o.value = r.full_name;
          o.textContent = r.full_name;
          sel.appendChild(o);
        });
        if (current) sel.value = current;
        const saved = settings().githubRepo;
        if (saved) sel.value = saved;
        status((repos || []).length + ' repository');
      } catch (e) {
        status(e.message || 'Errore');
      }
    });

    $('#ghRepo').addEventListener('change', () => {
      const s = settings();
      s.githubRepo = $('#ghRepo').value;
      try {
        localStorage.setItem('miaai_v1_settings', JSON.stringify(s));
      } catch (_) {}
    });

    $('#ghReview').addEventListener('click', () => {
      const repo = selectedRepo();
      if (!token()) return toast('Inserisci il token');
      if (!repo) return toast('Scegli un repository');
      const s = settings();
      s.githubToken = token();
      s.githubRepo = repo.owner + '/' + repo.repo;
      try {
        localStorage.setItem('miaai_v1_settings', JSON.stringify(s));
      } catch (_) {}
      $('#closeSettings').click();
      const input = $('#input');
      input.value = 'Controlla il repository ' + s.githubRepo;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      $('#composer').requestSubmit();
    });

    $('#ghExportChat').addEventListener('click', async () => {
      const data = currentChatMarkdown();
      if (!data) return toast('Nessuna chat da esportare');
      const pathInput = $('#ghPath');
      if (!pathInput.value.trim()) pathInput.value = 'note/' + data.slug + '.md';
      try {
        status('Salvataggio…');
        await put(pathInput.value.trim(), data.md, 'Chat da Mia');
        status('Chat salvata');
        toast('Chat salvata su GitHub');
      } catch (e) {
        status(e.message || 'Errore');
        toast(e.message || 'Errore GitHub');
      }
    });

    $('#ghPutFile').addEventListener('click', async () => {
      const body = $('#ghFileBody').value;
      if (!body.trim()) return toast('Il file è vuoto');
      try {
        status('Salvataggio…');
        await put($('#ghPath').value.trim(), body, 'File da Mia');
        status('File salvato');
        toast('File salvato su GitHub');
      } catch (e) {
        status(e.message || 'Errore');
        toast(e.message || 'Errore GitHub');
      }
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
