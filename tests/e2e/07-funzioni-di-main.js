/* Test end-to-end di Mia AI. Tutti i servizi esterni sono simulati: nessuna chiamata reale. Vedi tests/README.md */
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const TMP = fs.mkdtempSync(path.join(require('os').tmpdir(), 'mia-test-'));
const root = path.resolve(__dirname, '..', '..');
const mime = { '.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.webmanifest':'application/json' };
const srv = http.createServer((q,r)=>{ let p=q.url.split('?')[0]; if(p==='/')p='/index.html'; const f=path.join(root,p); fs.readFile(f,(e,d)=>{ if(e){r.writeHead(404);r.end();return;} r.writeHead(200,{'content-type':mime[path.extname(f)]||'application/octet-stream'}); r.end(d);});}).listen(8088);
const sse = (parts) => 'data: ' + JSON.stringify({candidates:[{content:{parts}}]}) + '\n\n';
(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport:{width:390,height:844}, deviceScaleFactor:2, hasTouch:true, isMobile:true });
  const page = await ctx.newPage();
  const errors = []; page.on('pageerror', e => errors.push('PAGEERR '+e.message)); page.on('console', m => { if (m.type()==='error' && !/404/.test(m.text())) errors.push('CONSOLE '+m.text()); });
  let script = []; const gem = []; const gh = [];
  await ctx.route('https://generativelanguage.googleapis.com/**', async route => { gem.push(JSON.parse(route.request().postData())); const next = script.shift() || [{text:'ok'}]; await route.fulfill({status:200, headers:{'content-type':'text/event-stream','access-control-allow-origin':'*'}, body: sse(next)}); });
  await ctx.route('https://api.github.com/**', async route => {
    const req = route.request(); const u = new URL(req.url()); const cors = {'access-control-allow-origin':'*','access-control-allow-headers':'*','access-control-allow-methods':'*'};
    if (req.method()==='OPTIONS') return route.fulfill({status:204, headers:cors});
    gh.push(req.method()+' '+u.pathname+(req.postData()?' '+req.postData():''));
    const j = (o, status=200) => route.fulfill({status, headers:{...cors,'content-type':'application/json'}, body: JSON.stringify(o)});
    const b64 = (t) => Buffer.from(t,'utf8').toString('base64');
    if (u.pathname==='/user') return j({login:'mario'});
    if (u.pathname==='/repos/mario/app/contents/README.md' && req.method()==='GET') return j({type:'file',sha:'abc',content:b64('# App\nvecchio testo\n')});
    if (u.pathname==='/repos/mario/app/contents/GRANDE.md' && req.method()==='GET') return j({type:'file',sha:'big',content:b64('x'.repeat(25000))});
    if (u.pathname==='/repos/mario/app/contents/README.md' && req.method()==='PUT') return j({content:{}},200);
    if (u.pathname==='/repos/mario/app') return j({description:'d',default_branch:'main'});
    if (u.pathname==='/repos/mario/app/contents') return j([{type:'file',path:'README.md',name:'README.md',size:20}]);
    return j({message:'Not Found'},404);
  });
  await ctx.route('https://api.duckduckgo.com/**', r => r.fulfill({status:200, headers:{'access-control-allow-origin':'*','content-type':'application/json'}, body:JSON.stringify({AbstractText:'Il meteo di oggi è sereno',Heading:'Meteo'})}));
  await ctx.route('https://it.wikipedia.org/**', r => r.fulfill({status:200, headers:{'access-control-allow-origin':'*','content-type':'application/json'}, body:'["x",[],[],[]]'}));
  const settings = (o) => ({provider:'gemini',profiles:{gemini:{apiKey:'k',model:'gemini-3.6-flash'}},autoFallback:false,favorites:[],theme:'dark',githubNewChatRepo:true,githubRepo:'mario/app',...o});
  await page.addInitScript((s) => { if (!localStorage.getItem('miaai_v1_settings')) localStorage.setItem('miaai_v1_settings', JSON.stringify(s)); }, settings({githubToken:'tok'}));
  await page.goto('http://localhost:8088/');
  const send = async (t) => { await page.fill('#input', t); await page.click('#sendBtn'); };

  // 1) Modifica file con push (flusso di main) → ora con conferma
  script = [[{text:'# App\nnuovo testo\n'}]];
  await send('modifica il file README.md: cambia il testo');
  await page.waitForSelector('#confirm:not([hidden])', {timeout:8000});
  console.log('1) conferma push:', (await page.textContent('#confirmTitle')).trim());
  console.log('   anteprima contiene il nuovo testo:', (await page.textContent('#confirmDetails')).includes('nuovo testo'));
  await page.screenshot({path: path.join(TMP,'ui-confirm.png')});
  await page.click('#confirmYes');
  await page.waitForSelector('.msg.assistant .bubble:has-text("fatto il push")');
  const put = gh.find(x=>x.startsWith('PUT'));
  console.log('   PUT inviato:', !!put, '| contenuto:', JSON.stringify(Buffer.from(JSON.parse(put.split(' ').slice(2).join(' ')).content,'base64').toString()));
  // 2) rifiuto
  gh.length = 0; script = [[{text:'# App\naltro\n'}]];
  await send('modifica il file README.md: altro cambio');
  await page.waitForSelector('#confirm:not([hidden])'); await page.click('#confirmNo');
  await page.waitForSelector('.msg.assistant .bubble:has-text("annullata")');
  console.log('2) rifiutato → PUT:', gh.filter(x=>x.startsWith('PUT')).length, '(atteso 0)');
  // 3) file troppo grande
  gh.length = 0; const before = gem.length;
  await send('modifica il file GRANDE.md: cambia qualcosa');
  await page.waitForTimeout(600);
  console.log('3) file >20000 car.: richieste al modello:', gem.length-before, '| PUT:', gh.filter(x=>x.startsWith('PUT')).length, '| avviso:', (await page.textContent('#toast')).slice(0,70));

  // 4) «progetto» da solo non deve bloccare il messaggio (senza token)
  await page.evaluate(() => { const s=JSON.parse(localStorage.getItem('miaai_v1_settings')); s.githubToken=''; localStorage.setItem('miaai_v1_settings', JSON.stringify(s)); });
  await page.reload();
  const n0 = gem.length; script = [[{text:'Risposta normale.'}]];
  await send('spiegami il progetto di legge sul lavoro');
  await page.waitForSelector('.msg.assistant .bubble:has-text("Risposta normale")');
  console.log('4) frase con «progetto» senza token: inviata =', gem.length-n0 === 1);
  // 5) ma «controlla il repo» senza token chiede il token
  const n1 = gem.length; await send('controlla il repo');
  await page.waitForSelector('#settings:not([hidden])', {timeout:3000});
  console.log('5) «controlla il repo» senza token: apre Impostazioni =', true, '| inviata al modello =', gem.length-n1 === 1);
  await page.click('#closeSettings');

  // 6) note dal web (main) arrivano al modello come contesto
  script = [[{text:'Oggi è sereno.'}]]; const n2 = gem.length;
  await send('che tempo fa oggi a Roma');
  await page.waitForSelector('.msg.assistant .bubble:has-text("sereno")');
  const body = JSON.stringify(gem[n2]);
  console.log('6) contesto web inoltrato al modello:', body.includes('Il meteo di oggi'));
  console.log('   il messaggio mostrato NON contiene il contesto:', !(await page.locator('.msg.user .bubble').last().textContent()).includes('Il meteo'));

  // 7) schermate: chat con strumenti + impostazioni (scuro e chiaro)
  await page.evaluate(() => { localStorage.setItem('miaai_v1_settings', JSON.stringify({provider:'gemini',profiles:{gemini:{apiKey:'k',model:'gemini-3.6-flash'}},autoFallback:false,favorites:[],theme:'dark',githubToken:'tok',githubNewChatRepo:true,githubRepo:'mario/app',agentEnabled:true,mcpServers:[{id:'m1',name:'Notion',url:'https://x.example/mcp',token:'',enabled:true,disabled:[]}]})); localStorage.removeItem('miaai_v1_conversations'); localStorage.removeItem('miaai_v1_current'); });
  await page.route('https://x.example/**', r => r.abort());
  await page.reload();
  script = [[{functionCall:{name:'create_xlsx',args:{filename:'spese',sheets:[{name:'Mese',rows:[['Voce','Importo'],['Affitto','700']]}]}}}],[{text:'Ecco il foglio con le spese: **Affitto 700**.'}]];
  await send('fammi un excel delle spese');
  await page.waitForSelector('.file-card', {timeout:8000}); await page.waitForSelector('.msg.assistant .bubble:has-text("Ecco il foglio")');
  await page.screenshot({path: path.join(TMP,'ui-chat-dark.png')});
  await page.evaluate(()=>{ const s=JSON.parse(localStorage.getItem('miaai_v1_settings')); s.theme='light'; localStorage.setItem('miaai_v1_settings',JSON.stringify(s)); }); await page.reload();
  await page.screenshot({path: path.join(TMP,'ui-chat-light.png')});
  await page.evaluate(()=>{ const s=JSON.parse(localStorage.getItem('miaai_v1_settings')); s.theme='dark'; localStorage.setItem('miaai_v1_settings',JSON.stringify(s)); }); await page.reload();
  await page.click('#menuBtn'); await page.click('#drawer [data-open-settings]').then(()=>page.evaluate(()=>document.querySelectorAll('details.set-sec,details.set-sub').forEach(d=>d.open=true))); await page.waitForSelector('#settings:not([hidden])');
  await page.evaluate(()=>document.querySelector('.agent-box').scrollIntoView({block:'start'})); await page.waitForTimeout(300);
  await page.screenshot({path: path.join(TMP,'ui-settings-agent.png')});
  console.log('ERRORS:', errors);
  await browser.close(); srv.close();
})().catch(e=>{console.error('FAIL',e);process.exit(1);});
