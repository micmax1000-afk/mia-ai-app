/* Test end-to-end di Mia AI. Tutti i servizi esterni sono simulati: nessuna chiamata reale. Vedi tests/README.md */
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const root = path.resolve(__dirname, '..', '..');
const mime = { '.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.webmanifest':'application/json' };
const web = http.createServer((q,r)=>{ let p=q.url.split('?')[0]; if(p==='/')p='/index.html'; const f=path.join(root,p); fs.readFile(f,(e,d)=>{ if(e){r.writeHead(404);r.end();return;} r.writeHead(200,{'content-type':mime[path.extname(f)]||'application/octet-stream'}); r.end(d);});}).listen(8080);
const cors={'access-control-allow-origin':'*','access-control-allow-headers':'*','access-control-allow-methods':'*'};
// file di ~230 KB come il vero «data.js» dei mazzi: 4000 carte con accenti ed emoji
let big = '// data.js — Mazzi di vocabolario\nconst DECKS = [\n  {\n    id: "en",\n    cards: [\n';
for (let i = 1; i <= 4000; i++) big += '      { front: "parola ' + i + ' è", back: "word ' + i + '", phon: "/ˈwɜːd/", emoji: "👩" },\n';
big += '    ]\n  }\n];\n';
const files = { 'data.js': big, 'piccolo.js': 'x'.repeat(1500), 'medio.js': 'riga\n'.repeat(1000) };
const puts = [];
(async () => {
  const b = await chromium.launch(); const ctx = await b.newContext({viewport:{width:390,height:844}}); const page = await ctx.newPage(); const errs=[]; page.on('pageerror', e => errs.push(e.message));
  await ctx.route('https://api.github.com/**', async route => { const r=route.request(); const u=new URL(r.url()); if(r.method()==='OPTIONS') return route.fulfill({status:204,headers:cors});
    const j=(o,s=200)=>route.fulfill({status:s,headers:{...cors,'content-type':'application/json'},body:JSON.stringify(o)});
    const m = u.pathname.match(/^\/repos\/mario\/flash\/contents\/(.+)$/); if (!m) return j({message:'Not Found'},404); const name=decodeURIComponent(m[1]);
    if (r.method()==='GET') return files[name]!==undefined ? j({type:'file',path:name,size:Buffer.byteLength(files[name]),sha:'sha-'+name,content:Buffer.from(files[name]).toString('base64').replace(/(.{60})/g,'$1\n'),encoding:'base64'}) : j({message:'Not Found'},404);
    if (r.method()==='PUT') { const b=JSON.parse(r.postData()); puts.push({name,len:Buffer.from(b.content,'base64').toString('utf8').length}); return j({commit:{sha:'abcdef123456'},content:{html_url:'https://github.com/mario/flash/blob/main/'+name}},200); }
    return j({message:'x'},404); });
  await page.goto('http://localhost:8080/'); await page.waitForSelector('#input');
  const run = (name,args,c) => page.evaluate(async ([name,args,c]) => { const ctx = Object.assign({token:'t'}, c && c.confirm!==undefined ? { confirm: async () => c.confirm } : {}); try { const r = await MiaTools.run(name,args,ctx); return {ok:true,text:r.text}; } catch(e){ return {ok:false,error:e.message}; } }, [name,args,c]);
  const rd = (extra) => run('github_read_file', Object.assign({owner:'mario',repo:'flash',path:'data.js'},extra));
  console.log('file di prova:', big.length, 'caratteri,', Buffer.byteLength(big), 'byte');

  console.log('— lettura di un file lungo');
  let r = await rd({}); const first = r.text;
  console.log('   avviso «FILE INCOMPLETO» =', /FILE INCOMPLETO: restano \d+ caratteri\. Leggi il resto con start=\d+/.test(first), '| indica il totale =', new RegExp('MOSTRATI i caratteri 0–\\d+ di '+big.length).test(first), '| avverte di non riscrivere =', /NON riscrivere/.test(first));
  console.log('   lunghezza della risposta (≈12000) =', first.length>11000 && first.length<13500);
  console.log('— lettura a blocchi: rimettendo insieme i pezzi si ottiene il file intero, senza buchi');
  let pos = 0, text = '', n = 0;
  while (pos < big.length && n < 40) { const x = await rd({start:pos}); const m = x.text.match(/MOSTRATI i caratteri (\d+)–(\d+) di/); const body = x.text.split('\n\n').slice(1).join('\n\n').replace(/\n\n\[FILE INCOMPLETO[^]*$/,''); const end = m ? Number(m[2]) : big.length; text += body; pos = end; n++; }
  console.log('   blocchi =', n, '| ricostruito identico =', text === big);
  console.log('— ricerca con «find»');
  r = await rd({find:'parola 3999'}); console.log('   ', r.text.split('\n').slice(2).join(' | ').slice(0,120));
  r = await rd({find:'zzz'}); console.log('    nessun risultato →', r.text.split('\n').pop());
  console.log('— file corto: niente avvisi');
  r = await run('github_read_file',{owner:'mario',repo:'flash',path:'piccolo.js'}); console.log('    senza avviso =', !/INCOMPLETO|MOSTRATI/.test(r.text));
  r = await rd({length:100000}); console.log('    length oltre il massimo → al più 40000 =', r.text.length < 41000);

  console.log('— scrittura: file lungo sostituito da uno corto (il caso dei mazzi)');
  puts.length = 0;
  r = await run('github_write_file',{owner:'mario',repo:'flash',path:'data.js',content:'const DECKS = [];\n',message:'x'}); console.log('    senza conferma disponibile →', r.ok?'SCRITTO (!!)':'RIFIUTATO', '|', (r.error||'').slice(0,110), '| scritture =', puts.length);
  r = await run('github_write_file',{owner:'mario',repo:'flash',path:'data.js',content:'const DECKS = [];\n',message:'x'},{confirm:false}); console.log('    utente rifiuta →', r.ok?'SCRITTO (!!)':'RIFIUTATO', '| scritture =', puts.length, '| consiglia github_edit_file =', /github_edit_file/.test(r.error||''));
  r = await run('github_write_file',{owner:'mario',repo:'flash',path:'data.js',content:'const DECKS = [];\n',message:'x'},{confirm:true}); console.log('    utente conferma →', r.ok?'scritto':'ERR '+r.error, '| scritture =', puts.length);
  console.log('— scritture normali senza seconda domanda');
  puts.length = 0;
  r = await run('github_write_file',{owner:'mario',repo:'flash',path:'data.js',content:big.split('\n').filter((l,i)=>!(i>5 && i<800)).join('\n'),message:'x'}); console.log('    riduzione −20% →', r.ok?'scritto':'ERR '+r.error, '| scritture =', puts.length);
  r = await run('github_write_file',{owner:'mario',repo:'flash',path:'piccolo.js',content:'y',message:'x'}); console.log('    file sotto i 2000 caratteri →', r.ok?'scritto':'ERR '+r.error);
  r = await run('github_write_file',{owner:'mario',repo:'flash',path:'nuovo.js',content:'z',message:'x'}); console.log('    file nuovo →', r.ok?'scritto':'ERR '+r.error);

  console.log('— dall\'app: Gemini prova a sostituire il file lungo, compaiono due domande');
  const bodies=[]; let step=0;
  await ctx.route('https://generativelanguage.googleapis.com/**', async route => { const r=route.request(); if(r.method()==='OPTIONS') return route.fulfill({status:204,headers:cors}); bodies.push(r.postData());
    const parts = step++===0 ? [{functionCall:{name:'github_write_file',args:{owner:'mario',repo:'flash',path:'data.js',content:'const DECKS = [];\n',message:'riscrivo'}}}] : [{text:'Fatto.'}];
    route.fulfill({status:200,headers:{...cors,'content-type':'text/event-stream'},body:'data: '+JSON.stringify({candidates:[{content:{parts}}]})+'\n\n'}); });
  await page.evaluate(()=>{ localStorage.setItem('miaai_v1_settings',JSON.stringify({provider:'gemini',profiles:{gemini:{apiKey:'k',model:'gemini-3.5-flash',baseUrl:'https://generativelanguage.googleapis.com/v1beta'}},agentEnabled:true,githubToken:'tok',githubRepo:'mario/flash',githubUseBranch:false,githubReadFirst:false,autoFallback:false,favorites:[],theme:'dark',systemPrompt:'x',temperature:0.7})); });
  await page.reload(); await page.waitForSelector('#input'); puts.length=0;
  await page.fill('#input','correggi i mazzi'); await page.click('#sendBtn');
  await page.waitForSelector('#confirm:not([hidden])'); console.log('    1ª domanda:', (await page.textContent('#confirmTitle')).slice(0,70), '| mostra la lunghezza =', /Nuovo contenuto: 2 righe, 18 caratteri/.test(await page.textContent('#confirmDetails')));
  await page.click('#confirmYes'); await page.waitForFunction(()=>/ATTENZIONE/.test(document.querySelector('#confirmTitle').textContent),null,{timeout:10000});
  console.log('    2ª domanda:', (await page.textContent('#confirmTitle')).slice(0,95), '| avviso rosso =', await page.locator('#confirmWarn').isVisible());
  await page.click('#confirmNo'); await page.waitForSelector('.msg.assistant .bubble:has-text("Fatto.")',{timeout:15000});
  console.log('    dopo il rifiuto: nessuna scrittura =', puts.length===0, '| il modello riceve il motivo =', /Scrittura annullata/.test(bodies[1]||''));
  console.log('ERRORS', errs);
  await b.close(); web.close();
})().catch(e=>{console.error('FAIL',e);process.exit(1)});
