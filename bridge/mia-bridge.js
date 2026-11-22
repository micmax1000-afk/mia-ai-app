#!/usr/bin/env node
/*
 * Mia Bridge — piccolo server MCP (Streamable HTTP) da eseguire sul TUO computer.
 * Permette a Mia (l'app) di lavorare su una cartella del computer: eseguire comandi,
 * leggere, scrivere e modificare file. Nessuna dipendenza: serve solo Node 18 o più recente.
 *
 *   node mia-bridge.js --root ~/progetti/mio-progetto
 *
 * ATTENZIONE: «run_command» esegue comandi veri con i tuoi permessi, NON in un ambiente isolato.
 * L'app chiede conferma per ogni azione che non è di sola lettura, ma chi ha il token può fare lo stesso.
 * Non condividere il token e non esporre la porta a internet senza un tunnel con accesso protetto.
 */
'use strict';

const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');

const VERSION = '0.1.0';
const MAX_OUT = 20000; // caratteri di output restituiti
const MAX_READ = 200 * 1024; // byte letti da un file
const MAX_BODY = 5 * 1024 * 1024;

// ─── Argomenti ────────────────────────────────────────────────
function parseArgs(argv) {
  const o = { port: 8787, host: '127.0.0.1', root: process.cwd(), token: '', readonly: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    if (a === '--root') o.root = next();
    else if (a === '--token') o.token = next();
    else if (a === '--port') o.port = Number(next());
    else if (a === '--host') o.host = next();
    else if (a === '--readonly') o.readonly = true;
    else if (a === '-h' || a === '--help') o.help = true;
    else throw new Error('Opzione sconosciuta: ' + a);
  }
  return o;
}

const HELP = `Mia Bridge ${VERSION}
Uso: node mia-bridge.js [opzioni]
  --root <cartella>   cartella di lavoro (predefinita: quella corrente). I file restano dentro questa cartella.
  --token <testo>     token di accesso (se manca ne viene creato uno casuale e stampato)
  --port <numero>     porta (predefinita 8787)
  --host <indirizzo>  indirizzo di ascolto (predefinito 127.0.0.1 = solo questo computer;
                      usa 0.0.0.0 per farti raggiungere dal telefono sulla stessa rete Wi-Fi)
  --readonly          solo lettura: niente comandi, scritture o modifiche`;

// ─── Percorsi sicuri dentro la cartella di lavoro ─────────────
function makeResolver(root) {
  const realRoot = fs.realpathSync(root);
  const inside = (p) => p === realRoot || p.startsWith(realRoot + path.sep);
  return function resolveInside(rel) {
    const abs = path.resolve(realRoot, String(rel || '.'));
    // risolve i collegamenti simbolici del primo antenato esistente, per non uscire dalla cartella
    let probe = abs;
    while (!fs.existsSync(probe)) {
      const up = path.dirname(probe);
      if (up === probe) break;
      probe = up;
    }
    const real = fs.realpathSync(probe);
    if (!inside(real) || !inside(abs)) throw new Error('Percorso fuori dalla cartella di lavoro: ' + rel);
    return abs;
  };
}

const clip = (s, n) => (s.length > n ? s.slice(0, n) + '\n[…troncato: ' + (s.length - n) + ' caratteri in più…]' : s);

