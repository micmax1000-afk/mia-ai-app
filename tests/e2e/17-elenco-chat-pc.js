/* Test end-to-end di Mia AI. Tutti i servizi esterni sono simulati: nessuna chiamata reale. Vedi tests/README.md */
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const TMP = fs.mkdtempSync(path.join(require('os').tmpdir(), 'mia-test-'));
const WWW = path.join(TMP,'www'); fs.cpSync(path.join(__dirname,'..','..','www'), WWW, {recursive:true}); const mime = { '.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.webmanifest':'application/manifest+json' };
const srv = http.createServer((q,r)=>{ let p=q.url.split('?')[0].replace('/mia-ai-app/','')||'index.html'; if(p===''||p.endsWith('/')) p+='index.html'; fs.readFile(path.join(WWW,p),(e,d)=>{ if(e){r.writeHead(404);r.end();return;} r.writeHead(200,{'content-type':mime[path.extname(p)]||'application/octet-stream'}); r.end(d);});}).listen(8078);
(async () => {
  const b = await chromium.launch();
  for (const [name,vp] of [['PC 1366px',{width:1366,height:800}],['telefono 390px',{width:390,height:844}]]) {
    const ctx = await b.newContext({viewport:vp}); const page = await ctx.newPage();
    await page.addInitScript(() => { if (!localStorage.getItem('miaai_v1_settings')) { localStorage.setItem('miaai_v1_settings', JSON.stringify({provider:'gemini',profiles:{gemini:{apiKey:'k',model:'m'}},theme:'dark',favorites:[]})); const now=Date.now(); localStorage.setItem('miaai_v1_conversations', JSON.stringify([{id:'a',title:'Prima chat',messages:[{role:'user',content:'uno'}],created:now,updated:now},{id:'b',title:'Seconda chat',messages:[{role:'user',content:'due'}],created:now-1000,updated:now-1000}])); } });
    await page.goto('http://localhost:8078/mia-ai-app/'); await page.waitForSelector('#input');
    const items = await page.locator('#convList .open-conv').allTextContents();
    console.log(name.padEnd(15), 'elenco chat all\'avvio:', JSON.stringify(items.map(t=>t.trim())));
    if (vp.width>=960) { await page.click('#convList .open-conv >> nth=1'); await page.waitForTimeout(200); console.log('   clic sulla seconda chat → titolo aperto:', (await page.textContent('#chatTitle')).trim()); await page.screenshot({path: path.join(TMP,'pc-web2.png')}); }
    await ctx.close();
  }
  await b.close(); srv.close();
})();
