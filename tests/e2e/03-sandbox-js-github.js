/* Test end-to-end di Mia AI. Tutti i servizi esterni sono simulati: nessuna chiamata reale. Vedi tests/README.md */
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const TMP = fs.mkdtempSync(path.join(require('os').tmpdir(), 'mia-test-'));
const root = path.resolve(__dirname, '..', '..');
const mime = { '.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.webmanifest':'application/json' };
const srv = http.createServer((q,r)=>{ let p=q.url.split('?')[0]; if(p==='/')p='/index.html'; const f=path.join(root,p); fs.readFile(f,(e,d)=>{ if(e){r.writeHead(404);r.end();return;} r.writeHead(200,{'content-type':mime[path.extname(f)]||'application/octet-stream'}); r.end(d);});}).listen(8097);
// server "esterno" per verificare che il sandbox non raggiunga la rete
let hits = 0; const ext = http.createServer((q,r)=>{hits++; r.writeHead(200,{'access-control-allow-origin':'*'}); r.end('x');}).listen(8096);
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push('PAGEERR ' + e.message));
  await page.addInitScript(() => localStorage.setItem('SEGRETO', 'chiave-api-segreta'));
  await page.goto('http://localhost:8097/');
  const run = (name,args,ctx={}) => page.evaluate(async ([name,args,ctx]) => {
    const t0 = performance.now();
    try { const r = await MiaTools.run(name,args,ctx); return {ok:true, text:r.text, files:(r.files||[]).map(f=>f.name+':'+f.blob.size), ms: Math.round(performance.now()-t0)}; }
    catch(e){ return {ok:false, error:e.message, ms: Math.round(performance.now()-t0)}; }
  }, [name,args,ctx]);
  const show = (t,r) => console.log(t.padEnd(22), r.ok?'OK ':'ERR', JSON.stringify(r.ok?r.text:r.error).slice(0,230), r.files?.length?r.files:'', r.ms+'ms');

  show('calcolo', await run('run_javascript',{code:'const a=[1,2,3,4]; console.log("doppi", a.map(x=>x*2)); await new Promise(r=>setTimeout(r,50)); return {somma:a.reduce((s,x)=>s+x,0), pi:Math.PI.toFixed(4)}'}));
  show('rete (fetch)', await run('run_javascript',{code:'try { await fetch("http://localhost:8096/x"); return "RAGGIUNTO"; } catch(e){ return "bloccato: "+e.message }'}));
  show('rete (XHR/WS/beacon)', await run('run_javascript',{code:'const out=[]; for (const f of [()=>{const x=new XMLHttpRequest(); x.open("GET","http://localhost:8096/y",false); x.send()}, ()=>new WebSocket("ws://localhost:8096"), ()=>importScripts("http://localhost:8096/z.js")]) { try{ f(); out.push("ok?") }catch(e){ out.push("bloccato") } } return out'}));
  console.log('richieste arrivate al server esterno (deve essere 0):', hits);
  show('dati app', await run('run_javascript',{code:'return {ls: typeof localStorage, idb: typeof indexedDB, doc: typeof document, parent: typeof parent, ck: typeof document==="undefined"?"-":document.cookie}'}));
  const t=Date.now(); const loop = await run('run_javascript',{code:'while(true){}', timeout_seconds:2});
  show('ciclo infinito', loop);
  // l'interfaccia deve restare viva dopo il loop
  console.log('UI viva dopo il loop:', await page.evaluate(()=>document.title));
  show('errore di sintassi', await run('run_javascript',{code:'const = ;'}));
  show('eccezione + log', await run('run_javascript',{code:'console.log("prima"); throw new Error("boom")'}));
  show('file (csv + binario)', await run('run_javascript',{code:'saveFile("tabella.csv","a;b\\n1;2"); saveFile("dati.bin", new Uint8Array([1,2,3,4,5])); saveFile("x.exe","no"); return "ok"'}));
  show('niente output', await run('run_javascript',{code:'const x = 1;'}));
  // abort
  const ab = await page.evaluate(async () => { const c=new AbortController(); setTimeout(()=>c.abort(),300); try{ await MiaTools.run('run_javascript',{code:'while(true){}',timeout_seconds:20},{signal:c.signal}); return 'no'}catch(e){return e.name} });
  console.log('abort:', ab);

  // GitHub avanzato con API simulata
  await page.route('https://api.github.com/**', async route => {
    const req = route.request(); const u = new URL(req.url());
    const cors = {'access-control-allow-origin':'*','access-control-allow-headers':'*','access-control-allow-methods':'*'};
    if (req.method()==='OPTIONS') return route.fulfill({status:204, headers:cors});
    const j = (o, status=200) => route.fulfill({status, headers:{...cors,'content-type':'application/json'}, body: JSON.stringify(o)});
    const p = u.pathname;
    if (p==='/user') return j({login:'mario'});
    if (p==='/search/code') return j({total_count:1,items:[{path:'src/a.js',repository:{full_name:'mario/app'},text_matches:[{fragment:'function login() {\n  return 1\n}'}]}], _q:u.searchParams.get('q'), _a:req.headers()['accept']});
    if (p==='/repos/mario/app/pulls' && req.method()==='GET') return j([{number:7,state:'open',draft:false,title:'Fix login',user:{login:'mario'},head:{ref:'fix'},base:{ref:'main'}}]);
    if (p==='/repos/mario/app/pulls/7' && req.method()==='GET') return j({number:7,state:'open',merged:false,title:'Fix login',head:{ref:'fix'},base:{ref:'main'},user:{login:'mario'},mergeable_state:'clean',changed_files:1,additions:2,deletions:1,body:'descr'});
    if (p==='/repos/mario/app/pulls/7/files') return j([{filename:'src/a.js',status:'modified',additions:2,deletions:1,patch:'@@ -1 +1,2 @@\n-a\n+b\n+c'}]);
    if (p==='/repos/mario/app/pulls/7/merge') return j({merged:true,message:'Pull Request successfully merged'});
    if (p==='/repos/mario/app/actions/runs') return j({workflow_runs:[{id:99,name:'Build APK',head_branch:'main',status:'completed',conclusion:'failure',created_at:'2026-11-21T10:00:00Z',head_sha:'abcdef1234'}]});
    if (p==='/repos/mario/app/actions/runs/99') return j({name:'Build APK',head_branch:'main',status:'completed',conclusion:'failure',html_url:'https://github.com/mario/app/actions/runs/99'});
    if (p==='/repos/mario/app/actions/runs/99/jobs') return j({jobs:[{id:5,name:'Android APK',status:'completed',conclusion:'failure',html_url:'https://github.com/x',steps:[{name:'Build debug APK',conclusion:'failure'},{name:'Checkout',conclusion:'success'}]}]});
    if (p==='/repos/mario/app/actions/jobs/5/logs') return route.fulfill({status:200, headers:{...cors,'content-type':'text/plain'}, body:'riga1\nERROR: compilazione fallita in Foo.java\n'});
    if (p==='/repos/mario/app/actions/workflows/build-apk.yml/dispatches') return route.fulfill({status:204, headers:cors});
    if (p==='/repos/mario/app') return j({default_branch:'main'});
    return j({message:'Not Found'},404);
  });
  const g = {token:'t'};
  show('search_code', await run('github_search_code',{query:'login'},g));
  show('pr list', await run('github_pull_requests',{owner:'mario',repo:'app',action:'list'},g));
  show('pr read', await run('github_pull_requests',{owner:'mario',repo:'app',action:'read',number:7},g));
  show('pr merge', await run('github_pull_requests',{owner:'mario',repo:'app',action:'merge',number:7},g));
  show('actions list', await run('github_actions',{owner:'mario',repo:'app',action:'list_runs'},g));
  show('actions read', await run('github_actions',{owner:'mario',repo:'app',action:'read_run',run_id:99},g));
  show('actions dispatch', await run('github_actions',{owner:'mario',repo:'app',action:'run_workflow',workflow:'build-apk.yml'},g));
  // conferme e pericolosità
  console.log('conferme:', await page.evaluate(()=>({
    prList: MiaTools.needsConfirm('github_pull_requests',{action:'list'}), prMerge: MiaTools.needsConfirm('github_pull_requests',{action:'merge'}),
    mergeDanger: MiaTools.describe('github_pull_requests',{action:'merge',number:1,owner:'a',repo:'b'}).danger, createDanger: MiaTools.describe('github_pull_requests',{action:'create'}).danger,
    actRead: MiaTools.needsConfirm('github_actions',{action:'read_run'}), actRun: MiaTools.needsConfirm('github_actions',{action:'run_workflow'}),
    js: MiaTools.needsConfirm('run_javascript',{}), count: MiaTools.count() })));
  console.log('ERRORS:', errors);
  await browser.close(); srv.close(); ext.close();
})().catch(e=>{console.error('FAIL',e);process.exit(1);});
