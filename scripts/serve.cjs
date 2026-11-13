const http = require('http'), fs = require('fs'), path = require('path');
const MIME = { '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.mjs':'text/javascript; charset=utf-8',
  '.css':'text/css; charset=utf-8', '.json':'application/json; charset=utf-8', '.png':'image/png', '.jpg':'image/jpeg',
  '.svg':'image/svg+xml', '.woff2':'font/woff2', '.ico':'image/x-icon', '.webmanifest':'application/manifest+json' };
const port = Number(process.argv[2] || 8099);
http.createServer((req, res) => {
  const url = decodeURIComponent(req.url.split('?')[0]);
  let file = path.join(process.cwd(), url === '/' ? 'index.html' : url);
  fs.readFile(file, (e, d) => {
    if (e) { res.writeHead(404, {'Content-Type':'text/plain'}); res.end('404'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(d);
  });
}).listen(port, () => console.log('http://127.0.0.1:' + port));
