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
        msg = (d.message || msg) + (d.documentation_url ? ' — ' + d.documentation_url : '');
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

  global.MiaGitHub = { listRepos, getFile, putFile, me };
})(window);
