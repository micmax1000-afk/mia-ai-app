/* Test end-to-end di Mia AI. Tutti i servizi esterni sono simulati: nessuna chiamata reale. Vedi tests/README.md */
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const TMP = fs.mkdtempSync(path.join(require('os').tmpdir(), 'mia-test-'));
const root = path.resolve(__dirname, '..', '..');
const mime = { '.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.webmanifest':'application/json' };
const web = http.createServer((q,r)=>{ let p=q.url.split('?')[0]; if(p==='/')p='/index.html'; const f=path.join(root,p); fs.readFile(f,(e,d)=>{ if(e){r.writeHead(404);r.end();return;} r.writeHead(200,{'content-type':mime[path.extname(f)]||'application/octet-stream'}); r.end(d);});}).listen(8086);
const sse = (parts) => 'data: ' + JSON.stringify({candidates:[{content:{parts}}]}) + '\n\n';
(async () => {
  const b = await chromium.launch(); const ctx = await b.newContext({viewport:{width:390,height:844}}); const page = await ctx.newPage(); const errs=[];
  page.on('pageerror', e => errs.push(e.message));
  const searchReqs=[]; let mode='ok'; let script=[]; const chat=[];
  await ctx.route('https://generativelanguage.googleapis.com/**', async route => {
    const url=route.request().url(); const body=JSON.parse(route.request().postData()); const cors={'access-control-allow-origin':'*','access-control-allow-headers':'*'};
    if (route.request().method()==='OPTIONS') return route.fulfill({status:204,headers:cors});
    if (url.includes(':generateContent')) {
      searchReqs.push({url, key:route.request().headers()['x-goog-api-key'], tools:JSON.stringify(body.tools), q:body.contents[0].parts[0].text});
      if (mode==='429') return route.fulfill({status:429,headers:{...cors,'content-type':'application/json'},body:JSON.stringify({error:{message:'Quota exceeded for grounding'}})});
      if (mode==='400') return route.fulfill({status:400,headers:{...cors,'content-type':'application/json'},body:JSON.stringify({error:{message:'Search grounding is not supported for this model'}})});
      return route.fulfill({status:200,headers:{...cors,'content-type':'application/json'},body:JSON.stringify({candidates:[{content:{parts:[{text:'Il prezzo del Bitcoin oggi è circa 98.000 dollari.'}]},groundingMetadata:{webSearchQueries:['prezzo bitcoin oggi'],groundingChunks:[{web:{uri:'https://vertexaisearch.cloud.google.com/grounding-api-redirect/AAA',title:'coindesk.com'}},{web:{uri:'https://vertexaisearch.cloud.google.com/grounding-api-redirect/BBB',title:'ansa.it'}}]}}]})});
    }
    chat.push(body); const next = script.shift() || [{text:'fine'}];
    await route.fulfill({status:200, headers:{...cors,'content-type':'text/event-stream'}, body: sse(next)});
  });
  const base = {provider:'gemini',profiles:{gemini:{apiKey:'chiave-gemini',model:'gemini-3.6-flash'}},autoFallback:false,favorites:[],theme:'dark',agentEnabled:true};
  await page.addInitScript((s) => { if (!localStorage.getItem('miaai_v1_settings')) localStorage.setItem('miaai_v1_settings', JSON.stringify(s)); }, base);
  await page.goto('http://localhost:8086/');
  const run = (c) => page.evaluate(async (c) => { try { const r = await MiaTools.run('web_search',{query:'prezzo bitcoin oggi'},c); return {ok:true,text:r.text}; } catch(e){ return {ok:false,error:e.message}; } }, c);
  const show=(t,r)=>console.log(t.padEnd(24), r.ok?'OK ':'ERR', JSON.stringify(r.ok?r.text:r.error).slice(0,330));
  show('Google via Gemini', await run({searchProvider:'gemini',geminiKey:'chiave-gemini',searchModel:'gemini-3.6-flash'}));
  console.log('  richiesta:', searchReqs[0].url.split('/models/')[1], '| chiave:', searchReqs[0].key, '| strumenti:', searchReqs[0].tools);
  show('modello non Gemini', await run({searchProvider:'gemini',geminiKey:'k',searchModel:'llama-3'}));
  console.log('  modello usato:', searchReqs[1].url.split('/models/')[1]);
  mode='429'; show('limite (429)', await run({searchProvider:'gemini',geminiKey:'k'}));
  mode='400'; show('non supportata (400)', await run({searchProvider:'gemini',geminiKey:'k'}));
  mode='ok'; show('senza chiave Gemini', await run({searchProvider:'gemini'}));
  show('disattivata', await run({searchProvider:''}));
  show('Serper senza chiave', await run({searchProvider:'serper'}));

  // flusso in chat: impostazione predefinita = Google/Gemini
  script = [[{functionCall:{name:'web_search',args:{query:'prezzo bitcoin oggi'}}}],[{text:'Il Bitcoin vale circa 98.000 dollari.'}]];
  searchReqs.length=0;
  await page.fill('#input','quanto vale il bitcoin oggi?'); await page.click('#sendBtn');
  await page.waitForSelector('.bubble:has-text("98.000 dollari")',{timeout:12000});
  console.log('chat: ricerche Google fatte =', searchReqs.length, '| scheda:', (await page.locator('.tool-card summary').first().textContent()).trim());
  console.log('chat: il modello ha ricevuto le fonti =', JSON.stringify(chat[1]).includes('coindesk.com'));
  console.log('chat: nessuna conferma richiesta =', await page.locator('#confirm').isHidden());
  // impostazioni: la chiave compare solo per Brave/Tavily
  await page.click('#menuBtn'); await page.click('#drawer [data-open-settings]'); await page.waitForSelector('#settings:not([hidden])');
  const vis = async (v) => { await page.selectOption('#searchProvider', v); return await page.locator('#searchKeyField').isVisible(); };
  console.log('campo chiave visibile: gemini =', await vis('gemini'), '| serper =', await vis('serper'), '| tavily =', await vis('tavily'), '| disattivata =', await vis(''));
  await page.selectOption('#searchProvider','tavily'); await page.fill('#searchKey','tvly-1'); await page.click('#closeSettings');
  const saved = await page.evaluate(()=>{const s=JSON.parse(localStorage.getItem('miaai_v1_settings')); return [s.searchProvider,s.searchKey]});
  console.log('salvato:', JSON.stringify(saved));
  await page.evaluate(()=>{const s=JSON.parse(localStorage.getItem('miaai_v1_settings')); delete s.searchProvider; localStorage.setItem('miaai_v1_settings',JSON.stringify(s));}); await page.reload();
  await page.click('#menuBtn'); await page.click('#drawer [data-open-settings]'); await page.waitForSelector('#settings:not([hidden])');
  console.log('impostazione assente → mostra:', await page.inputValue('#searchProvider'));
  console.log('ERRORS', errs);
  await b.close(); web.close();
})().catch(e=>{console.error('FAIL',e);process.exit(1)});
