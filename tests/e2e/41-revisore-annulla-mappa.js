/* Test end-to-end di Mia AI. Tutti i servizi esterni sono simulati: nessuna chiamata reale. Vedi tests/README.md */
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const root = path.resolve(__dirname, '..', '..');
const mime = { '.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.webmanifest':'application/json' };
const web = http.createServer((q,r)=>{ let p=q.url.split('?')[0]; if(p==='/')p='/index.html'; const f=path.join(root,p); fs.readFile(f,(e,d)=>{ if(e){r.writeHead(404);r.end();return;} r.writeHead(200,{'content-type':mime[path.extname(f)]||'application/octet-stream'}); r.end(d);});}).listen(8101);
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
  const gem=[]; let script=[]; const groq=[]; let groqReply='OK, la modifica è corretta.';
  await ctx.route('https://generativelanguage.googleapis.com/**', async route => { const q=route.request(); if(q.method()==='OPTIONS') return route.fulfill({status:204,headers:cors}); gem.push((q.postDataBuffer()||Buffer.from('')).toString('utf8')); const parts=script.shift()||[{text:'Fine.'}]; route.fulfill({status:200,headers:{...cors,'content-type':'text/event-stream'},body:'data: '+JSON.stringify({candidates:[{content:{parts}}]})+'\n\n'}); });
  await ctx.route('https://api.groq.com/**', async route => { const q=route.request(); if(q.method()==='OPTIONS') return route.fulfill({status:204,headers:cors}); groq.push((q.postDataBuffer()||Buffer.from('')).toString('utf8')); route.fulfill({status:200,headers:{...cors,'content-type':'text/event-stream'},body:'data: '+JSON.stringify({choices:[{delta:{content:groqReply}}]})+'\n\ndata: [DONE]\n\n'}); });
  await page.goto('http://localhost:8101/'); await page.waitForSelector('#input');
  const decks = (t) => { try { return new Function(t + ';return DECKS;')().map(d=>d.id+':'+d.cards.length).join(' '); } catch(e) { return 'NON VALIDO'; } };

  console.log('— differenze riga per riga');
  const d1 = await page.evaluate(() => { const d = MiaTools.lineDiff('a\nb\nc\nd\ne\nf\ng\nh\ni\nj', 'a\nb\nc\nd\nE\nf\ng\nh\ni\nj\nk'); return { add: d.add, del: d.del, text: MiaTools.diffText(d) }; });
  console.log('    righe tolte/aggiunte =', d1.del + '/' + d1.add, '| con numeri e contesto =', /^- 5 \| e$/m.test(d1.text) && /^\+ 5 \| E$/m.test(d1.text) && /^  2 \| b$/m.test(d1.text) && /^\+ 11 \| k$/m.test(d1.text));
  const d2 = await page.evaluate(() => { const a = Array.from({length:100},(_,i)=>'r'+i).join('\n'); const b = a.replace('r10','X').replace('r80','Y'); return MiaTools.diffText(MiaTools.lineDiff(a, b)); });
  console.log('    due zone lontane separate da «…» =', /^…$/m.test(d2) && !/r40/.test(d2));
  const d3 = await page.evaluate(() => { const d = MiaTools.lineDiff(null, 'uno\ndue'); return d.add + ' aggiunte, ' + d.del + ' tolte'; }); console.log('    file nuovo =', d3);

  console.log('— prova del codice (isolata) e conteggi prima/dopo');
  const cc = (p, a, b2) => page.evaluate(([p,a,b2]) => MiaTools.codeCheck(p, a, b2), [p,a,b2]);
  let r = await cc('data.js', DATA, DATA.replace(/,\n  \{\n    id: "de"[\s\S]*?\n  \}/, ''));
  console.log('    togliere un mazzo →', r && r.ok, '|', r && r.text);
  r = await cc('data.js', DATA, DATA.replace('const DECKS', 'const MAZZI'));
  console.log('    rinominare una variabile ancora usata →', r && r.ok, '|', r && /PRIMA si eseguiva, DOPO la modifica dà errore: .*DECKS/.test(r.text));
  r = await cc('ui.js', 'document.getElementById("x").textContent = 1;\nconst A = [1,2];\n', 'document.getElementById("x").textContent = 2;\nconst A = [1,2,3];\n');
  console.log('    file che usa la pagina (non eseguibile da solo) →', r && r.ok, '|', r && /non si può eseguire da solo/.test(r.text) && /A: 2 elementi → 3 elementi/.test(r.text));
  r = await cc('m.mjs', 'export const L = [1];\n', 'export const L = [1, 2];\n'); console.log('    modulo (solo conteggi) →', r && r.text);
  r = await cc('dati.json', '[1,2]', '[1,2,3]'); console.log('    json →', r && r.text);
  r = await cc('note.txt', 'a', 'b'); console.log('    file di testo → nessuna prova =', r === null);

  console.log('— mappa del progetto');
  const map = await page.evaluate(() => MiaTools.projectMap({ token: 't' }, 'mario/flash'));
  console.log('    elenco dei file =', /data\.js \(\d+ B\)/.test(map) && /README\.md/.test(map) && /js\/app\.js/.test(map), '| contenuto dei file grandi =', /js\/app\.js contiene: avvia\(\), OPZIONI \[2 chiavi\]/.test(map));
  const calls0 = gh.calls.length; await page.evaluate(() => MiaTools.projectMap({ token: 't' }, 'mario/flash')); console.log('    seconda volta dalla memoria (nessuna richiesta) =', gh.calls.length === calls0);
  console.log('    senza repository → vuota =', await page.evaluate(() => MiaTools.projectMap({ token: 't' }, '')) === '');

  console.log('— anteprima senza scrivere');
  gh.calls.length = 0;
  const pv = await page.evaluate(() => MiaTools.preview('github_edit_file', { owner:'mario', repo:'flash', path:'data.js', edits:[{old_text:'const TOTALE = DECKS.length;', new_text:'const TOTALE = 3;'}], message:'x', branch:'mia-lavoro' }, { token:'t', workBranch:'mia-lavoro' }));
  console.log('    differenza calcolata =', !!(pv && pv.before && /TOTALE = 3/.test(pv.after)), '| branch non ancora creato → si guarda il principale =', pv && pv.branch === '', '| scritture =', gh.calls.filter(c=>!c.startsWith('GET')).length);
  const pv2 = await page.evaluate(() => MiaTools.preview('github_delete_file', { owner:'mario', repo:'flash', path:'README.md', message:'x' }, { token:'t' })); console.log('    eliminazione → after null =', pv2 && pv2.after === null && pv2.before === '# Flash\n');
  console.log('    strumento di sola lettura → nessuna anteprima =', await page.evaluate(() => MiaTools.preview('github_read_file', { owner:'mario', repo:'flash', path:'data.js' }, { token:'t' })) === null);

  console.log('— dall\'app: conferma con differenze e prova del codice');
  const S = (extra) => JSON.stringify(Object.assign({provider:'gemini',profiles:{gemini:{apiKey:'k',model:'gemini-3.5-flash',baseUrl:'https://generativelanguage.googleapis.com/v1beta'},groq:{apiKey:'g',model:'llama',baseUrl:'https://api.groq.com/openai/v1'}},fallbacks:[{provider:'groq',model:'llama'}],agentEnabled:true,githubToken:'tok',githubNewChatRepo:true,githubRepo:'mario/flash',githubReadFirst:false,autoFallback:true,autoResume:false,keepAwake:false,favorites:[],theme:'dark',systemPrompt:'x',temperature:0.7}, extra||{}));
  await page.evaluate((s)=>{ localStorage.clear(); localStorage.setItem('miaai_v1_settings', s); }, S());
  await page.reload(); await page.waitForSelector('#input'); reset(); gem.length = 0; groq.length = 0;
  script=[[{functionCall:{name:'github_edit_structure',args:{path:'data.js',operations:[{op:'remove_element',target:'DECKS',match:{id:'de'}}],message:'togli il tedesco'}}}],[{text:'Fine.'}]];
  await page.fill('#input','togli il mazzo tedesco dal file data.js, lascia gli altri come sono'); await page.click('#sendBtn'); await page.waitForSelector('#confirm:not([hidden])');
  await page.waitForSelector('#confirmCheck:not([hidden])', { timeout: 15000 }); await page.waitForTimeout(500);
  console.log('    intestazione =', await page.textContent('#confirmDiffHead'));
  console.log('    righe rosse =', await page.locator('#confirmDiff .d-del').count(), '| verdi =', await page.locator('#confirmDiff .d-add').count(), '| numeri di riga =', /^−\d+/.test(await page.locator('#confirmDiff .d-del').first().locator('.d-no').textContent()));
  console.log('    prova =', await page.textContent('#confirmCheck'));
  console.log('    nessun revisore interno (nessuna richiesta all\'altro modello) =', groq.length === 0, '| riquadro del revisore assente =', await page.locator('#confirmReview').count() === 0);
  console.log('    nessuna scrittura prima del sì =', gh.calls.filter(c=>c.startsWith('PUT')).length === 0);
  await page.click('#confirmYes'); await page.waitForSelector('.msg.assistant .bubble:has-text("Fine.")',{timeout:15000});
  console.log('    scritto sul branch di lavoro =', decks(gh.branches['mia-lavoro'].files['data.js']), '| principale intatto =', decks(gh.branches.main.files['data.js']));
  console.log('    istruzioni con la mappa del progetto =', /MAPPA DEL PROGETTO/.test(gem[0]) && /data\.js contiene: DECKS \[3 elementi\]/.test(gem[0]));
  const saved = await page.evaluate(() => { const c = JSON.parse(localStorage.getItem('miaai_v1_conversations'))[0]; const t = c.messages.find(m => m.role === 'tool'); return t && t.commits; });
  console.log('    commit registrato =', !!(saved && saved.length === 1 && saved[0].path === 'data.js' && saved[0].branch === 'mia-lavoro' && saved[0].oldSha && saved[0].newSha));

  console.log('— annulla le modifiche');
  console.log('    pulsante sulla risposta finale =', await page.locator('.msg.assistant [data-act="undo"]').count());
  await page.click('.msg.assistant [data-act="undo"]'); await page.waitForSelector('#confirm:not([hidden])');
  console.log('    conferma:', await page.textContent('#confirmTitle'), '|', (await page.textContent('#confirmDetails')).split('\n')[0], '| rossa =', await page.locator('#confirmWarn').isVisible());
  await page.click('#confirmYes'); await page.waitForSelector('.undone-tag');
  console.log('    file ripristinato =', decks(gh.branches['mia-lavoro'].files['data.js']), '| identico all\'originale =', gh.branches['mia-lavoro'].files['data.js'] === DATA, '| etichetta =', await page.textContent('.undone-tag'), '| pulsante sparito =', await page.locator('[data-act="undo"]').count() === 0);
  script=[[{text:'Ok.'}]]; await page.fill('#input','grazie'); await page.click('#sendBtn'); await page.waitForSelector('.msg.assistant .bubble:has-text("Ok.")',{timeout:15000});
  console.log('    il modello sa che sono state annullate =', /ANNULLATO le modifiche/.test(gem[gem.length-1]));

  console.log('— annullare un file nuovo e un file cambiato dopo');
  reset(); gem.length = 0; groqReply = 'OK';
  await page.evaluate((s)=>{ localStorage.removeItem('miaai_v1_conversations'); localStorage.removeItem('miaai_v1_current'); localStorage.setItem('miaai_v1_settings', s); }, S());
  await page.reload(); await page.waitForSelector('#input'); groq.length = 0;
  script=[[{functionCall:{name:'github_write_file',args:{path:'nuovo.txt',content:'ciao\n',message:'nuovo'}}}],[{text:'Creato.'}]];
  await page.fill('#input','crea il file nuovo.txt con scritto ciao, per favore, grazie mille'); await page.click('#sendBtn'); await page.waitForSelector('#confirm:not([hidden])');
  await page.waitForSelector('#confirmDiffHead:has-text("File nuovo")', { timeout: 10000 }); await page.waitForTimeout(300);
  console.log('    nessuna richiesta all\'altro modello =', groq.length === 0);
  await page.click('#confirmYes'); await page.waitForSelector('.msg.assistant .bubble:has-text("Creato.")',{timeout:15000});
  await page.click('.msg.assistant [data-act="undo"]'); await page.waitForSelector('#confirm:not([hidden])'); console.log('    file nuovo →', (await page.textContent('#confirmDetails')).split('\n')[0]);
  await page.click('#confirmYes'); await page.waitForSelector('.undone-tag'); console.log('    eliminato =', gh.branches['mia-lavoro'].files['nuovo.txt'] === undefined);
  script=[[{functionCall:{name:'github_write_file',args:{path:'nuovo.txt',content:'ciao di nuovo\n',message:'nuovo'}}}],[{text:'Creato di nuovo.'}]];
  await page.fill('#input','crea di nuovo il file nuovo.txt con scritto ciao di nuovo, grazie'); await page.click('#sendBtn'); await page.waitForSelector('#confirm:not([hidden])'); await page.click('#confirmYes'); await page.waitForSelector('.msg.assistant .bubble:has-text("Creato di nuovo.")',{timeout:15000});
  gh.branches['mia-lavoro'].files['nuovo.txt'] = 'cambiato a mano\n'; gh.blobs[shaOf('cambiato a mano\n')] = 'cambiato a mano\n';
  await page.locator('.msg.assistant [data-act="undo"]').last().click(); await page.waitForSelector('#confirm:not([hidden])');
  console.log('    cambiato dopo → avviso =', /cambiato dopo/.test(await page.textContent('#confirmDetails')), '| rossa =', await page.locator('#confirmWarn').isVisible());
  await page.click('#confirmNo'); console.log('    rifiutato → file intatto =', gh.branches['mia-lavoro'].files['nuovo.txt'] === 'cambiato a mano\n');

  console.log('— modello che sbaglia 2 volte con lo stesso strumento → passa al successivo');
  reset(); gem.length = 0; groq.length = 0; groqReply = 'Ho controllato: il file non esiste, serve il nome giusto.';
  await page.evaluate((s)=>{ localStorage.removeItem('miaai_v1_conversations'); localStorage.removeItem('miaai_v1_current'); localStorage.setItem('miaai_v1_settings', s); }, S());
  await page.reload(); await page.waitForSelector('#input');
  script=[[{functionCall:{name:'github_read_file',args:{path:'manca1.js'}}}],[{functionCall:{name:'github_read_file',args:{path:'manca2.js'}}}],[{text:'Gemini di nuovo (!!)'}]];
  await page.fill('#input','leggi il file con le impostazioni del progetto e dimmi cosa contiene'); await page.click('#sendBtn');
  await page.waitForSelector('.msg.assistant .bubble:has-text("Ho controllato")',{timeout:20000});
  const tags = await page.locator('.msg.assistant .model-tag').allTextContents();
  console.log('    richieste a Gemini =', gem.length, '| poi Groq =', groq.length, '| risposta di Groq con ↪ =', /↪ .*llama/.test(tags[tags.length-1]));
  reset(); gem.length = 0; groq.length = 0;
  script=[[{functionCall:{name:'github_read_file',args:{path:'manca1.js'}}}],[{functionCall:{name:'github_read_file',args:{path:'data.js'}}}],[{functionCall:{name:'github_read_file',args:{path:'manca2.js'}}}],[{text:'Gemini ha finito.'}]];
  await page.fill('#input','leggi di nuovo i file del progetto e dimmi cosa contengono'); await page.click('#sendBtn');
  await page.waitForSelector('.msg.assistant .bubble:has-text("Gemini ha finito.")',{timeout:20000});
  console.log('    errori non di fila (in mezzo una lettura riuscita) → resta Gemini =', groq.length === 0);
  console.log('ERRORS', errs);
  await b.close(); web.close();
})().catch(e=>{console.error('FAIL',e);process.exit(1)});
