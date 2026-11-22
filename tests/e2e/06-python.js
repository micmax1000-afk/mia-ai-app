/* Test end-to-end di Mia AI. Tutti i servizi esterni sono simulati: nessuna chiamata reale. Vedi tests/README.md */
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const TMP = fs.mkdtempSync(path.join(require('os').tmpdir(), 'mia-test-'));
const root = path.resolve(__dirname, '..', '..');
const PYDIR = path.join(__dirname,'..','node_modules','pyodide');
if (!fs.existsSync(PYDIR)) { console.log('SKIP: manca il pacchetto npm "pyodide" (eseguire npm install in tests/)'); process.exit(0); }
const mime = { '.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.webmanifest':'application/json' };
const srv = http.createServer((q,r)=>{ let p=q.url.split('?')[0]; if(p==='/')p='/index.html'; const f=path.join(root,p); fs.readFile(f,(e,d)=>{ if(e){r.writeHead(404);r.end();return;} r.writeHead(200,{'content-type':mime[path.extname(f)]||'application/octet-stream'}); r.end(d);});}).listen(8090);
let hits=0; const ext = http.createServer((q,r)=>{hits++; r.writeHead(200,{'access-control-allow-origin':'*'}); r.end('x');}).listen(8089);
(async () => {
  const b = await chromium.launch(); const ctx = await b.newContext(); const page = await ctx.newPage(); const errs=[]; const cdn=[];
  page.on('pageerror', e => errs.push(e.message));
  await ctx.route('https://cdn.jsdelivr.net/pyodide/v314.0.8/full/**', async route => {
    const name = new URL(route.request().url()).pathname.split('/').pop(); cdn.push(name);
    const f = path.join(PYDIR, name);
    if (!fs.existsSync(f)) return route.fulfill({status:404, headers:{'access-control-allow-origin':'*'}, body:'nf'});
    const ct = name.endsWith('.wasm')?'application/wasm': name.endsWith('.json')?'application/json': name.endsWith('.zip')?'application/zip':'text/javascript';
    await route.fulfill({status:200, headers:{'access-control-allow-origin':'*','content-type':ct}, body: fs.readFileSync(f)});
  });
  await page.goto('http://localhost:8090/');
  const run = (code, t=120) => page.evaluate(async ([code,t]) => { const t0=performance.now(); try { const r = await MiaTools.run('run_python',{code, timeout_seconds:t},{}); return {ok:true,text:r.text,files:r.files.map(f=>f.name+':'+f.blob.size),ms:Math.round(performance.now()-t0)} } catch(e){ return {ok:false,error:e.message,ms:Math.round(performance.now()-t0)} } }, [code,t]);
  const show=(t,r)=>console.log(t.padEnd(18), r.ok?'OK ':'ERR', JSON.stringify(r.ok?r.text:r.error).slice(0,260), r.files&&r.files.length?r.files:'', r.ms+'ms');
  show('1ª (carica)', await run('import sys\nprint("python", sys.version_info[:2])\nsum(range(101))'));
  show('2ª (variabili)', await run('x = 21\nx*2'));
  show('3ª (persistono)', await run('print(x)'));
  show('file in /out', await run('import json\nopen("/out/dati.json","w").write(json.dumps({"a":1}))\nopen("/out/note.txt","w").write("ciao è")\nprint("scritti")'));
  show('eccezione', await run('print("prima")\n1/0'));
  show('rete', await run('import pyodide.http\ntry:\n    r = await pyodide.http.pyfetch("http://localhost:8089/x")\n    print("RAGGIUNTO")\nexcept Exception as e:\n    print("bloccato:", type(e).__name__)'));
  console.log('richieste al server esterno (0 atteso):', hits);
  show('pacchetto mancante', await run('import numpy\nprint(numpy.__version__)'));
  const t0=Date.now(); show('ciclo infinito', await run('while True: pass', 5));
  show('dopo il kill', await run('print("rinasce")'));
  console.log('file scaricati dalla CDN simulata:', [...new Set(cdn)].join(', '));
  console.log('ERRORS', errs);
  await b.close(); srv.close(); ext.close();
})().catch(e=>{console.error('FAIL',e);process.exit(1)});
