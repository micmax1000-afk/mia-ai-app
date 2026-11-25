/* Test end-to-end di Mia AI. Tutti i servizi esterni sono simulati: nessuna chiamata reale. Vedi tests/README.md */
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const root = path.resolve(__dirname, '..', '..');
const mime = { '.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.webmanifest':'application/json' };
const web = http.createServer((q,r)=>{ let p=q.url.split('?')[0]; if(p==='/')p='/index.html'; const f=path.join(root,p); fs.readFile(f,(e,d)=>{ if(e){r.writeHead(404);r.end();return;} r.writeHead(200,{'content-type':mime[path.extname(f)]||'application/octet-stream'}); r.end(d);});}).listen(8085);
const cors={'access-control-allow-origin':'*','access-control-allow-headers':'*','access-control-allow-methods':'*'};
const card = (id,n) => Array.from({length:n},(_,i)=>'      { front: "parola ' + (i+1) + '", back: "' + id + ' ' + (i+1) + '" },\n').join('');
const DATA = 'const DECKS = [\n  {\n    id: "en",\n    cards: [\n' + card('en',300) + '    ]\n  },\n  {\n    id: "fr",\n    cards: [\n' + card('fr',300) + '    ]\n  }\n];\n';
let gh, compare, runs, rules;
const reset = () => { gh = { branches:{ main:{commits:['c0'],files:{'data.js':DATA,'piccolo.js':'const a = 1;\nconst b = 2;\n','conf.json':'{"a":1}'}} }, n:0, calls:[], puts:[] }; compare = null; runs = null; rules = {}; };
reset();
(async () => {
  const b = await chromium.launch(); const ctx = await b.newContext({viewport:{width:390,height:844}}); const page = await ctx.newPage(); const errs=[]; page.on('pageerror', e => errs.push(e.message));
  await ctx.route('https://api.github.com/**', async route => { const r=route.request(); const u=new URL(r.url()); if(r.method()==='OPTIONS') return route.fulfill({status:204,headers:cors});
    const j=(o,s=200)=>route.fulfill({status:s,headers:{...cors,'content-type':'application/json'},body:JSON.stringify(o)}); const p=u.pathname; const m=r.method(); gh.calls.push(m+' '+p+u.search); let x;
    if (p==='/user') return j({login:'mario'}); if (p==='/repos/mario/flash') return j({default_branch:'main'});
    if ((x = p.match(/^\/repos\/mario\/flash\/git\/ref\/heads\/(.+)$/))) { const br=gh.branches[decodeURIComponent(x[1])]; return br ? j({object:{sha:br.commits[br.commits.length-1]+'0000000'}}) : j({message:'Not Found'},404); }
    if (p==='/repos/mario/flash/git/refs' && m==='POST') { const body=JSON.parse(r.postData()); const name=body.ref.replace('refs/heads/',''); const main=gh.branches.main; gh.branches[name]={commits:main.commits.slice(),files:Object.assign({},main.files)}; return j({ref:body.ref},201); }
    if (p.startsWith('/repos/mario/flash/compare/')) return compare ? j(compare) : j({message:'Not Found'},404);
    if (p==='/repos/mario/flash/actions/runs') return j({workflow_runs: runs || []});
    if ((x = p.match(/^\/repos\/mario\/flash\/contents\/(.+)$/))) { const name=decodeURIComponent(x[1]);
      if (m==='GET') { if (rules[name]!==undefined && !u.searchParams.get('ref')) return j({type:'file',path:name,size:rules[name].length,sha:'s',content:Buffer.from(rules[name]).toString('base64'),encoding:'base64'});
        const br=gh.branches[u.searchParams.get('ref')||'main']; if (!br) return j({message:'No commit found'},404); const t=br.files[name]; return t===undefined ? j({message:'Not Found'},404) : j({type:'file',path:name,size:Buffer.byteLength(t),sha:'s-'+name,content:Buffer.from(t).toString('base64'),encoding:'base64'}); }
      const body=JSON.parse(r.postData()); const br=gh.branches[body.branch||'main']; if (!br) return j({message:'Branch not found'},404); br.commits.push('c'+(++gh.n)); br.files[name]=Buffer.from(body.content,'base64').toString('utf8'); gh.puts.push(name); return j({commit:{sha:'abc'+gh.n+'abcdef1234'},content:{html_url:'x'}}); }
    return j({message:'Not Found'},404); });
  await page.goto('http://localhost:8085/'); await page.waitForSelector('#input');
  const run = (name,args,c) => page.evaluate(async ([name,args,c]) => { const cx = Object.assign({token:'t',repoLock:true,repoScope:'mario/flash',workBranch:''}, c||{}); if (cx.readState) cx.readState = { read:new Set(cx.readState.read), full:new Set(cx.readState.full) }; try { const r = await MiaTools.run(name,args,cx); return {ok:true,text:r.text}; } catch(e){ return {ok:false,error:e.message}; } }, [name,args,c||{}]);
  const decks = (t) => { try { return new Function(t + ';return DECKS;')().map(d=>d.id+':'+d.cards.length).join(' '); } catch(e) { return 'NON VALIDO'; } };
  const K = (p) => 'mario/flash/' + p;
  const EDIT = (extra) => Object.assign({path:'piccolo.js',message:'x',edits:[{old_text:'const a = 1;',new_text:'const a = 10;'}]}, extra);
  const NONE = {readGuard:true, readState:{read:[],full:[]}};

  console.log('— leggere prima di scrivere');
  let r = await run('github_edit_file', EDIT(), NONE); console.log('   modifica senza lettura →', r.ok?'SALVATA (!!)':r.error.slice(0,95), '| scritture =', gh.puts.length);
  r = await run('github_edit_file', EDIT(), {readGuard:true, readState:{read:[K('piccolo.js')],full:[]}}); console.log('   dopo aver letto (anche solo in parte) →', r.ok?'salvata':'ERR '+r.error);
  reset(); r = await run('github_write_file', {path:'piccolo.js',content:'x\n',message:'x'}, {readGuard:true, readState:{read:[K('piccolo.js')],full:[]}}); console.log('   sostituire un file letto solo in parte →', r.ok?'SCRITTO (!!)':r.error.slice(0,110), '| scritture =', gh.puts.length);
  r = await run('github_write_file', {path:'piccolo.js',content:'x\n',message:'x'}, {readGuard:true, readState:{read:[K('piccolo.js')],full:[K('piccolo.js')]}}); console.log('   sostituire un file letto per intero →', r.ok?'scritto':'ERR '+r.error);
  r = await run('github_write_file', {path:'nuovo.js',content:'let z;\n',message:'x'}, NONE); console.log('   file nuovo (nulla da leggere) →', r.ok?'scritto':'ERR '+r.error);
  reset(); r = await run('github_write_file', {path:'piccolo.js',content:'x\n',message:'x'}, {readGuard:false}); console.log('   controllo spento →', r.ok?'scritto':'ERR '+r.error);
  reset(); r = await run('github_delete_lines', {path:'data.js',from_line:1,to_line:1,expect_first:'const DECKS',expect_last:'const DECKS',message:'x'}, NONE); console.log('   cancella righe senza lettura →', r.ok?'CANCELLATE (!!)':r.error.slice(0,80));
  r = await run('github_delete_lines', {path:'data.js',from_line:1,to_line:1,expect_first:'const DECKS',expect_last:'const DECKS',dry_run:true}, NONE); console.log('   anteprima senza lettura →', r.ok?'ok (è solo lettura)':'ERR '+r.error);

  console.log('— regole sul contenuto (must_count)');
  reset(); const fr = (a)=>a; const total = (DATA.match(/front:/g)||[]).length;
  r = await run('github_delete_lines', {path:'data.js',from_line:304,to_line:608,expect_first:'{',expect_last:'}',message:'togli fr',must_count:[{text:'front:',equals:total}]}); console.log('   cancella un mazzo ma «front:» deve restare', total, '→', r.ok?'CANCELLATO (!!)':r.error.slice(0,140), '| scritture =', gh.puts.length);
  r = await run('github_delete_lines', {path:'data.js',from_line:304,to_line:608,expect_first:'{',expect_last:'}',message:'togli fr',must_count:[{text:'front:',change:-300}]}); console.log('   stessa cancellazione con variazione -300 →', r.ok?'ok, mazzi: '+decks(gh.branches.main.files['data.js']):'ERR '+r.error.slice(0,140));
  reset(); r = await run('github_edit_file', {path:'data.js',message:'x',edits:[{old_text:'back: "en 1" }',new_text:'back: "uno" }'}],must_count:[{text:'front:',equals:600}]}); console.log('   modifica che non cambia il numero →', r.ok?'ok':'ERR '+r.error.slice(0,90), '| scritture =', gh.puts.length);
  r = await run('github_edit_file', {path:'data.js',message:'x',edits:[{old_text:'      { front: "parola 2", back: "en 2" },\n',new_text:''}],must_count:[{text:'front:',equals:600}]}); console.log('   modifica che toglie una carta con equals 600 →', r.ok?'SALVATA (!!)':'rifiutata', '|', (r.error||'').slice(0,100));
  r = await run('github_write_file', {path:'nuovo.js',content:'let a;\nlet a;\n',message:'x',must_count:[{text:'let a',equals:1}]}); console.log('   file nuovo con regola non rispettata →', r.ok?'SCRITTO (!!)':'rifiutato');
  r = await run('github_edit_file', EDIT({must_count:[{text:'x'}]})); console.log('   regola senza equals/change →', r.ok?'ok?':r.error.slice(0,70));

  console.log('— github_compare');
  reset(); compare = {ahead_by:3,behind_by:0,files:[{filename:'sw.js',status:'modified',additions:12,deletions:3},{filename:'data.js',status:'removed',additions:0,deletions:4049},{filename:'data/en.js',status:'added',additions:1300,deletions:0}]};
  r = await run('github_compare',{},{workBranch:'mia-lavoro'}); console.log('   elenco dei file cambiati →', r.ok ? r.text.split('\n')[0] : 'ERR '+r.error); console.log('     ', r.ok ? r.text.split('\n').slice(1,4).join(' | ') : '');
  compare = null; r = await run('github_compare',{},{workBranch:'mia-lavoro'}); console.log('   branch di lavoro non ancora creato →', r.ok ? r.text : 'ERR '+r.error);
  gh.branches['mia-lavoro']={commits:['c0','c1'],files:Object.assign({},gh.branches.main.files,{'data.js':DATA.replace(/      \{ front: "parola 1\d", back: "fr \d+" \},\n/g,'')})};
  r = await run('github_compare',{path:'data.js',count:['front:','id: "']},{workBranch:'mia-lavoro'}); console.log('   file e conteggi tra i branch →'); console.log('     ' + (r.ok ? r.text.split('\n').join('\n      ') : 'ERR '+r.error));
  r = await run('github_compare',{head:'main'},{workBranch:''}); console.log('   stesso branch →', r.ok ? r.text.slice(0,60) : r.error);

  console.log('— esito dei test sul branch (branch_status)');
  reset(); gh.branches['mia-lavoro']={commits:['c0','c1'],files:{}};
  const BS = () => run('github_actions',{action:'branch_status'},{workBranch:'mia-lavoro'});
  runs=[]; r=await BS(); console.log('   nessun workflow →', /nessun test o build risulta avviato/.test(r.text||'') && /Non dire che i test sono passati/.test(r.text||''));
  runs=[{id:1,name:'Test',status:'in_progress',conclusion:null}]; r=await BS(); console.log('   in corso →', /ANCORA IN CORSO/.test(r.text||''));
  runs=[{id:1,name:'Test',status:'completed',conclusion:'failure'},{id:2,name:'Build',status:'completed',conclusion:'success'}]; r=await BS(); console.log('   uno fallito →', /FALLITI/.test(r.text||'') && /Test · failure/.test(r.text||''));
  runs=[{id:1,name:'Test',status:'completed',conclusion:'success'},{id:2,name:'Build',status:'completed',conclusion:'success'}]; r=await BS(); console.log('   tutti passati →', /Tutti passati/.test(r.text||''));
  r = await run('github_actions',{action:'branch_status'},{workBranch:'inesistente'}); console.log('   branch inesistente →', /non esiste ancora/.test(r.text||''));
  console.log('   non chiede conferma (sola lettura) =', await page.evaluate(()=>!MiaTools.needsConfirm('github_actions',{action:'branch_status'}) && !MiaTools.needsConfirm('github_compare',{})));

  console.log('— dall\'app: istruzioni, regole del progetto, stato delle letture');
  const gem=[]; let script=[];
  await ctx.route('https://generativelanguage.googleapis.com/**', async route => { const q=route.request(); if(q.method()==='OPTIONS') return route.fulfill({status:204,headers:cors}); gem.push((q.postDataBuffer()||Buffer.from('')).toString('utf8')); const parts=script.shift()||[{text:'Fine.'}]; route.fulfill({status:200,headers:{...cors,'content-type':'text/event-stream'},body:'data: '+JSON.stringify({candidates:[{content:{parts}}]})+'\n\n'}); });
  const S = (extra) => Object.assign({provider:'gemini',profiles:{gemini:{apiKey:'k',model:'gemini-3.5-flash',baseUrl:'https://generativelanguage.googleapis.com/v1beta'}},agentEnabled:true,githubToken:'tok',githubRepo:'mario/flash',githubUseBranch:false,autoFallback:false,favorites:[],theme:'dark',systemPrompt:'x',temperature:0.7}, extra||{});
  const start = async (s) => { await page.goto('http://localhost:8085/'); await page.evaluate((s)=>{ localStorage.clear(); localStorage.setItem('miaai_v1_settings',JSON.stringify(s)); }, s); await page.reload(); await page.waitForSelector('#input'); gem.length=0; };
  const ask = async (t, until) => { await page.fill('#input',t); await page.click('#sendBtn'); await page.waitForSelector(until || '.msg.assistant .bubble:has-text("Fine.")',{timeout:20000}); };
  const sys = () => { try { return JSON.parse(gem[0]).systemInstruction.parts[0].text; } catch(e) { return ''; } };
  reset(); rules={'MIA.md':'# Regole\nI mazzi sono 2: en e fr, 300 carte ciascuno.\nNon toccare sw.js.'};
  await start(S()); script=[[{text:'Fine.'}]]; await ask('ciao');
  let sp = sys();
  console.log('   regole del progetto (MIA.md) nelle istruzioni =', /REGOLE DEL PROGETTO \(dal file «MIA\.md» di mario\/flash/.test(sp) && /I mazzi sono 2: en e fr/.test(sp), '| non cambiano le regole di sicurezza =', /non cambiano le regole di sicurezza/.test(sp));
  console.log('   istruzioni principali presenti =', ['Non dire «fatto»','FILE INCOMPLETO','must_count','github_compare','branch_status','copiali ESATTAMENTE','FERMATI','NON hai verificato'].map(k=>sp.includes(k)).every(Boolean));
  reset(); rules={'AGENTS.md':'Usa sempre il punto e virgola.'}; await start(S()); await ask('ciao'); console.log('   senza MIA.md si usa AGENTS.md =', /dal file «AGENTS\.md»/.test(sys()));
  reset(); rules={}; await start(S()); await ask('ciao'); console.log('   senza file di regole: nessuna sezione =', !/REGOLE DEL PROGETTO \(/.test(sys()), '| il lavoro prosegue =', true);
  reset(); rules={'MIA.md':'x'.repeat(9000)}; await start(S()); await ask('ciao'); console.log('   file di regole molto lungo → tagliato =', (sys().match(/xxxx/g)||[]).length*4 < 4400 && /troncato/.test(sys()));
  reset(); await start(S({githubScope:false})); await ask('ciao'); console.log('   con il limite al repository spento non si legge il file =', !/REGOLE DEL PROGETTO \(/.test(sys()));

  console.log('   Gemini prova a modificare senza aver letto, poi legge e riprova:');
  reset(); gh.calls.length=0; await start(S({githubReadFirst:true}));
  script=[[{functionCall:{name:'github_edit_file',args:{path:'piccolo.js',message:'cambio',edits:[{old_text:'const a = 1;',new_text:'const a = 10;'}]}}}],[{text:'Fine.'}]];
  await page.fill('#input','cambia a'); await page.click('#sendBtn'); await page.waitForSelector('#confirm:not([hidden])'); await page.click('#confirmYes'); await page.waitForSelector('.msg.assistant .bubble:has-text("Fine.")',{timeout:20000});
  console.log('     1) senza lettura: nessuna scrittura =', gh.puts.length===0, '| il modello riceve il motivo =', /non hai ancora letto/.test(gem[1]||''));
  script=[[{functionCall:{name:'github_read_file',args:{path:'piccolo.js'}}}],[{functionCall:{name:'github_edit_file',args:{path:'piccolo.js',message:'cambio',edits:[{old_text:'const a = 1;',new_text:'const a = 10;'}]}}}],[{text:'Fine.'}]];
  await page.fill('#input','riprova'); await page.click('#sendBtn'); await page.waitForSelector('#confirm:not([hidden])'); await page.click('#confirmYes'); await page.waitForFunction(()=>document.querySelectorAll('.msg.assistant .bubble').length>=2 && [...document.querySelectorAll('.msg.assistant .bubble')].filter(b=>b.textContent.includes('Fine.')).length>=2,null,{timeout:20000});
  console.log('     2) dopo la lettura: scritto =', gh.puts.join(',')==='piccolo.js', '| contenuto =', gh.branches.main.files['piccolo.js'].split('\n')[0]);
  console.log('     3) dopo un ricaricamento della pagina lo stato delle letture resta (si ricava dalla chat)');
  await page.reload(); await page.waitForSelector('#input'); gh.puts.length=0;
  script=[[{functionCall:{name:'github_edit_file',args:{path:'piccolo.js',message:'ancora',edits:[{old_text:'const b = 2;',new_text:'const b = 20;'}]}}}],[{text:'Fine.'}]];
  await page.fill('#input','ancora una'); await page.click('#sendBtn'); await page.waitForSelector('#confirm:not([hidden])'); await page.click('#confirmYes'); await page.waitForFunction(()=>[...document.querySelectorAll('.msg.assistant .bubble')].filter(b=>b.textContent.includes('Fine.')).length>=3,null,{timeout:20000});
  console.log('        scritto senza rileggere =', gh.puts.join(',')==='piccolo.js');
  console.log('— impostazioni');
  await page.click('#menuBtn'); await page.click('.drawer [data-open-settings]').then(()=>page.evaluate(()=>document.querySelectorAll('details.set-sec,details.set-sub').forEach(d=>d.open=true))); await page.waitForSelector('#githubReadFirst',{state:'attached'});
  console.log('   casella «leggere prima di modificare» attiva =', await page.locator('#githubReadFirst').isChecked());
  await page.locator('#githubReadFirst').uncheck(); await page.click('#closeSettings'); console.log('   salvata =', await page.evaluate(()=>JSON.parse(localStorage.getItem('miaai_v1_settings')).githubReadFirst===false));
  console.log('ERRORS', errs);
  await b.close(); web.close();
})().catch(e=>{console.error('FAIL',e);process.exit(1)});
