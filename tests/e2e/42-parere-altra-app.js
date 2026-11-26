/* Test end-to-end di Mia AI. Tutti i servizi esterni sono simulati: nessuna chiamata reale. Vedi tests/README.md */
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const root = path.resolve(__dirname, '..', '..');
const mime = { '.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.webmanifest':'application/json' };
const web = http.createServer((q,r)=>{ let p=q.url.split('?')[0]; if(p==='/')p='/index.html'; const f=path.join(root,p); fs.readFile(f,(e,d)=>{ if(e){r.writeHead(404);r.end();return;} r.writeHead(200,{'content-type':mime[path.extname(f)]||'application/octet-stream'}); r.end(d);});}).listen(8103);
const cors={'access-control-allow-origin':'*','access-control-allow-headers':'*','access-control-allow-methods':'*'};
const deck = (id, n) => '  {\n    id: "' + id + '",\n    cards: [\n' + Array.from({length:n},(_,i)=>'      { front: "p' + (i+1) + '", back: "' + id + (i+1) + '" },\n').join('') + '    ]\n  }';
const DATA = 'const DECKS = [\n' + [deck('en',3), deck('fr',3), deck('de',3)].join(',\n') + '\n];\nconst TOTALE = DECKS.length;\n';
const crypto = require('crypto'); const shaOf = (t) => 'b' + crypto.createHash('sha1').update(t).digest('hex').slice(0, 20);
let gh;
const reset = () => { gh = { branches: { main: { commits:['c0'], files: { 'data.js': DATA, 'README.md': '# Flash\n', 'js/app.js': 'function avvia() { return 1; }\nconst OPZIONI = { a: 1, b: 2 };\n' + '// riempitivo\n'.repeat(200) } } }, blobs: {}, n: 0, calls: [] }; Object.values(gh.branches.main.files).forEach(t => gh.blobs[shaOf(t)] = t); };
reset();
(async () => {
  const b = await chromium.launch(); const ctx = await b.newContext({viewport:{width:390,height:844}}); await ctx.addInitScript(() => { window.__st = null; window.Capacitor = { Plugins: { CapacitorShareTarget: { addListener: async (n, cb) => { window.__st = cb; return { remove() {} }; } } } }; window.__shared = []; navigator.share = async (d) => { window.__shared.push(d.text); }; });
  const page = await ctx.newPage(); const errs=[]; page.on('pageerror', e => errs.push(e.message));
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
  await page.goto('http://localhost:8103/'); await page.waitForSelector('#input');
  const decks = (t) => { try { return new Function(t + ';return DECKS;')().map(d=>d.id+':'+d.cards.length).join(' '); } catch(e) { return 'NON VALIDO'; } };
  const S = JSON.stringify({provider:'gemini',profiles:{gemini:{apiKey:'k',model:'gemini-3.5-flash',baseUrl:'https://generativelanguage.googleapis.com/v1beta'}},fallbacks:[],agentEnabled:true,githubToken:'tok',githubNewChatRepo:true,githubRepo:'mario/flash',githubReadFirst:false,autoFallback:false,autoResume:false,keepAwake:false,favorites:[],theme:'dark',systemPrompt:'x',temperature:0.7});
  const fresh = async () => { await page.evaluate((s)=>{ localStorage.clear(); localStorage.setItem('miaai_v1_settings', s); window.__shared = []; }, S); await page.reload(); await page.waitForSelector('#input'); reset(); gem.length = 0; groq.length = 0; };
  const puts = () => gh.calls.filter(c=>c.startsWith('PUT')).length;
  const REMOVE_DE = {functionCall:{name:'github_edit_structure',args:{path:'data.js',operations:[{op:'remove_element',target:'DECKS',match:{id:'de'}}],message:'togli il tedesco'}}};
  const REMOVE_FR = {functionCall:{name:'github_edit_structure',args:{path:'data.js',operations:[{op:'remove_element',target:'DECKS',match:{id:'fr'}}],message:'togli il francese'}}};

  console.log('— nel riquadro di conferma: chiedi a un\'altra app');
  await fresh();
  script=[[REMOVE_FR],[REMOVE_DE],[{text:'Fine.'}]];
  await page.fill('#input','togli il mazzo tedesco dal file data.js, lascia gli altri come sono'); await page.click('#sendBtn'); await page.waitForSelector('#confirm:not([hidden])');
  await page.waitForSelector('#confirmCheck:not([hidden])', { timeout: 15000 });
  console.log('    pulsanti =', await page.locator('#askOtherApp').isVisible(), await page.locator('#pasteOpinion').isVisible(), '| «Decido dopo» =', await page.locator('#confirmLater').isVisible(), '| revisore interno assente =', await page.locator('#confirmReview').count() === 0);
  await page.click('#askOtherApp'); await page.waitForFunction(() => window.__shared.length === 1);
  const sh = await page.evaluate(() => window.__shared[0]);
  console.log('    testo condiviso: richiesta =', /togli il mazzo tedesco/.test(sh), '| differenze con numeri =', /^- \d+ \|\s+id: "fr",$/m.test(sh), '| prova del codice =', /Prova del codice: .*DECKS: 3 elementi → 2 elementi/.test(sh), '| domanda OK\/ATTENZIONE =', /iniziando con «OK» oppure con «ATTENZIONE»/.test(sh));
  console.log('    in attesa =', /In attesa del parere/.test(await page.textContent('#confirmOpinion')), '| nessuna scrittura =', puts() === 0);
  await page.evaluate(() => window.__st({ texts: ['ATTENZIONE: hai chiesto di togliere il tedesco (de), ma questa modifica toglie il francese (fr).'] }));
  await page.waitForSelector('#confirmOpinion.bad');
  console.log('    parere condiviso verso Mia → nel riquadro, in rosso =', /Parere di un'altra app\s*ATTENZIONE: hai chiesto di togliere il tedesco/.test(await page.textContent('#confirmOpinion')), '| la casella di scrittura resta vuota =', (await page.inputValue('#input')) === '');
  await page.click('#confirmNo');
  await page.waitForSelector('#confirm:not([hidden])'); await page.waitForSelector('#confirmCheck:not([hidden])', { timeout: 15000 });
  console.log('    rifiutato → il modello riceve il parere =', /dopo aver letto il parere di un'altra app/.test(gem[1] || '') && /toglie il francese \(fr\)/.test(gem[1] || ''), '| file intatto =', decks(gh.branches.main.files['data.js']));
  console.log('    nuova proposta: parere azzerato =', await page.locator('#confirmOpinion').isHidden());
  await page.click('#pasteOpinion'); await page.fill('#pasteText', 'OK, la modifica toglie solo il mazzo tedesco.'); await page.click('#pasteUse');
  console.log('    parere incollato → verde =', await page.locator('#confirmOpinion.good').count() === 1, '| casella nascosta =', await page.locator('#pasteBox').isHidden());
  await page.click('#confirmYes'); await page.waitForSelector('.msg.assistant .bubble:has-text("Fine.")',{timeout:15000});
  console.log('    consentito → scritto =', decks(gh.branches['mia-lavoro'].files['data.js']), '| l\'esito dice che il parere era stato letto =', /consentito la modifica dopo aver letto il parere/.test(gem[2] || ''));

  console.log('— strada di riserva: «Decido dopo»');
  await fresh();
  script=[[REMOVE_DE],[{text:'(!!) il modello non doveva essere chiamato'}]];
  await page.fill('#input','togli il mazzo tedesco dal file data.js, lascia gli altri come sono'); await page.click('#sendBtn'); await page.waitForSelector('#confirm:not([hidden])');
  await page.waitForSelector('#confirmCheck:not([hidden])', { timeout: 15000 });
  await page.click('#confirmLater'); await page.waitForSelector('.msg.assistant .bubble:has-text("Mi fermo")',{timeout:15000});
  console.log('    il parere viene chiesto da solo =', (await page.evaluate(() => window.__shared.length)) === 1, '| nessuna scrittura =', puts() === 0, '| il lavoro si ferma senza chiamare il modello =', gem.length === 1);
  console.log('    messaggio =', (await page.locator('.msg.assistant .bubble').last().textContent()).slice(0, 70));
  console.log('    Mia libera =', await page.evaluate(()=>document.querySelector('#sendBtn').textContent.trim()==='↑'));
  await page.evaluate(() => window.__st({ texts: ['OK, va bene.'] }));
  console.log('    parere arrivato dopo (conferma chiusa) → nella casella come parere =', /^Parere di un’altra app .*OK, va bene\./s.test(await page.inputValue('#input')));
  await page.fill('#input', 'procedi');
  script=[[REMOVE_DE],[{text:'Fatto.'}]];
  await page.click('#sendBtn'); await page.waitForSelector('#confirm:not([hidden])');
  console.log('    «procedi»: il modello vede la proposta e il fermo =', /non è stata fatta/.test(gem[1] || '') && /togli il tedesco/.test(gem[1] || ''));
  await page.click('#confirmYes'); await page.waitForSelector('.msg.assistant .bubble:has-text("Fatto.")',{timeout:15000});
  console.log('    scritto dopo «procedi» =', decks(gh.branches['mia-lavoro'].files['data.js']));
  console.log('ERRORS', errs);
  await b.close(); web.close();
})().catch(e=>{console.error('FAIL',e);process.exit(1)});
