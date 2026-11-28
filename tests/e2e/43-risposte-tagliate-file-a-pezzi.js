/* Test end-to-end di Mia AI. Tutti i servizi esterni sono simulati: nessuna chiamata reale. Vedi tests/README.md */
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const root = path.resolve(__dirname, '..', '..');
const mime = { '.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.webmanifest':'application/json' };
const web = http.createServer((q,r)=>{ let p=q.url.split('?')[0]; if(p==='/')p='/index.html'; const f=path.join(root,p); fs.readFile(f,(e,d)=>{ if(e){r.writeHead(404);r.end();return;} r.writeHead(200,{'content-type':mime[path.extname(f)]||'application/octet-stream'}); r.end(d);});}).listen(8104);
const cors={'access-control-allow-origin':'*','access-control-allow-headers':'*','access-control-allow-methods':'*'};
const deck = (id, n) => '  {\n    id: "' + id + '",\n    cards: [\n' + Array.from({length:n},(_,i)=>'      { front: "p' + (i+1) + '", back: "' + id + (i+1) + '" },\n').join('') + '    ]\n  }';
const DATA = 'const DECKS = [\n' + [deck('en',3), deck('fr',3), deck('de',3)].join(',\n') + '\n];\nconst TOTALE = DECKS.length;\n';
const crypto = require('crypto'); const shaOf = (t) => 'b' + crypto.createHash('sha1').update(t).digest('hex').slice(0, 20);
let gh;
const reset = () => { gh = { branches: { main: { commits:['c0'], files: { 'data.js': DATA, 'README.md': '# Flash\n', 'js/app.js': 'function avvia() { return 1; }\nconst OPZIONI = { a: 1, b: 2 };\n' + '// riempitivo\n'.repeat(200) } } }, blobs: {}, n: 0, calls: [] }; Object.values(gh.branches.main.files).forEach(t => gh.blobs[shaOf(t)] = t); };
reset();
(async () => {
  const b = await chromium.launch(); const ctx = await b.newContext({viewport:{width:390,height:844}}); const page = await ctx.newPage(); const errs=[]; page.on('pageerror', e => errs.push(e.message));
  await ctx.route('https://api.github.com/**', async route => { const r=route.request(); const u=new URL(r.url()); if(r.method()==='OPTIONS') return route.fulfill({status:204,headers:cors});
    const j=(o,s=200)=>route.fulfill({status:s,headers:{...cors,'content-type':'application/json'},body:JSON.stringify(o)}); const p=u.pathname; const m=r.method(); gh.calls.push(m+' '+p+u.search);
    if (p==='/user') return j({login:'mario'}); if (p==='/repos/mario/flash') return j({default_branch:'main'}); let x;
    if ((x = p.match(/^\/repos\/mario\/flash\/git\/ref\/heads\/(.+)$/))) { const br=gh.branches[decodeURIComponent(x[1])]; return br ? j({object:{sha:br.commits[br.commits.length-1]}}) : j({message:'Not Found'},404); }
    if (p==='/repos/mario/flash/git/refs' && m==='POST') { const body=JSON.parse(r.postData()); const name=body.ref.replace('refs/heads/',''); const main=gh.branches.main; gh.branches[name]={commits:main.commits.slice(),files:Object.assign({},main.files)}; return j({ref:body.ref},201); }
    if ((x = p.match(/^\/repos\/mario\/flash\/git\/trees\/(.+)$/))) { const br=gh.branches[decodeURIComponent(x[1])]; return j({tree:Object.keys(br.files).map(f=>({path:f,type:'blob',size:Buffer.byteLength(br.files[f])})).concat([{path:'js',type:'tree'}]),truncated:false}); }
    if ((x = p.match(/^\/repos\/mario\/flash\/git\/blobs\/(.+)$/))) { const t=gh.blobs[x[1]]; return t===undefined ? j({message:'Not Found'},404) : j({sha:x[1],encoding:'base64',content:Buffer.from(t).toString('base64').replace(/(.{60})/g,'$1\n')}); }
    if ((x = p.match(/^\/repos\/mario\/flash\/contents\/(.+)$/))) { const name=decodeURIComponent(x[1]);
      if (m==='GET') { const br=gh.branches[u.searchParams.get('ref')||'main']; if (!br) return j({message:'No commit found for the ref'},404); const t=br.files[name]; return t===undefined ? j({message:'Not Found'},404) : j({type:'file',path:name,size:Buffer.byteLength(t),sha:shaOf(t),content:Buffer.from(t).toString('base64'),encoding:'base64'}); }
      const body=JSON.parse(r.postData()); const br=gh.branches[body.branch||'main']; if (!br) return j({message:'Branch not found'},404);
      const cur=br.files[name]; if (cur!==undefined && body.sha!==shaOf(cur)) return j({message:'sha does not match'},409); if (cur===undefined && body.sha && m==='PUT') return j({message:'sha wasn\'t supplied'},422);
      const id='c'+(++gh.n); br.commits.push(id);
      if (m==='DELETE') { delete br.files[name]; return j({commit:{sha:id+'abcdef1234'},content:null}); }
      const t=Buffer.from(body.content,'base64').toString('utf8'); br.files[name]=t; gh.blobs[shaOf(t)]=t; return j({commit:{sha:id+'abcdef1234'},content:{sha:shaOf(t),html_url:'x'}}); }
    return j({message:'Not Found'},404); });
  const gem=[]; let script=[]; const oai=[]; let oscript=[];
  // Gemini simulato: ogni voce dello script è {parts, finish} oppure un elenco di parti
  await ctx.route('https://generativelanguage.googleapis.com/**', async route => { const q=route.request(); if(q.method()==='OPTIONS') return route.fulfill({status:204,headers:cors}); gem.push((q.postDataBuffer()||Buffer.from('')).toString('utf8')); let e=script.shift()||[{text:'Fine.'}]; if (Array.isArray(e)) e={parts:e}; const cand={content:{parts:e.parts||[]}}; if (e.finish) cand.finishReason=e.finish; route.fulfill({status:200,headers:{...cors,'content-type':'text/event-stream'},body:'data: '+JSON.stringify({candidates:[cand]})+'\n\n'}); });
  // Groq simulato (OpenAI): {text, finish, call:{name, args(stringa)}}
  await ctx.route('https://api.groq.com/**', async route => { const q=route.request(); if(q.method()==='OPTIONS') return route.fulfill({status:204,headers:cors}); oai.push((q.postDataBuffer()||Buffer.from('')).toString('utf8')); const e=oscript.shift()||{text:'Fine.'}; let b=''; if (e.text) b+='data: '+JSON.stringify({choices:[{delta:{content:e.text}}]})+'\n\n'; if (e.call) b+='data: '+JSON.stringify({choices:[{delta:{tool_calls:[{index:0,id:'call1',function:{name:e.call.name,arguments:e.call.args}}]}}]})+'\n\n'; b+='data: '+JSON.stringify({choices:[{delta:{},finish_reason:e.finish||'stop'}]})+'\n\ndata: [DONE]\n\n'; route.fulfill({status:200,headers:{...cors,'content-type':'text/event-stream'},body:b}); });
  await page.goto('http://localhost:8104/'); await page.waitForSelector('#input');
  const SET = (extra) => JSON.stringify(Object.assign({provider:'gemini',profiles:{gemini:{apiKey:'k',model:'gemini-3.5-flash',baseUrl:'https://generativelanguage.googleapis.com/v1beta'},groq:{apiKey:'g',model:'llama',baseUrl:'https://api.groq.com/openai/v1'}},fallbacks:[],agentEnabled:true,githubToken:'tok',githubNewChatRepo:true,githubRepo:'mario/flash',githubReadFirst:false,autoFallback:false,autoResume:false,keepAwake:false,favorites:[],theme:'dark',systemPrompt:'x',temperature:0.7}, extra||{}));
  const fresh = async (extra) => { await page.evaluate((s)=>{ localStorage.clear(); localStorage.setItem('miaai_v1_settings', s); }, SET(extra)); await page.reload(); await page.waitForSelector('#input'); reset(); gem.length = 0; oai.length = 0; };
  const ask = async (t, waitText) => { await page.fill('#input', t); await page.click('#sendBtn'); if (waitText) await page.waitForSelector('.msg.assistant .bubble:has-text("' + waitText + '")', { timeout: 20000 }); };
  const lastBubble = async () => (await page.locator('.msg.assistant .bubble').last().textContent()).trim();
  const puts = () => gh.calls.filter(c=>c.startsWith('PUT')).length;

  console.log('— risposta tagliata (Gemini MAX_TOKENS): continua da sola');
  await fresh({agentEnabled:false});
  script=[{parts:[{text:'Prima parte, '}],finish:'MAX_TOKENS'},{parts:[{text:'seconda parte, '}],finish:'MAX_TOKENS'},{parts:[{text:'fine.'}],finish:'STOP'}];
  await ask('scrivimi un testo molto lungo su qualcosa di interessante', 'fine.');
  console.log('    testo unito =', await lastBubble(), '| richieste =', gem.length);
  console.log('    la continuazione manda il testo già scritto e la richiesta di continuare =', /Prima parte, seconda parte,/.test(gem[2]) && /Continua ESATTAMENTE da dove ti sei interrotto/.test(gem[2]));
  const st = await page.evaluate(() => { const c = JSON.parse(localStorage.getItem('miaai_v1_conversations'))[0]; return { n: c.messages.length, sp: c.messages[1].speed }; });
  console.log('    un solo messaggio salvato =', st.n === 2, '| continuazioni registrate =', st.sp && st.sp.conts, '| etichetta con ↻ =', /↻2/.test(await page.locator('.msg.assistant .model-tag').last().textContent()));
  console.log('— tagliata 4 volte: si ferma dopo 3 continuazioni');
  script=[1,2,3,4].map(i=>({parts:[{text:'pezzo'+i+' '}],finish:'MAX_TOKENS'}));
  await ask('scrivimi un altro testo molto lungo su qualcosa di diverso', 'ancora tagliata'); console.log('    richieste =', gem.length - 3, '| avviso =', /risposta ancora tagliata dopo 3 continuazioni/.test(await lastBubble()));
  console.log('— API compatibili OpenAI (finish_reason length)');
  await fresh({agentEnabled:false, provider:'groq'});
  oscript=[{text:'Uno, ',finish:'length'},{text:'due.',finish:'stop'}];
  await ask('conta fino a due per favore, lentamente e con calma', 'due.'); console.log('    testo unito =', await lastBubble(), '| richieste =', oai.length);
  console.log('— chiamata a uno strumento tagliata a metà');
  await fresh({provider:'groq'});
  oscript=[{call:{name:'github_write_file',args:'{"path":"grande.js","content":"const a = ['},finish:'length'},{text:'Ho capito, lo scrivo a pezzi.'}];
  await ask('crea un file grande.js molto lungo con tanti dati', 'lo scrivo a pezzi');
  console.log('    il modello riceve la spiegazione =', /TAGLIATA perché la tua risposta era troppo lunga/.test(oai[1]) && /github_append_file/.test(oai[1]), '| nessuna scrittura =', puts() === 0);
  console.log('— risposta vuota tagliata (Gemini): chiede di dividere');
  await fresh();
  script=[{parts:[],finish:'MAX_TOKENS'},[{text:'Va bene, divido.'}]];
  await ask('crea un file enorme con tutti i dati del progetto', 'divido.'); console.log('    richiesta di dividere =', /Scrivi i file lunghi a pezzi/.test(gem[1]), '| nessun errore «Risposta vuota» =', (await page.locator('.msg.error').count()) === 0);

  console.log('— file scritto a pezzi, con il piano');
  await fresh();
  const W = (args) => ({functionCall:{name:'github_write_file',args}});
  const A = (args) => ({functionCall:{name:'github_append_file',args}});
  script=[
    [W({path:'grande.js',content:'const DATI = [\n  1,\n',partial:true,message:'inizio'})],
    [{functionCall:{name:'update_plan',args:{steps:[{text:'Scrivere grande.js a pezzi',status:'in_progress'},{text:'Aggiornare index.html',status:'todo'}]}}}],
    [W({path:'grande.js',content:'const DATI = [\n  1,\n',partial:true,message:'inizio'})],
    [A({path:'grande.js',content:'  2,\n',message:'parte 2'})],
    [A({path:'grande.js',content:'  3,\n',message:'parte 3'})],
    [A({path:'grande.js',content:'  4,\n',message:'parte 4 rotta',last:true})],
    [A({path:'grande.js',content:'  4\n];\n',message:'fine',last:true})],
    [{text:'File creato.'}]
  ];
  await ask('crea il file grande.js con un array DATI molto lungo, a pezzi', null);
  await page.waitForSelector('#confirm:not([hidden])');
  console.log('    senza piano → fermato =', /Non ho fatto nulla: questo è un lavoro grande \(un file scritto a pezzi\)/.test(gem[1]), '| nessuna scrittura =', puts() === 0);
  console.log('    conferma prima parte:', (await page.textContent('#confirmTitle')).slice(0, 40), '| casella «prossime parti» nascosta =', await page.locator('#confirmAllowRow').isHidden());
  await page.click('#confirmYes'); await page.waitForSelector('#confirmAllowRow:not([hidden])');
  console.log('    conferma aggiunta:', (await page.textContent('#confirmTitle')).slice(0, 45), '| differenze =', await page.locator('#confirmDiff .d-add').count() > 0 || 'in arrivo');
  console.log('    prima parte scritta anche se non è ancora JS valido =', /^const DATI = \[\n  1,\n$/.test(gh.branches['mia-lavoro'].files['grande.js'] || ''));
  await page.check('#confirmAllow'); await page.click('#confirmYes');
  await page.waitForSelector('.msg.assistant .bubble:has-text("File creato.")', { timeout: 20000 });
  console.log('    parti successive senza chiedere =', puts() === 4, '| ultima parte rotta rifiutata =', /Ultima parte NON aggiunta: il file finito non sarebbe valido/.test(gem[6] || ''));
  console.log('    file finito =', JSON.stringify(gh.branches['mia-lavoro'].files['grande.js']), '| valido =', (()=>{ try { return new Function(gh.branches['mia-lavoro'].files['grande.js'] + ';return DATI;')().join(','); } catch(e) { return 'NO'; } })());
  console.log('    esito dell\'ultima =', /Il file finito è sintatticamente valido/.test(gem[7] || ''));
  console.log('— secondo file senza piano → fermato; un file solo → nessun piano richiesto');
  await fresh();
  const E = (path, o, n) => ({functionCall:{name:'github_edit_file',args:{path,edits:[{old_text:o,new_text:n}],message:'x'}}});
  gh.branches.main.files['b.js'] = 'const B = 1;\n'; gh.blobs[shaOf('const B = 1;\n')] = 'const B = 1;\n';
  script=[[E('js/app.js','return 1;','return 2;')],[E('b.js','const B = 1;','const B = 2;')],[{text:'Fatto.'}]];
  await ask('cambia il valore restituito da avvia e quello di B, grazie', null);
  await page.waitForSelector('#confirm:not([hidden])'); await page.click('#confirmYes');
  await page.waitForSelector('.msg.assistant .bubble:has-text("Fatto.")', { timeout: 20000 });
  console.log('    primo file → scritto =', puts() === 1, '| secondo file senza piano → fermato =', /più di un file/.test(gem[2] || ''));
  console.log('— tempo di preparazione');
  const prep = await page.evaluate(() => { const c = JSON.parse(localStorage.getItem('miaai_v1_conversations'))[0]; return c.messages.find(m => m.role === 'assistant' && m.speed).speed.prep; });
  console.log('    misurato =', typeof prep === 'number' && prep >= 0);
  console.log('ERRORS', errs);
  await b.close(); web.close();
})().catch(e=>{console.error('FAIL',e);process.exit(1)});
