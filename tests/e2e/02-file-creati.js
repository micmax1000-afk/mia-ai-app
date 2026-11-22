/* Test end-to-end di Mia AI. Tutti i servizi esterni sono simulati: nessuna chiamata reale. Vedi tests/README.md */
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const TMP = fs.mkdtempSync(path.join(require('os').tmpdir(), 'mia-test-'));
const root = path.resolve(__dirname, '..', '..'), out = path.join(TMP, 'out');
fs.rmSync(out, {recursive:true,force:true}); fs.mkdirSync(out);
const mime = { '.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.webmanifest':'application/json' };
const srv = http.createServer((q,r)=>{ let p=q.url.split('?')[0]; if(p==='/')p='/index.html'; const f=path.join(root,p); fs.readFile(f,(e,d)=>{ if(e){r.writeHead(404);r.end();return;} r.writeHead(200,{'content-type':mime[path.extname(f)]||'application/octet-stream'}); r.end(d);});}).listen(8098);
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push('PAGEERR ' + e.message));
  page.on('console', m => { if (m.type()==='error' && !/404/.test(m.text())) errors.push('CONSOLE ' + m.text()); });
  // 1x1 PNG finto come risposta dell'immagine AI
  const png1 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  await page.route('https://generativelanguage.googleapis.com/**', async route => {
    const b = JSON.parse(route.request().postData());
    if (route.request().url().includes(':generateContent') && b.generationConfig && b.generationConfig.responseModalities)
      return route.fulfill({status:200, headers:{'content-type':'application/json','access-control-allow-origin':'*'}, body: JSON.stringify({candidates:[{content:{parts:[{text:'ecco'},{inlineData:{mimeType:'image/png',data:png1}}]}}]})});
    // flusso chat: prima chiamata = create_xlsx, seconda = testo
    globalThis.__n = (globalThis.__n||0)+1;
    const parts = globalThis.__n === 1
      ? [{functionCall:{name:'create_xlsx',args:{filename:'spese',sheets:[{name:'Mese',rows:[['Voce','Importo'],['Affitto','700'],['Cibo','250,5'],['Totale','=SUM(B2:B3)']]}]}}}]
      : [{text:'Ho creato il foglio.'}];
    await route.fulfill({status:200, headers:{'content-type':'text/event-stream','access-control-allow-origin':'*'}, body:'data: '+JSON.stringify({candidates:[{content:{parts}}]})+'\n\n'});
  });
  await page.addInitScript(() => localStorage.setItem('miaai_v1_settings', JSON.stringify({provider:'gemini',profiles:{gemini:{apiKey:'k',model:'gemini-3.5-flash',baseUrl:'https://generativelanguage.googleapis.com/v1beta'}},agentEnabled:true,githubToken:'',autoFallback:false,favorites:[],theme:'dark',systemPrompt:'x',temperature:0.7})));
  await page.goto('http://localhost:8098/');

  const calls = [
    ['create_file',{filename:'dati.csv',content:'nome;città\nMarìa;Roma\n'}],
    ['create_file',{filename:'virus.exe',content:'x'}],
    ['create_zip',{filename:'progetto',files:[{path:'src/index.js',content:'console.log("ciao")'},{path:'../../etc/passwd',content:'no'},{path:'README.md',content:'# Ciao è'}]}],
    ['create_svg',{filename:'logo',svg:'<svg viewBox="0 0 200 100"><rect width="200" height="100" fill="#7c5cff"/><circle cx="100" cy="50" r="30" fill="#22c1c3"/><text x="100" y="56" text-anchor="middle" fill="white" font-size="16" onclick="x()">Mia</text><script>alert(1)</script></svg>'}],
    ['create_svg',{filename:'rotto',svg:'<svg><rect></svg>'}],
    ['create_pdf',{filename:'relazione.pdf',blocks:[
      {type:'title',text:'Relazione “Test” — città'},{type:'heading',text:'Introduzione'},
      {type:'paragraph',text:'Questo è un paragrafo con accenti: è à ì ò ù, euro € e un emoji 😀 che sparisce. '.repeat(8)},
      {type:'bullets',items:['Primo punto','Secondo punto molto lungo '.repeat(10)]},{type:'numbered',items:['Uno','Due']},
      {type:'table',rows:[['Nome','Qtà','Prezzo'],['Mela','3','1,20 €'],['Pera con nome lunghissimo da andare a capo davvero','10','2,00 €']]},
      {type:'pagebreak'},{type:'heading',text:'Seconda pagina'},{type:'paragraph',text:'Fine.'}]}],
    ['create_xlsx',{filename:'conti.xlsx',sheets:[{name:'Spese',rows:[['Voce','Importo','Nota'],['Affitto','700','ok & <b>'],['Cibo','250,5',''],['Codice','007','zero iniziale'],['Totale','=SUM(B2:B3)','']]},{name:'Spese',rows:[['a']]}]}],
    ['generate_image',{prompt:'un gatto'}],
  ];
  for (const [name,args] of calls) {
    const r = await page.evaluate(async ([name,args]) => {
      try {
        const res = await MiaTools.run(name, args, {geminiKey:'k', imageModel:'gemini-2.5-flash-image'});
        const files = [];
        for (const f of res.files) { const buf = new Uint8Array(await f.blob.arrayBuffer()); let bin=''; buf.forEach(b=>bin+=String.fromCharCode(b)); files.push({name:f.name, mime:f.mime, b64:btoa(bin)}); }
        return {ok:true, text:res.text, files};
      } catch(e) { return {ok:false, error:e.message}; }
    }, [name,args]);
    console.log(name, r.ok ? 'OK ' : 'ERR', r.ok ? r.text.split('\n')[0].slice(0,140) : r.error);
    (r.files||[]).forEach(f => fs.writeFileSync(path.join(out, f.name), Buffer.from(f.b64,'base64')));
  }

  // Flusso in chat: scheda file + Condividi (fallback download nel browser)
  await page.fill('#input','fammi un excel delle spese');
  await page.click('#sendBtn');
  await page.waitForSelector('.file-card', {timeout:10000});
  await page.waitForSelector('.msg.assistant .bubble:has-text("Ho creato")');
  console.log('chat file-card:', await page.textContent('.file-info'));
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('[data-file]')]);
  await dl.saveAs(path.join(out,'scaricato_'+dl.suggestedFilename()));
  console.log('download:', dl.suggestedFilename());
  await page.reload();
  console.log('dopo reload file-card:', await page.locator('.file-card').count());
  console.log('ERRORS:', errors);
  await browser.close(); srv.close();
})().catch(e=>{console.error('FAIL',e);process.exit(1);});
