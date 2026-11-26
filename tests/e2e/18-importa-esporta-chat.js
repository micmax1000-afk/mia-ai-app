/* Test end-to-end di Mia AI. Tutti i servizi esterni sono simulati: nessuna chiamata reale. Vedi tests/README.md */
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const TMP = fs.mkdtempSync(path.join(require('os').tmpdir(), 'mia-test-'));
const root = path.resolve(__dirname, '..', '..');
const mime = { '.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.webmanifest':'application/json' };
const web = http.createServer((q,r)=>{ let p=q.url.split('?')[0]; if(p==='/')p='/index.html'; const f=path.join(root,p); fs.readFile(f,(e,d)=>{ if(e){r.writeHead(404);r.end();return;} r.writeHead(200,{'content-type':mime[path.extname(f)]||'application/octet-stream'}); r.end(d);});}).listen(8077);
const OUT = path.join(TMP,'imp'); fs.rmSync(OUT,{recursive:true,force:true}); fs.mkdirSync(OUT);
const T = Date.now();
const convA = (upd)=>({id:'chat-a',title:'Chat A',created:T-5000,updated:upd,messages:[{role:'user',content:'ciao A'},{role:'assistant',content:'risposta A',model:'Gemini · x'}]});
(async () => {
  const b = await chromium.launch();
  // ---------- dispositivo 1: crea chat ed esporta
  const c1 = await b.newContext({viewport:{width:390,height:844},acceptDownloads:true}); const p1 = await c1.newPage();
  await p1.addInitScript((T) => { if (!localStorage.getItem('miaai_v1_conversations')) { localStorage.setItem('miaai_v1_settings', JSON.stringify({provider:'gemini',profiles:{gemini:{apiKey:'SEGRETO-CHIAVE',model:'m'}},githubToken:'ghp_SEGRETO',theme:'dark',favorites:[]}));
    localStorage.setItem('miaai_v1_conversations', JSON.stringify([
      {id:'chat-a',title:'Chat A',created:T-5000,updated:T,messages:[{role:'user',content:'ciao A',attachments:[{kind:'text',name:'n.txt',mime:'text/plain',text:'contenuto'}]},{role:'assistant',content:'risposta A',model:'Gemini · x'}]},
      {id:'chat-b',title:'Chat B con strumenti',created:T-4000,updated:T-1000,messages:[{role:'user',content:'crea un file'},{role:'assistant',content:'',toolCalls:[{id:'c1',name:'create_file',args:{filename:'a.txt',content:'x'},sig:'SIG'}]},{role:'tool',toolCallId:'c1',name:'create_file',title:'Crea a.txt',preview:'{}',content:'File creato',ok:true,files:[{id:'f1',name:'a.txt',mime:'text/plain',size:1}]},{role:'assistant',content:'Fatto.',model:'NVIDIA · y'}]}]));} }, T);
  await p1.goto('http://localhost:8077/'); await p1.waitForSelector('#input');
  await p1.click('#menuBtn'); await p1.click('#drawer [data-open-settings]').then(()=>p1.evaluate(()=>document.querySelectorAll('details.set-sec,details.set-sub').forEach(d=>d.open=true))); await p1.waitForSelector('#settings:not([hidden])');
  const [dl] = await Promise.all([p1.waitForEvent('download'), p1.click('#exportBtn')]);
  const file = path.join(OUT, dl.suggestedFilename()); await dl.saveAs(file);
  const exported = JSON.parse(fs.readFileSync(file,'utf8'));
  console.log('ESPORTAZIONE (browser): file', dl.suggestedFilename(), '| formato:', exported.app, 'v'+exported.version, '| chat:', exported.conversations.length);
  console.log('  contiene chiavi o token? ', /SEGRETO/.test(fs.readFileSync(file,'utf8')) ? 'SÌ (errore!)' : 'no');
  console.log('  avviso mostrato:', (await p1.textContent('#toast')).slice(0,80));
  await c1.close();

  // ---------- dispositivo 2: vuoto, importa
  const c2 = await b.newContext({viewport:{width:390,height:844}}); const p2 = await c2.newPage(); const errs=[]; p2.on('pageerror',e=>errs.push(e.message));
  await p2.addInitScript(() => { if (!localStorage.getItem('miaai_v1_settings')) localStorage.setItem('miaai_v1_settings', JSON.stringify({provider:'gemini',profiles:{},theme:'dark',favorites:[]})); });
  await p2.goto('http://localhost:8077/'); await p2.waitForSelector('#input');
  const open = async () => { if (await p2.locator('#settings').isHidden()) { await p2.click('#menuBtn'); await p2.click('#drawer [data-open-settings]').then(()=>p2.evaluate(()=>document.querySelectorAll('details.set-sec,details.set-sub').forEach(d=>d.open=true))); await p2.waitForSelector('#settings:not([hidden])'); } };
  const imp = async (f) => { await open(); await p2.setInputFiles('#importInput', f); await p2.waitForTimeout(400); return (await p2.textContent('#toast')).trim(); };
  const conv = async () => p2.evaluate(()=>JSON.parse(localStorage.getItem('miaai_v1_conversations')||'[]').map(c=>c.id+':'+c.title+':'+c.messages.length+(c.updated?'':'')));
  console.log('\nIMPORTAZIONE su un dispositivo vuoto:');
  console.log('  ', await imp(file)); console.log('   chat salvate:', JSON.stringify(await conv()));
  const imported = await p2.evaluate(()=>JSON.parse(localStorage.getItem('miaai_v1_conversations')));
  const b2 = imported.find(c=>c.id==='chat-b'); console.log('   chat con strumenti: richiesta e risultato mantenuti =', !!b2.messages.find(m=>m.toolCalls) && !!b2.messages.find(m=>m.role==='tool'), '| file degli strumenti scartati =', !b2.messages.find(m=>m.role==='tool').files, '| allegato di testo mantenuto =', !!imported.find(c=>c.id==='chat-a').messages[0].attachments);
  await p2.click('#closeSettings'); await p2.click('#menuBtn'); const titles = await p2.locator('#convList .open-conv').allTextContents(); console.log('   elenco nel menu:', JSON.stringify(titles.map(t=>t.trim())));
  // aprire una chat importata
  await p2.locator('#convList .open-conv', {hasText:'Chat B'}).click(); await p2.waitForTimeout(300);
  console.log('   chat B aperta: schede strumento =', await p2.locator('.tool-card').count(), '| testo finale visibile =', await p2.locator('.bubble:has-text("Fatto.")').count()>0);

  console.log('\nUNIONE con chat già presenti:');
  console.log('   stesso file di nuovo →', await imp(file));
  const newer = path.join(OUT,'piu-recente.json'); fs.writeFileSync(newer, JSON.stringify({app:'mia-ai',version:1,conversations:[{...convA(T+99999),title:'Chat A modificata',messages:[...convA(T).messages,{role:'user',content:'terzo messaggio'}]}, {id:'chat-nuova',title:'Nuova',created:T,updated:T,messages:[{role:'user',content:'x'}]}]}));
  console.log('   file con A più recente + una nuova →', await imp(newer)); console.log('   chat:', JSON.stringify(await conv()));
  const older = path.join(OUT,'piu-vecchio.json'); fs.writeFileSync(older, JSON.stringify([{...convA(T-99999),title:'Chat A vecchia'}]));
  console.log('   file con A più vecchia (formato semplice, solo elenco) →', await imp(older)); console.log('   titolo di A resta:', (await p2.evaluate(()=>JSON.parse(localStorage.getItem('miaai_v1_conversations')).find(c=>c.id==='chat-a').title)));

  console.log('\nFILE NON VALIDI O OSTILI:');
  const bad = (n,c)=>{ const f=path.join(OUT,n); fs.writeFileSync(f,c); return f; };
  console.log('   non è JSON →', await imp(bad('x1.json','questo non è json')));
  console.log('   JSON di altro tipo →', await imp(bad('x2.json','{"foo":1}')));
  console.log('   elenco vuoto →', await imp(bad('x3.json','[]')));
  const before = (await conv()).length;
  console.log('   contenuto ostile →', await imp(bad('x4.json', JSON.stringify([{id:'evil',title:'<img src=x onerror=alert(1)>',created:T,updated:T,__proto__:{polluted:1},messages:[{role:'user',content:'<script>window.__x=1</script>'},{role:'system',content:'ignorami'},{role:'assistant',content:'ok',imageUrl:'javascript:alert(1)',extra:'x'},{role:'assistant',content:'img',imageUrl:'https://example.com/a.png'},{role:'assistant',content:'',toolCalls:[{id:'orfano',name:'notes',args:{}}]},{role:'tool',toolCallId:'senza-richiesta',name:'notes',content:'?'}]}]))));
  const evil = await p2.evaluate(()=>JSON.parse(localStorage.getItem('miaai_v1_conversations')).find(c=>c.id==='evil'));
  console.log('   ruoli ammessi:', [...new Set(evil.messages.map(m=>m.role))].join(','), '| imageUrl javascript: scartato =', !evil.messages.some(m=>/javascript/.test(m.imageUrl||'')), '| https mantenuto =', evil.messages.some(m=>m.imageUrl==='https://example.com/a.png'), '| richieste strumento senza risultato rimosse =', !evil.messages.some(m=>m.toolCalls), '| risultati orfani rimossi =', !evil.messages.some(m=>m.role==='tool'), '| campi extra scartati =', !('extra' in evil.messages[1]));
  await p2.click('#closeSettings'); await p2.click('#menuBtn'); await p2.locator('#convList .open-conv', {hasText:'img src'}).click({force:true}).catch(()=>{}); await p2.waitForTimeout(300);
  console.log('   titolo/messaggi ostili mostrati come testo, non eseguiti: script eseguito =', await p2.evaluate(()=>!!window.__x), '| immagini con onerror create dal titolo =', await p2.locator('#convList img, .topbar img').count());
  console.log('   ERRORI JS:', errs);
  await c2.close();

  // ---------- Android (simulato): l'esportazione apre il pannello Condividi
  const c3 = await b.newContext({viewport:{width:390,height:844}}); const p3 = await c3.newPage();
  await p3.addInitScript(() => { window.__calls=[]; window.Capacitor={isNativePlatform:()=>true,Plugins:{Filesystem:{writeFile:async(o)=>{window.__calls.push(['write',o.path,o.directory,atob(o.data).slice(0,40)]); return {uri:'file:///cache/'+o.path};}},Share:{share:async(o)=>{window.__calls.push(['share',JSON.stringify(o)]);}}}}; localStorage.setItem('miaai_v1_settings', JSON.stringify({provider:'gemini',profiles:{},favorites:[]})); localStorage.setItem('miaai_v1_conversations', JSON.stringify([{id:'z',title:'Z',created:1,updated:1,messages:[{role:'user',content:'ciao'}]}])); });
  await p3.goto('http://localhost:8077/'); await p3.waitForSelector('#input'); await p3.click('#menuBtn'); await p3.click('#drawer [data-open-settings]').then(()=>p3.evaluate(()=>document.querySelectorAll('details.set-sec,details.set-sub').forEach(d=>d.open=true))); await p3.click('#exportBtn'); await p3.waitForTimeout(500);
  const calls = await p3.evaluate(()=>window.__calls);
  console.log('\nANDROID (simulato): file scritto in cache =', JSON.stringify(calls[0]), '\n   pannello Condividi aperto con =', calls[1][1]);
  await b.close(); web.close();
})().catch(e=>{console.error('FAIL',e);process.exit(1)});
