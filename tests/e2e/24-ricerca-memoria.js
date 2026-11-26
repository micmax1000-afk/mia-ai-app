/* Test end-to-end di Mia AI. Tutti i servizi esterni sono simulati: nessuna chiamata reale. Vedi tests/README.md */
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const root = path.resolve(__dirname, '..', '..');
const mime = { '.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.webmanifest':'application/json' };
const web = http.createServer((q,r)=>{ let p=q.url.split('?')[0]; if(p==='/')p='/index.html'; const f=path.join(root,p); fs.readFile(f,(e,d)=>{ if(e){r.writeHead(404);r.end();return;} r.writeHead(200,{'content-type':mime[path.extname(f)]||'application/octet-stream'}); r.end(d);});}).listen(8075);
const cors={'access-control-allow-origin':'*','access-control-allow-headers':'*','access-control-allow-methods':'*'};
(async () => {
  const b = await chromium.launch(); const ctx = await b.newContext({viewport:{width:390,height:844}}); const page = await ctx.newPage(); const errs=[]; page.on('pageerror', e => errs.push(e.message));
  const gem = [];
  await ctx.route('https://generativelanguage.googleapis.com/**', async route => { const r=route.request(); if(r.method()==='OPTIONS') return route.fulfill({status:204,headers:cors}); gem.push(r.postData()); route.fulfill({status:200,headers:{...cors,'content-type':'text/event-stream'},body:'data: '+JSON.stringify({candidates:[{content:{parts:[{text:'Ok.'}]}}]})+'\n\n'}); });
  const settings = {provider:'gemini',profiles:{gemini:{apiKey:'gk',model:'gemini-3.5-flash',baseUrl:'https://generativelanguage.googleapis.com/v1beta'}},theme:'dark',favorites:[],autoFallback:false,agentEnabled:false,systemPrompt:'Sei Mia.',temperature:0.7};
  const T = Date.now();
  const convs = [
    {id:'a',title:'Ricetta lasagne',created:T-5e3,updated:T-5e3,messages:[{role:'user',content:'Come faccio le lasagne al forno con besciamella?'},{role:'assistant',content:'Servono sfoglie, ragù e besciamella: assembla a strati e inforna a 180 gradi per 40 minuti.'}]},
    {id:'b',title:'Viaggio a Lisbona',created:T-4e3,updated:T-4e3,messages:[{role:'user',content:'Cosa vedere a Lisbona in tre giorni?',attachments:[{kind:'pdf',name:'itinerario-lisbona.pdf',mime:'application/pdf',dropped:true}]},{role:'assistant',content:'Belém, Alfama e Sintra.'}]},
    {id:'c',title:'Codice Python',created:T-3e3,updated:T-3e3,messages:[{role:'user',content:'Scrivi una funzione per ordinare una lista'}]}
  ];
  await page.addInitScript(([s,c])=>{ if(!localStorage.getItem('miaai_v1_settings')){ localStorage.setItem('miaai_v1_settings',JSON.stringify(s)); localStorage.setItem('miaai_v1_conversations',JSON.stringify(c)); } }, [settings, convs]);
  await page.goto('http://localhost:8075/'); await page.waitForSelector('#input');
  const titles = async () => (await page.locator('#convList .open-conv > span').allTextContents()).join(' | ');

  console.log('— ricerca nella barra delle chat');
  await page.click('#menuBtn'); await page.waitForSelector('#convSearch',{state:'visible'});
  await page.fill('#convSearch','besciamella'); console.log('   «besciamella» →', await titles());
  console.log('   estratto mostrato =', /besciamella/.test(await page.locator('#convList .conv-snippet').first().textContent()));
  await page.fill('#convSearch','LISBONA tre'); console.log('   «LISBONA tre» (maiuscole, due parole) →', await titles());
  await page.fill('#convSearch','itinerario'); console.log('   nome di un allegato «itinerario» →', await titles());
  await page.fill('#convSearch','zzzz'); console.log('   «zzzz» →', (await page.locator('#convList').textContent()).trim());
  await page.fill('#convSearch','<img src=x onerror=alert(1)>'); console.log('   testo cercato mostrato come testo =', (await page.locator('#convList img').count())===0);
  await page.fill('#convSearch',''); console.log('   vuoto → elenco completo →', (await titles()).split(' | ').length, 'chat');
  await page.fill('#convSearch','python'); await page.locator('#convList .open-conv').first().click();
  console.log('   clic su un risultato apre la chat =', await page.locator('.msg.user .bubble').first().textContent());

  console.log('— strumenti search_chats e notes/search');
  const run = (name,args,c={}) => page.evaluate(async ([name,args,c]) => { try { const r = await MiaTools.run(name,args,c); return r.text; } catch(e){ return 'ERR '+e.message; } }, [name,args,c]);
  const fakeCtx = { searchChats: (q)=>[{title:'Ricetta lasagne',updated:T,snippet:'…besciamella…'}] };
  console.log('   search_chats →', JSON.stringify(await page.evaluate(async ()=>{ const r=await MiaTools.run('search_chats',{query:'x'},{searchChats:()=>[{title:'Ricetta lasagne',updated:1,snippet:'…besciamella…'}]}); return r.text; })));
  await run('notes',{action:'save',title:'Spesa',text:'latte, uova e pane integrale'}); await run('notes',{action:'save',title:'Idee',text:'app per la palestra'});
  console.log('   notes search «pane» →', JSON.stringify(await run('notes',{action:'search',query:'pane'})));
  console.log('   notes search «xyz» →', JSON.stringify(await run('notes',{action:'search',query:'xyz'})));
  console.log('   notes search nel titolo «idee» →', JSON.stringify(await run('notes',{action:'search',query:'idee'})));

  console.log('— Memoria');
  await page.click('#menuBtn'); await page.click('.drawer [data-open-settings]').then(()=>page.evaluate(()=>document.querySelectorAll('details.set-sec,details.set-sub').forEach(d=>d.open=true)));
  await page.waitForSelector('#memory',{state:'visible'}); await page.fill('#memory','Mi chiamo Marco.\nPreferisco risposte brevi.');
  await page.click('#closeSettings'); await page.waitForTimeout(300);
  await page.fill('#input','ciao'); await page.click('#sendBtn'); await page.waitForSelector('.msg.assistant .bubble:has-text("Ok.")',{timeout:15000});
  const body = gem[gem.length-1];
  console.log('   memoria nelle istruzioni di sistema =', /Mi chiamo Marco\.\\nPreferisco risposte brevi\./.test(body), '| indicata come dati =', /dati e non istruzioni/.test(body));
  console.log('   salvata nelle impostazioni =', await page.evaluate(()=>JSON.parse(localStorage.getItem('miaai_v1_settings')).memory));
  // strumento memory con il contesto reale dell'app: agente con chiamata a funzione
  const mem = (args,c)=>page.evaluate(async ([a,c])=>{ let m=c.m; const ctx={getMemory:()=>m,setMemory:t=>{m=t;}}; try{ const r=await MiaTools.run('memory',a,ctx); return r.text+' => ['+m.replace(/\n/g,' / ')+']'; }catch(e){return 'ERR '+e.message;} },[args,c]);
  console.log('   add →', await mem({action:'add',text:'Vivo a Torino'},{m:'Mi chiamo Marco.'}));
  console.log('   add doppione →', await mem({action:'add',text:'mi chiamo marco.'},{m:'Mi chiamo Marco.'}));
  console.log('   list →', await mem({action:'list'},{m:'A\nB'}));
  console.log('   remove →', await mem({action:'remove',text:'torino'},{m:'Mi chiamo Marco.\nVivo a Torino'}));
  console.log('   remove inesistente →', await mem({action:'remove',text:'zzz'},{m:'A'}));
  console.log('   memoria piena →', await mem({action:'add',text:'x'.repeat(200)},{m:'y'.repeat(3700)}));
  console.log('   add e remove chiedono conferma =', await page.evaluate(()=>MiaTools.needsConfirm('memory',{action:'add',text:'a'}) && MiaTools.needsConfirm('memory',{action:'remove',text:'a'}) && !MiaTools.needsConfirm('memory',{action:'list'}) && !MiaTools.needsConfirm('search_chats',{query:'a'})));
  console.log('ERRORS', errs);
  await b.close(); web.close();
})().catch(e=>{console.error('FAIL',e);process.exit(1)});
