/* Test end-to-end di Mia AI. Tutti i servizi esterni sono simulati: nessuna chiamata reale. Vedi tests/README.md */
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const root = path.resolve(__dirname, '..', '..');
const mime = { '.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.webmanifest':'application/json' };
const web = http.createServer((q,r)=>{ let p=q.url.split('?')[0]; if(p==='/')p='/index.html'; const f=path.join(root,p); fs.readFile(f,(e,d)=>{ if(e){r.writeHead(404);r.end();return;} r.writeHead(200,{'content-type':mime[path.extname(f)]||'application/octet-stream'}); r.end(d);});}).listen(8078);
const cors={'access-control-allow-origin':'*','access-control-allow-headers':'*','access-control-allow-methods':'*'};
(async () => {
  const b = await chromium.launch(); const ctx = await b.newContext({viewport:{width:390,height:844}}); const page = await ctx.newPage(); const errs=[]; page.on('pageerror', e => errs.push(e.message));
  const st = { nv:{calls:0,failFirst:0,models:[]}, gem:{calls:0,fail:false} };
  const sse=(t)=>'data: '+JSON.stringify({choices:[{delta:{content:t}}]})+'\n\ndata: [DONE]\n\n';
  await ctx.route('https://integrate.api.nvidia.com/**', async route => { const r=route.request(); if(r.method()==='OPTIONS') return route.fulfill({status:204,headers:cors}); st.nv.calls++; st.nv.models.push(JSON.parse(r.postData()).model);
    if (st.nv.calls<=st.nv.failFirst) return route.abort('connectionreset'); route.fulfill({status:200,headers:{...cors,'content-type':'text/event-stream'},body:sse('Risposta NVIDIA.')}); });
  await ctx.route('https://generativelanguage.googleapis.com/**', async route => { const r=route.request(); if(r.method()==='OPTIONS') return route.fulfill({status:204,headers:cors}); st.gem.calls++;
    route.fulfill({status:200,headers:{...cors,'content-type':'text/event-stream'},body:'data: '+JSON.stringify({candidates:[{content:{parts:[{text:'Risposta Gemini.'}]}}]})+'\n\n'}); });
  const base = (extra) => Object.assign({provider:'nvidia',profiles:{nvidia:{apiKey:'nv',model:'nvidia/uno',baseUrl:'https://integrate.api.nvidia.com/v1'},gemini:{apiKey:'g',model:'gemini-3.5-flash',baseUrl:'https://generativelanguage.googleapis.com/v1beta'}},theme:'dark',favorites:[],autoFallback:false,agentEnabled:false,systemPrompt:'x',temperature:0.7}, extra||{});
  const open = async (s) => { await page.goto('http://localhost:8078/'); await page.evaluate((s)=>{ localStorage.clear(); localStorage.setItem('miaai_v1_settings',JSON.stringify(s)); }, s); await page.reload(); await page.waitForSelector('#input'); };
  const ask = async (sel) => { await page.fill('#input','ciao'); await page.click('#sendBtn'); await page.waitForSelector(sel,{timeout:30000}); };

  console.log('— riconoscimento degli errori di connessione');
  await open(base());
  console.log('   ', await page.evaluate(()=>{ const P=MiaProviders; const t=(m)=>P.isConnectionError(new Error(m)); return ['Software caused connection abort','Connection reset','ECONNRESET','Failed to fetch','timeout of 30000ms exceeded','Unexpected end of stream'].map(t).every(Boolean) && !t('401 Unauthorized') && !t('429 rate limit') && !P.isConnectionError(Object.assign(new Error('Software caused connection abort'),{name:'AbortError'})); }) ? 'riconosciuti = true | 401/429 e interruzione dell\'utente non lo sono = true' : 'ERRORE');
  console.log('   messaggio in italiano =', await page.evaluate(()=>MiaProviders.friendlyError(new Error('Software caused connection abort'),'NVIDIA')));

  console.log('— la connessione cade 2 volte, poi va: stesso modello, nessun errore');
  await open(base()); st.nv.calls=0; st.nv.failFirst=2; await ask('.msg.assistant .bubble:has-text("Risposta NVIDIA.")');
  console.log('   richieste =', st.nv.calls, '| nessun errore =', (await page.locator('.msg.error').count())===0);
  console.log('— la connessione cade sempre: errore chiaro dopo 3 tentativi (senza ripiego)');
  await open(base()); st.nv.calls=0; st.nv.failFirst=99; await ask('.msg.error'); console.log('   richieste =', st.nv.calls, '|', (await page.locator('.msg.error .bubble').textContent()).slice(0,140));
  console.log('— la connessione cade sempre ma c\'è il ripiego automatico: risponde l\'altro modello');
  await open(base({autoFallback:true,favorites:[{provider:'gemini',model:'gemini-3.5-flash'}]})); st.nv.calls=0; st.nv.failFirst=99; st.gem.calls=0; await ask('.msg.assistant .bubble:has-text("Risposta Gemini.")');
  console.log('   richieste NVIDIA =', st.nv.calls, '| richieste Gemini =', st.gem.calls);
  console.log('— l\'utente interrompe durante i tentativi: nessun nuovo tentativo');
  await open(base()); st.nv.calls=0; st.nv.failFirst=99; await page.fill('#input','ciao'); await page.click('#sendBtn'); await page.waitForTimeout(300); await page.click('#sendBtn').catch(()=>{}); await page.waitForTimeout(6000);
  console.log('   richieste dopo lo stop <= 2 =', st.nv.calls<=2, '(', st.nv.calls, ')');
  console.log('ERRORS', errs);
  await b.close(); web.close();
})().catch(e=>{console.error('FAIL',e);process.exit(1)});
