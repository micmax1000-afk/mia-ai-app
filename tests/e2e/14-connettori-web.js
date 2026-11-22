/* Test end-to-end di Mia AI. Tutti i servizi esterni sono simulati: nessuna chiamata reale. Vedi tests/README.md */
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const TMP = fs.mkdtempSync(path.join(require('os').tmpdir(), 'mia-test-'));
const root = path.resolve(__dirname, '..', '..');
const mime = { '.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.webmanifest':'application/json' };
const web = http.createServer((q,r)=>{ let p=q.url.split('?')[0]; if(p==='/')p='/index.html'; const f=path.join(root,p); fs.readFile(f,(e,d)=>{ if(e){r.writeHead(404);r.end();return;} r.writeHead(200,{'content-type':mime[path.extname(f)]||'application/octet-stream'}); r.end(d);});}).listen(8081);
const cors={'access-control-allow-origin':'*','access-control-allow-headers':'*','access-control-allow-methods':'*','access-control-expose-headers':'Mcp-Session-Id'};
const TOOLS=[{name:'web_search',description:'Cerca sul web',inputSchema:{type:'object',properties:{objective:{type:'string'},search_queries:{type:'array',items:{type:'string'}}},required:['objective']},annotations:{readOnlyHint:true}},{name:'web_fetch',description:'Legge una pagina',inputSchema:{type:'object',properties:{urls:{type:'array',items:{type:'string'}}}},annotations:{readOnlyHint:true}},{name:'send_feedback',description:'Feedback',inputSchema:{type:'object',properties:{text:{type:'string'}}}}];
(async () => {
  const b = await chromium.launch(); const ctx = await b.newContext({viewport:{width:390,height:844}}); const page = await ctx.newPage(); const errs=[]; page.on('pageerror', e => errs.push(e.message));
  let script=[]; const chat=[]; const mcpCalls=[];
  await ctx.route('https://search.parallel.ai/**', async route => { const r=route.request(); if(r.method()==='OPTIONS') return route.fulfill({status:204,headers:cors}); const m=JSON.parse(r.postData()); mcpCalls.push(m.method+(m.params&&m.params.name?':'+m.params.name:''));
    const J=(result)=>route.fulfill({status:200,headers:{...cors,'content-type':'application/json','mcp-session-id':'s1'},body:JSON.stringify({jsonrpc:'2.0',id:m.id,result})});
    if (m.method==='initialize') return J({protocolVersion:'2025-06-18',capabilities:{tools:{}},serverInfo:{name:'Parallel MCP',version:'1'}});
    if (m.method==='notifications/initialized') return route.fulfill({status:202,headers:cors});
    if (m.method==='tools/list') return J({tools:TOOLS});
    if (m.method==='tools/call') return J({content:[{type:'text',text:'Risultati: titolo A (https://a.example), titolo B (https://b.example)'}]});
    J({}); });
  await ctx.route('https://generativelanguage.googleapis.com/**', async route => { chat.push(JSON.parse(route.request().postData())); const next=script.shift()||[{text:'fine'}]; await route.fulfill({status:200,headers:{...cors,'content-type':'text/event-stream'},body:'data: '+JSON.stringify({candidates:[{content:{parts:next}}]})+'\n\n'}); });
  const base = (extra={}) => ({provider:'gemini',profiles:{gemini:{apiKey:'k',model:'gemini-3.6-flash'}},autoFallback:false,favorites:[],theme:'dark',agentEnabled:true,mcpServers:[{id:'p1',name:'parallel',url:'https://search.parallel.ai/mcp',token:'',enabled:true,disabled:[]}],...extra});
  const setup = async (s) => { await page.evaluate((s)=>{ localStorage.setItem('miaai_v1_settings',JSON.stringify(s)); localStorage.removeItem('miaai_v1_conversations'); localStorage.removeItem('miaai_v1_current'); }, s); await page.reload(); };
  await page.addInitScript(() => {});
  await page.goto('http://localhost:8081/');
  const ask = async (t) => { chat.length=0; script=[[{text:'ok'}]]; await page.fill('#input',t); await page.click('#sendBtn'); await page.waitForSelector('.bubble:has-text("ok")',{timeout:15000}); const decl = chat[0].tools[0].functionDeclarations.map(d=>d.name); return {decl, sys: chat[0].systemInstruction.parts[0].text}; };
  const hasW = (d)=>['web_search','read_webpage'].filter(n=>d.includes(n)).join('+')||'nessuno';
  const mcpW = (d)=>d.filter(n=>/parallel/.test(n)).join(', ');

  await setup(base());
  let r = await ask('ciao');
  console.log('1) connettore + preferenza attiva (predefinita):\n   strumenti web di Mia presenti =', hasW(r.decl), '| connettore:', mcpW(r.decl));
  console.log('   il prompt nomina lo strumento =', /mcp_parallel_web_search/.test(r.sys), '| e la lettura =', /mcp_parallel_web_fetch/.test(r.sys));
  await setup(base({preferMcpWeb:false})); r = await ask('ciao');
  console.log('2) preferenza spenta: strumenti web di Mia =', hasW(r.decl), '| prompt li nomina =', /Per cercare sul web usa lo strumento/.test(r.sys));
  await setup(base({mcpServers:[]})); r = await ask('ciao');
  console.log('3) nessun connettore: strumenti web di Mia =', hasW(r.decl));
  await setup(base({mcpServers:[{id:'p1',name:'parallel',url:'https://search.parallel.ai/mcp',token:'',enabled:true,disabled:['web_search']}]})); r = await ask('ciao');
  console.log('4) connettore con web_search spento: Mia mantiene =', hasW(r.decl), '(la lettura web_fetch del connettore sostituisce read_webpage)');
  await setup(base({mcpServers:[{id:'p1',name:'parallel',url:'https://search.parallel.ai/mcp',token:'',enabled:false,disabled:[]}]})); r = await ask('ciao');
  console.log('5) connettore disattivato: strumenti web di Mia =', hasW(r.decl));
  // chat: senza nominare Parallel
  await setup(base()); chat.length=0; mcpCalls.length=0;
  script=[[{functionCall:{name:'mcp_parallel_web_search',args:{objective:'notizie di oggi',search_queries:['notizie oggi']}}}],[{text:'Ecco le notizie: A e B.'}]];
  await page.fill('#input','cerca le notizie di oggi'); await page.click('#sendBtn'); await page.waitForSelector('.bubble:has-text("Ecco le notizie")',{timeout:15000});
  console.log('6) chat senza nominare Parallel: chiamate al connettore =', mcpCalls.filter(x=>x.startsWith('tools/call')).join(','), '| scheda:', (await page.locator('.tool-card summary').first().textContent()).trim(), '| nessuna conferma =', await page.locator('#confirm').isHidden());
  // impostazioni
  await page.click('#menuBtn'); await page.click('#drawer [data-open-settings]'); await page.waitForSelector('#settings:not([hidden])');
  console.log('7) casella in Impostazioni selezionata:', await page.isChecked('#preferMcpWeb')); await page.uncheck('#preferMcpWeb'); await page.click('#closeSettings');
  console.log('   salvata:', await page.evaluate(()=>JSON.parse(localStorage.getItem('miaai_v1_settings')).preferMcpWeb));
  console.log('ERRORS', errs);
  await b.close(); web.close();
})().catch(e=>{console.error('FAIL',e);process.exit(1)});
