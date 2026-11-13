const fs = require('fs');
const base = 'http://127.0.0.1:9333';
const app = 'http://127.0.0.1:5173';
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function open(url) {
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
  await send('Runtime.enable'); await send('Page.enable');
  const ev = async (code) => { const r = await send('Runtime.evaluate', { expression: code, returnByValue: true, awaitPromise: true }); return r.exceptionDetails ? 'ERR:' + (r.exceptionDetails.exception?.description || '').split('\n')[0] : r.result?.value; };
  const shot = async (n) => { const s = await send('Page.captureScreenshot', { format: 'png' }); if (s.data) fs.writeFileSync(n, Buffer.from(s.data, 'base64')); };
  return { ev, shot, logs, ws };
}
const clickExpr = (text) => `(() => { const b = [...document.querySelectorAll('button')].find(x => x.textContent.trim().includes(${JSON.stringify(text)})); if (!b) return 'no-button'; if (b.disabled) return 'disabled'; b.click(); return 'clicked'; })()`;
async function waitFor(p, expr, ms) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { const v = await p.ev(expr); if (v === 'ok') return v; await sleep(600); }
  return 'timeout';
}
async function waitClick(p, text, ms = 30000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { const v = await p.ev(clickExpr(text)); if (v === 'clicked') return 'clicked'; await sleep(700); }
  return 'timeout:' + text;
}
(async () => {
  const A = await open(app + '/');
  console.log('A home:', await waitFor(A, `(() => { const el = document.querySelector('#screen-home'); return el && el.textContent.length > 40 ? 'ok' : null; })()`, 30000));
  console.log('A criar:', await waitClick(A, 'Criar Sala', 15000));
  const code = await waitFor(A, `(() => { const e = document.querySelector('.room-code'); return e && e.textContent.trim().length === 4 ? 'ok' : null; })()`, 40000);
  console.log('CODE-OK:', code);
  const room = await A.ev(`(document.querySelector('.room-code')||{}).textContent.trim()`);
  console.log('ROOM:', room);
  if (code !== 'ok') { await A.shot('imagens/_fail-host.png'); process.exit(2); }

  const B = await open(app + '/?room=' + room);
  console.log('B setup:', await waitFor(B, `(() => { const b = [...document.querySelectorAll('button')].find(x => x.textContent.trim().includes('Entrar')); return b ? 'ok' : null; })()`, 35000));
  console.log('B entrar:', await waitClick(B, 'Entrar', 15000));
  console.log('B lobby:', await waitFor(B, `(() => !document.querySelector('#screen-lobby').hidden ? 'ok' : null)()`, 40000));
  console.log('B pronto:', await waitClick(B, 'Estou pronto', 20000));
  await sleep(3000);
  console.log('A iniciar:', await waitClick(A, 'Iniciar partida', 25000));
  console.log('A game:', await waitFor(A, `(() => !document.querySelector('#screen-game').hidden ? 'ok' : null)()`, 30000));
  console.log('B game:', await waitFor(B, `(() => !document.querySelector('#screen-game').hidden ? 'ok' : null)()`, 30000));
  await sleep(8000);
  console.log('A state:', await A.ev(`(() => { const s = window.__ludo && __ludo.state; return s ? JSON.stringify({seats: s.seats.length, v: s.stateVersion, seat: s.turn.seat}) : 'null'; })()`));
  console.log('B state:', await B.ev(`(() => { const s = window.__ludo && __ludo.state; return s ? JSON.stringify({seats: s.seats.length, v: s.stateVersion, seat: s.turn.seat}) : 'null'; })()`));
  await sleep(8000);
  console.log('A later:', await A.ev(`JSON.stringify({v: __ludo.state.stateVersion, seat: __ludo.state.turn.seat})`));
  console.log('B later:', await B.ev(`JSON.stringify({v: __ludo.state.stateVersion, seat: __ludo.state.turn.seat})`));
  await A.shot('imagens/v2-online-host.png');
  await B.shot('imagens/v2-online-guest.png');
  console.log('LOGS-A', A.logs.slice(0, 3).join(' | ') || '(sem erros)');
  console.log('LOGS-B', B.logs.slice(0, 3).join(' | ') || '(sem erros)');
  A.ws.close(); B.ws.close();
  process.exit(0);
})().catch(e => { console.error('CDP', e.message); process.exit(1); });
