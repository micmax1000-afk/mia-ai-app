/* Test end-to-end di Mia AI. Tutti i servizi esterni sono simulati: nessuna chiamata reale. Vedi tests/README.md */
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const root = path.resolve(__dirname, '..', '..');
const mime = { '.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.webmanifest':'application/json' };
const web = http.createServer((q,r)=>{ let p=q.url.split('?')[0]; if(p==='/')p='/index.html'; const f=path.join(root,p); fs.readFile(f,(e,d)=>{ if(e){r.writeHead(404);r.end();return;} r.writeHead(200,{'content-type':mime[path.extname(f)]||'application/octet-stream'}); r.end(d);});}).listen(8083);
const cors={'access-control-allow-origin':'*','access-control-allow-headers':'*','access-control-allow-methods':'*'};
const TASK = 'In data-prova.js elimina il mazzo tedesco a blocchi di 50 carte, con modifiche a frammenti separate.';
// chat come quella del telefono: richiesta, 45 passi con strumenti (assistente + risultato di 4000 caratteri), «mi fermo», poi «continua»
const conv = (steps, extraUsers) => { const m=[{role:'user',content:TASK}]; for (let i=0;i<steps;i++){ m.push({role:'assistant',content:'Passo '+i,toolCalls:[{id:'t'+i,name:'github_read_file',args:{path:'data-prova.js'}}]}); m.push({role:'tool',toolCallId:'t'+i,name:'github_read_file',title:'Leggi',content:'RISULTATO '+i+' '+'x'.repeat(4000),ok:true}); }
  m.push({role:'assistant',content:'⏹ Mi fermo dopo '+steps+' passaggi con gli strumenti. Scrivi «continua» se vuoi che vada avanti.'}); (extraUsers||[]).forEach(t=>{m.push({role:'user',content:t});m.push({role:'assistant',content:'Ok '+t});}); return [{id:'c1',title:'Prova',created:1,updated:1,messages:m}]; };
(async () => {
  const b = await chromium.launch(); const ctx = await b.newContext({viewport:{width:390,height:844}}); const page = await ctx.newPage(); const errs=[]; page.on('pageerror', e => errs.push(e.message));
  const bodies=[];
  await ctx.route('https://generativelanguage.googleapis.com/**', async route => { const r=route.request(); if(r.method()==='OPTIONS') return route.fulfill({status:204,headers:cors}); bodies.push((r.postDataBuffer()||Buffer.from('')).toString('utf8')); if (process.env.DBG) console.log('   REQ', r.method(), r.url().slice(0,90), (r.postDataBuffer()||[]).length); route.fulfill({status:200,headers:{...cors,'content-type':'text/event-stream'},body:'data: '+JSON.stringify({candidates:[{content:{parts:[{text:'Riprendo.'}]}}]})+'\n\n'}); });
  const S = {provider:'gemini',profiles:{gemini:{apiKey:'k',model:'gemini-3.5-flash',baseUrl:'https://generativelanguage.googleapis.com/v1beta'}},agentEnabled:false,autoFallback:false,favorites:[],theme:'dark',systemPrompt:'x',temperature:0.7};
  const go = async (c, text) => { if (go.page) await go.page.close(); go.page = await ctx.newPage(); const page = go.page; await page.addInitScript(([s,c])=>{ if (!sessionStorage.getItem('init')) { sessionStorage.setItem('init','1'); localStorage.setItem('miaai_v1_settings',JSON.stringify(s)); localStorage.setItem('miaai_v1_conversations',JSON.stringify(c)); localStorage.setItem('miaai_v1_current',JSON.stringify(c[0].id)); } }, [S,c]); await page.goto('http://localhost:8083/'); await page.waitForSelector('#input'); bodies.length=0; if (process.env.DBG) console.log('   caricata: messaggi in memoria =', await page.evaluate(()=>{ try{ return JSON.parse(localStorage.getItem('miaai_v1_conversations')||'[]').map(c=>c.messages.length).join(',')+' | DOM: '+document.querySelectorAll('.msg').length; }catch(e){return 'ERR '+e.message;} })); if (false) await page.evaluate(([s,c])=>{ localStorage.setItem('miaai_v1_settings',JSON.stringify(s)); localStorage.setItem('miaai_v1_conversations',JSON.stringify(c)); localStorage.setItem('miaai_v1_current',JSON.stringify(c[0].id)); }, [S,c]);
    await page.fill('#input',text); await page.click('#sendBtn'); for (let i=0;i<100 && !bodies.length;i++) await page.waitForTimeout(100); await page.waitForTimeout(300); if (!bodies.length) console.log('   (nessuna richiesta) messaggi:', (await page.locator('.msg').allTextContents()).slice(-3).join(' | ').slice(0,300), '| toast:', await page.locator('#toast').textContent()); return bodies[0] || ''; };

  console.log('— «continua» dopo un lavoro lungo (45 passi con strumenti)');
  let body = await go(conv(45), 'continua');
  console.log('   la richiesta originale è nel contesto =', body.includes('elimina il mazzo tedesco a blocchi di 50 carte'), '| «continua» c\'è =', body.includes('continua'));
  const kb = Math.round(body.length/1024);
  console.log('   dimensione della richiesta ragionevole (< 120 KB) =', body.length < 120*1024, '(', kb, 'KB )');
  console.log('   i risultati più vecchi sono accorciati =', (body.match(/risultato accorciato/g)||[]).length > 20, '| gli ultimi 6 sono interi =', ['RISULTATO 44 ','RISULTATO 39 '].every(t=>body.includes(t+'x'.repeat(4000))), '| il più vecchio non è intero =', !body.includes('RISULTATO 1 '+'x'.repeat(4000)));
  console.log('— lavoro lunghissimo (150 passi): resta sotto il limite e tiene la richiesta');
  body = await go(conv(150), 'continua'); console.log('   richiesta originale presente =', body.includes('elimina il mazzo tedesco'), '| passaggi più recenti presenti =', body.includes('RISULTATO 149 '), '| passaggi lontani omessi =', !body.includes('RISULTATO 20 '), '| dimensione (< 160 KB) =', body.length < 160*1024, '(', Math.round(body.length/1024), 'KB )');
  console.log('— dopo la richiesta ci sono altre richieste: si tengono le ultime 3');
  body = await go(conv(45,['grazie','e poi?']), 'continua');
  console.log('   richiesta originale + «grazie» + «e poi?» presenti =', body.includes('elimina il mazzo tedesco') && body.includes('grazie') && body.includes('e poi?'));
  console.log('— chat normale breve: invariata');
  body = await go([{id:'c2',title:'x',created:1,updated:1,messages:[{role:'user',content:'ciao a tutti'},{role:'assistant',content:'salve'}]}], 'come stai?');
  console.log('   contiene i messaggi precedenti =', body.includes('ciao a tutti') && body.includes('salve') && body.includes('come stai?'));
  console.log('ERRORS', errs);
  await b.close(); web.close();
})().catch(e=>{console.error('FAIL',e);process.exit(1)});