// ─── Strumenti ────────────────────────────────────────────────
function buildTools(opts, resolveInside) {
  const text = (t, isError) => ({ content: [{ type: 'text', text: String(t) }], isError: !!isError });
  const tools = [];
  const add = (name, description, properties, required, annotations, run, writes) => {
    if (writes && opts.readonly) return;
    tools.push({ name, description, inputSchema: { type: 'object', properties, required }, annotations, run });
  };

  add(
    'list_dir',
    'Elenca i file e le cartelle di una cartella (percorso relativo alla cartella di lavoro).',
    { path: { type: 'string', description: 'Cartella, es. «src». Vuoto = cartella di lavoro.' } },
    [],
    { readOnlyHint: true },
    async (a) => {
      const dir = resolveInside(a.path);
      const names = fs.readdirSync(dir, { withFileTypes: true }).slice(0, 500);
      return text(names.map((d) => (d.isDirectory() ? '📁 ' : '📄 ') + d.name).join('\n') || '(cartella vuota)');
    }
  );

  add(
    'read_file',
    'Legge un file di testo (percorso relativo alla cartella di lavoro).',
    { path: { type: 'string', description: 'Percorso del file.' } },
    ['path'],
    { readOnlyHint: true },
    async (a) => {
      const f = resolveInside(a.path);
      const st = fs.statSync(f);
      if (!st.isFile()) throw new Error('Non è un file: ' + a.path);
      const buf = fs.readFileSync(f).subarray(0, MAX_READ);
      if (buf.includes(0)) throw new Error('File binario: non leggibile come testo.');
      return text(buf.toString('utf8') + (st.size > MAX_READ ? '\n[…file troncato: ' + st.size + ' byte in tutto…]' : ''));
    }
  );

  add(
    'write_file',
    'Crea o sostituisce un file con il contenuto indicato (crea anche le cartelle mancanti).',
    { path: { type: 'string', description: 'Percorso del file.' }, content: { type: 'string', description: 'Contenuto completo.' } },
    ['path', 'content'],
    { readOnlyHint: false, destructiveHint: true },
    async (a) => {
      const f = resolveInside(a.path);
      fs.mkdirSync(path.dirname(f), { recursive: true });
      const existed = fs.existsSync(f);
      fs.writeFileSync(f, String(a.content));
      return text((existed ? 'Sostituito: ' : 'Creato: ') + a.path + ' (' + Buffer.byteLength(String(a.content)) + ' byte)');
    },
    true
  );

  add(
    'edit_file',
    'Modifica un file sostituendo un frammento di testo esatto con un altro. Il frammento da cambiare deve comparire una sola volta.',
    {
      path: { type: 'string', description: 'Percorso del file.' },
      old_text: { type: 'string', description: 'Testo da sostituire (copiato esattamente dal file, deve essere unico).' },
      new_text: { type: 'string', description: 'Testo nuovo.' }
    },
    ['path', 'old_text', 'new_text'],
    { readOnlyHint: false, destructiveHint: true },
    async (a) => {
      const f = resolveInside(a.path);
      const src = fs.readFileSync(f, 'utf8');
      const n = a.old_text ? src.split(a.old_text).length - 1 : 0;
      if (n === 0) throw new Error('Il testo da sostituire non è stato trovato.');
      if (n > 1) throw new Error('Il testo da sostituire compare ' + n + ' volte: aggiungi più contesto per renderlo unico.');
      fs.writeFileSync(f, src.replace(a.old_text, () => String(a.new_text)));
      return text('Modificato: ' + a.path);
    },
    true
  );

  add(
    'run_command',
    'Esegue un comando di shell nel computer, nella cartella di lavoro (o in una sua sottocartella). Restituisce output e codice di uscita.',
    {
      command: { type: 'string', description: 'Comando, es. «npm test» o «git status».' },
      cwd: { type: 'string', description: 'Sottocartella in cui eseguirlo (facoltativa).' },
      timeout_seconds: { type: 'integer', description: 'Tempo massimo in secondi (1-300, predefinito 60).' }
    },
    ['command'],
    { readOnlyHint: false, destructiveHint: true, openWorldHint: true },
    (a) =>
      new Promise((resolve, reject) => {
        const cwd = resolveInside(a.cwd);
        const secs = Math.min(300, Math.max(1, Math.floor(Number(a.timeout_seconds)) || 60));
        const win = process.platform === 'win32';
        const child = spawn(String(a.command), { cwd, shell: true, detached: !win, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
        let out = '';
        let timedOut = false;
        const grab = (d) => {
          if (out.length < MAX_OUT * 4) out += d.toString('utf8');
        };
        child.stdout.on('data', grab);
        child.stderr.on('data', grab);
        const kill = () => {
          try {
            if (win) spawn('taskkill', ['/pid', String(child.pid), '/T', '/F']);
            else process.kill(-child.pid, 'SIGKILL');
          } catch (_) {
            try {
              child.kill('SIGKILL');
            } catch (_2) {}
          }
        };
        const timer = setTimeout(() => {
          timedOut = true;
          kill();
        }, secs * 1000);
        child.on('error', (e) => {
          clearTimeout(timer);
          reject(e);
        });
        child.on('close', (code, signal) => {
          clearTimeout(timer);
          const tail = out.length > MAX_OUT ? '[…output iniziale omesso…]\n' + out.slice(-MAX_OUT) : out;
          resolve(
            text('$ ' + a.command + '\n' + (tail || '(nessun output)') + '\n' + (timedOut ? '[interrotto: tempo scaduto dopo ' + secs + ' s]' : '[codice di uscita ' + (code === null ? signal : code) + ']'))
          );
        });
      }),
    true
  );

  return tools;
}

// ─── Server MCP (JSON-RPC su HTTP) ────────────────────────────
function createServer(opts) {
  const resolveInside = makeResolver(opts.root);
  const tools = buildTools(opts, resolveInside);
  const byName = Object.fromEntries(tools.map((t) => [t.name, t]));
  const tokenBuf = Buffer.from(opts.token);

  const authorized = (req) => {
    const h = String(req.headers.authorization || '');
    if (!h.startsWith('Bearer ')) return false;
    const given = Buffer.from(h.slice(7));
    return given.length === tokenBuf.length && crypto.timingSafeEqual(given, tokenBuf);
  };

  const cors = {
    'access-control-allow-origin': '*',
    'access-control-allow-headers': 'authorization, content-type, mcp-session-id, mcp-protocol-version, accept',
    'access-control-allow-methods': 'POST, OPTIONS',
    'access-control-expose-headers': 'Mcp-Session-Id'
  };

  async function handle(msg) {
    const id = msg.id;
    const ok = (result) => ({ jsonrpc: '2.0', id, result });
    const err = (code, message) => ({ jsonrpc: '2.0', id, error: { code, message } });
    switch (msg.method) {
      case 'initialize':
        return ok({
          protocolVersion: (msg.params && msg.params.protocolVersion) || '2025-06-18',
          capabilities: { tools: {} },
          serverInfo: { name: 'mia-bridge', version: VERSION },
          instructions: 'Lavora nella cartella ' + path.basename(opts.root) + (opts.readonly ? ' (solo lettura).' : '.')
        });
      case 'ping':
        return ok({});
      case 'tools/list':
        return ok({ tools: tools.map(({ run, ...t }) => t) });
      case 'tools/call': {
        const t = byName[msg.params && msg.params.name];
        if (!t) return err(-32602, 'Strumento sconosciuto');
        const args = (msg.params && msg.params.arguments) || {};
        const brief = JSON.stringify(args).slice(0, 160);
        console.log(new Date().toLocaleTimeString() + ' ▶ ' + t.name + ' ' + brief);
        try {
          return ok(await t.run(args));
        } catch (e) {
          console.log('   ✗ ' + e.message);
          return ok({ content: [{ type: 'text', text: 'Errore: ' + e.message }], isError: true });
        }
      }
      default:
        return err(-32601, 'Metodo non supportato: ' + msg.method);
    }
  }

  return http.createServer((req, res) => {
    if (req.method === 'OPTIONS') {
      res.writeHead(204, cors);
      return res.end();
    }
    const send = (status, body, extra) => {
      res.writeHead(status, Object.assign({ 'content-type': 'application/json' }, cors, extra || {}));
      res.end(body === undefined ? undefined : JSON.stringify(body));
    };
    if (req.method !== 'POST') return send(405, { error: 'Usa POST' });
    if (!authorized(req)) return send(401, { error: 'Token non valido' });
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) req.destroy();
      else chunks.push(c);
    });
    req.on('end', async () => {
      let msg;
      try {
        msg = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      } catch (_) {
        return send(400, { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'JSON non valido' } });
      }
      const extra = msg.method === 'initialize' ? { 'mcp-session-id': crypto.randomBytes(12).toString('hex') } : {};
      if (msg.id === undefined) return send(202, undefined); // notifica: nessuna risposta
      send(200, await handle(msg), extra);
    });
  });
}

