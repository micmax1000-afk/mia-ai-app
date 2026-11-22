/* Test end-to-end di Mia AI. Tutti i servizi esterni sono simulati: nessuna chiamata reale. Vedi tests/README.md */
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const TMP = fs.mkdtempSync(path.join(require('os').tmpdir(), 'mia-test-'));
const root = path.resolve(__dirname, '..', '..');
const mime = { '.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.webmanifest':'application/json' };
const srv = http.createServer((q,r)=>{ let p=q.url.split('?')[0]; if(p==='/')p='/index.html'; const f=path.join(root,p); fs.readFile(f,(e,d)=>{ if(e){r.writeHead(404);r.end();return;} r.writeHead(200,{'content-type':mime[path.extname(f)]||'application/octet-stream'}); r.end(d);});}).listen(8093);
(async () => {
  const b = await chromium.launch(); const page = await b.newPage(); const errs=[];
  page.on('pageerror', e => errs.push(e.message));
  await page.addInitScript(() => localStorage.setItem('miaai_v1_settings', JSON.stringify({provider:'gemini',profiles:{gemini:{apiKey:'k',model:'m'}}})));
  await page.goto('http://localhost:8093/');
  // passa dal vero campo file dell'app
  for (const f of ['vendite.xlsx','relazione.docx','deck.pptx','prog.zip','vecchio.xls','rotto.docx']) {
    await page.setInputFiles('#fileInput', path.join(__dirname,'..','fixtures','office',f));
    await page.waitForTimeout(400);
    const info = await page.evaluate(() => { const t=document.querySelector('#toast'); return {toast: t.hidden?'':t.textContent, n: document.querySelectorAll('#pendingAtt .att').length}; });
    console.log('\n=== '+f+' ===  allegati:', info.n, info.toast?'| avviso: '+info.toast:'');
    if (!info.toast) { const txt = await page.evaluate(()=>window.__pending && 0); }
  }
  // leggi il testo estratto direttamente
  for (const f of ['vendite.xlsx','relazione.docx','deck.pptx','prog.zip']) {
    const b64 = fs.readFileSync(path.join(__dirname,'..','fixtures','office',f)).toString('base64');
    const t = await page.evaluate(async ([n,b64]) => { const bin=atob(b64); const u=new Uint8Array(bin.length); for(let i=0;i<bin.length;i++)u[i]=bin.charCodeAt(i); return (await MiaDocs.extract(new File([u],n))).text; }, [f,b64]);
    console.log('\n--- '+f+' ---\n'+t);
  }
  console.log('\nERRORS', errs);
  await b.close(); srv.close();
})();
