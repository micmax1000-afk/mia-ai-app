/* Test end-to-end di Mia AI. Tutti i servizi esterni sono simulati: nessuna chiamata reale. Vedi tests/README.md */
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const TMP = fs.mkdtempSync(path.join(require('os').tmpdir(), 'mia-test-'));
const root = path.resolve(__dirname, '..', '..');
const mime = { '.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.webmanifest':'application/json' };
const web = http.createServer((q,r)=>{ let p=q.url.split('?')[0]; if(p==='/')p='/index.html'; const f=path.join(root,p); fs.readFile(f,(e,d)=>{ if(e){r.writeHead(404);r.end();return;} r.writeHead(200,{'content-type':mime[path.extname(f)]||'application/octet-stream'}); r.end(d);});}).listen(8074);
const JPG = Buffer.concat([Buffer.from([0xff,0xd8,0xff,0xe0,0,16,0x4a,0x46,0x49,0x46,0,1,1,0,0,1,0,1,0,0]), Buffer.alloc(600,7), Buffer.from([0xff,0xd9])]);
const cors={'access-control-allow-origin':'*','access-control-allow-headers':'*','access-control-allow-methods':'*'};
(async () => {
  const b = await chromium.launch(); const ctx = await b.newContext({viewport:{width:390,height:844}}); const page = await ctx.newPage(); const errs=[]; page.on('pageerror', e => errs.push(e.message));
  const pol = {mode:'ok', urls:[], delay:0}; let nvMode='402'; let gemMode='429'; let chatMode='ok'; const chatReqs=[];
  await ctx.route('https://image.pollinations.ai/**', async route => { const r=route.request(); pol.urls.push(r.url()); if (pol.delay) await new Promise(r=>setTimeout(r,pol.delay));
    if (pol.mode==='cors') { if (r.resourceType()==='image') return route.fulfill({status:200,headers:{...cors,'content-type':'image/png'},body:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==','base64')}); return route.abort('failed'); }
    if (pol.mode==='429') return route.fulfill({status:429,headers:cors,body:'slow down'});
    if (pol.mode==='html') return route.fulfill({status:200,headers:{...cors,'content-type':'text/html'},body:'<html>captcha</html>'});
    route.fulfill({status:200,headers:{...cors,'content-type':'image/jpeg'},body:JPG}); });
  await ctx.route('https://ai.api.nvidia.com/**', async route => { const r=route.request(); if(r.method()==='OPTIONS') return route.fulfill({status:204,headers:cors}); route.fulfill({status:402,headers:{...cors,'content-type':'application/json'},body:'{"detail":"Out of credits"}'}); });
  await ctx.route('https://generativelanguage.googleapis.com/**', async route => { const r=route.request(); if(r.method()==='OPTIONS') return route.fulfill({status:204,headers:cors});
    const url=r.url(); if (url.includes(':generateContent')) return route.fulfill({status:429,headers:{...cors,'content-type':'application/json'},body:'{"error":{"message":"Quota exceeded"}}'});
    chatReqs.push(JSON.parse(r.postData())); if (chatMode==='fail') return route.fulfill({status:500,headers:{...cors,'content-type':'application/json'},body:'{"error":{"message":"boom"}}'});
    route.fulfill({status:200,headers:{...cors,'content-type':'text/event-stream'},body:'data: '+JSON.stringify({candidates:[{content:{parts:[{text:'"A fluffy tabby cat sleeping curled up on a sunlit windowsill, soft golden light, shallow depth of field, photorealistic"'}]}}]})+'\n\n'}); });
  const base = (o={}) => ({provider:'gemini',profiles:{gemini:{apiKey:'gk',model:'gemini-3.6-flash'}},autoFallback:false,favorites:[],theme:'dark',...o});
  await page.addInitScript(() => {}); await page.goto('http://localhost:8074/');
  const setup = async (s) => { await page.evaluate((s)=>{ localStorage.setItem('miaai_v1_settings',JSON.stringify(s)); localStorage.removeItem('miaai_v1_conversations'); localStorage.removeItem('miaai_v1_current'); }, s); await page.reload(); await page.waitForSelector('#input'); };
  const run = (c, a={}) => page.evaluate(async ([c,a]) => { try { const r = await MiaTools.run('generate_image',{prompt:'a cat',...a},c); return {ok:true,text:r.text.split('\n').slice(-1)[0].slice(0,200),file:r.files[0]?r.files[0].name+' '+r.files[0].mime:'(nessun file)',url:r.imageUrl||''}; } catch(e){ return {ok:false,error:e.message}; } }, [c,a]);
  const show=(t,r)=>console.log(t.padEnd(34), r.ok?'OK  '+r.file+(r.url?' | link: '+r.url.slice(0,60):'')+' | '+r.text:'ERR '+r.error.slice(0,230));

  console.log('— strumento generate_image');
  pol.urls=[]; show('Pollinations esplicito', await run({imageProvider:'pollinations'})); const u=new URL(pol.urls[0]); console.log('   indirizzo:', u.origin+u.pathname, '| parametri:', [...u.searchParams.keys()].join(','), '| dimensioni:', u.searchParams.get('width')+'x'+u.searchParams.get('height'));
  show('auto: senza chiavi → Pollinations', await run({imageProvider:'auto'}));
  show('auto: NVIDIA ✗, Gemini ✗, Poll. ✓', await run({imageProvider:'auto',nvidiaKey:'nv',geminiKey:'gk'}));
  pol.mode='429'; show('Pollinations 429', await run({imageProvider:'pollinations'}));
  pol.mode='html'; show('Pollinations risponde con una pagina', await run({imageProvider:'pollinations'}));
  pol.mode='cors'; show('rete bloccata, senza allowLink', await run({imageProvider:'pollinations'}));
  show('rete bloccata, con allowLink', await run({imageProvider:'pollinations',allowLink:true}));
  pol.mode='429'; show('auto: tutti falliscono', await run({imageProvider:'auto',nvidiaKey:'nv',geminiKey:'gk'}));
  show('NVIDIA esplicito senza chiave', await run({imageProvider:'nvidia'}));
  pol.mode='ok';

  console.log('— «disegna…» dalla chat');
  await setup(base()); pol.urls=[]; chatReqs.length=0;
  await page.fill('#input','disegna un gatto che dorme'); await page.click('#sendBtn'); await page.waitForSelector('.file-card',{timeout:15000});
  const pu = new URL(pol.urls[0]); const prompt = decodeURIComponent(pu.pathname.replace('/prompt/',''));
  console.log('   il modello ha riscritto la richiesta:', JSON.stringify(chatReqs[0].contents[0].parts[0].text), '→ istruzione in inglese =', /image generator/.test(JSON.stringify(chatReqs[0].systemInstruction)));
  console.log('   descrizione inviata a Pollinations:', prompt.slice(0,70)+'…', '| senza virgolette =', !/^["']/.test(prompt));
  console.log('   file in chat:', (await page.textContent('.file-info')).trim(), '| anteprima =', await page.locator('.file-card img').count()===1, '| pulsante =', (await page.textContent('[data-file]')).trim());
  console.log('   messaggio:', (await page.locator('.bubble').last().textContent()).slice(0,60)+'…', '| etichetta:', (await page.locator('.model-tag').last().textContent()).trim());
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('[data-file]')]); console.log('   Condividi/Salva (browser) → scarica:', dl.suggestedFilename());
  await page.reload(); console.log('   dopo il ricaricamento il file c\'è ancora =', await page.locator('.file-card').count()===1);

  console.log('— formato dalla richiesta');
  for (const [testo, atteso] of [['disegna un tramonto panoramico orizzontale','1344x768'],['disegna un ritratto verticale di un gufo','768x1344'],['disegna una mela','1024x1024']]) {
    await setup(base()); pol.urls=[]; await page.fill('#input',testo); await page.click('#sendBtn'); await page.waitForSelector('.file-card',{timeout:20000});
    const q = new URL(pol.urls[0]).searchParams; console.log('   «'+testo+'» → '+q.get('width')+'x'+q.get('height')+(q.get('width')+'x'+q.get('height')===atteso?' (atteso)':' (!! atteso '+atteso+')'));
  }
  console.log('— il modello non risponde: si usa il testo originale');
  await setup(base()); chatMode='fail'; pol.urls=[];
  await page.fill('#input','disegna una casa rossa'); await page.click('#sendBtn'); await page.waitForSelector('.file-card',{timeout:25000});
  console.log('   descrizione inviata:', decodeURIComponent(new URL(pol.urls[0]).pathname.replace('/prompt/','')), '| file creato =', true); chatMode='ok';

  console.log('— tasto Stop durante la generazione');
  await setup(base()); pol.delay=6000; pol.urls=[];
  await page.fill('#input','disegna un drago'); await page.click('#sendBtn'); await page.waitForTimeout(1500); await page.click('#sendBtn'); await page.waitForSelector('.bubble:has-text("interrotto")',{timeout:8000});
  console.log('   messaggio «interrotto» mostrato =', true, '| nessun file =', await page.locator('.file-card').count()===0, '| pulsante di nuovo «invia» =', (await page.textContent('#sendBtn')).trim()); pol.delay=0;

  console.log('— rete bloccata (browser): resta il collegamento come prima');
  await setup(base()); pol.mode='cors';
  await page.fill('#input','disegna una barca'); await page.click('#sendBtn'); await page.waitForSelector('.gen-img',{timeout:15000}); await page.waitForTimeout(500);
  console.log('   immagine mostrata da collegamento =', await page.locator('.gen-img').count()===1, '| caricata davvero =', await page.evaluate(()=>{const i=document.querySelector('.gen-img'); return i && i.naturalWidth>0;}), '| src:', (await page.getAttribute('.gen-img','src')).slice(0,48)+'…'); pol.mode='ok';

  console.log('— tutti i servizi falliscono');
  await setup(base({profiles:{gemini:{apiKey:'gk',model:'gemini-3.6-flash'},nvidia:{apiKey:'nv',model:'x'}}})); pol.mode='429';
  await page.fill('#input','disegna un fiore'); await page.click('#sendBtn'); await page.waitForSelector('.msg.error',{timeout:15000});
  console.log('   errore mostrato:', (await page.locator('.msg.error .bubble').textContent()).slice(0,210)); pol.mode='ok';

  console.log('— impostazioni');
  await page.click('#menuBtn'); await page.click('#drawer [data-open-settings]'); await page.waitForSelector('#settings:not([hidden])');
  console.log('   scelte:', await page.evaluate(()=>[...document.querySelectorAll('#imageProvider option')].map(o=>o.value).join(', ')));
  console.log('ERRORS', errs);
  await b.close(); web.close();
})().catch(e=>{console.error('FAIL',e);process.exit(1)});
