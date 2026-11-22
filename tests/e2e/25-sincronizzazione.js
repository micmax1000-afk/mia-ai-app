/* Test end-to-end di Mia AI. Tutti i servizi esterni sono simulati: nessuna chiamata reale. Vedi tests/README.md */
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const root = path.resolve(__dirname, '..', '..');
const mime = { '.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.webmanifest':'application/json' };
const web = http.createServer((q,r)=>{ let p=q.url.split('?')[0]; if(p==='/')p='/index.html'; const f=path.join(root,p); fs.readFile(f,(e,d)=>{ if(e){r.writeHead(404);r.end();return;} r.writeHead(200,{'content-type':mime[path.extname(f)]||'application/octet-stream'}); r.end(d);});}).listen(8076);
const cors={'access-control-allow-origin':'*','access-control-allow-headers':'*','access-control-allow-methods':'*'};
// GitHub simulato in memoria (condiviso dai due «dispositivi»): API dei contenuti di un repository
const gh = { private:true, push:true, exists:true, file:null, sha:0, puts:[], putBodies:[], conflictOnce:false, big:false, tokens:new Set() };
const handler = async route => {
  const r = route.request(); const u = new URL(r.url()); const h = r.headers();
  if (r.method()==='OPTIONS') return route.fulfill({status:204,headers:cors});
  gh.tokens.add(h['authorization']);
  const j = (o,s=200)=>route.fulfill({status:s,headers:{...cors,'content-type':'application/json'},body:JSON.stringify(o)});
  if (u.pathname==='/repos/mario/mia-dati') return gh.exists ? j({private:gh.private,permissions:{push:gh.push}}) : j({message:'Not Found'},404);
  if (u.pathname==='/repos/mario/mia-dati/contents/mia-chats.json') {
    if (r.method()==='GET') {
      if (gh.file===null) return j({message:'Not Found'},404);
      if ((h['accept']||'').includes('raw')) return route.fulfill({status:200,headers:{...cors,'content-type':'text/plain'},body:gh.file});
      if (gh.big) return j({sha:'s'+gh.sha,content:'',encoding:'none'});
      return j({sha:'s'+gh.sha,content:Buffer.from(gh.file).toString('base64').replace(/(.{60})/g,'$1\n'),encoding:'base64'});
    }
    if (r.method()==='PUT') {
      const b = JSON.parse(r.postData()); gh.putBodies.push(b);
      if (gh.conflictOnce) { gh.conflictOnce=false; return j({message:'conflict'},409); }
      if (gh.file!==null && b.sha!=='s'+gh.sha) return j({message:'sha mismatch'},409);
      gh.file = Buffer.from(b.content,'base64').toString('utf8'); gh.sha++; gh.puts.push(1);
      return j({content:{sha:'s'+gh.sha}},gh.sha===1?201:200);
    }
  }
  return j({message:'Not Found'},404);
};
(async () => {
  const br = await chromium.launch(); const errs=[];
  const T = Date.now();
  const mkSettings = (extra) => Object.assign({provider:'gemini',profiles:{gemini:{apiKey:'CHIAVE-SEGRETA-GEMINI',model:'gemini-3.5-flash',baseUrl:'https://generativelanguage.googleapis.com/v1beta'}},theme:'dark',favorites:[],autoFallback:false,agentEnabled:false,systemPrompt:'Sei Mia.',temperature:0.7,githubToken:'ghp_TOKEN_SEGRETO',syncRepo:'mario/mia-dati'}, extra||{});
  const device = async (settings, convs) => {
    const ctx = await br.newContext({viewport:{width:390,height:844}}); await ctx.route('https://api.github.com/**', handler);
    const page = await ctx.newPage(); page.on('pageerror', e => errs.push(e.message));
    await page.addInitScript(([s,c])=>{ if(!localStorage.getItem('miaai_v1_settings')){ localStorage.setItem('miaai_v1_settings',JSON.stringify(s)); if(c) localStorage.setItem('miaai_v1_conversations',JSON.stringify(c)); } }, [settings, convs||null]);
    await page.goto('http://localhost:8076/'); await page.waitForSelector('#input');
    return {ctx,page};
  };
  const ui = async (page) => { if (await page.locator('#drawer.open').count()) await page.evaluate(()=>document.querySelector('#scrim').click()); await page.click('#menuBtn'); await page.click('.drawer [data-open-settings]'); await page.click('#syncNow'); await page.waitForFunction(()=>{ const t=document.querySelector('#syncStatus').textContent; return t && !/in corso/.test(t); },null,{timeout:20000}); const t = await page.locator('#syncStatus').textContent(); await page.click('#closeSettings'); return t; };
  const titles = async (page) => { if (await page.locator('#drawer.open').count()) await page.evaluate(()=>document.querySelector('#scrim').click()); await page.click('#menuBtn'); const t=(await page.locator('#convList .open-conv > span').allTextContents()).sort().join(' | '); await page.evaluate(()=>document.querySelector('#scrim').click()); return t; };
  const stored = (page) => page.evaluate(()=>JSON.parse(localStorage.getItem('miaai_v1_conversations')||'[]'));

  const convsA = [
    {id:'c1',title:'Lasagne',created:T-9e4,updated:T-9e4,messages:[{role:'user',content:'ricetta lasagne',attachments:[{kind:'image',name:'foto.jpg',mime:'image/jpeg',data:'AAAA'.repeat(500),thumb:'BBBB'}, {kind:'pdf',name:'menu.pdf',mime:'application/pdf',data:'CCCC',text:'Testo del menù',pages:2}]},{role:'assistant',content:'Ecco la ricetta.'}]},
    {id:'c2',title:'Viaggio',created:T-8e4,updated:T-8e4,messages:[{role:'user',content:'viaggio a Roma'},{role:'assistant',content:'Colosseo.'}]}
  ];
  console.log('— dispositivo A invia le chat (repository privato, file ancora inesistente)');
  const A = await device(mkSettings({memory:'Mi chiamo Marco.',memoryUpdated:T-1e3}), convsA);
  console.log('   esito:', await ui(A.page));
  const file1 = JSON.parse(gh.file);
  console.log('   file creato nel repository =', file1.app==='mia-ai' && file1.conversations.length===2, '| scritture =', gh.puts.length);
  console.log('   nessun segreto inviato =', !/CHIAVE-SEGRETA|ghp_TOKEN|githubToken|apiKey/.test(gh.file), '| token usato solo nell\'intestazione =', [...gh.tokens].every(t=>t==='Bearer ghp_TOKEN_SEGRETO'));
  console.log('   immagini non inviate, testo del PDF sì =', !/AAAA|BBBB|CCCC/.test(gh.file) && /Testo del menù/.test(gh.file));
  console.log('   memoria inviata =', file1.memory.text==='Mi chiamo Marco.');
  console.log('   in A gli allegati restano al loro posto =', (await stored(A.page))[0].messages[0].attachments[0].data.length===2000);

  console.log('— dispositivo B (vuoto) scarica');
  const B = await device(mkSettings());
  console.log('   esito:', await ui(B.page), '| scritture finora =', gh.puts.length);
  console.log('   chat arrivate =', await titles(B.page));
  console.log('   memoria arrivata =', await B.page.evaluate(()=>JSON.parse(localStorage.getItem('miaai_v1_settings')).memory));
  const bc = (await stored(B.page)).find(c=>c.id==='c1'); console.log('   allegato ricevuto senza immagine ma con testo =', bc.messages[0].attachments[0].dropped===true && !bc.messages[0].attachments[0].data && bc.messages[0].attachments[1].text==='Testo del menù');
  const putsBefore = gh.puts.length; console.log('   seconda sincronizzazione senza novità: nessuna scrittura =', (await ui(B.page), gh.puts.length===putsBefore));

  console.log('— B modifica una chat ed elimina l\'altra');
  await B.page.click('#menuBtn'); await B.page.locator('#convList .open-conv', {hasText:'Lasagne'}).click();
  await B.page.evaluate(()=>{ const c=JSON.parse(localStorage.getItem('miaai_v1_conversations')); const x=c.find(k=>k.id==='c1'); x.messages.push({role:'user',content:'aggiungi il basilico'}); x.updated=Date.now(); localStorage.setItem('miaai_v1_conversations',JSON.stringify(c)); });
  await B.page.reload(); await B.page.waitForSelector('#input');
  B.page.once('dialog', d=>d.accept());
  await B.page.click('#menuBtn'); await B.page.locator('#convList li', {hasText:'Viaggio'}).locator('.del-conv').click(); await B.page.evaluate(()=>document.querySelector('#scrim').click());
  console.log('   esito B:', await ui(B.page));
  const f2 = JSON.parse(gh.file); console.log('   nel repository: chat =', f2.conversations.map(c=>c.id).join(','), '| eliminata registrata =', Object.keys(f2.deleted).join(','));
  console.log('— A sincronizza: vede la modifica e l\'eliminazione');
  console.log('   esito A:', await ui(A.page));
  console.log('   chat in A =', await titles(A.page), '| messaggi di Lasagne =', (await stored(A.page)).find(c=>c.id==='c1').messages.length);
  console.log('   la versione più recente sostituisce quella locale (l\'immagine locale non c\'è più) =', !(await stored(A.page)).find(c=>c.id==='c1').messages[0].attachments[0].data);

  console.log('— chat modificata dopo l\'eliminazione altrove: resta');
  const m = await A.page.evaluate(([t])=>MiaSync.merge({conversations:[{id:'x',updated:t+10,messages:[]}],deleted:{},memory:{text:'',updated:0}},{conversations:[],deleted:{x:t},memory:{text:'',updated:0}},t+20), [T]);
  console.log('   chat più recente della lapide resta =', m.conversations.length===1 && !('x' in m.deleted));
  const m2 = await A.page.evaluate(([t])=>MiaSync.merge({conversations:[{id:'x',updated:t-10,messages:[]}],deleted:{},memory:{text:'',updated:0}},{conversations:[],deleted:{x:t},memory:{text:'',updated:0}},t+20), [T]);
  console.log('   chat più vecchia della lapide sparisce =', m2.conversations.length===0);
  const m3 = await A.page.evaluate(([t])=>MiaSync.merge({conversations:[],deleted:{old:t-100*86400000},memory:{text:'',updated:0}},{conversations:[],deleted:{},memory:{text:'',updated:0}},t), [T]);
  console.log('   lapidi vecchie di 90 giorni ripulite =', Object.keys(m3.deleted).length===0);

  console.log('— conflitto: un altro dispositivo scrive nel frattempo (409), si riprova');
  await A.page.evaluate(()=>{ const c=JSON.parse(localStorage.getItem('miaai_v1_conversations')); c[0].messages.push({role:'user',content:'altra riga'}); c[0].updated=Date.now(); localStorage.setItem('miaai_v1_conversations',JSON.stringify(c)); });
  await A.page.reload(); await A.page.waitForSelector('#input');
  gh.conflictOnce = true; const n0 = gh.putBodies.length;
  console.log('   esito:', await ui(A.page), '| tentativi di scrittura =', gh.putBodies.length-n0);

  console.log('— file molto grande (oltre 1 MB): lettura in formato «raw»');
  gh.big = true; console.log('   esito:', await ui(B.page)); gh.big = false;

  console.log('— repository pubblico: rifiutato, nessun invio');
  gh.private = false; const p0 = gh.putBodies.length; console.log('   esito:', await ui(B.page)); console.log('   nessuna scrittura =', gh.putBodies.length===p0); gh.private = true;
  console.log('— token senza permesso di scrittura');
  gh.push = false; console.log('   esito:', await ui(B.page)); gh.push = true;
  console.log('— repository inesistente o senza accesso');
  gh.exists = false; console.log('   esito:', await ui(B.page)); gh.exists = true;
  console.log('— nel repository c\'è un file con lo stesso nome ma non di Mia: non viene sovrascritto');
  const keep = gh.file; gh.file = JSON.stringify({ciao:1}); gh.sha++; const p1 = gh.putBodies.length; console.log('   esito:', await ui(B.page)); console.log('   nessuna scrittura =', gh.putBodies.length===p1); gh.file = keep; gh.sha++;

  console.log('— sincronizzazione automatica all\'apertura');
  gh.private = true;
  const C = await device(mkSettings({syncAuto:true}));
  await C.page.waitForFunction(()=>JSON.parse(localStorage.getItem('miaai_v1_conversations')||'[]').length>0,null,{timeout:15000});
  console.log('   chat scaricate da sole =', await titles(C.page));
  console.log('— senza configurazione non succede nulla');
  const nReq = gh.tokens.size; const D = await device(mkSettings({syncRepo:'',syncAuto:true})); await D.page.waitForTimeout(2500);
  console.log('   nessuna chat =', (await stored(D.page)).length===0);
  console.log('ERRORS', errs);
  await br.close(); web.close();
})().catch(e=>{console.error('FAIL',e);process.exit(1)});
