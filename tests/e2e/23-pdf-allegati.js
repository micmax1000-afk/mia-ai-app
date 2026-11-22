/* Test end-to-end di Mia AI. Tutti i servizi esterni sono simulati: nessuna chiamata reale. Vedi tests/README.md */
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const TMP = fs.mkdtempSync(path.join(require('os').tmpdir(), 'mia-test-'));
const root = path.resolve(__dirname, '..', '..');
const mime = { '.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.webmanifest':'application/json' };
const web = http.createServer((q,r)=>{ let p=q.url.split('?')[0]; if(p==='/')p='/index.html'; const f=path.join(root,p); fs.readFile(f,(e,d)=>{ if(e){r.writeHead(404);r.end();return;} r.writeHead(200,{'content-type':mime[path.extname(f)]||'application/octet-stream'}); r.end(d);});}).listen(8073);
const cors={'access-control-allow-origin':'*','access-control-allow-headers':'*','access-control-allow-methods':'*'};
(async () => {
  const b = await chromium.launch(); const ctx = await b.newContext({viewport:{width:390,height:844}}); const page = await ctx.newPage(); const errs=[]; page.on('pageerror', e => errs.push(e.message));
  const reqs = { nvidia:[], gemini:[], openrouter:[] };
  const sse = (t)=>'data: '+JSON.stringify({choices:[{delta:{content:t}}]})+'\n\ndata: [DONE]\n\n';
  await ctx.route('https://integrate.api.nvidia.com/**', async route => { const r=route.request(); if(r.method()==='OPTIONS') return route.fulfill({status:204,headers:cors}); reqs.nvidia.push(JSON.parse(r.postData())); route.fulfill({status:200,headers:{...cors,'content-type':'text/event-stream'},body:sse('Letto.')}); });
  await ctx.route('https://openrouter.ai/**', async route => { const r=route.request(); if(r.method()==='OPTIONS') return route.fulfill({status:204,headers:cors}); reqs.openrouter.push(JSON.parse(r.postData())); route.fulfill({status:200,headers:{...cors,'content-type':'text/event-stream'},body:sse('Letto.')}); });
  await ctx.route('https://generativelanguage.googleapis.com/**', async route => { const r=route.request(); if(r.method()==='OPTIONS') return route.fulfill({status:204,headers:cors}); reqs.gemini.push(JSON.parse(r.postData())); route.fulfill({status:200,headers:{...cors,'content-type':'text/event-stream'},body:'data: '+JSON.stringify({candidates:[{content:{parts:[{text:'Letto.'}]}}]})+'\n\n'}); });
  const cfg = (prov) => ({provider:prov,profiles:{nvidia:{apiKey:'nv',model:'nvidia/x',baseUrl:'https://integrate.api.nvidia.com/v1'},gemini:{apiKey:'gk',model:'gemini-3.5-flash',baseUrl:'https://generativelanguage.googleapis.com/v1beta'},openrouter:{apiKey:'or',model:'meta/llama',baseUrl:'https://openrouter.ai/api/v1'}},theme:'dark',favorites:[],autoFallback:false,agentEnabled:false,systemPrompt:'x',temperature:0.7});
  await page.goto('http://localhost:8073/'); await page.waitForSelector('#input');
  const setup = async (prov, convs) => { await page.evaluate(([s,c])=>{ localStorage.setItem('miaai_v1_settings',JSON.stringify(s)); if (c) { localStorage.setItem('miaai_v1_conversations',JSON.stringify(c)); localStorage.setItem('miaai_v1_current', JSON.stringify(c[0].id)); } else { localStorage.removeItem('miaai_v1_conversations'); localStorage.removeItem('miaai_v1_current'); } }, [cfg(prov), convs]); await page.reload(); await page.waitForSelector('#input'); };
  // PDF creati dall'app stessa (create_pdf) o a mano con jsPDF
  const makePdf = (kind, n) => page.evaluate(async ([kind,n]) => {
    let blob;
    if (kind === 'testo') blob = (await MiaTools.run('create_pdf',{filename:'relazione',blocks:[{type:'title',text:'Relazione trimestrale'},{type:'paragraph',text:'Alfa: il fatturato è cresciuto del 12% rispetto al trimestre precedente.'},{type:'pagebreak'},{type:'heading',text:'Seconda parte'},{type:'paragraph',text:'Beta: le spese sono rimaste stabili; città e perché con accenti.'},{type:'pagebreak'},{type:'paragraph',text:'Gamma: conclusioni finali.'}]},{})).files[0].blob;
    else if (kind === 'lungo') blob = (await MiaTools.run('create_pdf',{filename:'lungo',blocks:Array.from({length:n},(_,i)=>[{type:'paragraph',text:'Pagina numero '+(i+1)+' del documento lungo.'},{type:'pagebreak'}]).flat()},{})).files[0].blob;
    else if (kind === 'scansione') { const { jsPDF } = window.jspdf; const d = new jsPDF(); d.rect(20,20,100,100,'F'); d.circle(60,150,20); blob = d.output('blob'); }
    const buf = new Uint8Array(await blob.arrayBuffer()); let s=''; buf.forEach(x=>s+=String.fromCharCode(x)); return btoa(s);
  }, [kind,n]);
  const attach = async (name, b64, bytes) => { const before = await page.locator('#pendingAtt .att').count(); await page.setInputFiles('#fileInput', {name, mimeType:'application/pdf', buffer: bytes || Buffer.from(b64,'base64')}); await page.waitForFunction((n)=>document.querySelectorAll('#pendingAtt .att').length>n, before, {timeout:60000}); await page.waitForTimeout(800); };
  const send = async (t) => { await page.fill('#input', t); await page.click('#sendBtn'); };
  const lastText = (r) => JSON.stringify(r);

  const pdfTesto = await makePdf('testo'); const pdfLungo = await makePdf('lungo', 120); const pdfScan = await makePdf('scansione');

  console.log('— modello senza lettura nativa dei PDF (NVIDIA)');
  await setup('nvidia'); await attach('relazione.pdf', pdfTesto); await send('riassumi'); await page.waitForSelector('.msg.assistant .bubble:has-text("Letto.")',{timeout:15000}).catch(async e=>{console.log('DEBUG',(await page.locator('.msg').allTextContents()).join(' | ').slice(0,400));throw e;});
  let body = lastText(reqs.nvidia[0]);
  console.log('   testo estratto inviato =', /Testo estratto dal PDF «relazione\.pdf» \(3 pagine\)/.test(body), '| pagine =', /\[Pagina 1\]/.test(body) && /\[Pagina 2\]/.test(body) && /\[Pagina 3\]/.test(body), '| contenuto =', /Alfa: il fatturato è cresciuto del 12%/.test(body) && /città e perché/.test(body), '| nessun file binario =', !/"type":"file"|base64,JVBER/.test(body));
  console.log('   chip dell\'allegato nel messaggio =', await page.locator('.msg.user .att').count()===1);

  console.log('— Gemini: legge il PDF da solo, il testo non viene duplicato');
  await setup('gemini'); await attach('relazione.pdf', pdfTesto); await send('riassumi'); await page.waitForSelector('.msg.assistant .bubble:has-text("Letto.")',{timeout:15000}).catch(async e=>{console.log('DEBUG',(await page.locator('.msg').allTextContents()).join(' | ').slice(0,400));throw e;});
  body = lastText(reqs.gemini[0]);
  console.log('   PDF inviato come dati =', /"inlineData":\{"mimeType":"application\/pdf"/.test(body), '| testo non duplicato =', !/Testo estratto dal PDF/.test(body));

  console.log('— OpenRouter: file nativo, nessun testo estratto');
  await setup('openrouter'); await attach('relazione.pdf', pdfTesto); await send('riassumi'); await page.waitForSelector('.msg.assistant .bubble:has-text("Letto.")',{timeout:15000}).catch(async e=>{console.log('DEBUG',(await page.locator('.msg').allTextContents()).join(' | ').slice(0,400));throw e;});
  body = lastText(reqs.openrouter[0]);
  console.log('   file nativo =', /"type":"file"/.test(body), '| testo non duplicato =', !/Testo estratto dal PDF/.test(body));

  console.log('— PDF molto lungo (120 pagine)');
  await setup('nvidia'); await attach('lungo.pdf', pdfLungo); await send('cosa contiene?'); await page.waitForSelector('.msg.assistant .bubble:has-text("Letto.")',{timeout:15000}).catch(async e=>{console.log('DEBUG',(await page.locator('.msg').allTextContents()).join(' | ').slice(0,400));throw e;});
  body = lastText(reqs.nvidia[reqs.nvidia.length-1]);
  console.log('   indica il numero di pagine reale =', /\(12[01] pagine\)/.test(body), '| arriva a pagina 100 =', /\[Pagina 100\]/.test(body), '| non oltre =', !/\[Pagina 101\]/.test(body), '| avviso di testo troncato =', /testo troncato/.test(body));

  console.log('— scansione (PDF senza testo)');
  await setup('nvidia'); await attach('scansione.pdf', pdfScan); await send('leggi'); await page.waitForSelector('.msg.error',{timeout:15000});
  console.log('   errore chiaro =', (await page.locator('.msg.error .bubble').textContent()).slice(0,150));
  await setup('gemini'); await attach('scansione.pdf', pdfScan); await send('leggi'); await page.waitForSelector('.msg.assistant .bubble:has-text("Letto.")',{timeout:15000}).catch(async e=>{console.log('DEBUG',(await page.locator('.msg').allTextContents()).join(' | ').slice(0,400));throw e;});
  console.log('   con Gemini invece va (legge le immagini) = true');

  console.log('— file PDF danneggiato');
  await setup('nvidia'); await attach('rotto.pdf', null, Buffer.from('%PDF-1.4 questo non è un pdf vero')); await send('leggi'); await page.waitForSelector('.msg.error',{timeout:15000});
  console.log('   l\'allegato si crea comunque e dà l\'errore chiaro =', /non contiene testo selezionabile/.test(await page.locator('.msg.error .bubble').textContent()));

  console.log('— chat già salvate');
  const old = [{id:'v',title:'Vecchia',created:1,updated:1,messages:[{role:'user',content:'vedi allegato',attachments:[{kind:'pdf',name:'vecchio.pdf',mime:'application/pdf',data:'JVBERi0='}]}]}];
  await setup('nvidia', old); await send('continua'); await page.waitForSelector('.msg.error',{timeout:15000}); console.log('   PDF vecchio senza testo estratto → errore chiaro con NVIDIA =', true);
  const dropped = [{id:'d',title:'Liberata',created:1,updated:1,messages:[{role:'user',content:'vedi',attachments:[{kind:'pdf',name:'liberato.pdf',mime:'application/pdf',text:'Contenuto salvato del PDF liberato dalla memoria',pages:2,dropped:true}]}]}];
  reqs.gemini.length=0; await setup('gemini', dropped);
  await send('e adesso?'); await page.waitForSelector('.msg.assistant .bubble:has-text("Letto.")',{timeout:15000}).catch(async e=>{console.log('DEBUG',(await page.locator('.msg').allTextContents()).join(' | ').slice(0,400));throw e;});
  console.log('   PDF liberato dalla memoria ma con testo: il testo viene usato anche con Gemini =', /Contenuto salvato del PDF liberato/.test(lastText(reqs.gemini[0])));
  console.log('ERRORS', errs);
  await b.close(); web.close();
})().catch(e=>{console.error('FAIL',e);process.exit(1)});
