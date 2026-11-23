/* Test end-to-end di Mia AI. Tutti i servizi esterni sono simulati: nessuna chiamata reale. Vedi tests/README.md */
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const root = path.resolve(__dirname, '..', '..');
const mime = { '.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.webmanifest':'application/json' };
const web = http.createServer((q,r)=>{ let p=q.url.split('?')[0]; if(p==='/')p='/index.html'; const f=path.join(root,p); fs.readFile(f,(e,d)=>{ if(e){r.writeHead(404);r.end();return;} r.writeHead(200,{'content-type':mime[path.extname(f)]||'application/octet-stream'}); r.end(d);});}).listen(8089);
// Simulazione di Android: il fetch «nativo» (window.fetch) restituisce tutto alla fine; window.CapacitorWebFetch è il fetch del browser, che fa arrivare i pezzi a poco a poco.
const SIM = `
  window.__native = []; window.__web = []; window.__webMode = window.__webMode || 'stream';
  const WORDS = 'uno due tre quattro cinque sei sette otto nove dieci undici dodici tredici quattordici quindici sedici diciassette diciotto diciannove venti ventuno ventidue'.split(' ');
  const ssePart = (host, text) => host.includes('generativelanguage') ? 'data: ' + JSON.stringify({candidates:[{content:{parts:[{text}]}}]}) + '\\n\\n' : 'data: ' + JSON.stringify({choices:[{delta:{content:text}}]}) + '\\n\\n';
  const done = (host) => host.includes('generativelanguage') ? '' : 'data: [DONE]\\n\\n';
  const nativeFetch = (url, init) => { const u=String(url); const host=new URL(u).host; window.__native.push(host);
    return new Promise((res, rej) => { const t = setTimeout(() => res(new Response(WORDS.map(w=>ssePart(host,w+' ')).join('')+done(host),{status:200,headers:{'content-type':'text/event-stream'}})), 2400); });
  };
  const webFetch = (url, init) => { const host=new URL(String(url)).host; window.__web.push(host);
    if (window.__webMode === 'cors') return Promise.reject(new TypeError('Failed to fetch'));
    const enc = new TextEncoder(); let i = 0; let timer;
    const stream = new ReadableStream({ start(ctrl) { const sig = init && init.signal; if (sig) sig.addEventListener('abort', () => { clearInterval(timer); try { ctrl.error(Object.assign(new Error('Interrotto'),{name:'AbortError'})); } catch(e){} }, {once:true});
      timer = setInterval(() => { if (i < WORDS.length) { ctrl.enqueue(enc.encode(ssePart(host, WORDS[i++] + ' '))); } else { ctrl.enqueue(enc.encode(done(host))); ctrl.close(); clearInterval(timer); } }, 110); } });
    return Promise.resolve(new Response(stream,{status:200,headers:{'content-type':'text/event-stream'}}));
  };
  window.fetch = function(url, init){ const u=String(url); if (/generativelanguage|api\\.groq|api\\.mistral|openrouter|integrate\\.api\\.nvidia/.test(u)) return nativeFetch(url, init); return realFetch(url, init); };
  window.__installWeb = () => { window.CapacitorWebFetch = webFetch; };`;
