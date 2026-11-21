/* Mia AI — UI leggera per GitHub (esporta chat) */
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
    toast._t = setTimeout(() => (t.hidden = true), 2500);
  }

  function getToken() {
    try {
      const s = JSON.parse(localStorage.getItem('miaai_v1_settings') || '{}');
      return s.githubToken || '';
    } catch (_) {
      return '';
    }
  }

  function setToken(token) {
    try {
      const s = JSON.parse(localStorage.getItem('miaai_v1_settings') || '{}');
      s.githubToken = token;
      localStorage.setItem('miaai_v1_settings', JSON.stringify(s));
    } catch (_) {}
  }

  function currentChatMarkdown() {
    try {
      const convs = JSON.parse(localStorage.getItem('miaai_v1_conversations') || '[]');
      const curId = localStorage.getItem('miaai_v1_current');
      const c = convs.find((x) => x.id === curId) || convs[0];
      if (!c || !c.messages || !c.messages.length) return null;
      let md = '# ' + (c.title || 'Chat Mia AI') + '\n\n';
      md += '_Esportata il ' + new Date().toLocaleString('it-IT') + '_\n\n';
      c.messages.forEach((m) => {
        if (m.error) return;
        const role = m.role === 'user' ? '**Tu**' : '**Mia**';
        md += role + '\n\n' + (m.content || '') + '\n\n---\n\n';
      });
      return { md, title: c.title || 'chat' };
    } catch (_) {
      return null;
    }
  }

  async function exportCurrentChat() {
    const token = getToken();
    if (!token) {
      toast('Inserisci prima il token GitHub');
      return;
    }
    const data = currentChatMarkdown();
    if (!data) {
      toast('Nessuna chat da esportare');
      return;
    }

    const owner = prompt('Owner del repository (es. micmax1000-afk):');
    if (!owner) return;
    const repo = prompt('Nome del repository:');
    if (!repo) return;
    const path = prompt('Percorso file (es. chats/chat.md):', 'chats/' + data.title.replace(/[^a-z0-9\-_]/gi, '_') + '.md');
    if (!path) return;
    const message = prompt('Messaggio di commit:', 'Esporta chat da Mia AI');

    try {
      let sha;
      try {
        const existing = await GH.getFile(token, owner, repo, path);
        sha = existing.sha;
      } catch (e) {
        if (e.status !== 404) throw e;
      }
      await GH.putFile(token, owner, repo, path, data.md, message || 'Esporta chat da Mia AI', sha);
      toast('Chat esportata su GitHub');
    } catch (e) {
      toast('Errore GitHub: ' + (e.message || e));
    }
  }

  function init() {
    const tokenInput = $('#githubToken');
    const testBtn = $('#testGithub');
    if (!tokenInput || !testBtn) return;

    tokenInput.addEventListener('change', () => setToken(tokenInput.value.trim()));

    testBtn.addEventListener('click', async () => {
      const token = tokenInput.value.trim();
      if (!token) {
        toast('Inserisci il token');
        return;
      }
      setToken(token);
      try {
        const u = await GH.me(token);
        toast('GitHub OK: ' + u.login);
      } catch (e) {
        toast('Token non valido: ' + (e.message || e));
      }
    });

    // Pulsante esporta chat
    const exportBtn = document.createElement('button');
    exportBtn.type = 'button';
    exportBtn.className = 'btn small';
    exportBtn.textContent = 'Esporta chat corrente su GitHub';
    exportBtn.style.marginTop = '8px';
    exportBtn.addEventListener('click', exportCurrentChat);

    const field = tokenInput.closest('.field');
    if (field) field.appendChild(exportBtn);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
