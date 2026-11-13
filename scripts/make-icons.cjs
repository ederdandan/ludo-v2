// Gera os ícones do PWA a partir de um SVG do tabuleiro (madeira + resina + latão + dado).
// Uso: Chrome com --remote-debugging-port=9333 aberto; `node scripts/make-icons.cjs`.
const fs = require('fs');
const path = require('path');
const OUT = path.join(__dirname, '..', 'icons');
const CDP = 'http://127.0.0.1:9333';

const C = { red: '#b3181a', green: '#146b2b', yellow: '#c08a1e', blue: '#2a4090' };
const LIGHT = { red: '#e0473f', green: '#2e9a4c', yellow: '#e9b546', blue: '#4a66c4' };

// Conteúdo do tabuleiro no sistema 15×15 casas (casa = 10).
function board() {
  const cells = [];
  const cell = (r, c, fill) => cells.push(`<rect x="${c * 10 + 0.6}" y="${r * 10 + 0.6}" width="8.8" height="8.8" rx="1.4" fill="${fill}"/>`);
  for (let i = 0; i < 15; i++) for (let j = 6; j <= 8; j++) {
    if (i >= 6 && i <= 8) continue;
    cell(i, j, '#efe2c4'); cell(j, i, '#efe2c4');
  }
  for (let k = 1; k <= 5; k++) {
    cell(7, k, `url(#r-red)`); cell(k, 7, `url(#r-green)`);
    cell(7, 14 - k, `url(#r-yellow)`); cell(14 - k, 7, `url(#r-blue)`);
  }
  cell(6, 1, C.red); cell(1, 8, C.green); cell(8, 13, C.yellow); cell(13, 6, C.blue);

  const base = (x, y, color) => {
    const rings = [[16, 16], [44, 16], [16, 44], [44, 44]]
      .map(([a, b]) => `<circle cx="${x + a}" cy="${y + b}" r="6.2" fill="rgba(0,0,0,.18)" stroke="#e8c87e" stroke-width="1.3"/>`).join('');
    return `<rect x="${x + 3}" y="${y + 3}" width="54" height="54" rx="7" fill="#8a5a2b"/>
      <rect x="${x + 4.5}" y="${y + 4.5}" width="51" height="51" rx="6" fill="url(#r-${color})" stroke="#d9b56a" stroke-width="1.1"/>
      <path d="M${x + 9} ${y + 12} q 16 -6 38 -2" stroke="rgba(255,255,255,.28)" stroke-width="3" fill="none" stroke-linecap="round"/>${rings}`;
  };

  const tri = (pts, color) => `<polygon points="${pts}" fill="url(#r-${color})" stroke="#d9b56a" stroke-width=".8"/>`;
  const center = tri('60,60 75,75 60,90', 'red') + tri('60,60 90,60 75,75', 'green') +
    tri('90,60 90,90 75,75', 'yellow') + tri('60,90 75,75 90,90', 'blue');

  // dado em destaque no centro (face 5), com sombra e brilho
  const pip = (x, y) => `<circle cx="${x}" cy="${y}" r="2.2" fill="#1b1512"/>`;
  const die = `<g transform="translate(75 75) rotate(-12)">
      <rect x="-15" y="-13" width="32" height="32" rx="7" fill="rgba(0,0,0,.35)"/>
      <rect x="-16" y="-16" width="32" height="32" rx="7" fill="url(#die)" stroke="#bfae8e" stroke-width=".8"/>
      ${pip(-8, -8)}${pip(8, -8)}${pip(0, 0)}${pip(-8, 8)}${pip(8, 8)}
    </g>`;

  return `
    <rect x="-9" y="-9" width="168" height="168" rx="16" fill="#6b4220"/>
    <rect x="-8" y="-8" width="166" height="164" rx="15" fill="url(#wood)"/>
    <rect x="-8" y="-8" width="166" height="166" rx="15" fill="url(#grain)" opacity=".5"/>
    <rect x="-3" y="-3" width="156" height="156" rx="10" fill="none" stroke="#e2c27c" stroke-width="1.6"/>
    ${base(0, 0, 'red')}${base(90, 0, 'green')}${base(0, 90, 'blue')}${base(90, 90, 'yellow')}
    ${cells.join('')}${center}${die}`;
}