(async () => {
  const b = await chromium.launch(); const ctx = await b.newContext({viewport:{width:390,height:844}}); const errs=[];
  const mk = async (extra, init) => { const page = await ctx.newPage(); page.on('pageerror', e => errs.push(e.message));
    await page.addInitScript(([s,sim,i])=>{ if(!sessionStorage.getItem('init')){ sessionStorage.setItem('init','1'); localStorage.clear(); localStorage.setItem('miaai_v1_settings',JSON.stringify(s)); } const realFetch = window.fetch.bind(window); eval(sim); if(i) eval(i); }, [Object.assign({provider:'gemini',profiles:{gemini:{apiKey:'k',model:'gemini-3.5-flash',baseUrl:'https://generativelanguage.googleapis.com/v1beta'},groq:{apiKey:'g',model:'llama',baseUrl:'https://api.groq.com/openai/v1'},nvidia:{apiKey:'n',model:'nvidia/x',baseUrl:'https://integrate.api.nvidia.com/v1'}},theme:'dark',favorites:[],autoFallback:false,autoResume:false,keepAwake:false,agentEnabled:false,systemPrompt:'x',temperature:0.7},extra||{}), SIM, init||null]);
    await page.goto('http://localhost:8089/'); await page.waitForSelector('#input'); return page; };
  const lastBubble = (page) => page.locator('.msg.assistant .bubble').last();
  const growth = async (page) => { const seen = []; const t0 = Date.now(); while (Date.now()-t0 < 9000) { const t = (await lastBubble(page).textContent().catch(()=>'' ) || '').trim(); if (t && seen[seen.length-1] !== t) seen.push(t); if (/ventidue/.test(t)) break; await page.waitForTimeout(60); } return seen; };

  console.log('— senza streaming (come l\'Android di oggi): tutta insieme alla fine');
  let page = await mk(); await page.fill('#input','ciao'); await page.click('#sendBtn'); let seen = await growth(page); await page.waitForTimeout(400);
  console.log('   aggiornamenti del testo visti =', seen.length, '(1 = tutto insieme) | richieste: native =', await page.evaluate(()=>window.__native.length), ', web =', await page.evaluate(()=>window.__web.length));
  let tag = (await page.locator('.model-tag').last().textContent()).trim();
  console.log('   etichetta =', tag); console.log('   mostra il tempo totale e le parole al secondo, senza «1° testo» =', /· \d+,\d s/.test(tag) && /~\d+ parole\/s/.test(tag) && !/1° testo/.test(tag));
  await page.close();

  console.log('— con il fetch del browser (CapacitorWebFetch): arriva a poco a poco');
  page = await mk({}, "window.__installWeb();"); await page.fill('#input','ciao'); await page.click('#sendBtn'); seen = await growth(page); await page.waitForTimeout(400);
  console.log('   aggiornamenti del testo visti =', seen.length, '(> 5 = progressivo) | prima parte =', JSON.stringify(seen[0].slice(0,20)), '| native =', await page.evaluate(()=>window.__native.length), ', web =', await page.evaluate(()=>window.__web.join(',')));
  tag = (await page.locator('.model-tag').last().textContent()).trim(); console.log('   etichetta =', tag);
  console.log('   mostra anche il «1° testo» =', /· 1° testo \d+,\d s/.test(tag) && /~\d+ parole\/s/.test(tag));
  await page.close();

  console.log('— Groq (OpenAI-compatibile) usa lo stesso canale; NVIDIA no');
  page = await mk({provider:'groq'}, "window.__installWeb();"); await page.fill('#input','ciao'); await page.click('#sendBtn'); await growth(page);
  console.log('   Groq → web =', await page.evaluate(()=>window.__web.join(',')), '| native =', await page.evaluate(()=>window.__native.length)); await page.close();
  page = await mk({provider:'nvidia'}, "window.__installWeb();"); await page.fill('#input','ciao'); await page.click('#sendBtn'); await growth(page);
  console.log('   NVIDIA → web =', await page.evaluate(()=>window.__web.length), '| native =', await page.evaluate(()=>window.__native.join(','))); await page.close();

  console.log('— il fetch del browser fallisce (CORS): si ripiega sul nativo e si ricorda');
  page = await mk({}, "window.__webMode='cors'; window.__installWeb();"); await page.fill('#input','uno'); await page.click('#sendBtn'); seen = await growth(page); await page.waitForTimeout(600);
  console.log('   risposta arrivata = ', /ventidue/.test(await lastBubble(page).textContent()), '| web provato =', await page.evaluate(()=>window.__web.length), ', nativo usato =', await page.evaluate(()=>window.__native.length));
  await page.fill('#input','due'); await page.click('#sendBtn'); await page.waitForFunction(()=>document.querySelectorAll('.msg.assistant').length>=2 && /ventidue/.test([...document.querySelectorAll('.msg.assistant .bubble')].pop().textContent),null,{timeout:12000});
  console.log('   alla seconda richiesta non riprova il canale del browser =', (await page.evaluate(()=>window.__web.length))===1, '| nativo =', await page.evaluate(()=>window.__native.length)); await page.close();

  console.log('— «Stop» durante lo streaming');
  page = await mk({}, "window.__installWeb();"); await page.fill('#input','ciao'); await page.click('#sendBtn'); await page.waitForTimeout(700); const t0 = Date.now(); await page.click('#sendBtn');
  let ms=-1; for (let i=0;i<40;i++){ if ((await page.evaluate(()=>document.querySelector('#sendBtn').textContent.trim()))==='↑') { ms=Date.now()-t0; break; } await page.waitForTimeout(50); }
  console.log('   torna libero subito =', ms>=0 && ms<800, '(' + ms + ' ms)', '| testo parziale conservato con «(interrotto)» =', /interrotto/.test(await lastBubble(page).textContent())); await page.close();

  console.log('— velocità misurate nelle Impostazioni');
  page = await mk({}, "window.__installWeb();"); for (const q of ['uno','due']) { await page.fill('#input',q); await page.click('#sendBtn'); await page.waitForFunction((n)=>document.querySelectorAll('.msg.assistant').length>=n && /ventidue/.test([...document.querySelectorAll('.msg.assistant .bubble')].pop().textContent),q==='uno'?1:2,{timeout:12000}); await page.waitForTimeout(500); }
  await page.click('#menuBtn'); await page.click('.drawer [data-open-settings]'); await page.waitForSelector('#speedList',{state:'attached'});
  const row = (await page.locator('#speedList li').first().textContent()).trim(); console.log('   riga =', row);
  console.log('   mostra modello, parole al secondo, tempo medio, 1° testo e numero di risposte =', /Gemini · gemini-3\.5-flash — ~\d+ parole\/s · \d+,\d s a risposta · 1° testo dopo \d+,\d s \(2 risposte\)/.test(row));
  await page.click('#speedReset'); console.log('   «Azzera le misure» =', /Ancora nessuna misura/.test(await page.locator('#speedList').textContent()));
  await page.locator('#showSpeed').uncheck(); await page.click('#closeSettings'); await page.waitForTimeout(200);
  console.log('   con «Mostra il tempo» spento l\'etichetta resta solo il modello =', !/ s/.test((await page.locator('.model-tag').last().textContent())), '|', (await page.locator('.model-tag').last().textContent()).trim());
  await page.close();
  console.log('ERRORS', errs);
  await b.close(); web.close();
})().catch(e=>{console.error('FAIL',e);process.exit(1)});
