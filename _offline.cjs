const fs = require('fs');
const base = 'http://127.0.0.1:9333';
const url = 'http://127.0.0.1:5173/';
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function connect(targetUrl) {
  const t = await (await fetch(base + '/json/new?' + encodeURIComponent(targetUrl), { method: 'PUT' })).json();
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  let id = 0; const pending = new Map(); const logs = [];
  const send = (m, p = {}) => new Promise(res => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
  ws.onmessage = ev => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result || {}); pending.delete(m.id); }
    else if (m.method === 'Runtime.exceptionThrown') logs.push('EXC: ' + (m.params.exceptionDetails.exception?.description || '').split('\n')[0]);
  };
  await new Promise(r => { ws.onopen = r; });
  await send('Runtime.enable'); await send('Page.enable'); await send('Network.enable');
  const ev = async (code) => { const r = await send('Runtime.evaluate', { expression: code, returnByValue: true, awaitPromise: true }); return r.exceptionDetails ? 'ERR:' + (r.exceptionDetails.exception?.description || '').split('\n')[0] : r.result?.value; };
  return { send, ev, logs, ws };
}
(async () => {
  const p = await connect(url);
  await sleep(9000);
  console.log('SW', await p.ev(`(async () => { const r = await navigator.serviceWorker.getRegistration(); return JSON.stringify({ reg: !!r, active: r && r.active && r.active.state, caches: await caches.keys() }); })()`));
  console.log('CACHE', await p.ev(`(async () => { const c = await caches.open('ludo-v2.0.1-wood3d'); const keys = await c.keys(); return JSON.stringify({ total: keys.length, hasThree: !!(await c.match('./vendor/three.module.min.js')), hasMain: !!(await c.match('./js/main.js')), hasIndex: !!(await c.match('./index.html')) }); })()`));
  await p.send('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0 });
  await p.send('Page.reload', { ignoreCache: false });
  await sleep(7000);
  console.log('OFFLINE', await p.ev(`JSON.stringify({ online: navigator.onLine, title: document.title, home: !!document.querySelector('#screen-home') && document.querySelector('#screen-home').textContent.length > 40, canvas: (document.getElementById('stage')||{}).width, view: !!window.__ludoView })`));
  const shot = await p.send('Page.captureScreenshot', { format: 'png' });
  if (shot.data) { fs.writeFileSync('imagens/v2-offline.png', Buffer.from(shot.data, 'base64')); console.log('shot offline'); }
  console.log('LOGS', p.logs.slice(0, 4).join(' | ') || '(sem erros)');
  p.ws.close();
})().catch(e => { console.error('CDP', e.message); process.exit(1); });
