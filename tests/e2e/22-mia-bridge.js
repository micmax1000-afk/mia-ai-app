/* Test end-to-end di Mia AI. Tutti i servizi esterni sono simulati: nessuna chiamata reale. Vedi tests/README.md */
const { createServer } = require('../../bridge/mia-bridge.js');
const http = require('http'); const path = require('path'); const fs = require('fs');
const TMP = fs.mkdtempSync(path.join(require('os').tmpdir(), 'mia-test-'));
const root = path.join(TMP,'broot');
fs.mkdirSync(path.join(root,'src'),{recursive:true}); fs.writeFileSync(path.join(root,'src','a.txt'),'ciao mondo\n');
fs.mkdirSync(path.join(TMP,'outside'),{recursive:true}); fs.writeFileSync(path.join(TMP,'outside','segreto.txt'),'segreto fuori\n'); fs.symlinkSync('../outside', path.join(root,'link-fuori'));
const srv = createServer({root: fs.realpathSync(root), token:'tokenlungoabbastanza123', readonly:false}).listen(0,'127.0.0.1', async () => {
  const port = srv.address().port;
  const rpc = (method, params, token='tokenlungoabbastanza123', id=1) => new Promise(res => { const body = JSON.stringify({jsonrpc:'2.0', id, method, params}); const r = http.request({port, method:'POST', headers:{'content-type':'application/json', ...(token?{authorization:'Bearer '+token}:{})}}, resp => { let d=''; resp.on('data',c=>d+=c); resp.on('end',()=>res({status:resp.statusCode, sid:resp.headers['mcp-session-id'], body:d?JSON.parse(d):null})); }); r.end(body); });
  const call = async (name, args) => { const r = await rpc('tools/call',{name,arguments:args}); const x = r.body.result || r.body.error; return (x.isError?'[ERRORE] ':'')+x.content[0].text.replace(/\n/g,' ⏎ ').slice(0,200); };
  console.log('senza token  →', (await rpc('initialize',{},null)).status);
  console.log('token errato →', (await rpc('initialize',{},'sbagliato')).status);
  const init = await rpc('initialize',{protocolVersion:'2025-06-18'}); console.log('initialize   →', init.status, init.body.result.serverInfo.name, '| sessione:', !!init.sid);
  console.log('notifica     →', (await new Promise(res=>{const r=http.request({port,method:'POST',headers:{authorization:'Bearer tokenlungoabbastanza123'}},x=>res(x.statusCode));r.end(JSON.stringify({jsonrpc:'2.0',method:'notifications/initialized'}))})));
  const list = (await rpc('tools/list',{})).body.result.tools; console.log('strumenti    →', list.map(t=>t.name+(t.annotations.readOnlyHint?'(lettura)':'')).join(', '));
  console.log('list_dir     →', await call('list_dir',{path:''}));
  console.log('read_file    →', await call('read_file',{path:'src/a.txt'}));
  console.log('write_file   →', await call('write_file',{path:'nuova/cartella/b.txt', content:'uno\ndue\ntre'}));
  console.log('edit_file    →', await call('edit_file',{path:'nuova/cartella/b.txt', old_text:'due', new_text:'DUE'}));
  console.log('  dopo       →', fs.readFileSync(path.join(root,'nuova/cartella/b.txt'),'utf8').replace(/\n/g,'|'));
  console.log('edit duplic. →', await call('edit_file',{path:'src/a.txt', old_text:'o', new_text:'0'}));
  console.log('edit assente →', await call('edit_file',{path:'src/a.txt', old_text:'zzz', new_text:'y'}));
  console.log('run echo     →', await call('run_command',{command:'echo ciao && pwd'}));
  console.log('run cwd      →', await call('run_command',{command:'cat a.txt', cwd:'src'}));
  console.log('run exit 3   →', await call('run_command',{command:'echo prima; exit 3'}));
  const t0=Date.now(); console.log('run timeout  →', await call('run_command',{command:'sleep 30', timeout_seconds:1}), (Date.now()-t0)+'ms');
  console.log('--- tentativi di uscire dalla cartella:');
  console.log('  ../         →', await call('read_file',{path:'../outside/segreto.txt'}));
  console.log('  assoluto    →', await call('read_file',{path:'/etc/passwd'}));
  console.log('  symlink     →', await call('read_file',{path:'link-fuori/segreto.txt'}));
  console.log('  scrivi symlink →', await call('write_file',{path:'link-fuori/nuovo.txt', content:'x'}), '| esiste fuori?', fs.existsSync(path.join(TMP,'outside/nuovo.txt')));
  console.log('  cwd fuori   →', await call('run_command',{command:'ls', cwd:'..'}));
  console.log('metodo ignoto→', JSON.stringify((await rpc('boh',{})).body.error));
  srv.close();
  // modalità sola lettura
  const ro = createServer({root: fs.realpathSync(root), token:'tokenlungoabbastanza123', readonly:true}).listen(0,'127.0.0.1', async () => {
    const p2 = ro.address().port; const r = http.request({port:p2,method:'POST',headers:{authorization:'Bearer tokenlungoabbastanza123'}}, resp=>{let d='';resp.on('data',c=>d+=c);resp.on('end',()=>{console.log('sola lettura →', JSON.parse(d).result.tools.map(t=>t.name).join(', ')); ro.close();});}); r.end(JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/list'}));
  });
});
