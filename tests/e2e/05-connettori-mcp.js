/* Test end-to-end di Mia AI. Tutti i servizi esterni sono simulati: nessuna chiamata reale. Vedi tests/README.md */
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const TMP = fs.mkdtempSync(path.join(require('os').tmpdir(), 'mia-test-'));
const { srv: mcpSrv, log } = require('../lib/mock-mcp.js');
const root = path.resolve(__dirname, '..', '..');
const mime = { '.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.webmanifest':'application/json' };
const srv = http.createServer((q,r)=>{ let p=q.url.split('?')[0]; if(p==='/')p='/index.html'; const f=path.join(root,p); fs.readFile(f,(e,d)=>{ if(e){r.writeHead(404);r.end();return;} r.writeHead(200,{'content-type':mime[path.extname(f)]||'application/octet-stream'}); r.end(d);});}).listen(8091);
(async () => {
  const b = await chromium.launch(); const page = await b.newPage({viewport:{width:390,height:844}}); const errs=[];
  page.on('pageerror', e => errs.push(e.message));
  const gemBodies=[]; let n=0;
  await page.route('https://generativelanguage.googleapis.com/**', async route => {
    gemBodies.push(JSON.parse(route.request().postData())); n++;
    const parts = n===1 ? [{functionCall:{name:'mcp_mockmcp_add',args:{a:2,b:3}}}] : n===2 ? [{functionCall:{name:'mcp_mockmcp_create_note',args:{text:'ciao'}}}] : [{text:'Fatto con il connettore.'}];
    await route.fulfill({status:200, headers:{'content-type':'text/event-stream','access-control-allow-origin':'*'}, body:'data: '+JSON.stringify({candidates:[{content:{parts}}]})+'\n\n'});
  });
  const server = {id:'s1', name:'MockMCP', url:'http://localhost:8092/mcp', token:'segreto', enabled:true, disabled:['fail']};
  await page.addInitScript((server) => localStorage.setItem('miaai_v1_settings', JSON.stringify({provider:'gemini',profiles:{gemini:{apiKey:'k',model:'gemini-3.5-flash'}},agentEnabled:true,autoFallback:false,favorites:[],mcpServers:[server]})), server);
  await page.goto('http://localhost:8091/');

  const ev = (fn, arg) => page.evaluate(fn, arg);
  // 1) connessione e sessione
  const c = await ev(async (s) => { try { const r = await MiaMcp.connect(s); return {n:r.tools.length, info:r.info, names:r.tools.map(t=>t.name)} } catch(e){ return {err:e.message} } }, server);
  console.log('connect:', JSON.stringify(c));
  console.log('header inviati (auth/sessione/protocollo):', JSON.stringify(log.map(l=>[l.method,!!l.auth,l.sid,l.proto])));
  // 2) token sbagliato
  console.log('token errato:', await ev(async (s) => { try { await MiaMcp.connect({...s, id:'x', token:'no'}); return 'connesso?!' } catch(e){ return e.message } }, server));
  // 3) registrazione + schemi puliti
  const defs = await ev(async (s) => { const r = await MiaMcp.connect(s); MiaTools.setMcpTools(s, r.tools, s.disabled); return MiaTools.definitions().filter(d=>d.name.startsWith('mcp_')) }, server);
  console.log('strumenti registrati:', defs.map(d=>d.name));
  console.log('schema add:', JSON.stringify(defs.find(d=>d.name==='mcp_mockmcp_add').parameters));
  console.log('schema create_note:', JSON.stringify(defs.find(d=>d.name==='mcp_mockmcp_create_note').parameters));
  console.log('conferme:', JSON.stringify(await ev(() => ({add:MiaTools.needsConfirm('mcp_mockmcp_add',{}), note:MiaTools.needsConfirm('mcp_mockmcp_create_note',{}), ping:MiaTools.needsConfirm('mcp_mockmcp_ping',{})}))));
  // 4) esecuzione: sse, json, structuredContent, immagine, isError
  for (const [t,a] of [['mcp_mockmcp_add',{a:2,b:3}],['mcp_mockmcp_create_note',{text:'x'}],['mcp_mockmcp_ping',{}],['mcp_mockmcp_pic',{}],['mcp_mockmcp_fail',{}]]) {
    const r = await ev(async ([t,a]) => { try { const x = await MiaTools.run(t,a,{}); return {text:x.text, files:x.files.map(f=>f.name)} } catch(e){ return {err:e.message} } }, [t,a]);
    console.log(' ', t, JSON.stringify(r));
  }
  // 5) sessione scaduta → riconnessione automatica
  const exp = await ev(async (s) => { MiaMcp.cached(s); /* corrompe la sessione */ return true }, server);
  // 6) flusso in chat completo con conferma sulla scrittura
  log.length=0;
  await page.fill('#input','somma 2+3 e crea una nota'); await page.click('#sendBtn');
  await page.waitForSelector('#confirm:not([hidden])', {timeout:10000});
  console.log('conferma chiesta per:', await page.textContent('#confirmTitle'));
  await page.click('#confirmYes');
  await page.waitForSelector('.msg.assistant .bubble:has-text("Fatto con il connettore")', {timeout:10000});
  console.log('schede strumento:', await page.locator('.tool-card').count());
  console.log('strumenti dichiarati al modello:', gemBodies[0].tools[0].functionDeclarations.map(d=>d.name).filter(n=>n.startsWith('mcp_')));
  const ping = gemBodies[0].tools[0].functionDeclarations.find(d=>d.name==='mcp_mockmcp_ping');
  console.log('ping senza parametri →', JSON.stringify(ping));
  // 7) UI impostazioni
  await page.click('#menuBtn'); await page.click('#drawer [data-open-settings]').then(()=>page.evaluate(()=>document.querySelectorAll('details.set-sec,details.set-sub').forEach(d=>d.open=true)));
  await page.waitForSelector('.mcp-server');
  await page.click('.mcp-server .btn:has-text("Prova")');
  await page.waitForSelector('.mcp-status.ok');
  console.log('UI stato:', await page.textContent('.mcp-status'));
  await page.screenshot({path: path.join(TMP,'mcp.png')});
  console.log('ERRORS', errs);
  await b.close(); srv.close(); mcpSrv.close();
})().catch(e=>{console.error('FAIL',e);process.exit(1)});
