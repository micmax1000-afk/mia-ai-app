/* Mia AI — client MCP (Model Context Protocol, trasporto «Streamable HTTP») */
(function (global) {
  'use strict';

  const PROTOCOL = '2025-06-18';
  const state = {}; // id server → { sessionId, protocol, tools, info, ts }
  let nextId = 1;

  function nativeHttp() {
    const C = global.Capacitor;
    return C && C.isNativePlatform && C.isNativePlatform() && C.Plugins && C.Plugins.CapacitorHttp;
  }

  function lowerKeys(h) {
    const o = {};
    Object.keys(h || {}).forEach((k) => (o[k.toLowerCase()] = h[k]));
    return o;
  }

  function withAbort(promise, signal) {
    if (!signal) return promise;
    return new Promise((resolve, reject) => {
      const onAbort = () => {
        const e = new Error('Interrotto');
        e.name = 'AbortError';
        reject(e);
      };
      if (signal.aborted) return onAbort();
      signal.addEventListener('abort', onAbort, { once: true });
      promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort));
    });
  }

  /** Estrae da una risposta SSE il messaggio JSON-RPC con l'id richiesto. */
  function fromSse(text, id) {
    let found = null;
    text.split(/\r?\n\r?\n/).forEach((block) => {
      const data = block
        .split(/\r?\n/)
        .filter((l) => l.startsWith('data:'))
        .map((l) => l.slice(5).replace(/^ /, ''))
        .join('\n');
      if (!data) return;
      try {
        const m = JSON.parse(data);
        (Array.isArray(m) ? m : [m]).forEach((x) => {
          if (x && x.id === id && ('result' in x || 'error' in x)) found = x;
        });
      } catch (_) {}
    });
    return found;
  }

  async function post(server, body, signal) {
    const st = state[server.id] || (state[server.id] = {});
    const headers = { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' };
    if (server.token) headers.Authorization = 'Bearer ' + server.token;
    if (st.sessionId) headers['Mcp-Session-Id'] = st.sessionId;
    if (st.protocol && body.method !== 'initialize') headers['MCP-Protocol-Version'] = st.protocol;

    let status;
    let ctype;
    let text;
    let sid;
    const http = nativeHttp();
    if (http) {
      // su Android: richiesta nativa, senza i limiti CORS del browser
      const r = await withAbort(http.request({ url: server.url, method: 'POST', headers, data: body, connectTimeout: 15000, readTimeout: 60000 }), signal);
      const h = lowerKeys(r.headers);
      status = r.status;
      ctype = h['content-type'] || '';
      sid = h['mcp-session-id'];
      text = typeof r.data === 'string' ? r.data : JSON.stringify(r.data == null ? '' : r.data);
    } else {
      const res = await fetch(server.url, { method: 'POST', headers, body: JSON.stringify(body), signal });
      status = res.status;
      ctype = res.headers.get('content-type') || '';
      sid = res.headers.get('mcp-session-id');
      text = await res.text();
    }
    if (sid) st.sessionId = sid;
    return { status, ctype, text };
  }

  function httpError(r, server) {
    if (r.status === 401 || r.status === 403) return new Error('Il server «' + server.name + '» ha rifiutato l\'accesso (HTTP ' + r.status + '): controlla il token.');
    let detail = '';
    try {
      const j = JSON.parse(r.text);
      detail = (j.error && (j.error.message || j.error)) || j.message || '';
    } catch (_) {
      detail = String(r.text || '').replace(/\s+/g, ' ').slice(0, 160);
    }
    return new Error('Il server «' + server.name + '» ha risposto con un errore (HTTP ' + r.status + ')' + (detail ? ': ' + detail : '') + '.');
  }

  async function rpc(server, method, params, signal, retried) {
    const id = nextId++;
    const r = await post(server, { jsonrpc: '2.0', id, method, params: params || {} }, signal);
    if (r.status === 404 && state[server.id] && state[server.id].sessionId && !retried && method !== 'initialize') {
      await connect(server, signal); // sessione scaduta: nuova inizializzazione e un nuovo tentativo
      return rpc(server, method, params, signal, true);
    }
    if (r.status < 200 || r.status >= 300) throw httpError(r, server);
    let msg = null;
    if (/text\/event-stream/i.test(r.ctype)) msg = fromSse(r.text, id);
    else {
      try {
        const j = JSON.parse(r.text);
        msg = Array.isArray(j) ? j.find((x) => x && x.id === id) : j;
      } catch (_) {}
    }
    if (!msg) throw new Error('Risposta non valida dal server «' + server.name + '».');
    if (msg.error) throw new Error(msg.error.message || 'Errore del server MCP');
    return msg.result;
  }

  async function notify(server, method, signal) {
    try {
      await post(server, { jsonrpc: '2.0', method }, signal);
    } catch (_) {}
  }

  /** Inizializza la connessione e legge l'elenco degli strumenti. */
  async function connect(server, signal) {
    if (!/^https?:\/\//i.test(server.url || '')) throw new Error('Indirizzo non valido: deve iniziare con http:// o https://');
    state[server.id] = {};
    const init = await rpc(server, 'initialize', { protocolVersion: PROTOCOL, capabilities: {}, clientInfo: { name: 'Mia AI', version: '0.1.0' } }, signal, true);
    state[server.id].protocol = (init && init.protocolVersion) || PROTOCOL;
    await notify(server, 'notifications/initialized', signal);
    const tools = [];
    let cursor;
    for (let page = 0; page < 5; page++) {
      const r = await rpc(server, 'tools/list', cursor ? { cursor } : {}, signal, true);
      (r.tools || []).forEach((t) => t && t.name && tools.push(t));
      cursor = r.nextCursor;
      if (!cursor) break;
    }
    Object.assign(state[server.id], { tools, info: (init && init.serverInfo) || {}, ts: Date.now() });
    return { tools, info: state[server.id].info };
  }

  async function call(server, name, args, signal) {
    if (!state[server.id] || !state[server.id].protocol) await connect(server, signal);
    return rpc(server, 'tools/call', { name, arguments: args || {} }, signal);
  }

  const cached = (server) => state[server.id] && state[server.id].tools && Date.now() - state[server.id].ts < 10 * 60 * 1000 ? state[server.id] : null;
  const forget = (id) => delete state[id];

  global.MiaMcp = { connect, call, cached, forget };
})(window);
