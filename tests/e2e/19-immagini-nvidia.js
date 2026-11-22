/* Test end-to-end di Mia AI. Tutti i servizi esterni sono simulati: nessuna chiamata reale. Vedi tests/README.md */
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const TMP = fs.mkdtempSync(path.join(require('os').tmpdir(), 'mia-test-'));
const root = path.resolve(__dirname, '..', '..');
const mime = { '.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.webmanifest':'application/json' };
const web = http.createServer((q,r)=>{ let p=q.url.split('?')[0]; if(p==='/')p='/index.html'; const f=path.join(root,p); fs.readFile(f,(e,d)=>{ if(e){r.writeHead(404);r.end();return;} r.writeHead(200,{'content-type':mime[path.extname(f)]||'application/octet-stream'}); r.end(d);});}).listen(8076);
const PNG='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const JPG=Buffer.from([0xff,0xd8,0xff,0xe0,0,16,0x4a,0x46,0x49,0x46,0,1,1,0,0,1,0,1,0,0,0xff,0xd9]).toString('base64');
const cors={'access-control-allow-origin':'*','access-control-allow-headers':'*','access-control-allow-methods':'*'};
(async () => {
  const b = await chromium.launch(); const ctx = await b.newContext({viewport:{width:390,height:844}}); const page = await ctx.newPage(); const errs=[]; page.on('pageerror', e => errs.push(e.message));
  let nv = {mode:'ok', bodies:[], auth:null}; let gm = {mode:'ok', n:0};
  await ctx.route('https://ai.api.nvidia.com/**', async route => { const r=route.request(); if(r.method()==='OPTIONS') return route.fulfill({status:204,headers:cors}); nv.bodies.push(JSON.parse(r.postData())); nv.auth=r.headers()['authorization']; const J=(o,st=200)=>route.fulfill({status:st,headers:{...cors,'content-type':'application/json'},body:JSON.stringify(o)});
    switch(nv.mode){
      case 'artifacts': return J({artifacts:[{base64:PNG,finishReason:'SUCCESS',seed:0}]});
      case 'image': return J({image:PNG});
      case 'openai': return J({data:[{b64_json:'data:image/png;base64,'+PNG}]});
      case 'jpeg': return J({artifacts:[{base64:JPG,finishReason:'SUCCESS'}]});
      case '422': return nv.bodies.length===1 ? J({detail:[{type:'extra_forbidden',loc:['body','width'],msg:'Extra inputs are not permitted'},{type:'extra_forbidden',loc:['body','height'],msg:'Extra inputs are not permitted'}]},422) : J({artifacts:[{base64:PNG,finishReason:'SUCCESS'}]});
      case 'filtered': return J({artifacts:[{base64:'',finishReason:'CONTENT_FILTERED'}]});
      case 'vuota': return J({qualcosa:1});
      case '401': return J({detail:'Authentication failed'},401);
      case '402': return J({detail:'Out of credits'},402);
      case '429': return J({detail:'Too many'},429);
      default: return J({artifacts:[{base64:PNG,finishReason:'SUCCESS'}]});
    } });
  await ctx.route('https://generativelanguage.googleapis.com/**', async route => { const r=route.request(); if(r.method()==='OPTIONS') return route.fulfill({status:204,headers:cors}); gm.n++; if(gm.mode==='429') return route.fulfill({status:429,headers:{...cors,'content-type':'application/json'},body:'{"error":{"message":"Quota exceeded"}}'}); route.fulfill({status:200,headers:{...cors,'content-type':'application/json'},body:JSON.stringify({candidates:[{content:{parts:[{inlineData:{mimeType:'image/png',data:PNG}}]}}]})}); });
  await ctx.route('https://integrate.api.nvidia.com/**', async route => { const r=route.request(); if(r.method()==='OPTIONS') return route.fulfill({status:204,headers:cors}); route.fulfill({status:200,headers:{...cors,'content-type':'application/json'},body:JSON.stringify({data:['bigcode/starcoder2-15b','fastino/gliner2-pii','google/gemma-3-12b-it','google/gemma-3-4b-it','google/gemma-4-31b-it','meta/muse-glimmer-30b','minimaxai/minimax-m3.1-flash','mistralai/mistral-large-4-1t-a52b','moonshotai/kimi-k3.1-pro','nvidia/ai-synthetic-video-detector','nvidia/cosmos-reason2-8b','nvidia/ising-calibration-1.5-31b','nvidia/nemotron-3-nano-omni-30b-a3b-reasoning','nvidia/nemotron-3-ultra-550b-a55b','nvidia/nemotron-3.5-bolt-e4b','nvidia/nemotron-3.5-lightning-30b-a3b','nvidia/nemotron-3.5-super-vl-120b-a12b','nvidia/nvclip','nvidia/riva-translate-4b-instruct-v2','poolside/laguna-xs-2.1','stepfun-ai/step-5-preview','z-ai/glm-5.3-flash','nvidia/llama-3.3-nemotron-70b-reward','nvidia/nv-embedqa-e5-v5','nvidia/parakeet-ctc-1.1b-asr','nvidia/llama-3.1-nemoguard-8b-content-safety'].map(id=>({id}))})}); });
  await ctx.route('https://image.pollinations.ai/**', (route) => route.abort('failed'));
  await page.addInitScript(() => { if (!localStorage.getItem('miaai_v1_settings')) localStorage.setItem('miaai_v1_settings', JSON.stringify({provider:'nvidia',profiles:{nvidia:{apiKey:'nvapi-X',model:'nvidia/nemotron-3.5-super-vl-120b-a12b'},gemini:{apiKey:'gk'}},theme:'dark',favorites:[],agentEnabled:true})); });
  await page.goto('http://localhost:8076/');
  const run = (c, a={}) => page.evaluate(async ([c,a]) => { try { const r = await MiaTools.run('generate_image',{prompt:'a red fox in snow',...a},c); const f=r.files[0]; return {ok:true,text:r.text.split('\n').slice(-1)[0].slice(0,170),file:f.name+' '+f.mime+' '+f.blob.size+'B'}; } catch(e){ return {ok:false,error:e.message}; } }, [c,a]);
  const show=(t,r)=>console.log(t.padEnd(30), r.ok?'OK  '+r.file+' | '+r.text:'ERR '+r.error.slice(0,260));
  const C = (o={}) => ({imageProvider:'auto',nvidiaKey:'nvapi-X',geminiKey:'gk',...o});
  console.log('— NVIDIA FLUX: formati di risposta');
  nv.mode='artifacts'; nv.bodies=[]; show('artifacts[0].base64', await run(C({imageProvider:'nvidia'})));
  console.log('   richiesta:', JSON.stringify(nv.bodies[0]), '| auth:', nv.auth);
  nv.mode='image'; show('campo image', await run(C({imageProvider:'nvidia'})));
  nv.mode='openai'; show('data[0].b64_json (+prefisso)', await run(C({imageProvider:'nvidia'})));
  nv.mode='jpeg'; show('JPEG riconosciuto dai byte', await run(C({imageProvider:'nvidia'})));
  nv.mode='422'; nv.bodies=[]; show('422 → richiesta minima', await run(C({imageProvider:'nvidia'}))); console.log('   corpi inviati:', JSON.stringify(nv.bodies));
  console.log('— NVIDIA FLUX: errori');
  for (const m of ['filtered','vuota','401','402','429']) { nv.mode=m; show(m, await run(C({imageProvider:'nvidia'}))); }
  console.log('— scelta del servizio');
  nv.mode='artifacts'; gm={mode:'ok',n:0}; show('auto: NVIDIA ok', await run(C())); console.log('   chiamate a Gemini:', gm.n);
  nv.mode='402'; gm={mode:'ok',n:0}; show('auto: NVIDIA 402 → Gemini', await run(C())); console.log('   chiamate a Gemini:', gm.n);
  nv.mode='402'; gm={mode:'429',n:0}; show('auto: falliscono entrambe', await run(C()));
  nv.mode='artifacts'; gm={mode:'ok',n:0}; show('auto: solo chiave Gemini', await run(C({nvidiaKey:''}))); console.log('   chiamate a Gemini:', gm.n);
  nv.bodies=[]; show('auto: solo chiave NVIDIA', await run(C({geminiKey:''}))); console.log('   chiamate a NVIDIA:', nv.bodies.length);
  show('gemini esplicito', await run(C({imageProvider:'gemini'})));
  show('nessuna chiave', await run(C({nvidiaKey:'',geminiKey:''})));
  show('nvidia esplicito senza chiave', await run(C({imageProvider:'nvidia',nvidiaKey:''})));
  // impostazioni
  await page.click('#menuBtn'); await page.click('#drawer [data-open-settings]'); await page.waitForSelector('#settings:not([hidden])');
  console.log('— impostazioni: scelte =', await page.evaluate(()=>[...document.querySelectorAll('#imageProvider option')].map(o=>o.value).join(',')), '| predefinita =', await page.inputValue('#imageProvider'));
  await page.selectOption('#imageProvider','nvidia');
  // modelli NVIDIA
  await page.selectOption('#provider','nvidia'); await page.fill('#apiKey','nvapi-X'); await page.click('#loadModels'); await page.waitForSelector('#modelResults li button');
  const shown = await page.evaluate(()=>[...document.querySelectorAll('#modelResults button')].map(b=>b.dataset.model));
  console.log('— elenco modelli NVIDIA: mostrati', shown.length, 'su 26'); console.log('   NASCOSTI:', ['bigcode/starcoder2-15b','fastino/gliner2-pii','nvidia/ai-synthetic-video-detector','nvidia/ising-calibration-1.5-31b','nvidia/nvclip','nvidia/llama-3.3-nemotron-70b-reward','nvidia/nv-embedqa-e5-v5','nvidia/parakeet-ctc-1.1b-asr','nvidia/llama-3.1-nemoguard-8b-content-safety','nvidia/riva-translate-4b-instruct-v2'].map(x=>x+(shown.includes(x)?' (!! ancora visibile)':' ok')).join('\n            '));
  console.log('   MOSTRATI:', shown.join(', '));
  await page.click('#closeSettings'); console.log('   salvato imageProvider =', await page.evaluate(()=>JSON.parse(localStorage.getItem('miaai_v1_settings')).imageProvider));
  console.log('ERRORS', errs);
  await b.close(); web.close();
})().catch(e=>{console.error('FAIL',e);process.exit(1)});
