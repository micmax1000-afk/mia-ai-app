/* Test end-to-end di Mia AI. Tutti i servizi esterni sono simulati: nessuna chiamata reale. Vedi tests/README.md */
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const TMP = fs.mkdtempSync(path.join(require('os').tmpdir(), 'mia-test-'));
const WWW = path.join(TMP,'www'); fs.cpSync(path.join(__dirname,'..','..','www'), WWW, {recursive:true}); const mime = { '.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.webmanifest':'application/manifest+json' };
const srv = http.createServer((q,r)=>{ let p=q.url.split('?')[0]; p=p.replace('/mia-ai-app/','')||'index.html'; if(p===''||p.endsWith('/')) p+='index.html'; fs.readFile(path.join(WWW,p),(e,d)=>{ if(e){r.writeHead(404);r.end();return;} r.writeHead(200,{'content-type':mime[path.extname(p)]||'application/octet-stream'}); r.end(d);});}).listen(8079);
(async () => {
  const b = await chromium.launch();
  for (const native of [false,true]) {
    const ctx = await b.newContext(); const page = await ctx.newPage();
    if (native) await page.addInitScript(()=>{ window.Capacitor={isNativePlatform:()=>true,Plugins:{}}; });
    await page.goto('http://localhost:8079/mia-ai-app/'); await page.waitForSelector('#input'); await page.waitForTimeout(1200);
    console.log(native?'app Android (simulata):':'browser:', 'service worker registrati =', await page.evaluate(async()=>(await navigator.serviceWorker.getRegistrations()).length));
    await ctx.close();
  }
  await b.close(); srv.close();
})();
