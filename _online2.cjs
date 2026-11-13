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
const click = (text) => `(() => { const b = [...document.querySelectorAll('button')].find(x => x.textContent.trim().includes(${JSON.stringify(text)})); if (!b) return 'no-button'; if (b.disabled) return 'disabled'; b.click(); return 'clicked'; })()`;
async function waitFor(p, expr, ms = 30000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { const v = await p.ev(expr); if (v && v !== 'null' && v !== 'false' && v !== 'no-button' && v !== 'disabled') return v; await sleep(600); }
  return 'timeout';
}
(async () => {
  const A = await open(app + '/');
  console.log('A ready:', await waitFor(A, `document.querySelector('#screen-home').textContent.length > 40 ? 'ok' : null`, 25000));
  console.log('A criar:', await A.ev(click('Criar Sala')));
  const code = await waitFor(A, `(() => { const e = document.querySelector('.room-code'); return e && e.textContent.trim().length === 4 ? e.textContent.trim() : null; })()`, 35000);
  console.log('CODE:', code);

  const B = await open(app + '/?room=' + code);
  console.log('B setup:', await waitFor(B, `(() => { const b = [...document.querySelectorAll('button')].find(x => x.textContent.trim().includes('Entrar')); return b ? 'has-button' : null; })()`, 35000));
  console.log('B entrar:', await B.ev(click('Entrar')));
  console.log('B lobby:', await waitFor(B, `(() => !document.querySelector('#screen-lobby').hidden ? 'lobby' : null)()`, 40000));
  console.log('B pronto:', await B.ev(click('Estou pronto')));
  await sleep(3000);
  console.log('A iniciar:', await A.ev(click('Iniciar partida')));
  console.log('A game:', await waitFor(A, `(() => !document.querySelector('#screen-game').hidden ? 'game' : null)()`, 25000));
  console.log('B game:', await waitFor(B, `(() => !document.querySelector('#screen-game').hidden ? 'game' : null)()`, 25000));
  await sleep(6000);
  console.log('A state:', await A.ev(`JSON.stringify({seats: __ludo.state.seats.length, v: __ludo.state.stateVersion, seat: __ludo.state.turn.seat})`));
  console.log('B state:', await B.ev(`JSON.stringify({seats: __ludo.state.seats.length, v: __ludo.state.stateVersion, seat: __ludo.state.turn.seat})`));
  await sleep(7000);
  console.log('A later:', await A.ev(`JSON.stringify({v: __ludo.state.stateVersion, seat: __ludo.state.turn.seat})`));
  console.log('B later:', await B.ev(`JSON.stringify({v: __ludo.state.stateVersion, seat: __ludo.state.turn.seat})`));
  await A.shot('imagens/v2-online-host.png');
  await B.shot('imagens/v2-online-guest.png');
  console.log('LOGS-A', A.logs.slice(0, 3).join(' | ') || '(sem erros)');
  console.log('LOGS-B', B.logs.slice(0, 3).join(' | ') || '(sem erros)');
  A.ws.close(); B.ws.close();
  process.exit(0);
})().catch(e => { console.error('CDP', e.message); process.exit(1); });
