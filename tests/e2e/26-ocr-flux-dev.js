/* Test end-to-end di Mia AI. Tutti i servizi esterni sono simulati: nessuna chiamata reale. Vedi tests/README.md */
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const root = path.resolve(__dirname, '..', '..');
const mime = { '.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.webmanifest':'application/json' };
const web = http.createServer((q,r)=>{ let p=q.url.split('?')[0]; if(p==='/')p='/index.html'; const f=path.join(root,p); fs.readFile(f,(e,d)=>{ if(e){r.writeHead(404);r.end();return;} r.writeHead(200,{'content-type':mime[path.extname(f)]||'application/octet-stream'}); r.end(d);});}).listen(8077);
const PNG='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const cors={'access-control-allow-origin':'*','access-control-allow-headers':'*','access-control-allow-methods':'*'};
(async () => {
  const b = await chromium.launch(); const ctx = await b.newContext({viewport:{width:390,height:844}}); const page = await ctx.newPage(); const errs=[]; page.on('pageerror', e => errs.push(e.message));
  const ocr = { bodies:[], mode:'data', status:200 }; const nv = []; const flux = { urls:[], bodies:[], rejectSize:false };
  await ctx.route('https://ai.api.nvidia.com/**', async route => { const r=route.request(); if(r.method()==='OPTIONS') return route.fulfill({status:204,headers:cors}); const u=new URL(r.url()); const body=JSON.parse(r.postData());
    const j=(o,s=200)=>route.fulfill({status:s,headers:{...cors,'content-type':'application/json'},body:JSON.stringify(o)});
    if (u.pathname.includes('/cv/nvidia/nemoretriever-ocr')) { ocr.bodies.push(body); const n=ocr.bodies.length; if (ocr.status!==200) return j({detail:'Unauthorized'},ocr.status);
      if (ocr.mode==='data') return j({object:'list',data:[{index:0,content:'Testo della pagina '+n+' con àccenti',object:'string'}],model:'nvidia/nemoretriever-ocr'});
      if (ocr.mode==='detections') return j({data:[{index:0,text_detections:[{text_prediction:{text:'Prima riga '+n,confidence:.9}},{text_prediction:{text:'Seconda riga '+n,confidence:.9}}]}]});
      if (ocr.mode==='jsonstring') return j({data:[{index:0,content:JSON.stringify({text_detections:[{text_prediction:{text:'Dal JSON '+n}}]})}]});
      return j({data:[]}); }
    if (u.pathname.includes('/genai/black-forest-labs/')) { flux.urls.push(u.pathname); flux.bodies.push(body);
      if (flux.rejectSize && (body.width||body.height)) return j({detail:[{type:'literal_error',loc:['body','width'],msg:'Only width=1024 is supported'}]},422);
      return j({artifacts:[{base64:PNG,finishReason:'SUCCESS'}]}); }
    return j({},404); });
  await ctx.route('https://integrate.api.nvidia.com/**', async route => { const r=route.request(); if(r.method()==='OPTIONS') return route.fulfill({status:204,headers:cors}); nv.push(JSON.parse(r.postData())); route.fulfill({status:200,headers:{...cors,'content-type':'text/event-stream'},body:'data: '+JSON.stringify({choices:[{delta:{content:'Letto.'}}]})+'\n\ndata: [DONE]\n\n'}); });
  const settings = (extra) => Object.assign({provider:'nvidia',profiles:{nvidia:{apiKey:'nvapi-X',model:'nvidia/x',baseUrl:'https://integrate.api.nvidia.com/v1'}},theme:'dark',favorites:[],autoFallback:false,agentEnabled:false,systemPrompt:'x',temperature:0.7}, extra||{});
  const open = async (s) => { await page.goto('http://localhost:8077/'); await page.evaluate((s)=>{ localStorage.clear(); localStorage.setItem('miaai_v1_settings',JSON.stringify(s)); }, s); await page.reload(); await page.waitForSelector('#input'); };
  const scan = (pages) => page.evaluate(async (n) => { await MiaTools.run('create_pdf',{filename:'x',blocks:[{type:'paragraph',text:'x'}]},{}); const { jsPDF } = window.jspdf; const d = new jsPDF(); for (let i=0;i<n;i++){ if(i) d.addPage(); d.rect(20,20,150,200,'F'); d.circle(100,250,20); } const buf = new Uint8Array(d.output('arraybuffer')); let s=''; buf.forEach(x=>s+=String.fromCharCode(x)); return btoa(s); }, pages);
  const attach = async (b64, accept) => { const dialogs=[]; const h = async d => { dialogs.push(d.message()); accept ? await d.accept() : await d.dismiss(); }; page.on('dialog', h);
    const before = await page.locator('#pendingAtt .att').count(); await page.setInputFiles('#fileInput', {name:'scan.pdf', mimeType:'application/pdf', buffer:Buffer.from(b64,'base64')});
    await page.waitForFunction((n)=>document.querySelectorAll('#pendingAtt .att').length>n, before, {timeout:90000}); await page.waitForTimeout(500); page.off('dialog', h); return dialogs; };
  const reset = () => { ocr.bodies.length=0; ocr.status=200; ocr.mode='data'; nv.length=0; };
  const toastText = () => page.locator('#toast').textContent().catch(()=>'');

  console.log('— OCR di una scansione (3 pagine), l\'utente accetta');
  await open(settings()); reset(); const pdf3 = await scan(3);
  const dlg = await attach(pdf3, true);
  console.log('   domanda mostrata =', dlg.length===1 && /sembra una scansione/.test(dlg[0]) && /servizio di PROVA/.test(dlg[0]) && /prime 3 pagine/.test(dlg[0]));
  const b0 = ocr.bodies[0] || {};
  console.log('   richieste OCR =', ocr.bodies.length, '| formato {input:[{type,url}]} =', Array.isArray(b0.input) && b0.input[0].type==='image_url' && /^data:image\/jpeg;base64,/.test(b0.input[0].url), '| immagine sotto i 180000 caratteri =', ocr.bodies.every(x=>x.input[0].url.length-23<180000));
  await page.fill('#input','leggi'); await page.click('#sendBtn'); await page.waitForSelector('.msg.assistant .bubble:has-text("Letto.")',{timeout:15000});
  const sent = JSON.stringify(nv[0]);
  console.log('   testo riconosciuto inviato al modello =', /\[Pagina 1\]\\nTesto della pagina 1 con àccenti/.test(sent) && /\[Pagina 3\]/.test(sent), '| indicato come OCR =', /riconosciuto con OCR: può contenere errori/.test(sent), '| nessun errore =', (await page.locator('.msg.error').count())===0);

  console.log('— altre forme di risposta');
  for (const mode of ['detections','jsonstring']) { await open(settings()); reset(); ocr.mode=mode; await attach(await scan(1), true); await page.fill('#input','leggi'); await page.click('#sendBtn'); await page.waitForSelector('.msg.assistant .bubble:has-text("Letto.")',{timeout:15000});
    console.log('   ', mode, '→', (JSON.stringify(nv[0]).match(mode==='detections' ? /Prima riga 1\\nSeconda riga 1/ : /Dal JSON 1/)||['NON LETTO'])[0]); }

  console.log('— l\'utente rifiuta: nessuna richiesta a NVIDIA OCR');
  await open(settings()); reset(); await attach(await scan(1), false); console.log('   richieste OCR =', ocr.bodies.length);
  console.log('— senza chiave NVIDIA: nessuna domanda');
  await open(settings({provider:'gemini',profiles:{gemini:{apiKey:'g',model:'gemini-3.5-flash',baseUrl:'https://generativelanguage.googleapis.com/v1beta'}}})); reset(); const d2 = await attach(await scan(1), true); console.log('   domande =', d2.length, '| richieste OCR =', ocr.bodies.length);
  console.log('— scansione di 12 pagine: solo le prime 10');
  await open(settings()); reset(); await attach(await scan(12), true); console.log('   richieste OCR =', ocr.bodies.length, '| avviso =', /solo le prime 10 pagine/.test(await toastText()));
  console.log('— chiave rifiutata (401): l\'allegato si crea lo stesso, messaggio chiaro');
  await open(settings()); reset(); ocr.status=401; await attach(await scan(3), true); await page.waitForTimeout(300);
  console.log('   richieste OCR =', ocr.bodies.length, '(si smette dopo 2 errori) | messaggio =', (await toastText()).slice(0,150));
  await page.fill('#input','leggi'); await page.click('#sendBtn'); await page.waitForSelector('.msg.error',{timeout:15000}); console.log('   all\'invio: errore «scansione» come prima =', /non contiene testo selezionabile/.test(await page.locator('.msg.error .bubble').textContent()));

  console.log('— immagini FLUX.1 dev / schnell');
  const gen = (extra) => page.evaluate(async (extra) => { try { const r = await MiaTools.run('generate_image',{prompt:'a fox',aspect:'landscape'},Object.assign({imageProvider:'nvidia',nvidiaKey:'nvapi-X'},extra)); return 'OK '+r.text.slice(0,70); } catch(e){ return 'ERR '+e.message; } }, extra);
  await open(settings());
  flux.urls.length=0; flux.bodies.length=0; console.log('   predefinito →', await gen({}), '|', flux.urls[0], JSON.stringify(flux.bodies[0]));
  flux.urls.length=0; flux.bodies.length=0; console.log('   dev →', await gen({nvidiaImageModel:'flux.1-dev'}), '|', flux.urls[0], JSON.stringify(flux.bodies[0]));
  flux.urls.length=0; flux.bodies.length=0; flux.rejectSize=true; console.log('   dev con formato rifiutato →', await gen({nvidiaImageModel:'flux.1-dev'}), '| richieste =', flux.bodies.length, '| ultima =', JSON.stringify(flux.bodies[flux.bodies.length-1])); flux.rejectSize=false;
  console.log('   la scelta nelle Impostazioni arriva allo strumento =', await (async()=>{ await page.evaluate(()=>{ const s=JSON.parse(localStorage.getItem('miaai_v1_settings')); s.nvidiaImageModel='flux.1-dev'; s.imageProvider='nvidia'; s.agentEnabled=true; localStorage.setItem('miaai_v1_settings',JSON.stringify(s)); }); await page.reload(); await page.waitForSelector('#input'); flux.urls.length=0;
    await page.fill('#input','disegna una volpe'); await page.click('#sendBtn'); await page.waitForSelector('.file-card, .msg.error, .gen-img',{timeout:25000}); return flux.urls[0]; })());
  console.log('ERRORS', errs);
  await b.close(); web.close();
})().catch(e=>{console.error('FAIL',e);process.exit(1)});