function defs() {
  const resin = Object.keys(C).map(k => `<radialGradient id="r-${k}" cx="35%" cy="30%" r="80%">
      <stop offset="0" stop-color="${LIGHT[k]}"/><stop offset=".55" stop-color="${C[k]}"/><stop offset="1" stop-color="${C[k]}" stop-opacity=".95"/></radialGradient>`).join('');
  return `<defs>${resin}
    <linearGradient id="wood" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#e3b679"/><stop offset=".5" stop-color="#d09b5c"/><stop offset="1" stop-color="#b47b3d"/></linearGradient>
    <pattern id="grain" width="166" height="9" patternUnits="userSpaceOnUse" patternTransform="rotate(-4)">
      <path d="M0 3 Q 40 1.5 83 3.5 T 166 3" stroke="#9c6630" stroke-width=".7" fill="none" opacity=".55"/>
      <path d="M0 7 Q 50 8.5 100 6.5 T 166 7.5" stroke="#f1cf98" stroke-width=".5" fill="none" opacity=".6"/></pattern>
    <linearGradient id="die" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#fffaf0"/><stop offset="1" stop-color="#e2d3b6"/></linearGradient>
    <radialGradient id="bg" cx="50%" cy="38%" r="75%">
      <stop offset="0" stop-color="#2a3344"/><stop offset="1" stop-color="#121721"/></radialGradient>
  </defs>`;
}

// scale: fração do lado ocupada pelo tabuleiro; bg: fundo sólido (maskable/apple)
function svg({ scale, bg }) {
  const s = (512 * scale) / 168, o = (512 - 168 * s) / 2 + 9 * s;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">${defs()}
  ${bg ? '<rect width="512" height="512" fill="url(#bg)"/>' : ''}
  <g transform="translate(${o} ${o + (bg ? 0 : 0)}) scale(${s})">${board()}</g></svg>`;
}

const variants = [
  { file: 'icon.svg', svg: svg({ scale: 0.96, bg: false }) },
  { file: 'icon-192.png', size: 192, svg: svg({ scale: 0.96, bg: false }) },
  { file: 'icon-512.png', size: 512, svg: svg({ scale: 0.96, bg: false }) },
  { file: 'icon-maskable-512.png', size: 512, svg: svg({ scale: 0.7, bg: true }) },
  { file: 'icon-maskable-192.png', size: 192, svg: svg({ scale: 0.7, bg: true }) },
  { file: 'apple-touch-icon.png', size: 180, svg: svg({ scale: 0.84, bg: true }) },
  { file: 'favicon-32.png', size: 32, svg: svg({ scale: 1, bg: false }) },
];

(async () => {
  const t = await (await fetch(CDP + '/json/new?about:blank', { method: 'PUT' })).json();
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  let id = 0; const pending = new Map();
  const send = (m, p = {}) => new Promise(res => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
  ws.onmessage = ev => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result || {}); pending.delete(m.id); } };
  await new Promise(r => { ws.onopen = r; });
  await send('Page.enable');
  await send('Emulation.setDefaultBackgroundColorOverride', { color: { r: 0, g: 0, b: 0, a: 0 } });
  for (const v of variants) {
    if (!v.size) { fs.writeFileSync(path.join(OUT, v.file), v.svg); continue; }
    await send('Emulation.setDeviceMetricsOverride', { width: v.size, height: v.size, deviceScaleFactor: 1, mobile: false });
    const html = `<html><body style="margin:0;background:transparent">${v.svg.replace('width="512" height="512"', `width="${v.size}" height="${v.size}"`)}</body></html>`;
    await send('Page.navigate', { url: 'data:text/html;base64,' + Buffer.from(html).toString('base64') });
    await new Promise(r => setTimeout(r, 400));
    const shot = await send('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width: v.size, height: v.size, scale: 1 } });
    fs.writeFileSync(path.join(OUT, v.file), Buffer.from(shot.data, 'base64'));
    console.log('ok', v.file);
  }
  await send('Page.close'); ws.close();
})().catch(e => { console.error(e.message); process.exit(1); });