// ─── Avvio ────────────────────────────────────────────────────
if (require.main === module) {
  let opts;
  try {
    opts = parseArgs(process.argv.slice(2));
  } catch (e) {
    console.error(e.message + '\n\n' + HELP);
    process.exit(1);
  }
  if (opts.help) {
    console.log(HELP);
    process.exit(0);
  }
  if (!fs.existsSync(opts.root) || !fs.statSync(opts.root).isDirectory()) {
    console.error('Cartella non trovata: ' + opts.root);
    process.exit(1);
  }
  opts.root = fs.realpathSync(opts.root);
  const generated = !opts.token;
  if (generated) opts.token = crypto.randomBytes(24).toString('hex');
  const loopback = ['127.0.0.1', 'localhost', '::1'].includes(opts.host);
  if (!loopback && opts.token.length < 16) {
    console.error('Con --host diverso da 127.0.0.1 il token deve avere almeno 16 caratteri.');
    process.exit(1);
  }
  createServer(opts).listen(opts.port, opts.host, () => {
    console.log('Mia Bridge ' + VERSION + (opts.readonly ? ' (solo lettura)' : ''));
    console.log('Cartella di lavoro: ' + opts.root);
    console.log('Token: ' + opts.token + (generated ? '   (creato ora: copialo in Mia)' : ''));
    const ips = Object.values(os.networkInterfaces()).flat().filter((i) => i && i.family === 'IPv4' && !i.internal).map((i) => i.address);
    console.log('Indirizzo per Mia: http://' + (loopback ? 'localhost' : ips[0] || opts.host) + ':' + opts.port + '/mcp');
    if (loopback) console.log('Solo questo computer può collegarsi. Per il telefono usa --host 0.0.0.0 (stessa Wi-Fi) o un tunnel.');
    else console.log('⚠ In ascolto sulla rete: chiunque abbia il token può eseguire comandi. Usa una rete fidata.');
  });
}

module.exports = { createServer, parseArgs };
