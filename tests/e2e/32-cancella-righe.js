/* Test end-to-end di Mia AI. Tutti i servizi esterni sono simulati: nessuna chiamata reale. Vedi tests/README.md */
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const root = path.resolve(__dirname, '..', '..');
const mime = { '.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.webmanifest':'application/json' };
const web = http.createServer((q,r)=>{ let p=q.url.split('?')[0]; if(p==='/')p='/index.html'; const f=path.join(root,p); fs.readFile(f,(e,d)=>{ if(e){r.writeHead(404);r.end();return;} r.writeHead(200,{'content-type':mime[path.extname(f)]||'application/octet-stream'}); r.end(d);});}).listen(8084);
const cors={'access-control-allow-origin':'*','access-control-allow-headers':'*','access-control-allow-methods':'*'};
const deck = (id, name, n) => '  {\n    id: "' + id + '",\n    name: "' + name + '",\n    cards: [\n' + Array.from({length:n},(_,i)=>'      { front: "parola ' + (i+1) + '", back: "' + id + ' ' + (i+1) + '" },\n').join('') + '    ]\n  }';
const DATA = 'const DECKS = [\n' + [deck('en','Inglese',200), deck('fr','Francese',200), deck('de','Tedesco',200)].join(',\n') + '\n];\n';
let gh;
const reset = () => { gh = { branches: { main: { commits:['c0'], files: { 'data.js': DATA } } }, n: 0, calls: [] }; };
reset();
(async () => {
  const b = await chromium.launch(); const ctx = await b.newContext({viewport:{width:390,height:844}}); const page = await ctx.newPage(); const errs=[]; page.on('pageerror', e => errs.push(e.message));
  await ctx.route('https://api.github.com/**', async route => { const r=route.request(); const u=new URL(r.url()); if(r.method()==='OPTIONS') return route.fulfill({status:204,headers:cors});
    const j=(o,s=200)=>route.fulfill({status:s,headers:{...cors,'content-type':'application/json'},body:JSON.stringify(o)}); const p=u.pathname; const m=r.method(); gh.calls.push(m+' '+p+u.search);
    if (p==='/user') return j({login:'mario'}); if (p==='/repos/mario/flash') return j({default_branch:'main'}); let x;
    if ((x = p.match(/^\/repos\/mario\/flash\/git\/ref\/heads\/(.+)$/))) { const br=gh.branches[decodeURIComponent(x[1])]; return br ? j({object:{sha:br.commits[br.commits.length-1]}}) : j({message:'Not Found'},404); }
    if (p==='/repos/mario/flash/git/refs' && m==='POST') { const body=JSON.parse(r.postData()); const name=body.ref.replace('refs/heads/',''); const main=gh.branches.main; gh.branches[name]={commits:main.commits.slice(),files:Object.assign({},main.files)}; return j({ref:body.ref},201); }
    if ((x = p.match(/^\/repos\/mario\/flash\/contents\/(.+)$/))) { const name=decodeURIComponent(x[1]);
      if (m==='GET') { const br=gh.branches[u.searchParams.get('ref')||'main']; if (!br) return j({message:'No commit found for the ref'},404); const t=br.files[name]; return t===undefined ? j({message:'Not Found'},404) : j({type:'file',path:name,size:Buffer.byteLength(t),sha:'s-'+name,content:Buffer.from(t).toString('base64'),encoding:'base64'}); }
      const body=JSON.parse(r.postData()); const br=gh.branches[body.branch||'main']; if (!br) return j({message:'Branch not found'},404); const id='c'+(++gh.n); br.commits.push(id); br.files[name]=Buffer.from(body.content,'base64').toString('utf8'); return j({commit:{sha:id+'abcdef1234'},content:{html_url:'x'}}); }
    return j({message:'Not Found'},404); });
  await page.goto('http://localhost:8084/'); await page.waitForSelector('#input');
  const run = (name,args,c) => page.evaluate(async ([name,args,c]) => { try { const r = await MiaTools.run(name,args,Object.assign({token:'t',repoLock:true,repoScope:'mario/flash'},c)); return {ok:true,text:r.text}; } catch(e){ return {ok:false,error:e.message}; } }, [name,args,c||{}]);
  const decks = (t) => { try { return new Function(t + ';return DECKS;')().map(d=>d.id+':'+d.cards.length).join(' '); } catch(e) { return 'NON VALIDO'; } };
  const lines = DATA.split('\n'); const deStart = lines.findIndex(l=>l.includes('id: "de"')) ; // riga (da 0) dell'id: la graffa di apertura è la precedente
  const FROM = deStart, TO = lines.length - 2; // 1-based: la «{» del mazzo tedesco (deStart è 0-based → il numero della «{» è deStart)
  console.log('file di prova:', lines.length - 1, 'righe | mazzo tedesco = righe', FROM, '–', TO, '|', lines[FROM-1].trim(), '…', lines[TO-1].trim());
  const W = (extra) => Object.assign({path:'data.js',from_line:FROM,to_line:TO,expect_first:'{',expect_last:'}',message:'togli tedesco'}, extra);

  console.log('— anteprima (dry_run): non scrive e non chiede conferma');
  let r = await run('github_delete_lines', W({dry_run:true}),{workBranch:''});
  console.log('   ', r.ok ? r.text.split('\n')[0] : 'ERR '+r.error, '| scritture =', gh.calls.filter(c=>c.startsWith('PUT')).length);
  console.log('    mostra i bordi =', /Primo bordo/.test(r.text||'') && /Ultimo bordo/.test(r.text||''), '| conferma richiesta =', await page.evaluate(()=>MiaTools.needsConfirm('github_delete_lines',{dry_run:true})));
  console.log('— numeri di riga sbagliati (spostati di una riga): non cancella');
  r = await run('github_delete_lines', W({from_line:FROM+1,expect_first:'{'}),{workBranch:''}); console.log('    ', r.ok?'CANCELLATO (!!)':r.error.split('\n')[0].slice(0,120), '| scritture =', gh.calls.filter(c=>c.startsWith('PUT')).length);
  r = await run('github_delete_lines', W({to_line:TO-1}),{workBranch:''}); console.log('     ultima riga sbagliata →', r.ok?'CANCELLATO (!!)':'rifiutato', '| scritture =', gh.calls.filter(c=>c.startsWith('PUT')).length);
  r = await run('github_delete_lines', W({expect_first:'id: "fr"'}),{workBranch:''}); console.log('     testo atteso diverso →', r.ok?'CANCELLATO (!!)':'rifiutato');
  r = await run('github_delete_lines', W({from_line:600,to_line:700}),{workBranch:''}); console.log('     oltre la fine del file →', r.ok?'CANCELLATO (!!)':r.error.slice(0,60));
  r = await run('github_delete_lines', W({from_line:10,to_line:5}),{workBranch:''}); console.log('     intervallo invertito →', r.ok?'CANCELLATO (!!)':r.error.slice(0,60));
  console.log('— intervallo che romperebbe il file: non salva');
  r = await run('github_delete_lines', {path:'data.js',from_line:TO,to_line:TO,expect_first:'}',expect_last:'}',message:'x'},{workBranch:''}); console.log('    ', r.ok?'SALVATO (!!)':r.error.slice(0,95), '| file intatto =', decks(gh.branches.main.files['data.js']));
  console.log('— cancellazione corretta del mazzo tedesco');
  gh.calls.length=0; r = await run('github_delete_lines', W(),{workBranch:''});
  console.log('   ', r.ok ? r.text.split('\n')[0].replace(/commit \w+/,'commit …') : 'ERR '+r.error);
  console.log('    mazzi dopo =', decks(gh.branches.main.files['data.js']), '| scritture =', gh.calls.filter(c=>c.startsWith('PUT')).length, '| mostra il punto e avvisa dei numeri =', /Così com'è ora/.test(r.text||'') && /numeri di riga sono cambiati/.test(r.text||''));
  console.log('— sul branch di lavoro (il principale non si tocca, l\'anteprima non crea il branch)');
  reset(); gh.calls.length=0;
  r = await run('github_delete_lines', W({dry_run:true}),{workBranch:'mia-lavoro'}); console.log('    anteprima: branch creato =', gh.calls.some(c=>c.startsWith('POST')), '| richieste di scrittura =', gh.calls.filter(c=>c.startsWith('PUT')).length, '| esito =', r.ok ? 'ok' : r.error.slice(0,80));
  r = await run('github_delete_lines', W({branch:'main'}),{workBranch:'mia-lavoro'}); console.log('    cancellazione →', r.ok ? r.text.split(' — ')[0].replace(/\d+ righe \(/,'N righe (') : 'ERR '+r.error);
  console.log('    principale intatto =', decks(gh.branches.main.files['data.js'])==='en:200 fr:200 de:200', '| branch di lavoro =', decks(gh.branches['mia-lavoro'].files['data.js']));
  console.log('— altro repository: rifiutato');
  r = await run('github_delete_lines', W({owner:'mario',repo:'segreto'}),{workBranch:''}); console.log('    ', r.ok?'CANCELLATO (!!)':r.error.slice(0,50));
  console.log('— dall\'app: Gemini cancella il mazzo, conferma rossa');
  const gem=[]; let script=[];
  await ctx.route('https://generativelanguage.googleapis.com/**', async route => { const q=route.request(); if(q.method()==='OPTIONS') return route.fulfill({status:204,headers:cors}); gem.push((q.postDataBuffer()||Buffer.from('')).toString('utf8')); const parts=script.shift()||[{text:'Fine.'}]; route.fulfill({status:200,headers:{...cors,'content-type':'text/event-stream'},body:'data: '+JSON.stringify({candidates:[{content:{parts}}]})+'\n\n'}); });
  await page.evaluate(()=>localStorage.setItem('miaai_v1_settings',JSON.stringify({provider:'gemini',profiles:{gemini:{apiKey:'k',model:'gemini-3.5-flash',baseUrl:'https://generativelanguage.googleapis.com/v1beta'}},agentEnabled:true,githubToken:'tok',githubRepo:'mario/flash',githubReadFirst:false,autoFallback:false,favorites:[],theme:'dark',systemPrompt:'x',temperature:0.7})));
  await page.reload(); await page.waitForSelector('#input'); reset();
  script=[[{functionCall:{name:'github_delete_lines',args:{path:'data.js',from_line:FROM,to_line:TO,expect_first:'{',expect_last:'}',message:'togli il tedesco'}}}],[{text:'Fine.'}]];
  await page.fill('#input','togli il tedesco'); await page.click('#sendBtn'); await page.waitForSelector('#confirm:not([hidden])');
  console.log('    conferma:', (await page.textContent('#confirmTitle')).slice(0,48), '| righe =', /Righe: −\d+ \/ \+0/.test(await page.textContent('#confirmDetails')), '| branch =', /Branch: mia-lavoro/.test(await page.textContent('#confirmDetails')), '| rossa =', await page.locator('#confirmWarn').isVisible());
  await page.click('#confirmYes'); await page.waitForSelector('.msg.assistant .bubble:has-text("Fine.")',{timeout:15000});
  console.log('    il modello conosce lo strumento =', /github_delete_lines/.test(gem[0]), '| riceve l\'esito =', /Cancellate \d+ righe/.test(gem[1]||''), '| branch di lavoro =', decks(gh.branches['mia-lavoro'].files['data.js']));
  console.log('— passi massimi fino a 100');
  await page.click('#menuBtn'); await page.click('.drawer [data-open-settings]').then(()=>page.evaluate(()=>document.querySelectorAll('details.set-sec,details.set-sub').forEach(d=>d.open=true))); await page.waitForSelector('#maxSteps',{state:'attached'});
  console.log('    campo: max =', await page.getAttribute('#maxSteps','max'));
  await page.fill('#maxSteps','100'); await page.click('#closeSettings'); console.log('    100 salvato =', await page.evaluate(()=>JSON.parse(localStorage.getItem('miaai_v1_settings')).maxSteps));
  await page.click('#menuBtn'); await page.click('.drawer [data-open-settings]').then(()=>page.evaluate(()=>document.querySelectorAll('details.set-sec,details.set-sub').forEach(d=>d.open=true))); await page.fill('#maxSteps','500'); await page.click('#closeSettings'); console.log('    500 → ridotto a =', await page.evaluate(()=>JSON.parse(localStorage.getItem('miaai_v1_settings')).maxSteps));
  console.log('ERRORS', errs);
  await b.close(); web.close();
})().catch(e=>{console.error('FAIL',e);process.exit(1)});
