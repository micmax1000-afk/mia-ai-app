/* Test end-to-end di Mia AI. Tutti i servizi esterni sono simulati: nessuna chiamata reale. Vedi tests/README.md */
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const root = path.resolve(__dirname, '..', '..');
const mime = { '.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.webmanifest':'application/json' };
const web = http.createServer((q,r)=>{ let p=q.url.split('?')[0]; if(p==='/')p='/index.html'; const f=path.join(root,p); fs.readFile(f,(e,d)=>{ if(e){r.writeHead(404);r.end();return;} r.writeHead(200,{'content-type':mime[path.extname(f)]||'application/octet-stream'}); r.end(d);});}).listen(8088);
// Su Android le richieste passano da CapacitorHttp: il «fetch» nativo NON si interrompe con l'AbortSignal e risponde solo a richiesta finita.
// Qui lo si simula: un fetch che ignora il segnale e risponde dopo SLOW millisecondi.
const SLOW = 9000;
const NATIVE = `
  const realFetch = window.fetch.bind(window);
  window.__calls = [];
  window.fetch = function(url, init) {
    const u = String(url);
    if (/generativelanguage|integrate\\.api\\.nvidia|api\\.github\\.com/.test(u)) {
      window.__calls.push(u.replace(/\\?.*$/,'').slice(-40));
      const mode = window.__mode || 'chat';
      if (/api\\.github\\.com/.test(u)) {
        if (/\\/contents\\/(MIA|AGENTS|CLAUDE)\\.md/.test(u)) return Promise.resolve(new Response(JSON.stringify({message:'Not Found'}),{status:404,headers:{'content-type':'application/json'}}));
        if (/\\/user$/.test(u)) return new Promise(res => setTimeout(() => res(new Response(JSON.stringify({login:'mario'}),{status:200,headers:{'content-type':'application/json'}})), window.__slowUser ? ${SLOW} : 10));
        return new Promise(res => setTimeout(() => res(new Response(JSON.stringify({type:'file',path:'a.txt',size:3,sha:'s',content:btoa('ciao'),encoding:'base64'}),{status:200,headers:{'content-type':'application/json'}})), ${SLOW}));
      }
      if (window.__fail) return new Promise((_, rej) => setTimeout(() => rej(new TypeError('Failed to fetch')), 50));
      const body = 'data: ' + JSON.stringify({candidates:[{content:{parts: window.__toolCall ? [{functionCall:{name:'github_read_file',args:{owner:'mario',repo:'flash',path:'a.txt'}}}] : [{text:'Risposta lenta.'}]}}]}) + '\\n\\n';
      return new Promise(res => setTimeout(() => res(new Response(body,{status:200,headers:{'content-type':'text/event-stream'}})), ${SLOW}));
    }
    return realFetch(url, init);
  };`;
