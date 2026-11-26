/* Test end-to-end di Mia AI. Tutti i servizi esterni sono simulati: nessuna chiamata reale. Vedi tests/README.md */
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const TMP = fs.mkdtempSync(path.join(require('os').tmpdir(), 'mia-test-'));
const { createServer } = require('../../bridge/mia-bridge.js');
const root = path.resolve(__dirname, '..', '..');
const mime = { '.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.webmanifest':'application/json' };
const web = http.createServer((q,r)=>{ let p=q.url.split('?')[0]; if(p==='/')p='/index.html'; const f=path.join(root,p); fs.readFile(f,(e,d)=>{ if(e){r.writeHead(404);r.end();return;} r.writeHead(200,{'content-type':mime[path.extname(f)]||'application/octet-stream'}); r.end(d);});}).listen(8087);
const BR = path.join(TMP,'broot2'); fs.mkdirSync(path.join(BR,'src'),{recursive:true}); fs.writeFileSync(path.join(BR,'src','note.txt'),'riga uno\nriga due\nriga tre\n');
const bridge = createServer({root: fs.realpathSync(BR), token:'tokenbridge-lungo-123', readonly:false}).listen(8786,'127.0.0.1');
const sse = (parts) => 'data: ' + JSON.stringify({candidates:[{content:{parts}}]}) + '\n\n';
(async () => {
  const b = await chromium.launch(); const ctx = await b.newContext({viewport:{width:390,height:844}}); const page = await ctx.newPage(); const errs=[];
  page.on('pageerror', e => errs.push(e.message));
  let script=[]; const gem=[]; const gh=[]; let ghFile = 'uno\nrepeat\nrepeat\ndue\ntre\n';
  await ctx.route('https://generativelanguage.googleapis.com/**', async route => { gem.push(JSON.parse(route.request().postData())); const next = script.shift() || [{text:'fine'}]; await route.fulfill({status:200, headers:{'content-type':'text/event-stream','access-control-allow-origin':'*'}, body: sse(next)}); });
  const cors = {'access-control-allow-origin':'*','access-control-allow-headers':'*','access-control-allow-methods':'*'};
  await ctx.route('https://api.github.com/**', async route => {
    const req=route.request(), u=new URL(req.url()); if (req.method()==='OPTIONS') return route.fulfill({status:204,headers:cors});
    gh.push(req.method()+' '+u.pathname+(req.postData()?' '+req.postData():''));
    const j=(o,s=200)=>route.fulfill({status:s,headers:{...cors,'content-type':'application/json'},body:JSON.stringify(o)});
    if (u.pathname==='/user') return j({login:'mario'});
    if (u.pathname==='/repos/mario/app/contents/f.txt' && req.method()==='GET') return j({type:'file',sha:'s1',content:Buffer.from(ghFile).toString('base64')});
    if (u.pathname==='/repos/mario/app/contents/f.txt' && req.method()==='PUT') return j({commit:{sha:'abcdef12'}});
    return j({message:'Not Found'},404);
  });
  await ctx.route('https://api.tavily.com/**', async route => { const r=route.request(); if (r.method()==='OPTIONS') return route.fulfill({status:204,headers:cors}); const auth=r.headers()['authorization']; if (auth!=='Bearer buona') return route.fulfill({status:401,headers:{...cors,'content-type':'application/json'},body:'{"detail":{"error":"Unauthorized"}}'}); route.fulfill({status:200,headers:{...cors,'content-type':'application/json'},body:JSON.stringify({answer:'Roma ha 2,8 milioni di abitanti.',results:[{title:'Roma - Wikipedia',url:'https://it.wikipedia.org/wiki/Roma',content:'Roma è la capitale d\'Italia…'}]})}); });

  const base = {provider:'gemini',profiles:{gemini:{apiKey:'k',model:'gemini-3.6-flash'}},autoFallback:false,favorites:[],theme:'dark',githubToken:'tok',githubNewChatRepo:true,githubRepo:'mario/app',agentEnabled:true};
  await page.addInitScript((s) => { if (!localStorage.getItem('miaai_v1_settings')) localStorage.setItem('miaai_v1_settings', JSON.stringify(s)); }, base);
  await page.goto('http://localhost:8087/');
  const run = (name,args,c={}) => page.evaluate(async ([name,args,c]) => { try { const r = await MiaTools.run(name,args,{token:'tok',...c}); return {ok:true,text:r.text}; } catch(e){ return {ok:false,error:e.message}; } }, [name,args,c]);
  const show = (t,r) => console.log(t.padEnd(22), r.ok?'OK ':'ERR', JSON.stringify(r.ok?r.text:r.error).slice(0,200));

  console.log('— github_edit_file');
  const E = (edits, extra={}) => run('github_edit_file', {owner:'mario',repo:'app',path:'f.txt',message:'m',edits,...extra});
  show('modifica unica', await E([{old_text:'due',new_text:'DUE'}]));
  const put = gh.find(x=>x.startsWith('PUT')); console.log('  contenuto inviato:', JSON.stringify(Buffer.from(JSON.parse(put.split(' ').slice(2).join(' ')).content,'base64').toString()), '| sha usato:', JSON.parse(put.split(' ').slice(2).join(' ')).sha);
  show('testo duplicato', await E([{old_text:'repeat',new_text:'x'}]));
  show('testo assente', await E([{old_text:'zzz',new_text:'x'}]));
  show('nessun cambio', await E([{old_text:'uno',new_text:'uno'}]));
  gh.length=0; ghFile='a\r\nb\r\nc\r\n'; show('file con a-capo CRLF', await E([{old_text:'a\nb',new_text:'A\nB'}]));
  const put2 = gh.find(x=>x.startsWith('PUT')); console.log('  contenuto inviato:', JSON.stringify(Buffer.from(JSON.parse(put2.split(' ').slice(2).join(' ')).content,'base64').toString()));
  console.log('  richiede conferma:', await page.evaluate(()=>MiaTools.needsConfirm('github_edit_file',{})));

  console.log('— web_search');
  show('Tavily', await run('web_search',{query:'abitanti di Roma'},{searchProvider:'tavily',searchKey:'buona'}));
  show('Tavily chiave errata', await run('web_search',{query:'x'},{searchProvider:'tavily',searchKey:'no'}));
  show('senza chiave', await run('web_search',{query:'x'},{}));

  console.log('— piano + limite di passaggi (modello che non smette di usare strumenti)');
  const planCall = (n) => [{functionCall:{name:'update_plan',args:{steps:[{text:'Leggi',status:'done'},{text:'Scrivi',status:n%2?'in_progress':'pending'}]}}}];
  const send = async (t) => { await page.fill('#input', t); await page.click('#sendBtn'); };
  script = Array.from({length:20},(_,i)=>planCall(i)); const g0=gem.length;
  await send('fai un lavoro lungo'); await page.waitForSelector('.bubble:has-text("Mi fermo dopo 15")', {timeout:20000});
  console.log('  con limite 15 → richieste al modello:', gem.length-g0, '| schede piano:', await page.locator('.tool-card').count());
  console.log('  scheda piano:', (await page.locator('.tool-card summary').first().textContent()).trim());
  await page.locator('.tool-card summary').first().click(); console.log('  contenuto:', JSON.stringify((await page.locator('.tool-card pre').first().textContent()).replace(/\n+/g,' | ')));
  // limite alzato/abbassato dalle impostazioni
  await page.evaluate(()=>{ const s=JSON.parse(localStorage.getItem('miaai_v1_settings')); s.maxSteps=4; localStorage.setItem('miaai_v1_settings',JSON.stringify(s)); localStorage.removeItem('miaai_v1_conversations'); localStorage.removeItem('miaai_v1_current'); });
  await page.reload(); script = Array.from({length:20},(_,i)=>planCall(i)); const g1=gem.length;
  await send('altro lavoro'); await page.waitForSelector('.bubble:has-text("Mi fermo dopo 4")', {timeout:15000});
  console.log('  con limite 4  → richieste al modello:', gem.length-g1);

  console.log('— contesto: lavori lunghi con risultati grandi');
  await page.evaluate(()=>{ const s=JSON.parse(localStorage.getItem('miaai_v1_settings')); s.maxSteps=12; localStorage.setItem('miaai_v1_settings',JSON.stringify(s)); localStorage.removeItem('miaai_v1_conversations'); localStorage.removeItem('miaai_v1_current'); });
  await page.reload();
  const big = 'x'.repeat(9000);
  script = [...Array.from({length:10},(_,i)=>[{functionCall:{name:'run_javascript',args:{code:'return "'+big+'"'}}}]), [{text:'Finito.'}]]; const g2=gem.length;
  await send('RICHIESTA-ORIGINALE elabora tanto'); await page.waitForSelector('.bubble:has-text("Finito")', {timeout:25000});
  const last = gem[gem.length-1].contents;
  const resp = last.filter(c=>c.parts.some(p=>p.functionResponse)).flatMap(c=>c.parts.map(p=>String(p.functionResponse.response.result||'').length));
  console.log('  ultima richiesta: primo messaggio è la richiesta originale =', JSON.stringify(last[0]).includes('RICHIESTA-ORIGINALE'), '| lunghezze risultati strumenti:', resp.join(','));

  console.log('— Mia Bridge come connettore MCP (server vero)');
  await page.evaluate(()=>{ const s=JSON.parse(localStorage.getItem('miaai_v1_settings')); s.mcpServers=[{id:'b1',name:'Computer',url:'http://127.0.0.1:8786/mcp',token:'tokenbridge-lungo-123',enabled:true,disabled:[]}]; localStorage.setItem('miaai_v1_settings',JSON.stringify(s)); localStorage.removeItem('miaai_v1_conversations'); localStorage.removeItem('miaai_v1_current'); });
  await page.reload();
  script = [[{functionCall:{name:'mcp_computer_list_dir',args:{path:'src'}}}],[{functionCall:{name:'mcp_computer_edit_file',args:{path:'src/note.txt',old_text:'riga due',new_text:'RIGA 2'}}}],[{functionCall:{name:'mcp_computer_run_command',args:{command:'cat src/note.txt && echo ok'}}}],[{text:'Ho modificato il file e controllato.'}]];
  await send('cambia la seconda riga di src/note.txt e mostrami il file');
  const titles=[]; for (let i=0;i<2;i++){ await page.waitForSelector('#confirm:not([hidden])',{timeout:15000}); titles.push((await page.textContent('#confirmTitle')).trim()); if(i===1) await page.screenshot({path: path.join(TMP,'ui-bridge-confirm.png')}); await page.click('#confirmYes'); await page.waitForTimeout(500); }
  await page.waitForSelector('.bubble:has-text("Ho modificato")',{timeout:15000});
  console.log('  conferme chieste:', titles.join('  |  '), '(list_dir è di sola lettura: nessuna conferma)');
  console.log('  file sul computer:', JSON.stringify(fs.readFileSync(path.join(BR,'src/note.txt'),'utf8')));
  console.log('ERRORS', errs);
  await b.close(); web.close(); bridge.close();
})().catch(e=>{console.error('FAIL',e);process.exit(1)});
