/* Test end-to-end di Mia AI. Tutti i servizi esterni sono simulati: nessuna chiamata reale. Vedi tests/README.md */
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const root = path.resolve(__dirname, '..', '..');
const mime = { '.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.webmanifest':'application/json' };
const web = http.createServer((q,r)=>{ let p=q.url.split('?')[0]; if(p==='/')p='/index.html'; const f=path.join(root,p); fs.readFile(f,(e,d)=>{ if(e){r.writeHead(404);r.end();return;} r.writeHead(200,{'content-type':mime[path.extname(f)]||'application/octet-stream'}); r.end(d);});}).listen(8100);
const cors={'access-control-allow-origin':'*','access-control-allow-headers':'*','access-control-allow-methods':'*'};
const deck = (id, name, n) => '  {\n    id: "' + id + '",\n    name: "' + name + '",\n    cards: [\n' + Array.from({length:n},(_,i)=>'      { front: "parola ' + (i+1) + '", back: "' + id + ' ' + (i+1) + '" },\n').join('') + '    ]\n  }';
const DATA = 'const DECKS = [\n' + [deck('en','Inglese',200), deck('fr','Francese',200), deck('de','Tedesco',200)].join(',\n') + '\n];\n';
const big = 'const BIG = [\n' + Array.from({length:100},(_,i)=>'  { id: "c' + i + '", t: "x" },\n').join('') + '];\n';
const FILES = () => ({
  'data.js': DATA + 'const CONFIG = {\n  nome: "prova",\n  vecchia: true,\n  attiva: false\n};\nfunction helper(a, b) {\n  return a + b;\n}\nconst LIMITE = 10;\nclass Archivio {\n  static crea() { return new Archivio(); }\n  leggi(x) { return x; }\n}\n',
  'big.js': big,
  'mod.mjs': 'import a from "./a.js";\nexport const DECKS = [{ id: "m" }];\nexport function creaMazzo(n) { return { id: n }; }\n',
  'dati.json': '[\n  {"id": 1},\n  {"id": 2}\n]\n',
  'LEGGIMI.md': '# Titolo\n\ntesto\n\n```\n# dentro il codice\n```\n\n## Sezione\n',
  'rotto.js': 'const a = ;\n',
  'iife.js': '(function (window) {\n  window.DECKS = [\n    { id: "en" },\n    { id: "de" }\n  ];\n})(window);\n'
});
let gh;
const reset = () => { gh = { branches: { main: { commits:['c0'], files: FILES() } }, n: 0, calls: [] }; };
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
  await page.goto('http://localhost:8100/'); await page.waitForSelector('#input');
  const run = (name,args,c) => page.evaluate(async ([name,args,c]) => { try { if (c.readKeys) c.readState = { read: new Set(c.readKeys), full: new Set() }; const r = await MiaTools.run(name,args,Object.assign({token:'t',repoLock:true,repoScope:'mario/flash'},c)); return {ok:true,text:r.text}; } catch(e){ return {ok:false,error:e.message}; } }, [name,args,c||{}]);
  const decks = (t) => { try { return new Function(t + ';return DECKS;')().map(d=>d.id+':'+d.cards.length).join(' '); } catch(e) { return 'NON VALIDO'; } };
  const puts = () => gh.calls.filter(c=>c.startsWith('PUT')).length;
  const syn = (path, text) => page.evaluate(([p,t]) => MiaTools.syntaxError(p,t), [path,text]);
  console.log('— controllo della sintassi con acorn');
  await run('github_outline',{path:'data.js'},{workBranch:''}); // carica acorn
  console.log('    acorn caricato =', await page.evaluate(()=>!!window.acorn));
  console.log('    modulo valido →', await syn('m.mjs','import a from "./a.js";\nexport const x = await a();\n'));
  const e1 = await syn('m.js','const a = 1;\nconst b = {\n  x: 1,\n  y: ,\n};\n'); console.log('    errore con posizione →', /riga 4, colonna 6/.test(e1) ? 'riga 4, colonna 6' : e1);
  console.log('    modulo rotto →', /riga 2/.test(await syn('m.mjs','import a from "./a.js";\nexport const = 1;\n')) ? 'riga 2' : 'NO');
  console.log('    await al primo livello (script) →', await syn('s.js','await fetch("x");\n'));
  console.log('    file json →', await syn('a.json','{"a":1}'), '| json rotto =', typeof await syn('a.json','{"a":}'));
  console.log('— mappa del file (github_outline)');
  gh.calls.length = 0;
  let r = await run('github_outline',{path:'data.js'},{workBranch:''});
  const o = r.ok ? r.text : 'ERR ' + r.error;
  console.log('    intestazione =', o.split('\n')[0], '| sola lettura (scritture) =', puts());
  console.log('    array DECKS = 3 elementi con id =', /const DECKS = \[3 elementi\]/.test(o) && /\[0\] id=en/.test(o) && /\[2\] id=de/.test(o), '| righe del mazzo tedesco =', (o.match(/(\d+–\d+)\s+\[2\] id=de/) || [])[1]);
  console.log('    funzione e costante trovate =', /function helper\(a, b\)/.test(o) && /const LIMITE = 10/.test(o), '| classe con metodi =', /class Archivio/.test(o) && /static crea/.test(o), '| oggetto con chiavi =', /const CONFIG = \{3 chiavi\}/.test(o) && /vecchia: true/.test(o));
  console.log('    non chiede conferma =', await page.evaluate(()=>MiaTools.needsConfirm('github_outline',{path:'x'})));
  r = await run('github_outline',{path:'data.js',symbol:'decks',max_items:5},{workBranch:''});
  console.log('    con symbol: solo DECKS =', !/function helper/.test(r.text) && /const DECKS/.test(r.text));
  r = await run('github_outline',{path:'data.js',max_items:5},{workBranch:''});
  console.log('    pochi elementi → riepilogo =', /non mostrati/.test(r.text) === false ? 'nessun taglio (3 elementi)' : 'taglio');
  r = await run('github_outline',{path:'big.js'},{workBranch:''});
  console.log('    array lungo (100 carte) → taglio con primi e ultimi =', /non mostrati/.test(r.text) && /\[0\] id=c0/.test(r.text) && /\[99\] id=c99/.test(r.text) && !/\[50\]/.test(r.text));
  r = await run('github_outline',{path:'mod.mjs'},{workBranch:''}); console.log('    modulo con export =', /export|function creaMazzo/.test(r.text) && /const DECKS/.test(r.text));
  r = await run('github_outline',{path:'dati.json'},{workBranch:''}); console.log('    json =', /\(radice\)/.test(r.text) && /\[2 elementi\]/.test(r.text) ? 'radice con 2 elementi' : r.text.slice(0,100));
  r = await run('github_outline',{path:'LEGGIMI.md'},{workBranch:''}); console.log('    markdown =', /# Titolo/.test(r.text) && /## Sezione/.test(r.text) && !/dentro il codice/.test(r.text));
  r = await run('github_outline',{path:'rotto.js'},{workBranch:''}); console.log('    file rotto →', r.ok ? 'ok (!!)' : r.error.slice(0,80));
  r = await run('github_outline',{path:'data.js',owner:'mario',repo:'segreto'},{workBranch:''}); console.log('    altro repository →', r.ok ? 'LETTO (!!)' : r.error.slice(0,40));
  console.log('— modifica sulla struttura (github_edit_structure)');
  const E = (ops, extra) => run('github_edit_structure', Object.assign({path:'data.js', operations: ops, message:'struttura'}, extra), {workBranch:''});
  gh.calls.length = 0;
  r = await E([{op:'remove_element',target:'DECKS',match:{id:'de'}}],{dry_run:true});
  console.log('    anteprima:', r.ok ? r.text.split('\n').slice(0,3).join(' / ').replace(/\s+/g,' ').slice(0,150) : 'ERR '+r.error, '| scritture =', puts(), '| conferma richiesta =', await page.evaluate(()=>MiaTools.needsConfirm('github_edit_structure',{dry_run:true,operations:[]})));
  console.log('    dopo l\'anteprima il file è intatto =', decks(gh.branches.main.files['data.js']));
  r = await E([{op:'remove_element',target:'DECKS',match:{id:'xx'}}]); console.log('    elemento inesistente →', r.ok ? 'FATTO (!!)' : r.error.slice(0,100));
  r = await E([{op:'remove_element',target:'NONESISTE',match:{id:'de'}}]); console.log('    variabile inesistente →', r.ok ? 'FATTO (!!)' : r.error.slice(0,120));
  r = await E([{op:'remove_element',target:'DECKS',match:{back:'x'}}]); console.log('    nessuna corrispondenza →', r.ok ? 'FATTO' : 'rifiutato');
  r = await E([{op:'remove_element',target:'CONFIG',match:{id:'de'}}]); console.log('    non è un array →', r.ok ? 'FATTO (!!)' : r.error.split(': ').pop().slice(0,50));
  r = await E([{op:'remove_element',target:'DECKS',match:{id:'de'}}],{must_count:[{text:'front:',equals:999}]}); console.log('    must_count non rispettato →', r.ok ? 'SALVATO (!!)' : 'rifiutato', '| scritture =', puts());
  console.log('    toglie il mazzo centrale (fr) =', await (async()=>{ const x = await E([{op:'remove_element',target:'DECKS',match:{id:'fr'}}],{must_count:[{text:'front:',change:-200}]}); return x.ok ? decks(gh.branches.main.files['data.js']) : 'ERR '+x.error; })(), '| scritture =', puts());
  console.log('    toglie l\'ultimo (de) =', await (async()=>{ const x = await E([{op:'remove_element',target:'DECKS',match:{id:'de'}}]); return x.ok ? decks(gh.branches.main.files['data.js']) : 'ERR '+x.error; })());
  console.log('    il resto del file è intatto =', /function helper/.test(gh.branches.main.files['data.js']) && /const CONFIG/.test(gh.branches.main.files['data.js']));
  console.log('    aggiunge un mazzo in fondo =', await (async()=>{ const x = await E([{op:'add_element',target:'DECKS',element:'{ id: "it", name: "Italiano", cards: [] }'}]); return x.ok ? decks(gh.branches.main.files['data.js']) : 'ERR '+x.error; })());
  r = await E([{op:'add_element',target:'DECKS',element:'{ id: "it", name: "Doppione", cards: [] }'}]); console.log('    doppione →', r.ok ? 'AGGIUNTO (!!)' : r.error.split(': ').pop().slice(0,60));
  r = await E([{op:'add_element',target:'DECKS',element:'{ id: "es", ,, }'}]); console.log('    elemento non valido →', r.ok ? 'AGGIUNTO (!!)' : 'rifiutato');
  console.log('    aggiunge all\'inizio =', await (async()=>{ const x = await E([{op:'add_element',target:'DECKS',element:'{ id: "pt", name: "Portoghese", cards: [] }',position:'start'}]); return x.ok ? decks(gh.branches.main.files['data.js']) : 'ERR '+x.error; })());
  console.log('    aggiunge dopo "en" =', await (async()=>{ const x = await E([{op:'add_element',target:'DECKS',element:'{ id: "ru", name: "Russo", cards: [] }',after_match:{id:'en'}}]); return x.ok ? decks(gh.branches.main.files['data.js']) : 'ERR '+x.error; })());
  console.log('    toglie una proprietà dall\'oggetto =', await (async()=>{ const x = await E([{op:'remove_property',target:'CONFIG',key:'vecchia'}]); return x.ok ? (/vecchia/.test(gh.branches.main.files['data.js']) ? 'ANCORA' : 'tolta') + ' | CONFIG ok = ' + (new Function(gh.branches.main.files['data.js'] + ';return CONFIG;')().nome) : 'ERR '+x.error; })());
  console.log('    toglie una funzione =', await (async()=>{ const x = await E([{op:'remove_declaration',name:'helper'}]); return x.ok ? (/function helper/.test(gh.branches.main.files['data.js']) ? 'ANCORA' : 'tolta') + ' | LIMITE ancora = ' + /const LIMITE/.test(gh.branches.main.files['data.js']) : 'ERR '+x.error; })());
  r = await E([{op:'remove_declaration',name:'nonEsiste'}]); console.log('    dichiarazione inesistente →', r.ok ? 'FATTO (!!)' : r.error.split(': ').pop().slice(0,50));
  r = await E([{op:'boh'}]); console.log('    operazione sconosciuta →', r.ok ? 'FATTO (!!)' : r.error.split(': ').pop().slice(0,50));
  console.log('    il file finale è valido =', await syn('data.js', gh.branches.main.files['data.js']) === null);
  console.log('— più elementi insieme, array con virgola finale, file json');
  gh.branches.main.files['lista.js'] = 'const L = [\n  { id: "a", n: 1 },\n  { id: "b", n: 2 },\n  { id: "b", n: 3 },\n  { id: "c", n: 4 },\n];\n';
  r = await run('github_edit_structure',{path:'lista.js',operations:[{op:'remove_element',target:'L',match:{id:'b'}}],message:'x'},{workBranch:''}); console.log('    due corrispondenze senza all →', r.ok ? 'FATTO (!!)' : r.error.split(': ').pop().slice(0,60));
  r = await run('github_edit_structure',{path:'lista.js',operations:[{op:'remove_element',target:'L',match:{id:'b'},all:true}],message:'x'},{workBranch:''}); console.log('    con all =', r.ok ? new Function(gh.branches.main.files['lista.js']+';return L;')().map(x=>x.id).join('') : 'ERR '+r.error, '| virgola finale conservata =', /\},\n\];/.test(gh.branches.main.files['lista.js']));
  r = await run('github_edit_structure',{path:'lista.js',operations:[{op:'remove_element',target:'L',match:{id:'c'}}],message:'x'},{workBranch:''}); console.log('    ultimo con virgola finale → ancora valido =', await syn('lista.js',gh.branches.main.files['lista.js']) === null, '| elementi =', new Function(gh.branches.main.files['lista.js']+';return L;')().length);
  r = await run('github_edit_structure',{path:'dati.json',operations:[{op:'remove_element',target:'$',match:{id:2}}],message:'x'},{workBranch:''}); console.log('    json: tolto =', r.ok ? JSON.parse(gh.branches.main.files['dati.json']).map(x=>x.id).join(',') : 'ERR '+r.error);
  r = await run('github_edit_structure',{path:'dati.json',operations:[{op:'add_element',target:'$',element:'{"id": 3}'}],message:'x'},{workBranch:''}); console.log('    json: aggiunto =', r.ok ? JSON.parse(gh.branches.main.files['dati.json']).map(x=>x.id).join(',') : 'ERR '+r.error);
  r = await run('github_edit_structure',{path:'rotto.js',operations:[{op:'remove_declaration',name:'a'}],message:'x'},{workBranch:''}); console.log('    file già rotto →', r.ok ? 'FATTO (!!)' : r.error.slice(0,50));
  console.log('— modulo con window.DECKS e funzione richiamata subito');
  r = await run('github_edit_structure',{path:'iife.js',operations:[{op:'remove_element',target:'window.DECKS',match:{id:'de'}}],message:'x'},{workBranch:''}); console.log('    window.DECKS dentro (function(){…})() =', r.ok ? new Function('var window={};' + gh.branches.main.files['iife.js'] + ';return window.DECKS;')().map(d=>d.id).join(',') : 'ERR '+r.error);
  console.log('— branch di lavoro e limiti');
  reset(); gh.calls.length = 0;
  r = await run('github_edit_structure',{path:'data.js',operations:[{op:'remove_element',target:'DECKS',match:{id:'de'}}],dry_run:true},{workBranch:'mia-lavoro'}); console.log('    anteprima: branch creato =', gh.calls.some(c=>c.startsWith('POST')), '| scritture =', puts(), '| esito =', r.ok ? 'ok' : r.error.slice(0,60));
  r = await run('github_edit_structure',{path:'data.js',operations:[{op:'remove_element',target:'DECKS',match:{id:'de'}}],message:'x',branch:'main'},{workBranch:'mia-lavoro'}); console.log('    scrittura →', r.ok ? 'ok' : 'ERR '+r.error.slice(0,60), '| principale intatto =', decks(gh.branches.main.files['data.js'])==='en:200 fr:200 de:200', '| branch di lavoro =', decks(gh.branches['mia-lavoro'].files['data.js']));
  r = await run('github_edit_structure',{path:'data.js',operations:[{op:'remove_element',target:'DECKS',match:{id:'de'}}],message:'x',owner:'mario',repo:'segreto'},{workBranch:''}); console.log('    altro repository →', r.ok ? 'FATTO (!!)' : r.error.slice(0,40));
  console.log('— leggere prima di scrivere');
  reset(); gh.calls.length = 0;
  const G = { readGuard: true, readKeys: [], workBranch: '' };
  r = await run('github_edit_structure',{path:'data.js',operations:[{op:'remove_element',target:'DECKS',match:{id:'de'}}],message:'x'}, G); console.log('    senza lettura → Non ho modificato nulla =', /Non ho modificato nulla/.test(r.error||''), '| scritture =', puts());
  r = await run('github_edit_structure',{path:'data.js',operations:[{op:'remove_element',target:'DECKS',match:{id:'de'}}],dry_run:true}, G); console.log('    anteprima senza lettura → ok =', r.ok);
  G.readKeys = ['mario/flash/data.js'];
  r = await run('github_edit_structure',{path:'data.js',operations:[{op:'remove_element',target:'DECKS',match:{id:'de'}}],message:'x'}, G); console.log('    dopo la mappa/lettura → scritto =', r.ok, '| mazzi =', decks(gh.branches.main.files['data.js']));
  console.log('— dall\'app: la mappa conta come lettura, conferma, istruzioni');
  const gem=[]; let script=[];
  await ctx.route('https://generativelanguage.googleapis.com/**', async route => { const q=route.request(); if(q.method()==='OPTIONS') return route.fulfill({status:204,headers:cors}); gem.push((q.postDataBuffer()||Buffer.from('')).toString('utf8')); const parts=script.shift()||[{text:'Fine.'}]; route.fulfill({status:200,headers:{...cors,'content-type':'text/event-stream'},body:'data: '+JSON.stringify({candidates:[{content:{parts}}]})+'\n\n'}); });
  await page.evaluate(()=>localStorage.setItem('miaai_v1_settings',JSON.stringify({provider:'gemini',profiles:{gemini:{apiKey:'k',model:'gemini-3.5-flash',baseUrl:'https://generativelanguage.googleapis.com/v1beta'}},agentEnabled:true,githubToken:'tok',githubNewChatRepo:true,githubRepo:'mario/flash',githubUseBranch:false,autoFallback:false,favorites:[],theme:'dark',systemPrompt:'x',temperature:0.7})));
  await page.reload(); await page.waitForSelector('#input'); reset();
  script=[[{functionCall:{name:'github_outline',args:{path:'data.js'}}}],[{functionCall:{name:'github_edit_structure',args:{path:'data.js',operations:[{op:'remove_element',target:'DECKS',match:{id:'de'}}],message:'togli il tedesco'}}}],[{text:'Fine.'}]];
  await page.fill('#input','togli il tedesco'); await page.click('#sendBtn'); await page.waitForSelector('#confirm:not([hidden])');
  console.log('    conferma:', (await page.textContent('#confirmTitle')).slice(0,60), '| mostra l\'operazione =', /remove_element/.test(await page.textContent('#confirmDetails')));
  await page.click('#confirmYes'); await page.waitForSelector('.msg.assistant .bubble:has-text("Fine.")',{timeout:15000});
  console.log('    il modello conosce gli strumenti =', /github_outline/.test(gem[0]) && /github_edit_structure/.test(gem[0]), '| dopo la mappa, la modifica non è stata rifiutata =', !/Non ho modificato nulla/.test(gem[2]||''), '| mazzi =', decks(gh.branches.main.files['data.js']));
  console.log('    istruzioni: mappa invece di rileggere =', /github_outline/.test(gem[0]) && /non rileggere/i.test(gem[0]));
  console.log('    errore ripetuto o esterno → cerca sul web (web_search), errore nel codice → rileggi =', /ripete due volte/.test(gem[0]) && /web_search il messaggio esatto/.test(gem[0]) && /invece di cercare sul web/.test(gem[0]));
  console.log('ERRORS', errs);
  await b.close(); web.close();
})().catch(e=>{console.error('FAIL',e);process.exit(1)});
