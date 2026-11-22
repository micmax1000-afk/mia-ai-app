/* Test end-to-end di Mia AI. Tutti i servizi esterni sono simulati: nessuna chiamata reale. Vedi tests/README.md */
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const TMP = fs.mkdtempSync(path.join(require('os').tmpdir(), 'mia-test-'));
const root = path.resolve(__dirname, '..', '..');
const mime = { '.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.webmanifest':'application/json' };
const web = http.createServer((q,r)=>{ let p=q.url.split('?')[0]; if(p==='/')p='/index.html'; const f=path.join(root,p); fs.readFile(f,(e,d)=>{ if(e){r.writeHead(404);r.end();return;} r.writeHead(200,{'content-type':mime[path.extname(f)]||'application/octet-stream'}); r.end(d);});}).listen(8082);
(async () => {
  const b = await chromium.launch(); const ctx = await b.newContext(); const page = await ctx.newPage();
  const cors={'access-control-allow-origin':'*','access-control-allow-headers':'*','access-control-allow-methods':'*','access-control-expose-headers':'X-Accepted-GitHub-Permissions, X-OAuth-Scopes'};
  await ctx.route('https://api.github.com/**', async route => { const r=route.request(); if (r.method()==='OPTIONS') return route.fulfill({status:204,headers:cors}); const u=new URL(r.url());
    if (u.pathname.endsWith('/issues/1/comments')) return route.fulfill({status:403,headers:{...cors,'content-type':'application/json','x-accepted-github-permissions':'issues=write; pull_requests=write'},body:JSON.stringify({message:'Resource not accessible by personal access token',documentation_url:'https://docs.github.com/rest/issues/comments#create-an-issue-comment',status:'403'})});
    if (u.pathname.endsWith('/issues/2/comments')) return route.fulfill({status:403,headers:{...cors,'content-type':'application/json','x-oauth-scopes':'public_repo'},body:JSON.stringify({message:'Must have admin rights to Repository.'})});
    if (u.pathname.endsWith('/issues/3/comments')) return route.fulfill({status:403,headers:{...cors,'content-type':'application/json'},body:JSON.stringify({message:'You have exceeded a secondary rate limit.'})});
    return route.fulfill({status:404,headers:{...cors,'content-type':'application/json'},body:'{"message":"Not Found"}'}); });
  await page.goto('http://localhost:8082/');
  const run = (tok,n) => page.evaluate(async ([tok,n]) => { try { await MiaTools.run('github_issues',{owner:'micmax1000-afk',repo:'Prova',action:'comment',number:n,body:'Funziona'},{token:tok}); return 'OK'; } catch(e){ return e.message; } }, [tok,n]);
  console.log('fine-grained + permessi richiesti:\n ', await run('github_pat_AAA',1));
  console.log('classic con scope:\n ', await run('ghp_BBB',2));
  console.log('limite di velocità (messaggio invariato):\n ', await run('github_pat_AAA',3));
  console.log('404 (token fine-grained):\n ', await run('github_pat_AAA',9));
  await b.close(); web.close();
})();
