/* Test end-to-end di Mia AI. Tutti i servizi esterni sono simulati: nessuna chiamata reale. Vedi tests/README.md */
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const TMP = fs.mkdtempSync(path.join(require('os').tmpdir(), 'mia-test-'));
const WWW = path.join(TMP,'www'); fs.cpSync(path.join(__dirname,'..','..','www'), WWW, {recursive:true}); const PREFIX='/mia-ai-app/';
const mime = { '.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.webmanifest':'application/manifest+json' };
const hits=[]; const srv = http.createServer((q,r)=>{ let p=q.url.split('?')[0]; hits.push(p); if(!p.startsWith(PREFIX)){r.writeHead(404);r.end('no');return;} p=p.slice(PREFIX.length)||'index.html'; if(p.endsWith('/')) p+='index.html'; const f=path.join(WWW,p); fs.readFile(f,(e,d)=>{ if(e){r.writeHead(404);r.end('nf');return;} r.writeHead(200,{'content-type':mime[path.extname(f)]||'application/octet-stream','cache-control':'no-cache'}); r.end(d);});}).listen(8080);
(async () => {
  const b = await chromium.launch(); const ctx = await b.newContext({viewport:{width:1366,height:800}}); const page = await ctx.newPage(); const errs=[], bad=[];
  page.on('pageerror', e => errs.push(e.message)); page.on('response', r => { if (r.status()>=400 && r.url().startsWith('http://localhost:8080')) bad.push(r.status()+' '+r.url().replace('http://localhost:8080','')); });
  const gem=[]; await ctx.route('https://generativelanguage.googleapis.com/**', async route => { gem.push(1); await route.fulfill({status:200,headers:{'content-type':'text/event-stream','access-control-allow-origin':'*'},body:'data: '+JSON.stringify({candidates:[{content:{parts:[{text:'Ciao dal web.'}]}}]})+'\n\n'}); });
  await page.addInitScript(() => { if (!localStorage.getItem('miaai_v1_settings')) localStorage.setItem('miaai_v1_settings', JSON.stringify({provider:'gemini',profiles:{gemini:{apiKey:'k',model:'gemini-3.6-flash'}},theme:'dark',favorites:[]})); });
  await page.goto('http://localhost:8080/mia-ai-app/');
  await page.waitForSelector('#input');
  console.log('1) avvio sotto /mia-ai-app/: errori JS =', errs.length, '| file non trovati =', bad.length ? bad.join(', ') : 'nessuno');
  // service worker
  await page.waitForFunction(()=>navigator.serviceWorker.ready.then(()=>true)); await page.waitForTimeout(800);
  const sw = await page.evaluate(async ()=>{ const r=await navigator.serviceWorker.getRegistration(); const keys=await caches.keys(); const c=keys.length?await (await caches.open(keys[0])).keys():[]; return {scope:r&&r.scope, state:r&&r.active&&r.active.state, cache:keys, files:c.length}; });
  console.log('2) service worker:', JSON.stringify(sw));
  // chat online
  await page.fill('#input','ciao'); await page.click('#sendBtn'); await page.waitForSelector('.bubble:has-text("Ciao dal web")');
  console.log('3) chat online: il service worker non ha ostacolato la chiamata al modello =', gem.length===1);
  // senza rete: la pagina si riapre dalla cache
  await ctx.setOffline(true); await page.reload(); await page.waitForSelector('#input',{timeout:8000});
  console.log('4) rete assente: l\'app si riapre =', await page.locator('#input').isVisible(), '| chat salvata ancora visibile =', await page.locator('.bubble:has-text("Ciao dal web")').count()>0);
  await ctx.setOffline(false);
  // aggiornamento: con la rete si vede subito la versione nuova
  fs.writeFileSync(path.join(WWW,'index.html'), fs.readFileSync(path.join(WWW,'index.html'),'utf8').replace('<title>Mia</title>','<title>Mia v2</title>'));
  await page.reload(); await page.waitForSelector('#input');
  console.log('5) aggiornamento online: titolo =', await page.title());
  // manifest
  const man = await page.evaluate(async()=>{ const r=await fetch(document.querySelector('link[rel=manifest]').href); return r.json(); });
  console.log('6) manifest:', JSON.stringify({start_url:man.start_url,scope:man.scope,display:man.display,id:man.id,icone:man.icons.length}));
  // layout da PC
  await page.screenshot({path: path.join(TMP,'pc-web.png')});
  console.log('   barra laterale visibile su schermo largo =', await page.locator('#drawer').isVisible(), '| pulsante menu nascosto =', await page.locator('#menuBtn').isHidden());
  // nell'app Android il service worker NON deve registrarsi
  const p2 = await ctx.newPage(); await p2.addInitScript(()=>{ window.Capacitor={isNativePlatform:()=>true,Plugins:{}}; });
  await p2.goto('http://localhost:8080/mia-ai-app/'); await p2.waitForSelector('#input'); await p2.waitForTimeout(800);
  console.log('7) simulando l\'app Android: registrazioni service worker =', await p2.evaluate(async()=>{ const rs=await navigator.serviceWorker.getRegistrations(); return rs.length; }), '(1 = quella già presente nello stesso sito di prova)');
  console.log('ERRORS', errs);
  await b.close(); srv.close();
})().catch(e=>{console.error('FAIL',e);process.exit(1)});
