/* Test end-to-end di Mia AI. Tutti i servizi esterni sono simulati: nessuna chiamata reale. Vedi tests/README.md */
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const root = path.resolve(__dirname, '..', '..');
const mime = { '.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.webmanifest':'application/json' };
const web = http.createServer((q,r)=>{ let p=q.url.split('?')[0]; if(p==='/')p='/index.html'; const f=path.join(root,p); fs.readFile(f,(e,d)=>{ if(e){r.writeHead(404);r.end();return;} r.writeHead(200,{'content-type':mime[path.extname(f)]||'application/octet-stream'}); r.end(d);});}).listen(8105);
const cors={'access-control-allow-origin':'*','access-control-allow-headers':'*','access-control-allow-methods':'*'};
let st; const calls = [];
const reset = (o) => { st = Object.assign({ checks: [], statuses: [], mergeable: true, mstate: 'clean', draft: false, state: 'open', merged: false, mergedBody: null }, o || {}); calls.length = 0; };
reset();
(async () => {
  const b = await chromium.launch(); const ctx = await b.newContext({viewport:{width:390,height:844}}); const page = await ctx.newPage(); const errs=[]; page.on('pageerror', e => errs.push(e.message));
  await ctx.route('https://api.github.com/**', async route => { const r=route.request(); const u=new URL(r.url()); if(r.method()==='OPTIONS') return route.fulfill({status:204,headers:cors});
    const j=(o,s=200)=>route.fulfill({status:s,headers:{...cors,'content-type':'application/json'},body:JSON.stringify(o)}); const p=u.pathname; const m=r.method(); calls.push(m+' '+p);
    if (p==='/repos/mario/flash') return j({default_branch:'main'});
    if (p==='/repos/mario/flash/pulls/7' && m==='GET') return j({number:7,title:'Prova',state:st.state,merged:st.merged,draft:st.draft,mergeable:st.mergeable,mergeable_state:st.mstate,head:{ref:'mia-lavoro',sha:'abc1234567'},base:{ref:'main'},user:{login:'mario'},changed_files:1,additions:2,deletions:1,body:'x'});
    if (p==='/repos/mario/flash/pulls/7/files') return j([{filename:'data.js',status:'modified',additions:2,deletions:1,patch:'@@ -1 +1 @@'}]);
    if (p==='/repos/mario/flash/commits/abc1234567/check-runs') return j({check_runs:st.checks});
    if (p==='/repos/mario/flash/commits/abc1234567/status') return j({state:'x',statuses:st.statuses});
    if (p==='/repos/mario/flash/pulls/7/merge' && m==='PUT') { st.mergedBody = JSON.parse(r.postData()); return j({merged:true,message:'Pull Request successfully merged'}); }
    return j({message:'Not Found'},404); });
  await page.goto('http://localhost:8105/'); await page.waitForSelector('#input');
  const run = (name,args) => page.evaluate(async ([name,args]) => { try { const r = await MiaTools.run(name,args,{token:'t',repoLock:true,repoScope:'mario/flash'}); return {ok:true,text:r.text}; } catch(e){ return {ok:false,error:e.message}; } }, [name,args]);
  const RED = [{name:'Test',status:'completed',conclusion:'failure',details_url:'https://github.com/mario/flash/actions/runs/555/job/1'},{name:'Build APK',status:'completed',conclusion:'success',details_url:'https://github.com/mario/flash/actions/runs/556/job/2'}];
  const GREEN = [{name:'Test',status:'completed',conclusion:'success',details_url:'https://github.com/mario/flash/actions/runs/557/job/3'},{name:'Lint',status:'completed',conclusion:'skipped'}];
  const PEND = [{name:'Test',status:'in_progress',conclusion:null,details_url:'https://github.com/mario/flash/actions/runs/558/job/4'}];

  console.log('— lettura della PR: esito dei controlli');
  reset({checks:RED}); let r = await run('github_pull_requests',{action:'read',number:7});
  console.log('    rosso =', /Controlli: ❌ FALLITI 1 su 2 sul commit abc1234/.test(r.text), '| riga del test fallito con run_id =', /❌ Test · failure · run_id 555/.test(r.text), '| invito a leggere l\'errore =', /read_run run_id=555/.test(r.text));
  reset({checks:GREEN}); r = await run('github_pull_requests',{action:'read',number:7}); console.log('    verde =', /✅ tutti passati \(2\)/.test(r.text));
  reset({checks:PEND}); r = await run('github_pull_requests',{action:'read',number:7}); console.log('    in corso =', /⏳ IN CORSO 1 su 1/.test(r.text) && /Aspetta e ricontrolla/.test(r.text));
  reset({statuses:[{context:'ci/vecchio',state:'failure'}]}); r = await run('github_pull_requests',{action:'read',number:7}); console.log('    stato classico fallito =', /❌ ci\/vecchio · failure/.test(r.text));
  reset(); r = await run('github_pull_requests',{action:'read',number:7}); console.log('    nessun controllo =', /nessun controllo \(test o build\) trovato/.test(r.text));
  console.log('— unione');
  reset({checks:RED}); r = await run('github_pull_requests',{action:'merge',number:7}); console.log('    rosso → rifiutata =', !r.ok && /Non unisco: ci sono controlli FALLITI/.test(r.error), '| nessuna unione =', st.mergedBody === null);
  reset({checks:PEND}); r = await run('github_pull_requests',{action:'merge',number:7}); console.log('    in corso → rifiutata =', !r.ok && /ancora in corso/.test(r.error) && st.mergedBody === null);
  reset({checks:GREEN,mergeable:false,mstate:'dirty'}); r = await run('github_pull_requests',{action:'merge',number:7}); console.log('    conflitti → rifiutata =', !r.ok && /ha conflitti/.test(r.error) && st.mergedBody === null);
  reset({checks:GREEN,draft:true}); r = await run('github_pull_requests',{action:'merge',number:7}); console.log('    bozza → rifiutata =', !r.ok && /è una bozza/.test(r.error));
  reset({checks:GREEN,merged:true,state:'closed'}); r = await run('github_pull_requests',{action:'merge',number:7}); console.log('    già unita =', r.ok && /già stata unita/.test(r.text) && st.mergedBody === null);
  reset({checks:GREEN}); r = await run('github_pull_requests',{action:'merge',number:7,method:'merge'}); console.log('    verde → unita =', r.ok && /successfully merged/.test(r.text), '| solo il commit controllato (sha) =', st.mergedBody && st.mergedBody.sha === 'abc1234567' && st.mergedBody.merge_method === 'merge');
  reset(); r = await run('github_pull_requests',{action:'merge',number:7}); console.log('    senza controlli → unita con avviso =', r.ok && /nessun controllo/.test(r.text));
  console.log('— istruzioni dell\'agente');
  const desc = await page.evaluate(() => MiaTools.definitions({}).find(t => t.name === 'github_pull_requests').description);
  console.log('    lo strumento dice che legge i controlli e blocca l\'unione =', /esito dei controlli/.test(desc) && /rifiutata se un controllo è fallito o in corso/.test(desc));
  console.log('ERRORS', errs);
  await b.close(); web.close();
})().catch(e=>{console.error('FAIL',e);process.exit(1)});
