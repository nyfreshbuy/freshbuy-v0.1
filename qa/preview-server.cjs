// Local preview: static files from this checkout; production public GET APIs only.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../frontend');
const types = {'.html':'text/html','.css':'text/css','.js':'text/javascript','.json':'application/json','.svg':'image/svg+xml','.png':'image/png','.ico':'image/x-icon','.webmanifest':'application/manifest+json'};
http.createServer(async (req,res) => {
  const url = new URL(req.url,'http://localhost');
  if (req.method !== 'GET') { res.writeHead(405); return res.end('Read-only preview'); }
  if (url.pathname.startsWith('/api/')) {
    try {
      const r = await fetch('https://nyfreshbuy.com' + req.url);
      res.writeHead(r.status,{'content-type':r.headers.get('content-type') || 'application/json'});
      return res.end(Buffer.from(await r.arrayBuffer()));
    } catch (e) { res.writeHead(502); return res.end(JSON.stringify({success:false})); }
  }
  let route = url.pathname === '/' ? '/user/index.html' : decodeURIComponent(url.pathname);
  if (route.startsWith('/assets/')) route = '/user' + route;
  const file = path.resolve(root,'.' + route);
  if (!file.startsWith(root + '/')) {res.writeHead(403); return res.end();}
  try { const data = fs.readFileSync(file); res.writeHead(200,{'content-type':types[path.extname(file)] || 'application/octet-stream'});res.end(data); }
  catch (_) {res.writeHead(404);res.end('Not found');}
}).listen(4173,'127.0.0.1',()=>console.log('Preview ready: http://127.0.0.1:4173/user/index.html'));
