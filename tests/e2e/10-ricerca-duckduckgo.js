/* Test end-to-end di Mia AI. Tutti i servizi esterni sono simulati: nessuna chiamata reale. Vedi tests/README.md */
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const TMP = fs.mkdtempSync(path.join(require('os').tmpdir(), 'mia-test-'));
const root = path.resolve(__dirname, '..', '..');
const mime = { '.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.webmanifest':'application/json' };
const web = http.createServer((q,r)=>{ let p=q.url.split('?')[0]; if(p==='/')p='/index.html'; const f=path.join(root,p); fs.readFile(f,(e,d)=>{ if(e){r.writeHead(404);r.end();return;} r.writeHead(200,{'content-type':mime[path.extname(f)]||'application/octet-stream'}); r.end(d);});}).listen(8085);
const FIX = `<html><body><div id="links" class="results">
<div class="result results_links result--ad"><h2 class="result__title"><a class="result__a" href="//duckduckgo.com/y.js?ad_provider=bingv7aa&u3=https%3A%2F%2Fpubblicita.example">Offerta sponsorizzata</a></h2><a class="result__snippet">compra ora</a></div>
<div class="result results_links results_links_deep web-result"><div class="links_main links_deep result__body"><h2 class="result__title"><a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fit.wikipedia.org%2Fwiki%2FRoma%3Fa%3D1%26b%3D2&amp;rut=abc123">Roma - <b>Wikipedia</b> &amp; storia</a></h2><a class="result__snippet" href="//x">Roma è la <b>capitale</b> d&#39;Italia, con 2,8 milioni di abitanti.</a></div></div>
<div class="result results_links web-result"><div class="links_main result__body"><h2 class="result__title"><a class="result__a" href="https://diretto.example/pagina">Link diretto</a></h2><a class="result__snippet">secondo snippet</a></div></div>
</div></body></html>`;
(async () => {
  const b = await chromium.launch(); const ctx = await b.newContext({viewport:{width:390,height:844}}); const page = await ctx.newPage(); const errs=[];
  page.on('pageerror', e => errs.push(e.message));
  const reqs=[]; let mode='ok'; let script=[]; const chat=[];
  const cors={'access-control-allow-origin':'*','access-control-allow-headers':'*','access-control-allow-methods':'*'};
  await ctx.route('https://html.duckduckgo.com/**', async route => {
    const r=route.request(); if (r.method()==='OPTIONS') return route.fulfill({status:204,headers:cors});
    reqs.push({method:r.method(), ct:r.headers()['content-type'], body:r.postData()});
    if (mode==='cors') return route.abort('failed');
    if (mode==='202') return route.fulfill({status:202,headers:{...cors,'content-type':'text/html'},body:'<html><body><div class="anomaly-modal">Unfortunately, bots use DuckDuckGo too.</div></body></html>'});
    if (mode==='429') return route.fulfill({status:429,headers:cors,body:''});
    if (mode==='captcha200') return route.fulfill({status:200,headers:{...cors,'content-type':'text/html'},body:'<html><body><form class="anomaly-modal__form">Please complete the following challenge — bots use DuckDuckGo too</form></body></html>'});
    if (mode==='empty') return route.fulfill({status:200,headers:{...cors,'content-type':'text/html'},body:'<html><body><div class="no-results">Nessun risultato</div></body></html>'});
    return route.fulfill({status:200,headers:{...cors,'content-type':'text/html'},body:FIX});
  });
  await ctx.route('https://generativelanguage.googleapis.com/**', async route => { const body=JSON.parse(route.request().postData()); chat.push(body); const next=script.shift()||[{text:'fine'}]; await route.fulfill({status:200,headers:{...cors,'content-type':'text/event-stream'},body:'data: '+JSON.stringify({candidates:[{content:{parts:next}}]})+'\n\n'}); });
  const base = {provider:'gemini',profiles:{gemini:{apiKey:'k',model:'gemini-3.6-flash'}},autoFallback:false,favorites:[],theme:'dark',agentEnabled:true,searchProvider:'ddg'};
  await page.addInitScript((s) => { if (!localStorage.getItem('miaai_v1_settings')) localStorage.setItem('miaai_v1_settings', JSON.stringify(s)); }, base);
  await page.goto('http://localhost:8085/');
  const run = (args={}) => page.evaluate(async (a) => { try { const r = await MiaTools.run('web_search',{query:'capitale italia',...a},{searchProvider:'ddg'}); return {ok:true,text:r.text}; } catch(e){ return {ok:false,error:e.message}; } }, args);
  const show=(t,r)=>console.log(t.padEnd(22), r.ok?'OK ':'ERR', JSON.stringify(r.ok?r.text:r.error).slice(0,420));
  show('risultati', await run());
  console.log('  richiesta:', reqs[0].method, reqs[0].ct, '|', reqs[0].body);
  show('limite = 1', await run({limit:1}));
  mode='202'; show('verifica anti-robot 202', await run());
  mode='captcha200'; show('captcha con 200', await run());
  mode='429'; show('troppe richieste 429', await run());
  mode='empty'; show('nessun risultato', await run());
  mode='cors'; show('bloccato (CORS/rete)', await run());
  mode='ok';
  // senza chiave: ddg non la chiede
  console.log('chiave richiesta da ddg: no (ha funzionato senza searchKey)');
  // chat
  script = [[{functionCall:{name:'web_search',args:{query:'capitale italia'}}}],[{text:'La capitale è Roma.'}]];
  await page.fill('#input','qual è la capitale d\'Italia? cerca sul web'); await page.click('#sendBtn');
  await page.waitForSelector('.bubble:has-text("capitale è Roma")',{timeout:12000});
  console.log('chat: il modello ha ricevuto i risultati =', JSON.stringify(chat[chat.length-1]).includes('it.wikipedia.org/wiki/Roma'), '| nessuna conferma =', await page.locator('#confirm').isHidden());
  // impostazioni
  await page.click('#menuBtn'); await page.click('#drawer [data-open-settings]').then(()=>page.evaluate(()=>document.querySelectorAll('details.set-sec,details.set-sub').forEach(d=>d.open=true))); await page.waitForSelector('#settings:not([hidden])');
  const vis = async (v) => { await page.selectOption('#searchProvider', v); return await page.locator('#searchKeyField').isVisible(); };
  console.log('campo chiave visibile: ddg =', await vis('ddg'), '| gemini =', await vis('gemini'), '| exa =', await vis('exa'));
  await page.selectOption('#searchProvider','ddg'); await page.click('#closeSettings');
  console.log('salvato:', await page.evaluate(()=>JSON.parse(localStorage.getItem('miaai_v1_settings')).searchProvider));
  console.log('opzioni del menu:', await page.evaluate(()=>[...document.querySelectorAll('#searchProvider option')].map(o=>o.value||'(disattivata)').join(', ')));
  console.log('ERRORS', errs);
  await b.close(); web.close();
})().catch(e=>{console.error('FAIL',e);process.exit(1)});
