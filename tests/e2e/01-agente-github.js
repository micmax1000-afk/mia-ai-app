/* Test end-to-end di Mia AI. Tutti i servizi esterni sono simulati: nessuna chiamata reale. Vedi tests/README.md */
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const TMP = fs.mkdtempSync(path.join(require('os').tmpdir(), 'mia-test-'));
const root = path.resolve(__dirname, '..', '..');
const mime = { '.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.webmanifest':'application/json' };
const srv = http.createServer((q,r)=>{ let p=q.url.split('?')[0]; if(p==='/')p='/index.html'; const f=path.join(root,p); fs.readFile(f,(e,d)=>{ if(e){r.writeHead(404);r.end();return;} r.writeHead(200,{'content-type':mime[path.extname(f)]||'application/octet-stream'}); r.end(d);});}).listen(8099);

const sse = (parts) => 'data: ' + JSON.stringify({candidates:[{content:{parts}}]}) + '\n\n';
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push('PAGEERR ' + e.message));
  page.on('console', m => { if (m.type()==='error') errors.push('CONSOLE ' + m.text()); });
  const geminiBodies = [];
  const ghCalls = [];
  let script = [];
  await page.route('https://generativelanguage.googleapis.com/**', async route => {
    geminiBodies.push(JSON.parse(route.request().postData()));
    const next = script.shift();
    await route.fulfill({ status: 200, headers: {'content-type':'text/event-stream','access-control-allow-origin':'*'}, body: sse(next) });
  });
  await page.route('https://api.github.com/**', async route => {
    const req = route.request(); const u = new URL(req.url());
    ghCalls.push(req.method() + ' ' + u.pathname + u.search + (req.postData() ? ' ' + req.postData() : ''));
    const cors = {'access-control-allow-origin':'*','access-control-allow-headers':'*','access-control-allow-methods':'*'};
    if (req.method()==='OPTIONS') return route.fulfill({status:204, headers:cors});
    const j = (o, status=200) => route.fulfill({status, headers:{...cors,'content-type':'application/json'}, body: JSON.stringify(o)});
    if (u.pathname==='/user') return j({login:'mario'});
    if (u.pathname==='/user/repos' && req.method()==='GET') return j([{full_name:'mario/app',private:true,default_branch:'main',language:'JS',description:'Una app'}]);
    if (u.pathname==='/repos/mario/app/contents/NOTE.md' && req.method()==='GET') return j({message:'Not Found'},404);
    if (u.pathname==='/repos/mario/app/contents/NOTE.md' && req.method()==='PUT') return j({commit:{sha:'abcdef123456'},content:{html_url:'https://github.com/mario/app/blob/main/NOTE.md'}},201);
    return j({message:'Not Found'},404);
  });
  await page.addInitScript(() => {
    localStorage.setItem('miaai_v1_settings', JSON.stringify({provider:'gemini',profiles:{gemini:{apiKey:'k',model:'gemini-3.5-flash',baseUrl:'https://generativelanguage.googleapis.com/v1beta'}},agentEnabled:true,githubToken:'tok',githubRepo:'mario/app',githubUseBranch:false,autoFallback:false,favorites:[],theme:'dark',systemPrompt:'x',temperature:0.7}));
  });
  await page.goto('http://localhost:8099/');

  // Scenario 1: lettura (nessuna conferma) → risposta finale
  script = [
    [{functionCall:{name:'github_list_repos',args:{}}, thoughtSignature:'SIG1'}],
    [{text:'Hai un repository: mario/app.'}]
  ];
  await page.fill('#input','elenca i miei repo');
  await page.click('#sendBtn');
  await page.waitForSelector('.msg.assistant .bubble:has-text("mario/app")', {timeout:8000});
  console.log('S1 tool cards:', await page.locator('.tool-card').count(), '| confirm visible:', await page.locator('#confirm').isVisible());
  console.log('S1 2nd request has functionResponse:', JSON.stringify(geminiBodies[1].contents.slice(-2)).slice(0,400));
  console.log('S1 sig kept:', JSON.stringify(geminiBodies[1].contents).includes('SIG1'));
  console.log('S1 tools declared:', geminiBodies[0].tools[0].functionDeclarations.length, '| system has login:', geminiBodies[0].systemInstruction.parts[0].text.includes('mario'));

  // Scenario 2: scrittura con conferma → Consenti
  script = [
    [{functionCall:{name:'github_write_file',args:{owner:'mario',repo:'app',path:'NOTE.md',content:'ciao è così',message:'aggiungi nota'}}}],
    [{text:'Fatto, file creato.'}]
  ];
  await page.fill('#input','crea NOTE.md');
  await page.click('#sendBtn');
  await page.waitForSelector('#confirm:not([hidden])', {timeout:8000});
  console.log('S2 confirm title:', await page.textContent('#confirmTitle'));
  await page.click('#confirmYes');
  await page.waitForSelector('.msg.assistant .bubble:has-text("file creato")', {timeout:8000});
  console.log('S2 gh calls:', ghCalls.filter(c=>c.includes('NOTE.md')));
  const put = ghCalls.find(c=>c.startsWith('PUT'));
  const b64 = JSON.parse(put.split(' ').slice(2).join(' ')).content;
  console.log('S2 decoded content:', Buffer.from(b64,'base64').toString('utf8'));

  // Scenario 3: scrittura rifiutata
  ghCalls.length = 0;
  script = [
    [{functionCall:{name:'github_write_file',args:{path:'altro.md',content:'x',message:'altro'}}}],
    [{text:'Ok, non lo creo.'}]
  ];
  await page.fill('#input','crea repo nuovo');
  await page.click('#sendBtn');
  await page.waitForSelector('#confirm:not([hidden])');
  await page.click('#confirmNo');
  await page.waitForSelector('.msg.assistant .bubble:has-text("non lo creo")');
  console.log('S3 gh POST calls (deve essere 0):', ghCalls.filter(c=>c.startsWith('POST')).length, '| denied card:', await page.locator('.tool-card.denied').count());

  // Scenario 4: note + strumento sconosciuto + stop
  script = [
    [{functionCall:{name:'notes',args:{action:'save',title:'Idea',text:'ciao'}}},{functionCall:{name:'boh',args:{}}}],
    [{text:'ok note'}]
  ];
  await page.fill('#input','salva nota');
  await page.click('#sendBtn');
  await page.waitForSelector('.msg.assistant .bubble:has-text("ok note")');
  console.log('S4 notes in LS:', await page.evaluate(()=>localStorage.getItem('miaai_v1_notes')));
  const last = geminiBodies[geminiBodies.length-1].contents.slice(-1)[0];
  console.log('S4 merged responses in one turn:', last.parts.length);

  // ricarica: la chat persiste e si renderizza
  await page.reload();
  console.log('Reload: tool cards', await page.locator('.tool-card').count(), 'msgs', await page.locator('.msg').count());
  await page.screenshot({path: path.join(TMP,'s.png')});
  console.log('ERRORS:', errors);
  await browser.close(); srv.close();
})().catch(e=>{console.error('FAIL',e);process.exit(1);});
