/* Test end-to-end di Mia AI. Tutti i servizi esterni sono simulati: nessuna chiamata reale. Vedi tests/README.md */
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const TMP = fs.mkdtempSync(path.join(require('os').tmpdir(), 'mia-test-'));
const root = path.resolve(__dirname, '..', '..');
const mime = { '.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.webmanifest':'application/json' };
const web = http.createServer((q,r)=>{ let p=q.url.split('?')[0]; if(p==='/')p='/index.html'; const f=path.join(root,p); fs.readFile(f,(e,d)=>{ if(e){r.writeHead(404);r.end();return;} r.writeHead(200,{'content-type':mime[path.extname(f)]||'application/octet-stream'}); r.end(d);});}).listen(8084);
const cors={'access-control-allow-origin':'*','access-control-allow-headers':'*','access-control-allow-methods':'*'};
const sse=(deltas)=>deltas.map(d=>'data: '+JSON.stringify({choices:[{delta:d}]})+'\n\n').join('')+'data: [DONE]\n\n';
(async () => {
  const b = await chromium.launch(); const ctx = await b.newContext({viewport:{width:390,height:844}}); const page = await ctx.newPage(); const errs=[];
  page.on('pageerror', e => errs.push(e.message));
  const seen = {}; let reply = ()=>[{content:'Ciao dal provider.'}];
  const HOSTS = {'integrate.api.nvidia.com':'nvidia','api.mistral.ai':'mistral','api.sambanova.ai':'sambanova','router.huggingface.co':'huggingface'};
  for (const host of Object.keys(HOSTS)) await ctx.route('https://'+host+'/**', async route => {
    const r=route.request(); if (r.method()==='OPTIONS') return route.fulfill({status:204,headers:cors});
    const u=new URL(r.url()); const key=HOSTS[host]; (seen[key]=seen[key]||[]).push({path:u.pathname, auth:r.headers()['authorization'], body:r.postData()?JSON.parse(r.postData()):null});
    if (u.pathname.endsWith('/models')) return route.fulfill({status:200,headers:{...cors,'content-type':'application/json'},body:JSON.stringify({data:[{id:key+'/llama-3.3-70b-instruct'},{id:key+'/nv-embedqa-e5-v5'},{id:key+'/rerank-qa-mistral-4b'},{id:key+'/llama-3.2-11b-vision-instruct'},{id:key+'/llama-guard-3-8b'}]})});
    return route.fulfill({status:200,headers:{...cors,'content-type':'text/event-stream'},body:sse(reply())});
  });
  await page.addInitScript(() => { if (!localStorage.getItem('miaai_v1_settings')) localStorage.setItem('miaai_v1_settings', JSON.stringify({provider:'gemini',profiles:{},theme:'dark',favorites:[]})); });
  await page.goto('http://localhost:8084/');
  await page.waitForSelector('#settings:not([hidden])', {timeout:3000}).catch(()=>{});
  if (await page.locator('#settings').isHidden()) { await page.click('#menuBtn').catch(()=>{}); await page.click('#drawer [data-open-settings]'); await page.waitForSelector('#settings:not([hidden])'); }
  console.log('provider nel menu:', await page.evaluate(()=>[...document.querySelectorAll('#provider option')].map(o=>o.textContent).join(' | ')));
  for (const id of ['nvidia','mistral','sambanova','huggingface']) {
    await page.selectOption('#provider', id);
    const f = await page.evaluate(()=>({url:document.querySelector('#baseUrl').value, hint:document.querySelector('#providerHint').textContent.slice(0,70), link:(document.querySelector('#providerHint a')||{}).href||''}));
    console.log(id.padEnd(12),'URL:',f.url,'| guida:',f.hint || '(link) '+f.link);
  }
  // NVIDIA: chiave, carica modelli, scegli, chiudi
  await page.selectOption('#provider','nvidia'); await page.fill('#apiKey','nvapi-TEST123');
  await page.click('#loadModels'); await page.waitForSelector('#modelResults li button');
  const models = await page.evaluate(()=>[...document.querySelectorAll('#modelResults button')].map(b=>b.dataset.model));
  console.log('modelli NVIDIA mostrati:', models.join(', '), '| (embed/rerank/guard esclusi)');
  console.log('  richiesta modelli: path', seen.nvidia[0].path, '| auth', seen.nvidia[0].auth);
  console.log('  etichetta «gratis» nascosta se nessun modello gratuito:', await page.evaluate(()=>document.querySelector('#onlyFree').parentElement.hidden));
  await page.click('#modelResults button[data-model="nvidia/llama-3.3-70b-instruct"]');
  // Mistral: chiave diversa, profili separati
  await page.selectOption('#provider','mistral'); await page.fill('#apiKey','mk-999'); await page.fill('#model','mistral-small-latest');
  await page.selectOption('#provider','nvidia');
  console.log('profili separati: NVIDIA mantiene chiave =', await page.inputValue('#apiKey'), '| modello =', await page.inputValue('#model'));
  await page.click('#closeSettings');
  console.log('intestazione:', (await page.textContent('#modelHint')).trim());
  // chat con NVIDIA
  await page.fill('#input','ciao'); await page.click('#sendBtn'); await page.waitForSelector('.bubble:has-text("Ciao dal provider")',{timeout:8000});
  const chat = seen.nvidia.find(x=>x.path.endsWith('/chat/completions'));
  console.log('chat NVIDIA: path', chat.path, '| modello', chat.body.model, '| stream', chat.body.stream, '| auth', chat.auth, '| tag:', (await page.locator('.model-tag').last().textContent()).trim());

  // Mistral: id delle chiamate strumenti
  await page.evaluate(()=>{ localStorage.setItem('miaai_v1_settings', JSON.stringify({provider:'mistral',profiles:{mistral:{apiKey:'mk-999',model:'mistral-small-latest'}},agentEnabled:true,autoFallback:false,favorites:[],theme:'dark'})); localStorage.removeItem('miaai_v1_conversations'); localStorage.removeItem('miaai_v1_current'); });
  await page.reload();
  let n=0; reply = () => (++n===1) ? [{tool_calls:[{index:0,id:'call_mk4x9z2b7q1c',function:{name:'notes',arguments:'{"action":"list"}'}}]}] : [{content:'Nessuna nota.'}];
  await page.fill('#input','elenca le note'); await page.click('#sendBtn'); await page.waitForSelector('.bubble:has-text("Nessuna nota")',{timeout:10000});
  const calls = seen.mistral.filter(x=>x.path.endsWith('/chat/completions'));
  const second = calls[1].body.messages; const asst = second.find(m=>m.tool_calls); const tool = second.find(m=>m.role==='tool');
  const idA = asst.tool_calls[0].id, idT = tool.tool_call_id;
  console.log('Mistral: id nel messaggio assistente =', idA, '| id nel risultato =', idT, '| uguali =', idA===idT, '| 9 caratteri alfanumerici =', /^[A-Za-z0-9]{9}$/.test(idA));
  // stesso scenario su NVIDIA: gli id restano quelli originali
  await page.evaluate(()=>{ localStorage.setItem('miaai_v1_settings', JSON.stringify({provider:'nvidia',profiles:{nvidia:{apiKey:'nvapi-T',model:'nvidia/llama-3.3-70b-instruct'}},agentEnabled:true,autoFallback:false,favorites:[],theme:'dark'})); localStorage.removeItem('miaai_v1_conversations'); localStorage.removeItem('miaai_v1_current'); });
  await page.reload(); seen.nvidia.length=0; n=0;
  await page.fill('#input','elenca le note'); await page.click('#sendBtn'); await page.waitForSelector('.bubble:has-text("Nessuna nota")',{timeout:10000});
  const nv = seen.nvidia.filter(x=>x.path.endsWith('/chat/completions'))[1].body.messages; console.log('NVIDIA: id invariato =', nv.find(m=>m.tool_calls).tool_calls[0].id, '| strumenti dichiarati:', seen.nvidia.filter(x=>x.path.endsWith('/chat/completions'))[0].body.tools.length);
  // cambio rapido fra provider
  await page.click('#modelBtn'); await page.waitForSelector('#picker:not([hidden])');
  console.log('cambio rapido contiene:', await page.evaluate(()=>[...document.querySelectorAll('#pickerList .pick')].map(b=>b.textContent.replace(/\s+/g,' ').trim()).join(' | ')));
  console.log('ERRORS', errs);
  await b.close(); web.close();
})().catch(e=>{console.error('FAIL',e);process.exit(1)});