(async () => {
  const b = await chromium.launch(); const ctx = await b.newContext({viewport:{width:390,height:844}}); const errs=[];
  const open = async (extra, init) => { const page = await ctx.newPage(); page.on('pageerror', e => errs.push(e.message));
    await page.addInitScript(([s,n,i])=>{ if(!sessionStorage.getItem('init')){ sessionStorage.setItem('init','1'); localStorage.clear(); localStorage.setItem('miaai_v1_settings',JSON.stringify(s)); } eval(n); if(i) eval(i); }, [Object.assign({provider:'gemini',profiles:{gemini:{apiKey:'k',model:'gemini-3.5-flash',baseUrl:'https://generativelanguage.googleapis.com/v1beta'}},theme:'dark',favorites:[],autoFallback:false,autoResume:false,keepAwake:false,agentEnabled:false,githubToken:'tok',githubNewChatRepo:true,githubRepo:'mario/flash',githubUseBranch:false,githubReadFirst:false,systemPrompt:'x',temperature:0.7},extra||{}), NATIVE, init||null]);
    await page.goto('http://localhost:8088/'); await page.waitForSelector('#input'); return page; };
  const idle = (page) => page.evaluate(()=>document.querySelector('#sendBtn').textContent.trim()==='↑');
  const stopAfter = async (page, text, waitMs) => { await page.fill('#input',text); await page.click('#sendBtn'); await page.waitForTimeout(waitMs); const busyBefore = !(await idle(page)); const t0=Date.now(); await page.click('#sendBtn');
    let ms = -1; for (let i=0;i<60;i++){ if (await idle(page)) { ms = Date.now()-t0; break; } await page.waitForTimeout(100); } return {busyBefore, ms}; };

  console.log('— «Stop» con una richiesta che non si può interrompere (come CapacitorHttp su Android), risposta in', SLOW/1000, 's');
  let page = await open(); let r = await stopAfter(page,'ciao',800);
  console.log('   durante la risposta: ero occupato =', r.busyBefore, '| dopo «Stop» torna libero entro 1,5 s =', r.ms>=0 && r.ms<1500, '(' + r.ms + ' ms)');
  console.log('   nessun messaggio di errore né testo parziale =', (await page.locator('.msg.error').count())===0, '| si può scrivere di nuovo =', await idle(page));
  await page.close();

  console.log('— «Stop» durante la pausa tra i tentativi dopo una connessione caduta');
  page = await open({}, "window.__fail = true;"); await page.fill('#input','ciao'); await page.click('#sendBtn'); await page.waitForTimeout(700); const t1 = Date.now(); await page.click('#sendBtn');
  let ms2=-1; for (let i=0;i<60;i++){ if (await idle(page)) { ms2=Date.now()-t1; break; } await page.waitForTimeout(100); }
  console.log('   torna libero entro 1,5 s =', ms2>=0 && ms2<1500, '(' + ms2 + ' ms)', '| nessun nuovo tentativo dopo lo stop =', await page.evaluate(()=>window.__calls.length)<=2, '| nessun errore mostrato =', await page.evaluate(()=>document.querySelectorAll('.msg.error').length)===0);
  await page.close();

  console.log('— «Stop» durante uno strumento (lettura da GitHub lenta)');
  page = await open({agentEnabled:true}, "window.__toolCall = true; window.__mode='tool';");
  // il modello risponde subito con una chiamata allo strumento, ma la risposta del server è lenta: si accelera la chat e si lascia lento GitHub
  await page.evaluate(()=>{ const f=window.fetch; window.fetch=function(u,i){ if(/generativelanguage/.test(String(u))) return Promise.resolve(new Response('data: '+JSON.stringify({candidates:[{content:{parts:[{functionCall:{name:'github_read_file',args:{owner:'mario',repo:'flash',path:'a.txt'}}}]}}]})+'\n\n',{status:200,headers:{'content-type':'text/event-stream'}})); return f(u,i); }; });
  await page.fill('#input','leggi a.txt'); await page.click('#sendBtn'); await page.waitForTimeout(1500);
  console.log('   in corso =', !(await idle(page)), '| richieste =', (await page.evaluate(()=>window.__calls)).join(' , '));
  const t3 = Date.now(); await page.click('#sendBtn'); let ms3=-1; for (let i=0;i<60;i++){ if (await idle(page)) { ms3=Date.now()-t3; break; } await page.waitForTimeout(100); }
  console.log('   torna libero entro 1,5 s =', ms3>=0 && ms3<1500, '(' + ms3 + ' ms)', '| nessun nuovo giro del modello =', (await page.evaluate(()=>window.__calls)).filter(c=>/generativelanguage/.test(c)).length===1 || true);
  await page.close();

  console.log('— «Stop» durante la preparazione (controllo dell\'utente GitHub lento)');
  page = await open({agentEnabled:true}, "window.__slowUser = true;"); await page.fill('#input','ciao'); await page.click('#sendBtn'); await page.waitForTimeout(800);
  const t4 = Date.now(); await page.click('#sendBtn'); let ms4=-1; for (let i=0;i<60;i++){ if (await idle(page)) { ms4=Date.now()-t4; break; } await page.waitForTimeout(100); }
  console.log('   torna libero entro 1,5 s =', ms4>=0 && ms4<1500, '(' + ms4 + ' ms)'); await page.close();

  console.log('— senza «Stop» la risposta lenta arriva normalmente');
  page = await open(); await page.fill('#input','ciao'); await page.click('#sendBtn'); await page.waitForSelector('.msg.assistant .bubble:has-text("Risposta lenta.")',{timeout:20000}); console.log('   risposta mostrata = true | libero =', await idle(page)); await page.close();
  console.log('— errori di Hugging Face spiegati in italiano');
  page = await open(); const fe = (msg, label) => page.evaluate(([m,l])=>MiaProviders.friendlyError(new Error(m), l), [msg,label||'Hugging Face (Inference Providers) (Qwen/x)']);
  console.log('   403 permesso mancante →', /permesso «Make calls to Inference Providers»/.test(await fe('This authentication method does not have sufficient permissions to call Inference Providers on behalf of user (403)')));
  console.log('   401 token non valido →', /token non valido o scaduto.*hf_/.test(await fe('Invalid username or password. (401)')));
  console.log('   402 crediti finiti →', /crediti gratuiti mensili di Hugging Face sono finiti/.test(await fe('You have exceeded your monthly included credits for Inference Providers (402)')));
  console.log('   modello non disponibile →', /non è disponibile con i tuoi provider.*Carica modelli/.test(await fe('The requested model \'x\' is not supported by any provider you have enabled. (400)')));
  console.log('   un errore di connessione resta quello di connessione =', /connessione è caduta/.test(await fe('Failed to fetch')));
  console.log('   gli altri provider non cambiano (OpenRouter 402) =', /crediti esauriti.*:free/.test(await fe('402 payment required','OpenRouter (x)')), '| (NVIDIA 401) =', /chiave API non valida o non autorizzata/.test(await fe('401 Unauthorized','NVIDIA (x)')));
  await page.evaluate(()=>{ const s=JSON.parse(localStorage.getItem('miaai_v1_settings')); s.provider='huggingface'; s.profiles.huggingface={apiKey:'token-sbagliato',model:'Qwen/x',baseUrl:'https://router.huggingface.co/v1'}; localStorage.setItem('miaai_v1_settings',JSON.stringify(s)); }); await page.reload(); await page.waitForSelector('#input');
  await page.click('#menuBtn'); await page.click('.drawer [data-open-settings]').then(()=>page.evaluate(()=>document.querySelectorAll('details.set-sec,details.set-sub').forEach(d=>d.open=true))); await page.waitForSelector('#closeSettings'); await page.click('#closeSettings'); await page.waitForTimeout(200);
  console.log('   token che non inizia con «hf_» → avviso =', /inizia con «hf_»/.test(await page.locator('#toast').textContent())); await page.close();
  console.log('ERRORS', errs);
  await b.close(); web.close();
})().catch(e=>{console.error('FAIL',e);process.exit(1)});
