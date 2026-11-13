const fs = require('fs');
const base = 'http://127.0.0.1:9333';
const url = 'http://127.0.0.1:5173/';
const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  const t = await (await fetch(base + '/json/new?' + encodeURIComponent(url), { method: 'PUT' })).json();
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
  await sleep(12000);
  console.log('ONLINE-SW', await ev(`(async () => { const list = await navigator.serviceWorker.getRegistrations(); return JSON.stringify({ regs: list.length, states: list.map(r => r.active && r.active.state), ctrl: navigator.serviceWorker.controller && navigator.serviceWorker.controller.scriptURL, ready: document.readyState, view: !!window.__ludoView }); })()`));
  await send('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0 });
  await send('Page.reload', { ignoreCache: false });
  await sleep(13000);
  console.log('OFFLINE-PAGE', await ev(`JSON.stringify({ online: navigator.onLine, ready: document.readyState, home: (document.querySelector('#screen-home')||{}).textContent.length, canvas: (document.getElementById('stage')||{}).width, view: !!window.__ludoView, ctrl: !!(navigator.serviceWorker.controller) })`));
  const shot = await send('Page.captureScreenshot', { format: 'png' });
  if (shot.data) { fs.writeFileSync('imagens/v2-offline.png', Buffer.from(shot.data, 'base64')); console.log('shot offline'); }
  await send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
  console.log('LOGS', logs.slice(0, 4).join(' | ') || '(sem erros)');
  ws.close();
})().catch(e => { console.error('CDP', e.message); process.exit(1); });
