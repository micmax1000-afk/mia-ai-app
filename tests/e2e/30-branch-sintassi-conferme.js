/* Test end-to-end di Mia AI. Tutti i servizi esterni sono simulati: nessuna chiamata reale. Vedi tests/README.md */
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const root = path.resolve(__dirname, '..', '..');
const mime = { '.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.webmanifest':'application/json' };
const web = http.createServer((q,r)=>{ let p=q.url.split('?')[0]; if(p==='/')p='/index.html'; const f=path.join(root,p); fs.readFile(f,(e,d)=>{ if(e){r.writeHead(404);r.end();return;} r.writeHead(200,{'content-type':mime[path.extname(f)]||'application/octet-stream'}); r.end(d);});}).listen(8082);
const cors={'access-control-allow-origin':'*','access-control-allow-headers':'*','access-control-allow-methods':'*'};
// file dei mazzi come quello del test sul telefono: en, fr, de (10 carte ciascuno)
const deck = (id, name, n) => '  {\n    id: "' + id + '",\n    name: "' + name + '",\n    flag: "🏳",\n    lang: "' + id + '",\n    cards: [\n' + Array.from({length:n},(_,i)=>'      { front: "parola ' + (i+1) + '", back: "' + id + ' ' + (i+1) + '", emoji: "👩" },\n').join('') + '    ]\n  }';
const DATA = 'const DECKS = [\n' + [deck('en','Inglese',25), deck('fr','Francese',25), deck('de','Tedesco',25)].join(',\n') + '\n];\n';
// GitHub simulato con branch: ogni branch ha i suoi file e la sua lista di commit
let gh;
const reset = () => { gh = { branches: { main: { commits:['c0'], files: { 'data.js': DATA, 'rotto.js': 'const x = ;\n', 'conf.json': '{"a":1}' } } }, n: 0, calls: [] }; };
reset();
(async () => {
  const b = await chromium.launch(); const ctx = await b.newContext({viewport:{width:390,height:844}}); const page = await ctx.newPage(); const errs=[]; page.on('pageerror', e => errs.push(e.message));
  await ctx.route('https://api.github.com/**', async route => { const r=route.request(); const u=new URL(r.url()); if(r.method()==='OPTIONS') return route.fulfill({status:204,headers:cors});
    const j=(o,s=200)=>route.fulfill({status:s,headers:{...cors,'content-type':'application/json'},body:JSON.stringify(o)}); const p=u.pathname; const m=r.method(); gh.calls.push(m+' '+p+u.search);
    if (p==='/user') return j({login:'mario'});
    if (p==='/repos/mario/flash') return j({default_branch:'main'});
    let x;
    if ((x = p.match(/^\/repos\/mario\/flash\/git\/ref\/heads\/(.+)$/))) { const br=gh.branches[decodeURIComponent(x[1])]; return br ? j({object:{sha:br.commits[br.commits.length-1]}}) : j({message:'Not Found'},404); }
    if (p==='/repos/mario/flash/git/refs' && m==='POST') { const body=JSON.parse(r.postData()); const name=body.ref.replace('refs/heads/',''); const main=gh.branches.main; gh.branches[name]={commits:main.commits.slice(),files:Object.assign({},main.files)}; return j({ref:body.ref},201); }
    if ((x = p.match(/^\/repos\/mario\/flash\/git\/refs\/heads\/(.+)$/)) && m==='PATCH') { const br=gh.branches[decodeURIComponent(x[1])]; br.commits=gh.branches.main.commits.slice(); br.files=Object.assign({},gh.branches.main.files); return j({}); }
    if ((x = p.match(/^\/repos\/mario\/flash\/compare\/([^.]+)\.\.\.(.+)$/))) { const A=gh.branches[decodeURIComponent(x[1])], B=gh.branches[decodeURIComponent(x[2])]; return j({ahead_by:B.commits.filter(c=>!A.commits.includes(c)).length, behind_by:A.commits.filter(c=>!B.commits.includes(c)).length}); }
    if ((x = p.match(/^\/repos\/mario\/flash\/contents\/(.+)$/))) { const name=decodeURIComponent(x[1]);
      if (m==='GET') { const br=gh.branches[u.searchParams.get('ref')||'main']; if (!br) return j({message:'No commit found for the ref'},404); const t=br.files[name]; return t===undefined ? j({message:'Not Found'},404) : j({type:'file',path:name,size:Buffer.byteLength(t),sha:'s-'+name,content:Buffer.from(t).toString('base64'),encoding:'base64'}); }
      const body=JSON.parse(r.postData()); const br=gh.branches[body.branch||'main']; if (!br) return j({message:'Branch not found'},404); const id='c'+(++gh.n); br.commits.push(id);
      if (m==='PUT') br.files[name]=Buffer.from(body.content,'base64').toString('utf8'); else delete br.files[name];
      return j({commit:{sha:id+'abcdef1234'},content:{html_url:'x'}}); }
    return j({message:'Not Found'},404); });
  await page.goto('http://localhost:8082/'); await page.waitForSelector('#input');
  const run = (name,args,c) => page.evaluate(async ([name,args,c]) => { try { const r = await MiaTools.run(name,args,Object.assign({token:'t',repoLock:true,repoScope:'mario/flash'},c)); return {ok:true,text:r.text}; } catch(e){ return {ok:false,error:e.message}; } }, [name,args,c||{}]);
  const decks = (t) => { try { return new Function(t + ';return DECKS;')().map(d=>d.id+':'+d.cards.length).join(' '); } catch(e) { return 'NON VALIDO'; } };

  console.log('— controllo della sintassi');
  console.log('   ', await page.evaluate(()=>{ const S=MiaTools.syntaxError; const v=(x)=>x===undefined?'non controllabile':x===null?'valido':'errore'; return ['valido: '+v(S('a.js','const a = 1;')),'rotto: '+v(S('a.js','const a = ;')),'json rotto: '+v(S('b.json','{"a":')),'json: '+v(S('b.json','{"a":1}')),'modulo: '+v(S('m.js','import x from "y";\nconst = ;')),'await: '+v(S('a.js','const r = await fetch("x");')),'markdown: '+v(S('r.md','# ciao ('))].join(' | '); }));
  console.log('   il codice NON viene eseguito =', await page.evaluate(()=>{ window.__eseguito=false; MiaTools.syntaxError('a.js','window.__eseguito = true;'); return window.__eseguito===false; }));

  console.log('— l\'errore del test sul telefono: tolta solo l\'intestazione del mazzo tedesco');
  const header = '  },\n  {\n    id: "de",\n    name: "Tedesco",\n    flag: "🏳",\n    lang: "de",\n    cards: [\n';
  let r = await run('github_edit_file',{path:'data.js',message:'togli tedesco',edits:[{old_text:header,new_text:'  ]\n  },\n'}]},{workBranch:''});
  console.log('   esito:', r.ok ? 'SALVATO (!!)' : r.error.slice(0,120), '| scritture =', gh.calls.filter(c=>c.startsWith('PUT')).length, '| file intatto =', decks(gh.branches.main.files['data.js']));
  console.log('— rimozione corretta dell\'intero mazzo tedesco');
  const deBlock = ',\n' + deck('de','Tedesco',25);
  r = await run('github_edit_file',{path:'data.js',message:'togli tedesco',edits:[{old_text:deBlock,new_text:''}]},{workBranch:''});
  console.log('   esito:', r.ok ? r.text.split('\n')[0].replace(/commit \w+/,'commit …') : 'ERR '+r.error);
  console.log('   mazzi dopo =', decks(gh.branches.main.files['data.js']), '| righe mostrate al modello =', /@@ sostituzione 1, righe \d+–\d+ dopo la modifica @@\n +\d+ \| /.test(r.text||''), '| invito a controllare =', /Controlla qui sotto/.test(r.text||''));
  console.log('     ', (r.text||'').split('\n').slice(2,9).join('\n      '));
  console.log('— file che era già rotto: si può modificare, con avviso');
  r = await run('github_edit_file',{path:'rotto.js',message:'x',edits:[{old_text:'const x',new_text:'const y'}]},{workBranch:''}); console.log('   ', r.ok ? 'salvato, avviso = ' + /non lo era nemmeno prima/.test(r.text) : 'ERR '+r.error);
  console.log('— JSON');
  r = await run('github_edit_file',{path:'conf.json',message:'x',edits:[{old_text:'"a":1',new_text:'"a":1,'}]},{workBranch:''}); console.log('    JSON rotto →', r.ok ? 'SALVATO (!!)' : 'rifiutato');
  console.log('— github_write_file');
  r = await run('github_write_file',{path:'nuovo.js',content:'function (',message:'x'},{workBranch:''}); console.log('    file nuovo .js non valido →', r.ok ? 'SALVATO (!!)' : 'rifiutato');
  r = await run('github_write_file',{path:'nuovo.md',content:'# testo (',message:'x'},{workBranch:''}); console.log('    file .md →', r.ok ? 'salvato' : 'ERR '+r.error, '| righe nel risultato =', /righe: 1\./.test(r.text||''));

  console.log('— branch di lavoro «mia-lavoro»');
  reset();
  r = await run('github_read_file',{path:'data.js'},{workBranch:'mia-lavoro'}); console.log('   lettura prima che il branch esista → legge il principale =', r.ok && /id: "de"/.test(r.text), '| richieste =', gh.calls.filter(c=>c.includes('contents')).join(', '));
  gh.calls.length=0;
  r = await run('github_edit_file',{path:'data.js',branch:'main',message:'en 1',edits:[{old_text:'back: "en 1"',new_text:'back: "uno"'}]},{workBranch:'mia-lavoro'});
  console.log('   modifica (il modello chiede «main») →', r.ok ? r.text.split(' — ')[0] : 'ERR '+r.error);
  console.log('   branch creato dal principale =', gh.calls.some(c=>c==='POST /repos/mario/flash/git/refs'), '| principale intatto =', !/"uno"/.test(gh.branches.main.files['data.js']), '| modifica sul branch =', /"uno"/.test(gh.branches['mia-lavoro'].files['data.js']));
  r = await run('github_read_file',{path:'data.js',find:'"uno"'},{workBranch:'mia-lavoro'}); console.log('   la lettura successiva vede la modifica =', /riga \d+: \{ front: "parola 1", back: "uno"/.test(r.text||''));
  r = await run('github_write_file',{path:'note.md',content:'ciao',message:'n'},{workBranch:'mia-lavoro'}); console.log('   file nuovo sul branch =', gh.branches['mia-lavoro'].files['note.md']==='ciao' && !gh.branches.main.files['note.md']);
  r = await run('github_delete_file',{path:'note.md',message:'d',branch:'main'},{workBranch:'mia-lavoro'}); console.log('   eliminazione solo sul branch =', !gh.branches['mia-lavoro'].files['note.md']);
  console.log('   senza branch di lavoro (opzione spenta) scrive sul principale =', (await run('github_edit_file',{path:'data.js',message:'x',edits:[{old_text:'back: "en 2"',new_text:'back: "due"'}]},{workBranch:''})).ok && /"due"/.test(gh.branches.main.files['data.js']));
  console.log('— riallineamento dopo un\'unione');
  // il branch ha commit propri e il principale è andato avanti: NON si tocca
  await page.reload(); await page.waitForSelector('#input'); gh.calls.length=0;
  await run('github_edit_file',{path:'data.js',message:'x',edits:[{old_text:'back: "en 3"',new_text:'back: "tre"'}]},{workBranch:'mia-lavoro'});
  console.log('   branch con modifiche proprie: nessun riallineamento =', !gh.calls.some(c=>c.startsWith('PATCH')));
  // «unione»: il principale prende i file del branch; il branch non ha più commit propri
  const wb=gh.branches['mia-lavoro']; gh.branches.main.files=Object.assign({},wb.files); gh.branches.main.commits=wb.commits.concat(['merge1']);
  await page.reload(); await page.waitForSelector('#input'); gh.calls.length=0;
  r = await run('github_edit_file',{path:'data.js',message:'x',edits:[{old_text:'back: "en 4"',new_text:'back: "quattro"'}]},{workBranch:'mia-lavoro'});
  console.log('   dopo l\'unione il branch si riallinea da solo =', gh.calls.some(c=>c.startsWith('PATCH /repos/mario/flash/git/refs/heads/mia-lavoro')), '| modifica salvata =', r.ok);

  console.log('— conferme dall\'app');
  const gem=[]; let script=[];
  await ctx.route('https://generativelanguage.googleapis.com/**', async route => { const q=route.request(); if(q.method()==='OPTIONS') return route.fulfill({status:204,headers:cors}); gem.push(q.postData()); const parts=script.shift()||[{text:'Fine.'}]; route.fulfill({status:200,headers:{...cors,'content-type':'text/event-stream'},body:'data: '+JSON.stringify({candidates:[{content:{parts}}]})+'\n\n'}); });
  await page.evaluate(()=>localStorage.setItem('miaai_v1_settings',JSON.stringify({provider:'gemini',profiles:{gemini:{apiKey:'k',model:'gemini-3.5-flash',baseUrl:'https://generativelanguage.googleapis.com/v1beta'}},agentEnabled:true,githubToken:'tok',githubNewChatRepo:true,githubRepo:'mario/flash',githubReadFirst:false,autoFallback:false,favorites:[],theme:'dark',systemPrompt:'x',temperature:0.7})));
  await page.reload(); await page.waitForSelector('#input'); reset();
  script=[[{functionCall:{name:'github_edit_file',args:{path:'data.js',message:'togli de',edits:[{old_text:deBlock,new_text:''}]}}}],[{text:'Fine.'}]];
  await page.fill('#input','togli il tedesco'); await page.click('#sendBtn'); await page.waitForSelector('#confirm:not([hidden])');
  console.log('   modifica che cancella molte righe:', (await page.textContent('#confirmTitle')).slice(0,60), '| righe =', /Righe: −\d+ \/ \+0/.test(await page.textContent('#confirmDetails')), '| branch =', /Branch: mia-lavoro/.test(await page.textContent('#confirmDetails')), '| avviso rosso =', await page.locator('#confirmWarn').isVisible());
  await page.click('#confirmYes'); await page.waitForSelector('.msg.assistant .bubble:has-text("Fine.")',{timeout:15000});
  console.log('   il modello sa del branch =', /branch di lavoro «mia-lavoro»/.test(gem[0]), '| riceve le righe dopo la modifica =', /dopo la modifica @@/.test(gem[1]||''));
  script=[[{functionCall:{name:'github_edit_file',args:{path:'data.js',message:'una',edits:[{old_text:'back: "en 5"',new_text:'back: "cinque"'}]}}}],[{text:'Fine.'}]];
  await page.fill('#input','cambia una parola'); await page.click('#sendBtn'); await page.waitForSelector('#confirm:not([hidden])');
  console.log('   modifica piccola:', (await page.textContent('#confirmTitle')).slice(0,40), '| righe =', /Righe: −1 \/ \+1/.test(await page.textContent('#confirmDetails')), '| avviso rosso =', await page.locator('#confirmWarn').isVisible());
  await page.click('#confirmNo'); await page.waitForSelector('.msg.assistant .bubble:has-text("Fine.") >> nth=1',{timeout:15000});
  console.log('— impostazioni');
  await page.click('#menuBtn'); await page.click('.drawer [data-open-settings]').then(()=>page.evaluate(()=>document.querySelectorAll('details.set-sec,details.set-sub').forEach(d=>d.open=true))); await page.waitForSelector('#githubUseBranch',{state:'attached'});
  console.log('   branch di lavoro attivo di serie =', await page.locator('#githubUseBranch').isChecked(), '| nome =', await page.inputValue('#githubWorkBranch'));
  await page.fill('#githubWorkBranch','prove'); await page.click('#closeSettings');
  console.log('   nome salvato =', await page.evaluate(()=>JSON.parse(localStorage.getItem('miaai_v1_settings')).githubWorkBranch));
  console.log('ERRORS', errs);
  await b.close(); web.close();
})().catch(e=>{console.error('FAIL',e);process.exit(1)});
