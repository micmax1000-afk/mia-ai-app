/* Test end-to-end di Mia AI. Tutti i servizi esterni sono simulati: nessuna chiamata reale. Vedi tests/README.md */
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const TMP = fs.mkdtempSync(path.join(require('os').tmpdir(), 'mia-test-'));
const root = path.resolve(__dirname, '..', '..');
const mime = { '.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.webmanifest':'application/json' };
const web = http.createServer((q,r)=>{ let p=q.url.split('?')[0]; if(p==='/')p='/index.html'; const f=path.join(root,p); fs.readFile(f,(e,d)=>{ if(e){r.writeHead(404);r.end();return;} r.writeHead(200,{'content-type':mime[path.extname(f)]||'application/octet-stream'}); r.end(d);});}).listen(8075);
const PNG='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const cors={'access-control-allow-origin':'*','access-control-allow-headers':'*','access-control-allow-methods':'*'};
(async () => {
  const b = await chromium.launch(); const ctx = await b.newContext(); const page = await ctx.newPage();
  let allowed = ['prompt','width','height','seed','steps']; let maxPrompt = 1e9; let always422 = false; const bodies=[];
  await ctx.route('https://ai.api.nvidia.com/**', async route => { const r=route.request(); if(r.method()==='OPTIONS') return route.fulfill({status:204,headers:cors}); const body=JSON.parse(r.postData()); bodies.push(body);
    const errs=[]; // formato FastAPI/pydantic v2 come nello screenshot: elenco in «detail», un errore per campo
    Object.keys(body).forEach(k=>{ if(!allowed.includes(k)) errs.push({type:'extra_forbidden',loc:['body',k],msg:'Extra inputs are not permitted',input:body[k]}); });
    if (body.prompt && body.prompt.length>maxPrompt) errs.push({type:'string_too_long',loc:['body','prompt'],msg:'String should have at most '+maxPrompt+' characters',input:body.prompt});
    if (always422) errs.push({type:'value_error',loc:['body','steps'],msg:'sempre errato'});
    if (errs.length) return route.fulfill({status:422,headers:{...cors,'content-type':'application/json'},body:JSON.stringify({detail:errs})});
    route.fulfill({status:200,headers:{...cors,'content-type':'application/json'},body:JSON.stringify({artifacts:[{base64:PNG,finishReason:'SUCCESS',seed:0}]})}); });
  await page.goto('http://localhost:8075/');
  const run = (prompt='a red fox') => page.evaluate(async (prompt) => { try { const r = await MiaTools.run('generate_image',{prompt},{imageProvider:'nvidia',nvidiaKey:'nvapi-X'}); return {ok:true,file:r.files[0].name+' '+r.files[0].blob.size+'B'}; } catch(e){ return {ok:false,error:e.message}; } }, prompt);
  const t = async (nome, cfg, prompt) => { allowed=cfg.allowed||allowed; maxPrompt=cfg.maxPrompt||1e9; always422=!!cfg.always; bodies.length=0; const r=await run(prompt); console.log(nome.padEnd(38), r.ok?'OK  '+r.file:'ERR '+r.error.slice(0,230)); console.log('   richieste:', bodies.length, '| ultima:', JSON.stringify(bodies[bodies.length-1]).slice(0,110)); };
  await t('tutti i campi ammessi', {allowed:['prompt','width','height','seed','steps']});
  await t('seed rifiutato (caso dello screenshot)', {allowed:['prompt','width','height','steps']});
  await t('seed, width e height rifiutati', {allowed:['prompt','steps']});
  await t('ammesso solo il prompt', {allowed:['prompt']});
  await t('prompt troppo lungo (non risolvibile)', {allowed:['prompt','steps'], maxPrompt:20}, 'una descrizione molto molto lunga per il modello');
  await t('errore che non si risolve mai', {allowed:['prompt','width','height','seed','steps'], always:true});
  await b.close(); web.close();
})().catch(e=>{console.error('FAIL',e);process.exit(1)});
