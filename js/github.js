/* Mia AI — integrazione GitHub (token personale) */
(function (global) {
  'use strict';

  const API = 'https://api.github.com';

  function headers(token) {
    const h = {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28'
    };
    if (token) h.Authorization = 'Bearer ' + token;
    return h;
  }

  async function request(token, path, opts) {
    const res = await fetch(API + path, Object.assign({ headers: headers(token) }, opts || {}));
    if (!res.ok) {
      let msg = res.status + ' ' + res.statusText;
      try {
        const d = await res.json();
        if (/not accessible by personal access token/i.test(d.message || '')) {
          msg = 'Il token non può leggere o scrivere i file. Su GitHub, nel token, imposta Contents su Read and write per questo repository.';
        } else if (res.status === 404) {
          msg = 'File o repository non trovato.';
        } else {
          msg = d.message || msg;
        }
      } catch (_) {}
      const err = new Error(msg);
      err.status = res.status;
      throw err;
    }
    if (res.status === 204) return null;
    return res.json();
  }

  /** Lista i repository dell'utente autenticato (massimo 100). */
  async function listRepos(token) {
    return request(token, '/user/repos?per_page=100&sort=updated');
  }

  /** Contenuto di un file (base64). */
  function encPath(path) {
    return String(path || '').split('/').filter(Boolean).map(encodeURIComponent).join('/');
  }

  async function getFile(token, owner, repo, path, ref) {
    const q = ref ? '?ref=' + encodeURIComponent(ref) : '';
    return request(token, '/repos/' + owner + '/' + repo + '/contents/' + encPath(path) + q);
  }

  /**
   * Crea o aggiorna un file (commit).
   * Se il file esiste, passa lo sha corrente.
   */
  async function putFile(token, owner, repo, path, content, message, sha, branch) {
    const body = {
      message: message || 'Update via Mia AI',
      content: btoa(unescape(encodeURIComponent(content))) // UTF-8 safe base64
    };
    if (sha) body.sha = sha;
    if (branch) body.branch = branch;
    return request(token, '/repos/' + owner + '/' + repo + '/contents/' + encPath(path), {
      method: 'PUT',
      body: JSON.stringify(body)
    });
  }

  /** Info utente autenticato. */
  async function me(token) {
    return request(token, '/user');
  }

  function decodeB64(b64) {
    const bin = atob(String(b64 || '').replace(/\n/g, ''));
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  }

  /** Testo del repository (radice + README e pochi file) da passare al modello. */
  async function readRepo(token, fullName) {
    const slash = String(fullName || '').indexOf('/');
    if (slash < 1) throw new Error('Scegli un repository');
    const owner = fullName.slice(0, slash);
    const repo = fullName.slice(slash + 1);
    const meta = await request(token, '/repos/' + owner + '/' + repo);
    const root = await request(token, '/repos/' + owner + '/' + repo + '/contents');
    const items = Array.isArray(root) ? root : [];
    let out = 'Repository: ' + fullName + '\n';
    out += 'Descrizione: ' + (meta.description || 'nessuna') + '\n';
    out += 'Branch: ' + (meta.default_branch || 'main') + '\n\nFile nella radice:\n';
    items.forEach((it) => {
      out += '- ' + it.type + ' ' + it.path + '\n';
    });
    const files = items.filter((it) => it.type === 'file');
    const first = ['README.md', 'readme.md', 'package.json', 'index.html', 'capacitor.config.json'];
    const ordered = [];
    first.forEach((name) => {
      const hit = files.find((f) => f.name.toLowerCase() === name.toLowerCase());
      if (hit) ordered.push(hit);
    });
    files.forEach((f) => {
      if (ordered.length < 8 && ordered.indexOf(f) < 0) ordered.push(f);
    });
    for (const f of ordered) {
      if (out.length > 18000) break;
      if (!/\.(md|txt|json|js|mjs|html|css|yml|yaml|xml|py|java|kt|gradle|toml)$/i.test(f.name) && !/^readme/i.test(f.name)) continue;
      if (f.size > 50000) {
        out += '\n[' + f.path + ' troppo grande, non letto]\n';
        continue;
      }
      const file = await getFile(token, owner, repo, f.path);
      let text = '';
      try {
        text = decodeB64(file.content || '');
      } catch (_) {
        continue;
      }
      if (text.length > 5000) text = text.slice(0, 5000) + '\n[…troncato…]';
      out += '\n----- ' + f.path + ' -----\n' + text + '\n';
    }
    return out.slice(0, 20000);
  }

  global.MiaGitHub = { listRepos, getFile, putFile, me, readRepo };
})(window);
