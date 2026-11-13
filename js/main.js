// Controlador + HUD + rede — portado de index.html v1 para a cena 3D.
/* =========================================================
   Controlador (Solo / Hotseat / Online) + HUD 3D
   A camada 2D do tabuleiro deu lugar à cena Three.js em
   js/scene3d/*. Regras, bots e rede continuam idênticos.
   ========================================================= */
import { LudoEngine } from './game-engine.js';
import { createView } from './scene3d/WorldManager.js';

const E = LudoEngine;
const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;
const MOBILE = matchMedia('(max-width: 899px)').matches;
const STEP_MS = REDUCED ? 40 : 120;
const DICE_MS = REDUCED ? 200 : 600;

const CMETA = {
  red: { name: 'Vermelho', sym: '●' },
  green: { name: 'Verde', sym: '▲' },
  yellow: { name: 'Amarelo', sym: '■' },
  blue: { name: 'Azul', sym: '◆' },
};
const LEVELS = [['easy', 'Fácil'], ['medium', 'Médio'], ['hard', 'Difícil']];
const LEVEL_NAME = Object.fromEntries(LEVELS);
const SPEEDS = [['slow', 'Lenta'], ['normal', 'Normal'], ['fast', 'Rápida']];
const SPEED_MS = { slow: 1500, normal: 800, fast: 300 };
const AVATARS = ['😀', '😎', '🦊', '🐼', '🐯', '🦁', '🐸', '🐙', '👑', '🚀', '⚡', '🍕', '🎩', '🐧', '🦄', '🔥'];
const LOCAL_AVATARS = ['😀', '😎', '🦊', '🐼'];
const BOT_AVATAR = '🤖';
const PIP_LAYOUT = { 1: [4], 2: [0, 8], 3: [0, 4, 8], 4: [0, 2, 6, 8], 5: [0, 2, 4, 6, 8], 6: [0, 2, 3, 5, 6, 8] };

const RULE_DEFS = [
  { key: 'exitOnOne', label: 'Sair da base com 1 ou 6', def: false },
  { key: 'blocks', label: 'Bloqueio (barreira de 2 peões)', def: false },
  { key: 'captureBonus', label: 'Rolagem extra ao capturar', def: true },
  { key: 'finishBonus', label: 'Rolagem extra ao chegar ao centro', def: true },
  { key: 'threeSixesLimit', label: 'Limite de três 6 seguidos', def: true },
  { key: 'threeSixesPenalty', label: 'Penalidade dos três 6 (peão volta à base)', def: false },
  { key: 'exactFinish', label: 'Número exato para o centro', def: true },
  { key: 'endOnFirstWinner', label: 'Encerrar no 1º vencedor', def: false },
  { key: 'autoSingleMove', label: 'Movimento automático quando há só um', def: true },
  { key: 'quickMode', label: 'Modo rápido (1 peão já na saída)', def: false },
  { key: 'teams', label: 'Modo duplas: ●+■ contra ▲+◆ (só com 4 jogadores)', def: false },
];
const defaultRuleToggles = () => Object.fromEntries(RULE_DEFS.map(r => [r.key, r.def]));
const toEngineRules = (t) => ({
  exitOn: t.exitOnOne ? [1, 6] : [6],
  blocks: !!t.blocks, captureBonus: !!t.captureBonus, finishBonus: !!t.finishBonus,
  threeSixesLimit: !!t.threeSixesLimit, threeSixesPenalty: !!t.threeSixesPenalty,
  exactFinish: !!t.exactFinish, endOnFirstWinner: !!t.endOnFirstWinner,
  autoSingleMove: !!t.autoSingleMove, quickMode: !!t.quickMode, teams: !!t.teams,
});

// ---------- Utilidades ----------
const $ = (s, el = document) => el.querySelector(s);
const wait = (ms) => new Promise(r => setTimeout(r, ms));
function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'text') el.textContent = v;
    else if (k === 'style') el.setAttribute('style', v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}
const Store = {
  get(k, def) { try { const v = localStorage.getItem(k); return v == null ? def : JSON.parse(v); } catch { return def; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* armazenamento indisponível */ } },
  del(k) { try { localStorage.removeItem(k); } catch { /* idem */ } },
};
const cleanName = (n) => (n || '').trim().slice(0, 12);

function fillAvatar(el, avatar) {
  el.textContent = '';
  if (typeof avatar === 'string' && avatar.startsWith('data:image/')) {
    const img = new Image();
    img.alt = '';
    img.src = avatar;
    el.append(img);
  } else {
    el.textContent = avatar || '🙂';
  }
  return el;
}
const avatarEl = (avatar, color, extra = '') => {
  const el = h('span', { class: 'avatar ' + extra });
  if (color) el.style.setProperty('--c', `var(--${color})`);
  return fillAvatar(el, avatar);
};

let toastTimer = null;
function toast(msg) {
  document.querySelectorAll('.toast').forEach(t => t.remove());
  const el = h('div', { class: 'toast', role: 'status', text: msg });
  document.body.append(el);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.remove(), 2600);
}

function openModal(content, { dismissable = true, onClose } = {}) {
  const back = h('div', { class: 'modal-back' });
  const box = h('div', { class: 'modal-box', role: 'dialog', 'aria-modal': 'true' }, content);
  back.append(box);
  const close = () => { back.remove(); onClose && onClose(); };
  if (dismissable) back.addEventListener('click', e => { if (e.target === back) close(); });
  $('#modal-root').append(back);
  const focusable = box.querySelector('button, input');
  if (focusable) focusable.focus();
  return close;
}

// ---------- Som (WebAudio, sem arquivos) ----------
const Sound = {
  muted: Store.get('ludo:mute', false),
  ctx: null,
  tone(freq, dur, type = 'sine', vol = 0.15, when = 0) {
    const c = this.ctx;
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = type;
    o.frequency.value = freq;
    const t = c.currentTime + when;
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g).connect(c.destination);
    o.start(t);
    o.stop(t + dur + 0.02);
  },
  play(kind) {
    if (this.muted) return;
    try {
      this.ctx = this.ctx || new (window.AudioContext || window.webkitAudioContext)();
      if (this.ctx.state === 'suspended') this.ctx.resume();
    } catch { return; }
    switch (kind) {
      case 'dice': for (let i = 0; i < 6; i++) this.tone(260 + Math.random() * 480, 0.05, 'square', 0.04, i * 0.08); break;
      case 'move': this.tone(640, 0.06, 'triangle', 0.1); break;
      case 'capture': this.tone(520, 0.12, 'sawtooth', 0.1); this.tone(240, 0.28, 'sawtooth', 0.1, 0.1); break;
      case 'home': [523, 659, 784].forEach((f, i) => this.tone(f, 0.16, 'triangle', 0.14, i * 0.09)); break;
      case 'win': [523, 659, 784, 1047].forEach((f, i) => this.tone(f, 0.32, 'triangle', 0.16, i * 0.13)); break;
      case 'turn': this.tone(880, 0.09, 'sine', 0.07); break;
      case 'nomove': this.tone(200, 0.22, 'sine', 0.1); break;
    }
  },
  toggle() { this.muted = !this.muted; Store.set('ludo:mute', this.muted); updateMuteButtons(); },
};
function updateMuteButtons() {
  document.querySelectorAll('[data-mute]').forEach(b => {
    b.innerHTML = `<i class="fa-solid ${Sound.muted ? 'fa-volume-xmark' : 'fa-volume-high'}"></i>`;
    b.setAttribute('aria-label', Sound.muted ? 'Ativar som' : 'Silenciar');
  });
}

function celebrate(big) {
  if (typeof window.confetti !== 'function') return;
  const count = REDUCED ? 30 : (big ? 200 : 50);
  window.confetti({ particleCount: count, spread: big ? 100 : 60, origin: { y: 0.6 }, disableForReducedMotion: false });
  if (big && !REDUCED) {
    setTimeout(() => window.confetti({ particleCount: 80, angle: 60, spread: 70, origin: { x: 0 } }), 250);
    setTimeout(() => window.confetti({ particleCount: 80, angle: 120, spread: 70, origin: { x: 1 } }), 400);
  }
}

// ---------- Cena 3D ----------
// Tabuleiro "Madeira Nobre & Resina". A cena é só visual; o estado
// continua sendo o do motor (Game.state), como na v1.
const ATTRACT = (() => {
  const pieces = {};
  for (const c of E.COLORS) pieces[c] = [-1, -1, -1, -1];
  return {
    seats: E.COLORS.map((color, i) => ({ seat: i, color, name: CMETA[color].name, isBot: false, finishedRank: null })),
    pieces,
    phase: 'playing',
    rules: E.DEFAULT_RULES,
    turn: { seat: 0, awaiting: 'roll', validMoves: [], dice: 6, consecutiveSixes: 0 },
  };
})();

const View = createView({
  canvas: document.getElementById('stage'),
  reducedMotion: REDUCED,
  mobile: MOBILE,
  onPick: (color, piece) => { if (canPick(color, piece)) actMove(piece); },
  onDieClick: () => actRoll(),
});
View.reset(ATTRACT);
requestAnimationFrame(() => {
  const boot = document.getElementById('boot');
  if (boot) { boot.style.opacity = '0'; setTimeout(() => boot.remove(), 450); }
});

// ---------- Dado (usado apenas no modal de sorteio) ----------
function makeDie(small = false) {
  const el = h('div', { class: 'die' + (small ? ' small' : '') });
  const pips = Array.from({ length: 9 }, () => h('span', { class: 'pip' }));
  el.append(...pips);
  const set = (v) => { pips.forEach((p, i) => { p.style.visibility = v && PIP_LAYOUT[v].includes(i) ? 'visible' : 'hidden'; }); el.dataset.value = v || ''; };
  const roll = async (v) => {
    el.classList.add('rolling');
    const end = Date.now() + DICE_MS;
    while (Date.now() < end) { set(1 + Math.floor(Math.random() * 6)); await wait(70); }
    el.classList.remove('rolling');
    set(v);
  };
  return { el, set, roll };
}

// ---------- Perfil ----------
let profile = Store.get('ludo:profile', { name: '', avatar: '😀' });
const saveProfile = () => Store.set('ludo:profile', profile);

async function processPhoto(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = url; });
    const size = Math.min(img.naturalWidth, img.naturalHeight);
    const cv = document.createElement('canvas');
    cv.width = cv.height = 90;
    cv.getContext('2d').drawImage(img, (img.naturalWidth - size) / 2, (img.naturalHeight - size) / 2, size, size, 0, 0, 90, 90);
    return cv.toDataURL('image/jpeg', 0.7);
  } finally {
    URL.revokeObjectURL(url);
  }
}

function openAvatarPicker(onDone = renderHome) {
  const fileInput = h('input', { type: 'file', accept: 'image/*', class: 'sr-only' });
  let close;
  fileInput.addEventListener('change', async () => {
    const f = fileInput.files && fileInput.files[0];
    if (!f) return;
    try {
      profile.avatar = await processPhoto(f);
      saveProfile();
      close();
      onDone();
    } catch { toast('Não foi possível ler a imagem.'); }
  });
  const grid = h('div', { class: 'grid grid-cols-4 gap-2 my-4' },
    AVATARS.map(a => h('button', {
      class: 'btn btn-ghost text-2xl', 'aria-label': `Avatar ${a}`,
      onclick: () => { profile.avatar = a; saveProfile(); close(); onDone(); },
    }, a)));
  close = openModal(h('div', {},
    h('h2', { class: 'text-lg font-bold', text: 'Escolha seu avatar' }),
    grid,
    h('label', { class: 'btn btn-ghost w-full cursor-pointer' }, h('i', { class: 'fa-solid fa-camera' }), 'Usar uma foto', fileInput),
    h('p', { class: 'text-xs text-slate-400 mt-2', text: 'A foto é recortada e reduzida para 90×90 neste aparelho.' }),
  ));
}

// ---------- Navegação ----------
function showScreen(name) {
  for (const id of ['home', 'setup', 'lobby', 'game']) $('#screen-' + id).hidden = id !== name;
  if (name === 'home') renderHome();
  window.scrollTo(0, 0);
}

function latestSave() {
  const a = Store.get('ludo:solo', null);
  const b = Store.get('ludo:local', null);
  const list = [a, b].filter(x => x && x.state && x.state.phase !== 'finished');
  list.sort((x, y) => (y.savedAt || 0) - (x.savedAt || 0));
  return list[0] || null;
}

function renderHome() {
  const root = $('#screen-home');
  root.innerHTML = '';
  const saved = latestSave();
  const lastHost = Store.get('ludo:lastHost', null);
  const hostSave = lastHost ? Store.get('ludo:host:' + lastHost, null) : null;
  const nameInput = h('input', { type: 'text', maxlength: '12', placeholder: 'Seu apelido', 'aria-label': 'Apelido', class: 'flex-1 min-w-0' });
  nameInput.value = profile.name || '';
  nameInput.addEventListener('input', () => { profile.name = nameInput.value.slice(0, 12); saveProfile(); });
  nameInput.addEventListener('blur', () => { profile.name = cleanName(nameInput.value); nameInput.value = profile.name; saveProfile(); });

  const logo = h('div', { class: 'grid grid-cols-2 gap-1 w-14 h-14 rotate-45 rounded-xl overflow-hidden shadow-lg' },
    ['red', 'green', 'blue', 'yellow'].map(c => h('div', { style: `background:var(--${c})` })));

  root.append(h('div', { class: 'max-w-md mx-auto px-4 py-8 flex flex-col gap-5 min-h-screen' },
    h('div', { class: 'flex items-center justify-between' },
      h('div', { class: 'flex items-center gap-4' }, logo,
        h('div', {}, h('h1', { class: 'text-3xl font-black tracking-tight', text: 'Ludo Supreme' }),
          h('p', { class: 'text-slate-400 text-sm', text: 'O Ludo clássico, no navegador' }))),
      h('button', { class: 'icon-btn', 'data-mute': '', onclick: () => Sound.toggle() })),
    h('div', { class: 'card flex items-center gap-3' },
      h('button', { class: 'shrink-0', 'aria-label': 'Trocar avatar', onclick: () => openAvatarPicker() },
        avatarEl(profile.avatar, null, '!w-14 !h-14 !text-3xl')),
      nameInput),
    saved ? h('button', { class: 'btn btn-primary w-full text-lg', onclick: () => resumeGame(saved) },
      h('i', { class: 'fa-solid fa-play' }), 'Continuar partida',
      h('span', { class: 'text-xs font-normal opacity-90', text: `(${saved.state.mode === 'solo' ? 'Solo' : 'Local'} · ${saved.state.seats.length} jogadores)` })) : null,
    h('button', { class: 'btn ' + (saved ? 'btn-ghost' : 'btn-primary') + ' w-full text-lg py-4', onclick: () => { renderSoloSetup(); showScreen('setup'); } },
      h('i', { class: 'fa-solid fa-robot' }), 'Jogar Sozinho'),
    h('button', { class: 'btn btn-ghost w-full', onclick: () => { renderLocalSetup(); showScreen('setup'); } },
      h('i', { class: 'fa-solid fa-users' }), 'Jogar no mesmo aparelho'),
    hostSave ? h('button', { class: 'btn btn-ghost w-full', onclick: () => hostRoom(hostSave) },
      h('i', { class: 'fa-solid fa-door-open' }), `Voltar à sala ${hostSave.lobby.code}`) : null,
    h('div', { class: 'grid grid-cols-2 gap-3' },
      h('button', { class: 'btn btn-ghost', onclick: () => hostRoom(null) }, h('i', { class: 'fa-solid fa-plus' }), 'Criar Sala'),
      h('button', { class: 'btn btn-ghost', onclick: () => openJoin('') }, h('i', { class: 'fa-solid fa-right-to-bracket' }), 'Entrar em Sala')),
    h('button', { class: 'btn btn-ghost w-full', onclick: showStats }, h('i', { class: 'fa-solid fa-chart-simple' }), 'Estatísticas'),
    h('p', { class: 'text-center text-xs text-slate-500', text: 'Salas online: cada pessoa joga do próprio aparelho.' }),
  ));
  updateMuteButtons();
}

// ---------- Componentes de configuração ----------
function seg(options, value, onChange, label) {
  return h('div', { class: 'seg', role: 'group', 'aria-label': label || null },
    options.map(([v, text]) => h('button', { type: 'button', 'aria-pressed': String(v === value), onclick: () => onChange(v) }, text)));
}
function checkbox(label, checked, onChange) {
  const input = h('input', { type: 'checkbox' });
  input.checked = !!checked;
  input.addEventListener('change', () => onChange(input.checked));
  return h('label', { class: 'flex items-center gap-3 py-2 cursor-pointer select-none min-h-[44px]' }, input, h('span', { text: label }));
}
const section = (title, ...body) => h('div', { class: 'card flex flex-col gap-3' },
  h('div', { class: 'text-xs uppercase tracking-wider text-slate-400', text: title }), ...body);

const ui = { rulesOpen: false };
function rulesPanel(toggles, onChange) {
  const det = h('details', { class: 'card' },
    h('summary', { class: 'cursor-pointer font-semibold min-h-[32px] flex items-center' }, 'Regras da casa',
      h('span', { class: 'ml-2 text-xs text-slate-400 font-normal', text: '(padrão: Ludo clássico)' })),
    h('div', { class: 'mt-2' },
      RULE_DEFS.map(d => checkbox(d.label, toggles[d.key], v => { toggles[d.key] = v; onChange(); })),
      h('button', { class: 'btn btn-ghost mt-2 text-sm', onclick: () => { Object.assign(toggles, defaultRuleToggles()); onChange(); } }, 'Restaurar regras clássicas')));
  det.open = ui.rulesOpen;
  det.addEventListener('toggle', () => { ui.rulesOpen = det.open; });
  return det;
}
function timerControls(cfg, onChange) {
  const label = h('span', { class: 'text-sm text-slate-300 w-12 text-right', text: `${cfg.seconds}s` });
  const range = h('input', { type: 'range', min: '10', max: '40', step: '5', class: 'flex-1 accent-amber-500', 'aria-label': 'Segundos por ação' });
  range.value = cfg.seconds;
  range.addEventListener('input', () => { label.textContent = `${range.value}s`; });
  range.addEventListener('change', () => { cfg.seconds = Number(range.value); onChange(); });
  return [
    checkbox('Limitar o tempo de cada ação humana', cfg.timer, v => { cfg.timer = v; onChange(); }),
    cfg.timer ? h('div', { class: 'flex items-center gap-3' }, range, label) : null,
  ];
}
function setupHeader(title) {
  return h('div', { class: 'flex items-center gap-3' },
    h('button', { class: 'icon-btn', 'aria-label': 'Voltar', onclick: () => showScreen('home') }, h('i', { class: 'fa-solid fa-arrow-left' })),
    h('h1', { class: 'text-2xl font-black', text: title }));
}

function nameBots(players) {
  const total = {};
  const seen = {};
  players.filter(p => p.isBot).forEach(p => { total[p.botLevel] = (total[p.botLevel] || 0) + 1; });
  for (const p of players) {
    if (!p.isBot) continue;
    seen[p.botLevel] = (seen[p.botLevel] || 0) + 1;
    p.name = `Robô ${LEVEL_NAME[p.botLevel]}` + (seen[p.botLevel] > 1 ? ` ${seen[p.botLevel]}` : '');
    p.avatar = BOT_AVATAR;
  }
  return players;
}

// ---------- Configuração do Modo Solo ----------
const soloCfg = Object.assign({
  opponents: 3, color: 'red', level: 'medium', perBot: false, levels: ['medium', 'medium', 'medium'],
  speed: 'normal', timer: false, seconds: 20, rules: defaultRuleToggles(),
}, Store.get('ludo:soloConfig', {}));
soloCfg.rules = Object.assign(defaultRuleToggles(), soloCfg.rules);

function renderSoloSetup() {
  const cfg = soloCfg;
  const rerender = () => { Store.set('ludo:soloConfig', cfg); renderSoloSetup(); };
  const colors = E.seatColorsFor(cfg.color, cfg.opponents);
  const botColors = colors.filter(c => c !== cfg.color);

  const table = h('div', { class: 'grid grid-cols-2 gap-2' }, E.COLORS.map(c => {
    const style = `--c:var(--${c})`;
    if (c === cfg.color) {
      return h('div', { class: 'player-row current', style },
        avatarEl(profile.avatar, c), h('div', { class: 'min-w-0' },
          h('div', { class: 'font-semibold truncate', text: cleanName(profile.name) || 'Você' }),
          h('div', { class: 'text-xs text-slate-400', text: `${CMETA[c].sym} ${CMETA[c].name}` })));
    }
    const k = botColors.indexOf(c);
    if (k < 0) {
      return h('div', { class: 'player-row opacity-40 border-dashed !border-slate-600' },
        h('span', { class: 'avatar', style }, ''), h('div', { class: 'text-sm', text: `${CMETA[c].sym} vazio` }));
    }
    const lvl = cfg.perBot ? cfg.levels[k] : cfg.level;
    const sel = h('select', { class: 'bg-slate-900 rounded-md text-sm px-1 py-1 mt-1', 'aria-label': `Dificuldade do robô ${CMETA[c].name}` },
      LEVELS.map(([v, t]) => { const o = h('option', { value: v, text: t }); o.selected = v === lvl; return o; }));
    sel.addEventListener('change', () => { cfg.levels[k] = sel.value; rerender(); });
    return h('div', { class: 'player-row', style },
      avatarEl(BOT_AVATAR, c), h('div', { class: 'min-w-0' },
        h('div', { class: 'font-semibold truncate', text: `Robô ${LEVEL_NAME[lvl]}` }),
        cfg.perBot ? sel : h('div', { class: 'text-xs text-slate-400', text: `${CMETA[c].sym} ${CMETA[c].name}` })));
  }));

  const root = $('#screen-setup');
  root.innerHTML = '';
  root.append(h('div', { class: 'max-w-xl mx-auto px-4 py-6 flex flex-col gap-4' },
    setupHeader('Jogar Sozinho'),
    section('Número de adversários', seg([[1, '1 robô'], [2, '2 robôs'], [3, '3 robôs']], cfg.opponents, v => { cfg.opponents = v; rerender(); }, 'Adversários')),
    section('Sua cor', h('div', { class: 'flex gap-3' }, E.COLORS.map(c =>
      h('button', { class: 'color-chip', style: `background:var(--${c})`, 'aria-pressed': String(c === cfg.color), 'aria-label': CMETA[c].name, onclick: () => { cfg.color = c; rerender(); } }, CMETA[c].sym)))),
    section('Dificuldade',
      seg(LEVELS, cfg.level, v => { cfg.level = v; cfg.levels = cfg.levels.map(() => v); rerender(); }, 'Dificuldade'),
      checkbox('Uma dificuldade por adversário', cfg.perBot, v => { cfg.perBot = v; rerender(); })),
    section('Mesa', table),
    section('Velocidade dos robôs', seg(SPEEDS, cfg.speed, v => { cfg.speed = v; rerender(); }, 'Velocidade')),
    section('Tempo', ...timerControls(cfg, rerender)),
    rulesPanel(cfg.rules, rerender),
    h('button', { class: 'btn btn-primary w-full text-lg py-4', onclick: startSolo }, h('i', { class: 'fa-solid fa-dice' }), 'Iniciar partida'),
  ));
}

function startSolo() {
  const cfg = soloCfg;
  const colors = E.seatColorsFor(cfg.color, cfg.opponents);
  let k = 0;
  const players = colors.map(c => c === cfg.color
    ? { color: c, name: cleanName(profile.name) || 'Jogador 1', avatar: profile.avatar, isBot: false }
    : { color: c, isBot: true, botLevel: cfg.perBot ? cfg.levels[k++] : cfg.level });
  nameBots(players);
  startNewGame({
    mode: 'solo', players, rules: toEngineRules(cfg.rules),
    speed: cfg.speed, timer: { enabled: cfg.timer, seconds: cfg.seconds },
  });
}

// ---------- Configuração do modo local (hotseat) ----------
const localCfg = Object.assign({
  seats: {
    red: { type: 'human', name: '', level: 'medium' },
    green: { type: 'bot', name: '', level: 'medium' },
    yellow: { type: 'human', name: '', level: 'medium' },
    blue: { type: 'bot', name: '', level: 'medium' },
  },
  speed: 'normal', timer: false, seconds: 20, rules: defaultRuleToggles(),
}, Store.get('ludo:localConfig', {}));
localCfg.rules = Object.assign(defaultRuleToggles(), localCfg.rules);

function renderLocalSetup() {
  const cfg = localCfg;
  const persist = () => Store.set('ludo:localConfig', cfg);
  const rerender = () => { persist(); renderLocalSetup(); };
  const rows = E.COLORS.map(c => {
    const s = cfg.seats[c];
    const extra = [];
    if (s.type === 'human') {
      const input = h('input', { type: 'text', maxlength: '12', placeholder: 'Nome', class: 'w-full', 'aria-label': `Nome do jogador ${CMETA[c].name}` });
      input.value = s.name;
      input.addEventListener('input', () => { s.name = input.value.slice(0, 12); persist(); });
      extra.push(input);
    } else if (s.type === 'bot') {
      extra.push(seg(LEVELS, s.level, v => { s.level = v; rerender(); }, 'Dificuldade'));
    }
    return h('div', { class: 'card flex flex-col gap-2', style: `border-left:6px solid var(--${c})` },
      h('div', { class: 'flex items-center gap-3 flex-wrap' },
        h('span', { class: 'font-bold w-24', text: `${CMETA[c].sym} ${CMETA[c].name}` }),
        seg([['human', 'Humano'], ['bot', 'Robô'], ['empty', 'Vazio']], s.type, v => { s.type = v; rerender(); }, 'Tipo de assento')),
      ...extra);
  });
  const root = $('#screen-setup');
  root.innerHTML = '';
  root.append(h('div', { class: 'max-w-xl mx-auto px-4 py-6 flex flex-col gap-4' },
    setupHeader('Mesmo aparelho'),
    h('p', { class: 'text-sm text-slate-400', text: 'Jogadores revezam no mesmo aparelho. Assentos podem ser preenchidos com robôs.' }),
    ...rows,
    section('Velocidade dos robôs', seg(SPEEDS, cfg.speed, v => { cfg.speed = v; rerender(); }, 'Velocidade')),
    section('Tempo', ...timerControls(cfg, rerender)),
    rulesPanel(cfg.rules, rerender),
    h('button', { class: 'btn btn-primary w-full text-lg py-4', onclick: startLocal }, h('i', { class: 'fa-solid fa-dice' }), 'Iniciar partida'),
  ));
}

function startLocal() {
  const cfg = localCfg;
  let humanIdx = 0;
  const players = [];
  for (const c of E.COLORS) {
    const s = cfg.seats[c];
    if (s.type === 'human') {
      humanIdx++;
      players.push({ color: c, name: cleanName(s.name) || `Jogador ${humanIdx}`, avatar: LOCAL_AVATARS[humanIdx - 1], isBot: false });
    } else if (s.type === 'bot') {
      players.push({ color: c, isBot: true, botLevel: s.level });
    }
  }
  if (players.length < 2) { toast('Escolha pelo menos 2 assentos.'); return; }
  nameBots(players);
  startNewGame({
    mode: 'local', players, rules: toEngineRules(cfg.rules),
    speed: cfg.speed, timer: { enabled: cfg.timer, seconds: cfg.seconds },
  });
}

/* =========================================================
   Controlador da partida
   ========================================================= */
const Game = {
  state: null, config: null, busy: false, paused: false, pausedLeft: null,
  botTimer: null, turnTimer: null, turnMs: 20000, override: {}, fastBots: false,
  statusOverride: null, announcedTurn: null, resultsShown: false,
};

const currentSeat = () => Game.state.seats[Game.state.turn.seat];
// Assento jogado pelo algoritmo: robô, ausente ou desconectado
const isAuto = (seat) => seat.isBot || seat.afk || seat.connected === false;
// Assento controlado por quem está neste aparelho
function isLocalSeat(seat) {
  if (!seat || seat.isBot) return false;
  if (Game.state.mode !== 'online') return true;
  return seat.owner != null && seat.owner === Net.myId;
}
function canControl(seat) {
  if (!isLocalSeat(seat)) return false;
  if (Net.role === 'client') return Net.connected && !Net.pending;
  return !isAuto(seat);
}
const humanSeats = () => Game.state.seats.filter(s => !s.isBot);
const seatLabel = (seat) => `${CMETA[seat.color].sym} ${seat.name}`;
const botDelay = () => (Game.fastBots ? 150 : SPEED_MS[Game.config.speed] || 800);

function startNewGame(config) {
  const state = E.createGame({ mode: config.mode, players: config.players, rules: config.rules });
  state.config = config;
  state.humansDoneHandled = false;
  loadGame(state);
  runFirstDraw();
}

function resumeGame(saved) {
  const state = saved.state;
  state.turn.deadline = null;
  loadGame(state);
  if (state.phase === 'choosingFirst') runFirstDraw();
  else proceed();
}

function loadGame(state) {
  clearTimers();
  if (!state.gameId) state.gameId = randomId(6);
  Game.state = state;
  Game.config = state.config;
  Game.busy = false;
  Game.paused = false;
  Game.pausedLeft = null;
  Game.override = {};
  Game.fastBots = !!state.humansDoneHandled;
  Game.statusOverride = null;
  Game.announcedTurn = null;
  Game.resultsShown = false;
  $('#game-title').textContent = state.mode === 'solo' ? 'Modo Solo' : state.mode === 'online' ? `Sala ${Net.code}` : 'Mesmo aparelho';
  showScreen('game');
  View.resize();
  View.reset(state);
  View.setDie(state.turn.dice || 1);
  render();
}

function clearTimers() {
  clearTimeout(Game.botTimer);
  clearTimeout(Game.turnTimer);
  Game.botTimer = Game.turnTimer = null;
}

function save() {
  const s = Game.state;
  if (!s) return;
  if (s.mode === 'online') { Net.saveHost(); return; }
  const key = s.mode === 'solo' ? 'ludo:solo' : 'ludo:local';
  if (s.phase === 'finished') Store.del(key);
  else Store.set(key, { state: s, savedAt: Date.now() });
}

async function runFirstDraw() {
  Game.busy = true;
  const res = E.chooseFirst(Game.state, E.cryptoRng);
  pushLog(`${seatLabel(Game.state.seats[res.winner])} começa`);
  Net.broadcastAction(res.events);
  try {
    await showDrawOverlay(res);
  } finally {
    Game.busy = false;
  }
  save();
  proceed();
}

async function showDrawOverlay(res) {
  const s = Game.state;
  const rows = s.seats.map(seat => {
    const die = makeDie(true);
    const row = h('div', { class: 'player-row', style: `--c:var(--${seat.color})` },
      avatarEl(seat.avatar, seat.color), h('div', { class: 'flex-1 font-semibold truncate', text: seatLabel(seat) }), die.el);
    return { row, die };
  });
  const msg = h('div', { class: 'text-center font-bold text-lg min-h-[28px] mt-3' });
  const close = openModal(h('div', {},
    h('h2', { class: 'text-xl font-black mb-3 text-center', text: 'Quem começa?' }),
    h('div', { class: 'flex flex-col gap-1' }, rows.map(r => r.row)), msg), { dismissable: false });
  await wait(400);
  for (let ri = 0; ri < res.rounds.length; ri++) {
    const round = res.rounds[ri];
    if (ri > 0) { msg.textContent = 'Empate! Desempatando…'; await wait(900); }
    rows.forEach((r, seat) => { r.row.style.opacity = round.some(x => x.seat === seat) ? '1' : '.35'; });
    Sound.play('dice');
    await Promise.all(round.map(x => rows[x.seat].die.roll(x.value)));
    await wait(650);
  }
  rows[res.winner].row.classList.add('current');
  msg.textContent = `${s.seats[res.winner].name} começa!`;
  Sound.play('turn');
  await wait(REDUCED ? 700 : 1400);
  close();
}

// Decide o próximo passo automático depois de cada mudança de estado.
// No online só o anfitrião decide; ao final publica o estado aos convidados.
function proceed() {
  clearTimers();
  const s = Game.state;
  if (!s || Net.role === 'client') return;
  scheduleNext(s);
  render();
  Net.broadcastState();
}

function scheduleNext(s) {
  if (s.phase !== 'playing' || Game.paused || Game.busy) return;
  const seat = currentSeat();
  if (isAuto(seat)) {
    const delay = seat.isBot ? botDelay() : 2000;
    Game.botTimer = setTimeout(botAct, s.turn.awaiting === 'roll' ? delay : Math.max(150, delay * 0.6));
    return;
  }
  if (s.turn.awaiting === 'move' && s.turn.validMoves.length === 1 && s.rules.autoSingleMove) {
    Game.botTimer = setTimeout(() => actMove(s.turn.validMoves[0], 'auto'), 450);
    return;
  }
  if (s.turn.awaiting === 'roll' && Game.announcedTurn !== s.turnNumber) {
    Game.announcedTurn = s.turnNumber;
    if (isLocalSeat(seat)) Sound.play('turn');
    if (s.mode === 'local' && humanSeats().length >= 2) announce(seat);
  }
  startTurnTimer();
}

function announce(seat) {
  const b = $('#turn-banner');
  b.textContent = `Vez de ${seat.name} ${CMETA[seat.color].sym}`;
  b.style.setProperty('--c', `var(--${seat.color})`);
  b.classList.add('on');
  clearTimeout(announce.t);
  announce.t = setTimeout(() => b.classList.remove('on'), 1300);
}

function startTurnTimer() {
  const s = Game.state;
  const t = Game.config.timer;
  if (!t || !t.enabled) return;
  Game.turnMs = (s.rules.quickMode ? 10 : t.seconds) * 1000;
  s.turn.turnMs = Game.turnMs;
  if (!s.turn.deadline) s.turn.deadline = Date.now() + Game.turnMs;
  Game.turnTimer = setTimeout(onTimeout, Math.max(0, s.turn.deadline - Date.now()));
}

function onTimeout() {
  const s = Game.state;
  if (!s || Game.busy || Game.paused || s.phase !== 'playing') return;
  const seat = currentSeat();
  if (seat.isBot) return;
  seat.timeouts++;
  if (seat.timeouts >= 3 && !seat.afk) {
    seat.afk = true;
    toast(`${seat.name} está ausente — o robô assumiu. Toque na tela para voltar.`);
  }
  if (s.turn.awaiting === 'roll') actRoll('auto');
  else actMove(E.chooseMove(s, 'medium'), 'auto');
}

async function botAct() {
  const s = Game.state;
  if (!s || Game.busy || Game.paused || s.phase !== 'playing') return;
  const seat = currentSeat();
  if (!isAuto(seat)) return;
  if (s.turn.awaiting === 'roll') await actRoll('auto');
  else await actMove(E.chooseMove(s, seat.isBot ? seat.botLevel : 'medium'), 'auto');
}

// source: 'local' (quem está no aparelho), 'remote' (intenção validada de um convidado), 'auto' (robô/timer)
async function actRoll(source = 'local') {
  const s = Game.state;
  if (!s || Game.busy || Game.paused || s.phase !== 'playing' || s.turn.awaiting !== 'roll') return;
  const seat = currentSeat();
  if (Net.role === 'client') {
    if (source === 'local' && canControl(seat)) Net.request('ROLL_REQUEST', {});
    return;
  }
  if (source === 'local' && !canControl(seat)) return;
  if (source !== 'auto') seat.timeouts = 0;
  clearTimers();
  Game.busy = true;
  render();
  const events = E.roll(s, E.cryptoRng);
  Net.broadcastAction(events);
  try {
    await playEvents(events);
  } catch (err) {
    console.error('playEvents(roll)', err);
  } finally {
    Game.busy = false;
  }
  afterAction();
}

async function actMove(piece, source = 'local') {
  const s = Game.state;
  if (!s || Game.busy || Game.paused || s.phase !== 'playing' || s.turn.awaiting !== 'move') return;
  if (!s.turn.validMoves.includes(piece)) return;
  const seat = currentSeat();
  hidePreview();
  if (Net.role === 'client') {
    if (source === 'local' && canControl(seat)) Net.request('MOVE_REQUEST', { pieceId: piece });
    return;
  }
  if (source === 'local' && !canControl(seat)) return;
  if (source !== 'auto') seat.timeouts = 0;
  clearTimers();
  Game.busy = true;
  const events = E.move(s, piece);
  Net.broadcastAction(events);
  try {
    await playEvents(events);
  } catch (err) {
    console.error('playEvents(move)', err);
  } finally {
    Game.busy = false;
  }
  afterAction();
}

function afterAction() {
  const s = Game.state;
  Game.statusOverride = null;
  save();
  if (s.phase === 'finished') { proceed(); showResults(); return; }
  const humans = humanSeats();
  if (s.mode !== 'online' && !s.humansDoneHandled && humans.length && humans.every(x => x.finishedRank != null)) {
    s.humansDoneHandled = true;
    save();
    render();
    showHumansDone();
    return;
  }
  proceed();
}

// Anima a lista de eventos do motor. O estado já está aplicado; `override`
// mantém peões na posição antiga até a animação chegar neles.
async function playEvents(events) {
  const s = Game.state;
  const ov = Game.override = {};
  const setOv = (c, i, v) => { (ov[c] = ov[c] || {})[i] = v; };
  const clearOv = (c, i) => { if (ov[c]) delete ov[c][i]; };
  for (const e of events) {
    if (e.kind === 'MOVE') setOv(e.color, e.piece, e.from);
    if (e.kind === 'CAPTURE') e.victims.forEach(v => setOv(v.color, v.piece, v.from));
    if (e.kind === 'THREE_SIXES' && e.penalty) setOv(e.penalty.color, e.penalty.piece, e.penalty.from);
  }
  layoutTokens();
  const actor = events[0] && events[0].seat != null ? s.seats[events[0].seat] : null;
  const quick = actor && actor.isBot && Game.fastBots;
  let moveSummary = null;

  for (const e of events) {
    const seat = e.seat != null ? s.seats[e.seat] : null;
    Stats.onEvent(s, e);
    switch (e.kind) {
      case 'FIRST': // só os convidados recebem o sorteio como evento
        await showDrawOverlay(e);
        break;
      case 'ROLL':
        Sound.play('dice');
        Game.statusOverride = `${seat.name} rolou…`;
        renderStatus();
        await View.roll(e.value);
        Game.statusOverride = `${seat.name} tirou ${e.value}`;
        renderStatus();
        renderSixes();
        break;
      case 'NO_MOVES':
        Sound.play('nomove');
        Game.statusOverride = `${seat.name} tirou ${e.value} — nenhum movimento possível`;
        renderStatus();
        pushLog(`${seatLabel(seat)}: ${e.value} → sem jogadas`);
        await wait(quick ? 400 : 1500);
        break;
      case 'THREE_SIXES':
        Sound.play('nomove');
        Game.statusOverride = `${seat.name} tirou três 6 seguidos — perdeu a vez`;
        renderStatus();
        pushLog(`${seatLabel(seat)}: três 6 seguidos, perdeu a vez`);
        await wait(quick ? 500 : 1300);
        if (e.penalty) { await View.animateReturn(e.penalty); clearOv(e.penalty.color, e.penalty.piece); layoutTokens(new Set([`${e.penalty.color}-${e.penalty.piece}`])); }
        break;
      case 'MOVE': {
        Sound.play('move');
        clearOv(e.color, e.piece);
        await View.animateMove(e);
        layoutTokens();
        moveSummary = e.from < 0 ? 'tirou um peão da base' : `andou ${e.to - e.from} casa${e.to - e.from > 1 ? 's' : ''}`;
        break;
      }
      case 'CAPTURE': {
        Sound.play('capture');
        const names = [...new Set(e.victims.map(v => s.seats.find(x => x.color === v.color).name))].join(', ');
        await View.animateCapture(e);
        e.victims.forEach(v => clearOv(v.color, v.piece));
        layoutTokens();
        moveSummary = `capturou ${names}`;
        await wait(quick ? 80 : 180);
        break;
      }
      case 'PIECE_HOME':
        Sound.play('home');
        await View.animateHome(e);
        moveSummary = 'levou um peão ao centro';
        if (!quick) celebrate(false);
        await wait(quick ? 80 : 200);
        break;
      case 'TEAM_FINISHED': {
        const names = e.seats.map(i => s.seats[i].name).join(' e ');
        pushLog(`🏆 Dupla ${names} venceu`);
        Sound.play('win');
        celebrate(true);
        await wait(quick ? 200 : 700);
        break;
      }
      case 'PLAYER_FINISHED':
        pushLog(`🏆 ${seatLabel(seat)} terminou em ${e.rank}º`);
        if (e.rank === 1) { Sound.play('win'); celebrate(true); }
        toast(`${seat.name} terminou em ${e.rank}º lugar!`);
        await wait(quick ? 200 : 700);
        break;
    }
  }
  const mv = events.find(e => e.kind === 'MOVE');
  if (mv) pushLog(`${seatLabel(s.seats[mv.seat])}: ${mv.dice} → ${moveSummary}`);
  Game.override = {};
}

function pushLog(text) {
  const s = Game.state;
  s.log = (s.log || []).concat(text).slice(-5);
  renderHistory();
}

/* ---------- Tabuleiro 3D (adaptadores) ----------
   A cena vive em js/scene3d/*. Aqui ficam apenas as funções que o
   controlador já chamava na v1 (canPick, preview, layoutTokens). */
function canPick(color, i) {
  const s = Game.state;
  if (!s || Game.busy || Game.paused || s.phase !== 'playing' || s.turn.awaiting !== 'move') return false;
  return canControl(currentSeat()) && E.playColor(s, s.turn.seat) === color && s.turn.validMoves.includes(i);
}

function showPreview(color, i) {
  const s = Game.state;
  if (!s) return;
  const from = s.pieces[color][i];
  const to = from < 0 ? 0 : Math.min(from + s.turn.dice, E.GOAL);
  View.preview(color, to, i);
}
function hidePreview() { View.clearPreview(); }

function layoutTokens(returning = new Set()) {
  const s = Game.state;
  if (!s) return;
  const pickable = s.phase === 'playing' && !Game.busy && !Game.paused && s.turn.awaiting === 'move' && canControl(currentSeat());
  const turnColor = s.phase === 'playing' ? E.playColor(s, s.turn.seat) : null;
  View.sync(s, Game.override, returning, {
    pickableColor: pickable ? turnColor : null,
    validMoves: pickable ? s.turn.validMoves : [],
  });
  if (!Game.busy && s.turn && s.turn.dice) View.setDie(s.turn.dice);
}

/* ---------- Renderização / HUD ---------- */
function render() {
  if (!Game.state) return;
  renderStatus();
  renderPlayers();
  renderDicePanel();
  renderSixes();
  renderHistory();
  renderEmotes();
  layoutTokens();
  const pb = $('#btn-pause');
  pb.innerHTML = `<i class="fa-solid ${Game.paused ? 'fa-play' : 'fa-pause'}"></i>`;
  pb.setAttribute('aria-label', Game.paused ? 'Continuar' : 'Pausar');
  pb.style.display = Game.state.mode === 'online' ? 'none' : '';
  updateMuteButtons();
}

function renderStatus() {
  const s = Game.state;
  const el = $('#status');
  el.textContent = '';
  if (s.phase === 'finished') { el.style.setProperty('--c', '#64748b'); el.textContent = 'Partida encerrada'; return; }
  if (s.phase === 'choosingFirst') { el.textContent = 'Sorteando quem começa…'; return; }
  const seat = currentSeat();
  el.style.setProperty('--c', `var(--${seat.color})`);
  if (Game.statusOverride) { el.textContent = Game.statusOverride; return; }
  if (Game.paused) { el.textContent = 'Jogo pausado'; return; }
  let action;
  if (isLocalSeat(seat) && (Net.role === 'client' || !isAuto(seat))) {
    if (Net.pending) action = 'enviando…';
    else action = s.turn.awaiting === 'roll' ? 'role o dado' : 'escolha um peão';
  } else if (isAuto(seat)) action = s.turn.awaiting === 'roll' ? 'vai rolar…' : 'pensando…';
  else action = 'jogando…';
  const pc = E.playColor(s, s.turn.seat);
  const helping = pc !== seat.color ? ` (movendo ${CMETA[pc].sym} ${CMETA[pc].name})` : '';
  el.append('Vez de ', h('strong', { text: seat.name }), seat.isBot ? ' 🤖' : '', ` ${CMETA[seat.color].sym} — ${action}${helping}`);
}

const PILL_MEDALS = ['🥇', '🥈', '🥉', '4º'];

function renderPlayers() {
  const s = Game.state;
  const list = $('#players');
  const inPlay = new Set(s.seats.map((x) => x.color));
  for (const pill of [...list.querySelectorAll('.pill')]) {
    if (!inPlay.has(pill.getAttribute('data-color'))) pill.remove();
  }
  for (const seat of s.seats) {
    let pill = list.querySelector(`.pill[data-color="${seat.color}"]`);
    if (!pill) {
      pill = h('div', { class: 'pill', 'data-color': seat.color });
      list.append(pill);
    }
    const home = s.pieces[seat.color].filter((r) => r === E.GOAL).length;
    const current = s.phase === 'playing' && s.turn.seat === seat.seat;
    const mine = s.mode === 'online' && isLocalSeat(seat);
    let sub = current ? 'Sua vez' : seat.finishedRank ? PILL_MEDALS[seat.finishedRank - 1] || '—'
      : seat.connected === false ? 'offline' : seat.afk ? 'ausente' : seat.isBot ? `🤖 ${LEVEL_NAME[seat.botLevel]}` : 'aguardando';
    if (s.rules.teams && !current && !seat.finishedRank) sub = `Dupla ${E.TEAM[seat.color] === 0 ? 'A' : 'B'}`;
    pill.className = 'pill'
      + (current ? ' is-turn' : '')
      + (seat.finishedRank ? ' is-done' : '')
      + (seat.connected === false ? ' is-offline' : '');
    pill.style.setProperty('--c', `var(--${seat.color})`);
    pill.style.setProperty('--cl', `var(--${seat.color}-l)`);
    pill.innerHTML = '';
    pill.append(
      h('div', { class: 'pill-avatar' }, avatarEl(seat.avatar, seat.color)),
      h('div', { class: 'pill-body' },
        h('div', { class: 'pill-name', text: seat.name + (mine ? ' · você' : '') }),
        h('div', { class: 'pill-sub' },
          h('span', { class: 'em', text: sub }),
          h('span', { class: 'pill-dots' }, [0, 1, 2, 3].map((k) => h('i', { class: k < home ? 'on' : '' }))),
          h('span', { class: 'pill-home', text: String(home) })
        )
      )
    );
  }
}

function renderDicePanel() {
  const s = Game.state;
  const btn = $('#die-btn');
  const playing = s.phase === 'playing';
  const seat = playing ? currentSeat() : null;
  const canRoll = playing && !Game.busy && !Game.paused && s.turn.awaiting === 'roll' && canControl(seat);
  btn.disabled = !canRoll;
  btn.setAttribute('aria-label', canRoll ? 'Rolar o dado (Espaço)' : 'Aguardando o turno');
  const hint = $('#die-hint');
  if (!playing) hint.innerHTML = `<span class="sub">${s.phase === 'finished' ? 'Fim de jogo' : ''}</span>`;
  else if (canRoll) hint.innerHTML = '<strong>Toque no dado</strong><br><span class="sub">ou aperte Espaço</span>';
  else if (canControl(seat) && s.turn.awaiting === 'move' && !Game.busy) hint.innerHTML = '<strong>Escolha um peão</strong><br><span class="sub">toque nele ou use 1–4</span>';
  else hint.innerHTML = `<span class="sub">Vez de ${seat.name}</span>`;
}

function renderSixes() {
  const s = Game.state;
  const el = $('#sixes');
  el.innerHTML = '';
  if (!s.rules.threeSixesLimit || s.phase !== 'playing') return;
  const n = Math.min(3, s.turn.consecutiveSixes || 0);
  for (let i = 0; i < 3; i++) el.append(h('span', { class: 'dot' + (i < n ? ' on' : '') }));
  el.append(h('span', { class: 'sub', text: `${n}×6` }));
}

function renderHistory() {
  const ul = document.getElementById('history-list');
  if (!ul || !Game.state) return;
  ul.innerHTML = '';
  const log = (Game.state.log || []).slice().reverse();
  if (!log.length) ul.append(h('li', { text: 'Nenhuma jogada ainda' }));
  log.forEach((t) => ul.append(h('li', { text: t })));
}

function showHistory() {
  let close;
  close = openModal(h('div', {},
    h('h2', { class: 'text-xl font-black mb-3', text: 'Últimas jogadas' }),
    h('ul', { id: 'history-list', class: 'history-list' }),
    h('button', { class: 'btn btn-ghost w-full mt-4', onclick: () => close() }, 'Fechar')));
  renderHistory();
}

// Anel de timer no avatar do jogador da vez.
function tickTimer() {
  const s = Game.state;
  const text = $('#timer-text');
  const inGame = $('#screen-game') && !$('#screen-game').hidden;
  if (s && s.turn && s.turn.deadline && !Game.paused && inGame) {
    const now = Date.now() + (Net.role === 'client' ? Net.offset : 0);
    const left = Math.max(0, s.turn.deadline - now);
    const total = s.turn.turnMs || Game.turnMs || 1;
    const pill = document.querySelector('.pill.is-turn .pill-avatar');
    if (pill) pill.style.setProperty('--p', String(Math.max(0, Math.min(1, left / total))));
    if (text) text.textContent = `${Math.ceil(left / 1000)}s para jogar`;
  } else {
    const pill = document.querySelector('.pill.is-turn .pill-avatar');
    if (pill) pill.style.setProperty('--p', '1');
    if (text) text.textContent = '';
  }
  requestAnimationFrame(tickTimer);
}

/* ---------- Estatísticas locais (só neste navegador) ---------- */
const STAT_MODES = [['solo', 'Solo'], ['online', 'Online'], ['local', 'Local']];
const Stats = {
  load() { return Store.get('ludo:stats', {}); },
  bucket(all, mode) {
    all[mode] = Object.assign({
      played: 0, wins: 0, podiums: 0, captured: 0, lost: 0, sixes: 0, streak: 0, bestStreak: 0,
      winsByLevel: { easy: 0, medium: 0, hard: 0 },
    }, all[mode] || {});
    return all[mode];
  },
  add(mode, field, n = 1) {
    if (!n) return;
    const all = this.load();
    this.bucket(all, mode)[field] += n;
    Store.set('ludo:stats', all);
  },
  // Contabiliza o fim de uma partida uma única vez, para os assentos deste aparelho.
  finish(s) {
    const local = s.seats.filter(isLocalSeat);
    if (!local.length || Store.get('ludo:statsLast', null) === s.gameId) return;
    Store.set('ludo:statsLast', s.gameId);
    const all = this.load();
    const b = this.bucket(all, s.mode);
    b.played++;
    const best = Math.min(...local.map(x => x.finishedRank || 99));
    if (best === 1) {
      b.wins++;
      b.streak++;
      b.bestStreak = Math.max(b.bestStreak, b.streak);
      const levels = s.seats.filter(x => x.isBot).map(x => x.botLevel);
      const hardest = ['hard', 'medium', 'easy'].find(l => levels.includes(l));
      if (s.mode === 'solo' && hardest) b.winsByLevel[hardest]++;
    } else {
      b.streak = 0;
    }
    if (best <= 3) b.podiums++;
    Store.set('ludo:stats', all);
  },
  // Contadores durante a partida (seis, capturas)
  onEvent(s, e) {
    const seat = e.seat != null ? s.seats[e.seat] : null;
    if (e.kind === 'ROLL' && e.value === 6 && isLocalSeat(seat)) this.add(s.mode, 'sixes');
    if (e.kind === 'CAPTURE') {
      if (isLocalSeat(seat)) this.add(s.mode, 'captured', e.victims.length);
      const lost = e.victims.filter(v => isLocalSeat(s.seats.find(x => x.color === v.color))).length;
      this.add(s.mode, 'lost', lost);
    }
  },
};

function showStats() {
  let mode = 'solo';
  let close;
  const body = h('div', {});
  const draw = () => {
    const b = Stats.bucket(Stats.load(), mode);
    const rows = [
      ['Partidas jogadas', b.played], ['Vitórias (1º lugar)', b.wins], ['Pódios (1º a 3º)', b.podiums],
      ['Peões capturados', b.captured], ['Peões perdidos', b.lost], ['6 tirados', b.sixes], ['Maior sequência de vitórias', b.bestStreak],
    ];
    if (mode === 'solo') LEVELS.forEach(([lv, name]) => rows.push([`Vitórias contra ${name}`, b.winsByLevel[lv] || 0]));
    body.innerHTML = '';
    body.append(
      seg(STAT_MODES, mode, v => { mode = v; draw(); }, 'Modo'),
      h('dl', { class: 'grid grid-cols-[1fr_auto] gap-x-4 gap-y-2 mt-4' },
        rows.flatMap(([k, v]) => [h('dt', { class: 'text-slate-300', text: k }), h('dd', { class: 'font-black text-right text-lg', text: String(v) })])));
  };
  draw();
  close = openModal(h('div', {},
    h('h2', { class: 'text-xl font-black mb-3', text: 'Estatísticas' }),
    body,
    h('p', { class: 'text-xs text-slate-400 mt-4', text: 'Salvas apenas neste navegador.' }),
    h('div', { class: 'grid grid-cols-2 gap-2 mt-4' },
      h('button', { class: 'btn btn-ghost', onclick: () => {
        if (confirm('Zerar todas as estatísticas deste navegador?')) { Store.del('ludo:stats'); draw(); }
      } }, 'Zerar'),
      h('button', { class: 'btn btn-primary', onclick: () => close() }, 'Fechar'))));
}

/* ---------- Emotes (online) ---------- */
const EMOTES = ['👏', '😂', '😮', '😡', '🤝'];
const EMOTE_COOLDOWN = 3000;
const BASE_CENTER = { red: [20, 20], green: [80, 20], yellow: [80, 80], blue: [20, 80] }; // [left%, top%]
let lastEmoteAt = 0;

function renderEmotes() {
  const box = $('#emotes');
  const s = Game.state;
  const mine = s && s.mode === 'online' && s.seats.some(isLocalSeat);
  box.hidden = !mine;
  if (!mine) return;
  if (!box.childElementCount) {
    EMOTES.forEach(em => box.append(h('button', { class: 'emote-btn', 'aria-label': `Enviar ${em}`, onclick: () => sendEmote(em) }, em)));
  }
}

function sendEmote(emoji) {
  const s = Game.state;
  const seat = s && s.seats.find(isLocalSeat);
  if (!seat || Date.now() - lastEmoteAt < EMOTE_COOLDOWN) return;
  lastEmoteAt = Date.now();
  const btns = [...document.querySelectorAll('.emote-btn')];
  btns.forEach(b => { b.disabled = true; });
  setTimeout(() => btns.forEach(b => { b.disabled = false; }), EMOTE_COOLDOWN);
  if (Net.role === 'client') Net.send({ type: 'EMOTE', payload: { emoji } });
  else hostEmote(seat.seat, emoji);
}

function hostEmote(seatIdx, emoji) {
  Net.broadcast({ type: 'EMOTE', payload: { seat: seatIdx, emoji } });
  showEmote(seatIdx, emoji);
}

function showEmote(seatIdx, emoji) {
  const s = Game.state;
  const seat = s && s.seats[seatIdx];
  if (!seat || !EMOTES.includes(emoji) || $('#screen-game').hidden) return;
  const [x, y] = BASE_CENTER[seat.color];
  const el = h('div', { class: 'emote-bubble', style: `left:${x}%;top:${y}%`, text: emoji });
  $('#emote-layer').append(el);
  setTimeout(() => el.remove(), 2300);
  Sound.play('turn');
}

/* ---------- Modais da partida ---------- */
function rulesSummary(rules) {
  const yes = (b) => (b ? 'sim' : 'não');
  const cfg = Game.config;
  return [
    ['Sair da base com', rules.exitOn.join(' ou ')],
    ['Número exato para o centro', yes(rules.exactFinish)],
    ['Rolagem extra ao capturar', yes(rules.captureBonus)],
    ['Rolagem extra ao chegar', yes(rules.finishBonus)],
    ['Limite de três 6', yes(rules.threeSixesLimit)],
    ['Penalidade dos três 6', yes(rules.threeSixesPenalty)],
    ['Bloqueio (barreira)', yes(rules.blocks)],
    ['Encerrar no 1º vencedor', yes(rules.endOnFirstWinner)],
    ['Movimento automático único', yes(rules.autoSingleMove)],
    ['Modo rápido', yes(rules.quickMode)],
    ['Modo duplas', yes(rules.teams)],
    ['Tempo por ação', cfg.timer && cfg.timer.enabled ? `${rules.quickMode ? 10 : cfg.timer.seconds}s` : 'sem limite'],
  ];
}

function showRules() {
  const s = Game.state;
  let close;
  close = openModal(h('div', {},
    h('h2', { class: 'text-xl font-black mb-3', text: 'Regras desta partida' }),
    h('dl', { class: 'grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 text-sm' },
      rulesSummary(s.rules).flatMap(([k, v]) => [h('dt', { class: 'text-slate-400', text: k }), h('dd', { class: 'font-semibold text-right', text: v })])),
    h('p', { class: 'text-xs text-slate-400 mt-4', text: 'Casas seguras: as 4 saídas e as 4 estrelas ★. Peões de cores diferentes convivem nelas sem captura.' }),
    h('p', { class: 'text-xs text-slate-400 mt-1', text: 'Teclado: Espaço rola o dado; 1–4 escolhem o peão.' }),
    h('button', { class: 'btn btn-ghost w-full mt-4', onclick: () => close() }, 'Fechar')));
}

function togglePause() {
  const s = Game.state;
  if (!s || s.phase !== 'playing') return;
  if (!Game.paused) {
    Game.paused = true;
    clearTimers();
    if (s.turn.deadline) { Game.pausedLeft = s.turn.deadline - Date.now(); s.turn.deadline = null; }
    render();
    openModal(h('div', { class: 'text-center' },
      h('div', { class: 'text-5xl mb-2', text: '⏸️' }),
      h('h2', { class: 'text-xl font-black mb-4', text: 'Jogo pausado' }),
      h('button', { class: 'btn btn-primary w-full', onclick: () => { document.querySelector('.modal-back')?.remove(); resume(); } }, h('i', { class: 'fa-solid fa-play' }), 'Continuar')),
    { dismissable: false });
  } else {
    resume();
  }
  function resume() {
    Game.paused = false;
    if (Game.pausedLeft != null) { s.turn.deadline = Date.now() + Game.pausedLeft; Game.pausedLeft = null; }
    proceed();
  }
}

function confirmExit() {
  const s = Game.state;
  let close;
  const finished = !s || s.phase === 'finished';
  let text = finished ? 'A partida terminou.' : 'A partida fica salva e você pode continuar depois.';
  if (Net.role === 'host') text = 'A sala será encerrada para todos os jogadores.';
  if (Net.role === 'client') text = 'Você sai da sala. Seus peões passam a ser jogados pelo robô.';
  close = openModal(h('div', {},
    h('h2', { class: 'text-xl font-black mb-2', text: 'Sair para o menu?' }),
    h('p', { class: 'text-slate-300 text-sm mb-4', text }),
    h('div', { class: 'grid grid-cols-2 gap-2' },
      h('button', { class: 'btn btn-ghost', onclick: () => close() }, 'Ficar'),
      h('button', { class: 'btn btn-primary', onclick: () => { close(); leaveGame(); } }, 'Sair'))));
}

function leaveGame() {
  clearTimers();
  if (Net.role) netLeave();
  else if (Game.state && Game.state.phase !== 'finished') {
    Game.paused = false;
    save();
  }
  Game.state = null;
  View.reset(ATTRACT);
  document.querySelectorAll('.modal-back').forEach(m => m.remove());
  showScreen('home');
}

function showHumansDone() {
  const s = Game.state;
  const humans = humanSeats();
  const solo = humans.length === 1;
  const text = solo ? `Você terminou em ${humans[0].finishedRank}º lugar!` : 'Todos os humanos terminaram!';
  let close;
  close = openModal(h('div', { class: 'text-center' },
    h('div', { class: 'text-5xl mb-2', text: solo && humans[0].finishedRank === 1 ? '🏆' : '🎉' }),
    h('h2', { class: 'text-xl font-black mb-1', text }),
    h('p', { class: 'text-slate-300 text-sm mb-4', text: 'Os robôs ainda estão disputando as outras posições.' }),
    h('div', { class: 'grid grid-cols-2 gap-2' },
      h('button', { class: 'btn btn-ghost', onclick: () => { close(); const ev = E.endEarly(s); save(); render(); if (ev) showResults(); } }, 'Encerrar'),
      h('button', { class: 'btn btn-primary', onclick: () => { close(); Game.fastBots = true; proceed(); } }, 'Ver o resto'))),
  { dismissable: false });
}

function showResults() {
  const s = Game.state;
  if (Game.resultsShown) return;
  Game.resultsShown = true;
  clearTimers();
  if (Net.role !== 'client') save();
  Stats.finish(s);
  const medals = ['🥇', '🥈', '🥉', '4º'];
  const winners = s.seats.filter(x => x.finishedRank === 1);
  const winner = winners[0];
  if (winners.some(x => !x.isBot)) { Sound.play('win'); celebrate(true); }
  const title = winners.length > 1 ? `${winners.map(x => x.name).join(' e ')} venceram!` : `${winner.name} venceu!`;
  let close;
  close = openModal(h('div', {},
    h('h2', { class: 'text-2xl font-black text-center mb-1', text: title + (winners.some(x => !x.isBot) ? ' 🎉' : '') }),
    h('p', { class: 'text-center text-slate-400 text-sm mb-4', text: 'Classificação final' }),
    h('div', { class: 'flex flex-col gap-1' }, s.ranking.map((seatIdx) => {
      const seat = s.seats[seatIdx];
      return h('div', { class: 'player-row' + (seat.finishedRank === 1 ? ' current' : ''), style: `--c:var(--${seat.color})` },
        h('span', { class: 'text-2xl w-9 text-center', text: medals[(seat.finishedRank || 4) - 1] }),
        avatarEl(seat.avatar, seat.color),
        h('span', { class: 'font-semibold flex-1 truncate', text: seatLabel(seat) + (seat.isBot ? ' 🤖' : '') }));
    })),
    Net.role === 'client'
      ? h('div', { class: 'mt-5 flex flex-col gap-2' },
        h('p', { class: 'text-center text-sm text-slate-400', text: 'Aguardando o anfitrião para a revanche…' }),
        h('button', { class: 'btn btn-ghost', onclick: () => { close(); leaveGame(); } }, h('i', { class: 'fa-solid fa-door-open' }), 'Sair da sala'))
      : h('div', { class: 'grid grid-cols-2 gap-2 mt-5' },
        h('button', { class: 'btn btn-ghost', onclick: () => { close(); leaveGame(); } }, h('i', { class: 'fa-solid fa-house' }), 'Menu'),
        h('button', { class: 'btn btn-primary', onclick: () => { close(); if (Net.role === 'host') hostBackToLobby(); else startNewGame(s.config); } }, h('i', { class: 'fa-solid fa-rotate-right' }), 'Revanche'))),
  { dismissable: false });
}

/* =========================================================
   Rede (PeerJS) — o anfitrião é a única autoridade
   ========================================================= */
const PEERJS_URL = 'https://unpkg.com/peerjs@1.5.4/dist/peerjs.min.js';
const QRCODE_URL = 'https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js';
const PEER_PREFIX = 'ludosupreme-';
const ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:global.stun.twilio.com:3478' },
  // TURN opcional, para redes móveis/NAT restritivo:
  // { urls: 'turn:SEU_SERVIDOR:3478', username: 'usuario', credential: 'senha' },
];
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const JOIN_ORDER = ['red', 'yellow', 'green', 'blue'];

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const el = document.createElement('script');
    el.src = src;
    el.onload = resolve;
    el.onerror = () => reject(new Error('Falha ao carregar ' + src));
    document.head.append(el);
  });
}
const randomId = (n = 16) => [...crypto.getRandomValues(new Uint8Array(n))].map(x => x.toString(16).padStart(2, '0')).join('');
const randomCode = () => [...crypto.getRandomValues(new Uint8Array(4))].map(x => CODE_ALPHABET[x % CODE_ALPHABET.length]).join('');
// Cada troca de anfitrião abre a sala num ID novo: CODE, CODE-h1, CODE-h2…
const peerIdFor = (code, epoch = 0) => PEER_PREFIX + code + (epoch ? '-h' + epoch : '');
const MIGRATE_AFTER_MS = 15000;

async function sha256hex(text) {
  try {
    const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return [...new Uint8Array(d)].map(x => x.toString(16).padStart(2, '0')).join('');
  } catch { return null; } // sem contexto seguro (HTTPS/localhost)
}

// Verifica se existe alguém atendendo num ID de peer
function probePeer(id, ms = 6000) {
  return new Promise(resolve => {
    let peer;
    try { peer = new Peer({ config: { iceServers: ICE_SERVERS } }); } catch { resolve(false); return; }
    const done = (v) => { clearTimeout(timer); try { peer.destroy(); } catch { /* ignore */ } resolve(v); };
    const timer = setTimeout(() => done(false), ms);
    peer.on('open', () => {
      const c = peer.connect(id, { reliable: true, serialization: 'json' });
      c.on('open', () => done(true));
    });
    peer.on('error', () => done(false));
  });
}

// O anfitrião antigo (ou um sucessor atrasado) vira convidado de quem assumiu.
function becomeClientOf(lobby, epoch) {
  const me = lobby.members.find(m => m.id === Net.myId) || lobby.members.find(m => m.isHost);
  Store.del('ludo:host:' + lobby.code);
  Store.del('ludo:lastHost');
  if (me && me.token) Store.set('ludo:session:' + lobby.code, { token: me.token, epoch });
  clearTimers();
  Game.busy = false;
  hideConnecting();
  toast('Outro jogador está com a sala — reconectando…');
  joinRoom(lobby.code, epoch);
}

// Sucessor assume com o último estado recebido do anfitrião que caiu.
function promoteToHost() {
  const lobby = JSON.parse(JSON.stringify(Net.lobby));
  const st = Game.state ? JSON.parse(JSON.stringify(Game.state)) : null;
  lobby.epoch = (lobby.epoch || 0) + 1;
  lobby.members.forEach(m => {
    if (m.isHost) { m.isHost = false; m.connected = false; }
    if (m.id === Net.myId) { m.isHost = true; m.token = Net.myToken; m.ready = true; m.connected = true; }
  });
  const inGame = lobby.phase === 'game' && st && st.phase !== 'finished';
  if (st) st.config = Object.assign({ mode: 'online', speed: 'normal' }, st.config);
  Store.del('ludo:session:' + lobby.code);
  toast('O anfitrião caiu — você assumiu a sala.');
  hostRoom({ lobby, state: inGame ? st : null }, { takeover: true });
}

function safeAvatar(a) {
  if (typeof a !== 'string') return '🙂';
  if (a.startsWith('data:image/jpeg;base64,') && a.length < 40000) return a;
  if (!a.startsWith('data:') && a.length <= 16) return a;
  return '🙂';
}
function setRoomUrl(code) {
  try { const u = new URL(location.href); u.searchParams.set('room', code); history.replaceState(null, '', u); } catch { /* ignore */ }
}
function clearRoomUrl() {
  try { const u = new URL(location.href); u.searchParams.delete('room'); history.replaceState(null, '', u); } catch { /* ignore */ }
}
function roomLink(code) {
  const u = new URL(location.href);
  u.search = '';
  u.hash = '';
  u.searchParams.set('room', code);
  return u.toString();
}

const Net = {
  role: null, peer: null, code: null, myId: null, myToken: null, spectator: false,
  lobby: null, conns: new Map(), conn: null, connected: false, everConnected: false,
  pending: false, pendingTimer: null, offset: 0, lastPong: 0, hb: null,
  reconnTimer: null, retry: 0, closing: false, chain: Promise.resolve(), emoteAt: new Map(),
  epoch: 0, lostAt: null,

  // ----- anfitrião -----
  publicState() {
    const s = Game.state;
    const cfg = s.config || {};
    return {
      ...s,
      config: { mode: cfg.mode, timer: cfg.timer, speed: cfg.speed },
      seats: s.seats.map(seat => ({ ...seat, avatar: null })), // avatares vão só no LOBBY
    };
  },
  publicLobby() {
    return { ...this.lobby, members: this.lobby.members.map(({ token, ...m }) => m) };
  },
  broadcast(msg) { for (const conn of this.conns.keys()) sendTo(conn, msg); },
  broadcastState() {
    if (this.role !== 'host' || !Game.state || this.lobby.phase !== 'game') return;
    this.broadcast({ type: 'STATE', payload: { state: this.publicState() } });
  },
  broadcastAction(events) {
    if (this.role !== 'host') return;
    this.broadcast({ type: 'ACTION', payload: { events, state: this.publicState() } });
  },
  saveHost() {
    if (this.role !== 'host' || !this.lobby) return;
    const inGame = this.lobby.phase === 'game' && Game.state && Game.state.phase !== 'finished';
    Store.set('ludo:host:' + this.code, { lobby: this.lobby, state: inGame ? Game.state : null, savedAt: Date.now() });
    Store.set('ludo:lastHost', this.code);
  },

  // ----- convidado -----
  send(msg) { try { if (this.conn && this.conn.open) this.conn.send(msg); } catch { /* conexão caiu */ } },
  request(type, payload) {
    this.send({ type, v: Game.state.stateVersion, payload });
    this.pending = true;
    clearTimeout(this.pendingTimer);
    this.pendingTimer = setTimeout(() => {
      if (!this.pending) return;
      this.pending = false;
      this.send({ type: 'SYNC_REQUEST' });
      render();
    }, 5000);
    render();
  },
};
const sendTo = (conn, msg) => { try { if (conn.open) conn.send(msg); } catch { /* conexão caiu */ } };

function netReset() {
  Net.closing = false;
  Net.role = null;
  Net.peer = null;
  Net.conn = null;
  Net.conns = new Map();
  Net.connected = false;
  Net.everConnected = false;
  Net.pending = false;
  Net.spectator = false;
  Net.retry = 0;
  Net.offset = 0;
  Net.chain = Promise.resolve();
}

function netShutdown() {
  Net.closing = true;
  clearInterval(Net.hb);
  clearTimeout(Net.reconnTimer);
  const peer = Net.peer;
  setTimeout(() => { try { peer && peer.destroy(); } catch { /* ignore */ } }, 400);
  Net.role = null;
  Net.conn = null;
  Net.conns = new Map();
  Net.connected = false;
  $('#net-banner').hidden = true;
}

function netLeave() {
  if (Net.role === 'host') {
    Net.broadcast({ type: 'ROOM_CLOSED' });
    Store.del('ludo:host:' + Net.code);
    Store.del('ludo:lastHost');
  } else if (Net.role === 'client') {
    Net.send({ type: 'LEAVE' });
    Store.del('ludo:session:' + Net.code);
  }
  netShutdown();
  clearRoomUrl();
}

let connectingClose = null;
function showConnecting(text) {
  hideConnecting();
  connectingClose = openModal(h('div', { class: 'text-center py-2' },
    h('div', { class: 'spinner mb-4' }),
    h('p', { class: 'font-semibold mb-4', text }),
    h('button', { class: 'btn btn-ghost', onclick: () => { hideConnecting(); netLeave(); Game.state = null; showScreen('home'); } }, 'Cancelar')),
  { dismissable: false });
}
function hideConnecting() { if (connectingClose) { connectingClose(); connectingClose = null; } }

function netFail(err) {
  hideConnecting();
  netShutdown();
  clearRoomUrl();
  const type = err && err.type;
  let msg = 'Não foi possível conectar.';
  if (type === 'browser-incompatible') msg = 'Este navegador não suporta salas online.';
  else if (['network', 'server-error', 'socket-error', 'socket-closed'].includes(type)) msg = 'Sem conexão com o servidor de salas.';
  else if (type === 'peer-unavailable') msg = 'Sala não encontrada. Confira o código.';
  else if (type === 'unavailable-id') msg = 'Não foi possível reabrir a sala agora. Tente de novo em instantes.';
  else if (err && /carregar/.test(err.message || '')) msg = 'Não foi possível carregar a biblioteca de rede.';
  Game.state = null;
  showScreen('home');
  let close;
  close = openModal(h('div', { class: 'text-center' },
    h('div', { class: 'text-4xl mb-2', text: '📡' }),
    h('h2', { class: 'text-xl font-black mb-2', text: 'Problema de conexão' }),
    h('p', { class: 'text-slate-300 text-sm mb-4', text: msg }),
    h('div', { class: 'grid grid-cols-2 gap-2' },
      h('button', { class: 'btn btn-ghost', onclick: () => close() }, 'Fechar'),
      h('button', { class: 'btn btn-primary', onclick: () => { close(); renderSoloSetup(); showScreen('setup'); } }, 'Jogar Sozinho'))));
}

// ---------- Anfitrião ----------
// restore: { lobby, state } salvo (recarga) ou herdado (takeover = troca de anfitrião)
async function hostRoom(restore, { takeover = false } = {}) {
  try { if (!window.Peer) await loadScript(PEERJS_URL); } catch (e) { netFail(e); return; }
  if (Net.role) netShutdown();
  netReset();
  Net.role = 'host';
  let code = restore ? restore.lobby.code : randomCode();
  const epoch = restore ? (restore.lobby.epoch || 0) : 0;
  showConnecting(takeover ? 'Assumindo a sala…' : restore ? 'Reabrindo a sala…' : 'Criando sala…');

  // Recarga do anfitrião: se outro jogador já assumiu a sala, entra como convidado.
  if (restore && !takeover && await probePeer(peerIdFor(code, epoch + 1))) {
    becomeClientOf(restore.lobby, epoch + 1);
    return;
  }
  if (Net.closing) return;

  const open = () => new Promise((resolve, reject) => {
    let peer;
    try { peer = new Peer(peerIdFor(code, epoch), { config: { iceServers: ICE_SERVERS } }); } catch (e) { reject(e); return; }
    let opened = false;
    peer.on('open', () => { opened = true; resolve(peer); });
    peer.on('error', err => {
      if (!opened) { try { peer.destroy(); } catch { /* ignore */ } reject(err); return; }
      if (['network', 'server-error', 'socket-error', 'socket-closed', 'disconnected'].includes(err.type)) toast('Instabilidade na rede…');
    });
  });
  for (let attempt = 0; ; attempt++) {
    try { Net.peer = await open(); break; } catch (err) {
      if (Net.closing) return;
      if (err && err.type === 'unavailable-id') {
        if (takeover) { becomeClientOf(restore.lobby, epoch); return; } // outro sucessor chegou antes
        if (!restore && attempt < 5) { code = randomCode(); continue; }
        if (restore && attempt < 10) { await wait(3000); continue; } // o servidor ainda segura o ID antigo
      }
      netFail(err);
      return;
    }
  }
  if (Net.closing) return;
  hideConnecting();
  Net.code = code;
  Net.peer.on('connection', hostAccept);
  Net.peer.on('disconnected', () => { if (!Net.closing) { try { Net.peer.reconnect(); } catch { /* ignore */ } } });

  if (restore) {
    Net.lobby = restore.lobby;
    Net.lobby.members.forEach(m => { if (!m.isBot && !m.isHost) m.connected = false; });
    const me = Net.lobby.members.find(m => m.isHost);
    Net.myId = me.id;
  } else {
    const token = randomId();
    const me = {
      id: randomId(8), token, tokenHash: await sha256hex(token), name: cleanName(profile.name) || 'Anfitrião', avatar: profile.avatar,
      color: 'red', ready: true, isHost: true, isBot: false, connected: true,
    };
    Net.myId = me.id;
    Net.lobby = {
      code, epoch: 0, phase: 'lobby', members: [me],
      rules: Object.assign(defaultRuleToggles(), Store.get('ludo:onlineRules', {})),
      time: Object.assign({ timer: true, seconds: 20 }, Store.get('ludo:onlineTime', {})),
    };
  }
  setRoomUrl(code);
  clearInterval(Net.hb);
  Net.hb = setInterval(hostHeartbeat, 5000);

  if (restore && restore.state && Net.lobby.phase === 'game') {
    restore.state.seats.forEach(s => { if (!s.isBot && s.owner !== Net.myId) s.connected = false; });
    resumeGame({ state: restore.state });
  } else {
    Net.lobby.phase = 'lobby';
    showScreen('lobby');
    renderLobby();
  }
  Net.saveHost();
}

function hostAccept(conn) {
  conn.on('data', msg => { try { hostHandle(conn, msg); } catch (e) { console.error(e); } });
  conn.on('close', () => hostDrop(conn));
  conn.on('error', () => hostDrop(conn));
}

function hostHeartbeat() {
  const now = Date.now();
  for (const [conn, info] of Net.conns) if (now - info.lastSeen > 20000) hostDrop(conn);
}

function lobbyChanged() {
  Net.broadcast({ type: 'LOBBY', payload: { lobby: Net.publicLobby() } });
  if (!$('#screen-lobby').hidden) renderLobby();
  Net.saveHost();
}

function hostHandle(conn, msg) {
  if (!msg || typeof msg.type !== 'string') return;
  const info = Net.conns.get(conn);
  if (info) info.lastSeen = Date.now();
  const p = (msg.payload && typeof msg.payload === 'object') ? msg.payload : {};
  if (msg.type === 'PING') { sendTo(conn, { type: 'PONG', payload: { t: p.t, hostTime: Date.now() } }); return; }
  if (msg.type === 'JOIN' || msg.type === 'REJOIN') { hostJoin(conn, msg.type, p).catch(e => console.error(e)); return; }
  if (!info) return;
  const L = Net.lobby;
  const member = info.memberId ? L.members.find(m => m.id === info.memberId) : null;
  switch (msg.type) {
    case 'SYNC_REQUEST':
      sendTo(conn, { type: 'LOBBY', payload: { lobby: Net.publicLobby() } });
      if (Game.state && L.phase === 'game') sendTo(conn, { type: 'STATE', payload: { state: Net.publicState() } });
      break;
    case 'READY':
      if (member && L.phase === 'lobby') { member.ready = !!p.ready; lobbyChanged(); }
      break;
    case 'PICK_COLOR':
      if (member && L.phase === 'lobby' && E.COLORS.includes(p.color) && !L.members.some(m => m.color === p.color)) {
        member.color = p.color;
        lobbyChanged();
      }
      break;
    case 'LEAVE':
      hostDrop(conn, true);
      break;
    case 'EMOTE': {
      const seat = member && Game.state && L.phase === 'game' ? Game.state.seats.find(x => x.owner === member.id) : null;
      if (!seat || !EMOTES.includes(p.emoji) || Date.now() - (Net.emoteAt.get(member.id) || 0) < EMOTE_COOLDOWN - 300) break;
      Net.emoteAt.set(member.id, Date.now());
      hostEmote(seat.seat, p.emoji);
      break;
    }
    case 'ROLL_REQUEST':
    case 'MOVE_REQUEST':
      if (member) hostIntent(conn, member, msg);
      break;
  }
}

// Cor para quem chega: primeira livre (2 jogadores = Vermelho × Amarelo) ou o lugar de um robô.
function pickSeatForNewcomer() {
  const L = Net.lobby;
  const free = JOIN_ORDER.find(c => !L.members.some(m => m.color === c));
  if (free) return free;
  const bot = L.members.find(m => m.isBot);
  if (!bot) return null;
  L.members = L.members.filter(m => m !== bot);
  return bot.color;
}

async function hostJoin(conn, type, p) {
  const L = Net.lobby;
  let member = null;
  if (type === 'REJOIN' && typeof p.token === 'string') {
    const others = L.members.filter(m => !m.isBot && m.id !== Net.myId);
    member = others.find(m => m.token && m.token === p.token) || null;
    if (!member) {
      // Depois de uma troca de anfitrião só temos o hash do token de cada jogador
      const hash = await sha256hex(p.token);
      member = hash ? others.find(m => m.tokenHash === hash) || null : null;
      if (member) member.token = p.token;
    }
  }
  if (!member) {
    const color = L.phase === 'lobby' ? pickSeatForNewcomer() : null;
    if (!color) {
      Net.conns.set(conn, { memberId: null, lastSeen: Date.now() });
      sendTo(conn, { type: 'WELCOME', payload: { id: null, token: null, spectator: true, reason: L.phase === 'lobby' ? 'ROOM_FULL' : 'IN_PROGRESS' } });
      sendTo(conn, { type: 'LOBBY', payload: { lobby: Net.publicLobby() } });
      if (Game.state && L.phase === 'game') sendTo(conn, { type: 'STATE', payload: { state: Net.publicState() } });
      return;
    }
    const humans = L.members.filter(m => !m.isBot).length;
    const token = randomId();
    member = {
      id: randomId(8), token, tokenHash: await sha256hex(token), name: cleanName(String(p.name || '')) || `Jogador ${humans + 1}`,
      avatar: safeAvatar(p.avatar), color, ready: false, isHost: false, isBot: false, connected: true,
    };
    L.members.push(member);
  }
  for (const [c, inf] of Net.conns) {
    if (inf.memberId === member.id && c !== conn) { Net.conns.delete(c); try { c.close(); } catch { /* ignore */ } }
  }
  Net.conns.set(conn, { memberId: member.id, lastSeen: Date.now() });
  member.connected = true;
  sendTo(conn, { type: 'WELCOME', payload: { id: member.id, token: member.token, spectator: false } });
  lobbyChanged();
  if (Game.state && L.phase === 'game') {
    const seat = Game.state.seats.find(s => s.owner === member.id);
    if (seat && seat.connected === false) { seat.connected = true; toast(`${member.name} voltou`); }
    if (!Game.busy) proceed();
    else sendTo(conn, { type: 'STATE', payload: { state: Net.publicState() } });
  }
}

function hostDrop(conn, leaving = false) {
  const info = Net.conns.get(conn);
  if (!info) return;
  Net.conns.delete(conn);
  try { conn.close(); } catch { /* ignore */ }
  const L = Net.lobby;
  const member = info.memberId ? L.members.find(m => m.id === info.memberId) : null;
  if (!member || [...Net.conns.values()].some(i => i.memberId === member.id)) return;
  if (L.phase === 'lobby') {
    L.members = L.members.filter(m => m !== member);
  } else {
    member.connected = false;
    const seat = Game.state && Game.state.seats.find(s => s.owner === member.id);
    if (seat) {
      seat.connected = false;
      if (leaving) seat.afk = true;
      toast(`${member.name} ${leaving ? 'saiu' : 'desconectou'} — o robô joga por ele até voltar`);
      if (!Game.busy) proceed();
    }
  }
  lobbyChanged();
}

async function hostIntent(conn, member, msg) {
  const s = Game.state;
  const reject = (reason) => {
    sendTo(conn, { type: 'REJECT', payload: { reason } });
    if (Game.state) sendTo(conn, { type: 'STATE', payload: { state: Net.publicState() } });
  };
  if (!s || s.phase !== 'playing') return reject('not-playing');
  if (msg.v !== s.stateVersion) return reject('stale');
  if (currentSeat().owner !== member.id) return reject('not-your-turn');
  for (let k = 0; Game.busy && k < 200; k++) await wait(50); // espera a animação local terminar
  if (Game.state !== s || Game.busy || msg.v !== s.stateVersion) return reject('stale');
  const seat = currentSeat();
  seat.afk = false;
  seat.timeouts = 0;
  if (msg.type === 'ROLL_REQUEST') {
    if (s.turn.awaiting !== 'roll') return reject('stale');
    actRoll('remote');
  } else {
    const i = Number(msg.payload && msg.payload.pieceId);
    if (s.turn.awaiting !== 'move' || !s.turn.validMoves.includes(i)) return reject('invalid');
    actMove(i, 'remote');
  }
}

function hostStartGame() {
  const L = Net.lobby;
  const seated = L.members.filter(m => m.color);
  if (seated.length < 2) { toast('São necessários pelo menos 2 jogadores.'); return; }
  if (L.members.some(m => !m.isBot && !m.isHost && (!m.ready || !m.connected))) { toast('Aguarde todos ficarem prontos.'); return; }
  const players = seated.map(m => m.isBot
    ? { color: m.color, isBot: true, botLevel: m.botLevel }
    : { color: m.color, name: m.name, avatar: m.avatar, isBot: false, owner: m.id });
  nameBots(players);
  L.phase = 'game';
  lobbyChanged();
  startNewGame({
    mode: 'online', players, rules: toEngineRules(L.rules), speed: 'normal',
    timer: { enabled: L.time.timer, seconds: L.time.seconds },
  });
}

function hostBackToLobby() {
  const L = Net.lobby;
  clearTimers();
  Game.state = null;
  document.querySelectorAll('.modal-back').forEach(m => m.remove());
  L.phase = 'lobby';
  L.members = L.members.filter(m => m.isBot || m.isHost || m.connected);
  L.members.forEach(m => { if (!m.isBot && !m.isHost) m.ready = false; });
  showScreen('lobby');
  lobbyChanged();
}

// ---------- Convidado ----------
async function joinRoom(code, epoch) {
  code = (code || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4);
  if (code.length !== 4) { toast('O código tem 4 caracteres.'); return; }
  try { if (!window.Peer) await loadScript(PEERJS_URL); } catch (e) { netFail(e); return; }
  if (Net.role) netShutdown();
  netReset();
  Net.role = 'client';
  Net.code = code;
  const session = Store.get('ludo:session:' + code, null) || {};
  Net.myToken = session.token || null;
  Net.epoch = epoch != null ? epoch : (session.epoch || 0);
  setRoomUrl(code);
  showConnecting('Conectando à sala ' + code + '…');
  clientConnect();
  clearInterval(Net.hb);
  Net.hb = setInterval(clientHeartbeat, 5000);
}

function clientConnect() {
  if (Net.closing || Net.role !== 'client') return;
  Net.reconnTimer = null;
  // Anfitrião sumiu há tempo demais: o próximo jogador na ordem dos assentos assume.
  if (Net.everConnected && Net.lostAt && Net.lobby && !Net.spectator) {
    const lostFor = Date.now() - Net.lostAt;
    const successors = Net.lobby.members
      .filter(m => !m.isBot && !m.isHost && m.connected)
      .sort((a, b) => E.COLORS.indexOf(a.color) - E.COLORS.indexOf(b.color));
    const rank = successors.findIndex(m => m.id === Net.myId);
    if (rank >= 0 && lostFor > MIGRATE_AFTER_MS * (rank + 1)) { promoteToHost(); return; }
  }
  // Durante a queda alterna entre o anfitrião atual e um possível sucessor
  const target = Net.lostAt && Net.retry % 2 === 1 ? Net.epoch + 1 : Net.epoch;
  try { Net.peer && Net.peer.destroy(); } catch { /* ignore */ }
  let peer;
  try { peer = new Peer({ config: { iceServers: ICE_SERVERS } }); } catch (e) { netFail(e); return; }
  Net.peer = peer;
  peer.on('open', () => {
    if (Net.peer !== peer) return;
    const conn = peer.connect(peerIdFor(Net.code, target), { reliable: true, serialization: 'json' });
    Net.conn = conn;
    const timeout = setTimeout(() => { if (Net.conn === conn && !conn.open) clientLost(); }, 12000);
    conn.on('open', () => {
      clearTimeout(timeout);
      Net.connected = true;
      Net.lastPong = Date.now();
      Net.retry = 0;
      Net.lostAt = null;
      Net.epoch = target;
      $('#net-banner').hidden = true;
      const who = { name: cleanName(profile.name), avatar: profile.avatar };
      Net.send(Net.myToken ? { type: 'REJOIN', payload: { token: Net.myToken, ...who } } : { type: 'JOIN', payload: who });
      Net.send({ type: 'PING', payload: { t: Date.now() } });
    });
    conn.on('data', clientHandle);
    conn.on('close', () => { if (Net.conn === conn) clientLost(); });
    conn.on('error', () => { if (Net.conn === conn) clientLost(); });
  });
  peer.on('error', err => {
    if (Net.peer !== peer) return;
    if (!Net.everConnected && err.type === 'peer-unavailable' && Net.epoch < 3) {
      Net.epoch++; // a sala pode ter trocado de anfitrião
      clientConnect();
      return;
    }
    if (!Net.everConnected && (err.type === 'peer-unavailable' || err.type === 'browser-incompatible')) { netFail(err); return; }
    clientLost();
  });
}

function clientLost() {
  if (Net.closing || Net.role !== 'client' || Net.reconnTimer) return;
  Net.connected = false;
  Net.conn = null;
  Net.pending = false;
  if (Net.everConnected && !Net.lostAt) Net.lostAt = Date.now();
  if (Net.everConnected) {
    $('#net-banner').hidden = false;
    if (Game.state) render();
  }
  Net.retry++;
  if (!Net.everConnected && Net.retry > 3) { netFail({ type: 'peer-unavailable' }); return; }
  Net.reconnTimer = setTimeout(clientConnect, Math.min(1000 * Net.retry, 5000));
}

function clientHeartbeat() {
  if (Net.role !== 'client' || !Net.connected) return;
  if (Date.now() - Net.lastPong > 15000) { try { Net.conn && Net.conn.close(); } catch { /* ignore */ } clientLost(); return; }
  Net.send({ type: 'PING', payload: { t: Date.now() } });
}

const enqueue = (fn) => { Net.chain = Net.chain.then(fn).catch(e => console.error(e)); };

function clientHandle(msg) {
  if (!msg || typeof msg.type !== 'string') return;
  const p = msg.payload || {};
  switch (msg.type) {
    case 'WELCOME':
      hideConnecting();
      Net.everConnected = true;
      Net.spectator = !!p.spectator;
      Net.myId = p.id;
      if (p.token) { Net.myToken = p.token; Store.set('ludo:session:' + Net.code, { token: p.token, epoch: Net.epoch }); }
      if (p.spectator) toast(p.reason === 'ROOM_FULL' ? 'Sala cheia — você está assistindo.' : 'Partida em andamento — você está assistindo.');
      break;
    case 'LOBBY':
      Net.lobby = p.lobby;
      Net.epoch = p.lobby.epoch || 0;
      if (Net.myToken) Store.set('ludo:session:' + Net.code, { token: Net.myToken, epoch: Net.epoch });
      enqueue(clientOnLobby);
      break;
    case 'STATE':
      enqueue(() => clientApplyState(p.state));
      break;
    case 'ACTION':
      enqueue(() => clientApplyAction(p.events, p.state));
      break;
    case 'REJECT':
      Net.pending = false;
      if (p.reason !== 'stale') toast('Jogada não permitida agora.');
      if (Game.state) render();
      break;
    case 'EMOTE':
      showEmote(p.seat, p.emoji);
      break;
    case 'PONG': {
      const now = Date.now();
      Net.lastPong = now;
      Net.offset = p.hostTime + (now - p.t) / 2 - now;
      break;
    }
    case 'ROOM_CLOSED':
      netShutdown();
      clearRoomUrl();
      Store.del('ludo:session:' + Net.code);
      Game.state = null;
      clearTimers();
      document.querySelectorAll('.modal-back').forEach(m => m.remove());
      showScreen('home');
      toast('O anfitrião encerrou a sala.');
      break;
  }
}

function injectAvatars(state) {
  const members = (Net.lobby && Net.lobby.members) || [];
  state.seats.forEach(seat => {
    const m = members.find(x => x.id === seat.owner);
    seat.avatar = seat.isBot ? BOT_AVATAR : (m ? m.avatar : '🙂');
  });
  return state;
}

function clientOnLobby() {
  if (Net.lobby.phase === 'lobby') {
    if (!$('#screen-game').hidden || Game.state) {
      Game.state = null;
      document.querySelectorAll('.modal-back').forEach(m => m.remove());
    }
    if ($('#screen-lobby').hidden) showScreen('lobby');
    renderLobby();
  }
}

function ensureGameView() {
  const key = Game.state.seats.map(s => s.color + s.owner).join('|');
  if ($('#screen-game').hidden || Game.viewKey !== key) {
    const st = Game.state;
    loadGame(st);
    Game.viewKey = key;
  }
}

function clientNotifyTurn() {
  const s = Game.state;
  if (s.phase !== 'playing') return;
  const seat = currentSeat();
  if (isLocalSeat(seat) && s.turn.awaiting === 'roll' && Game.announcedTurn !== s.turnNumber) {
    Game.announcedTurn = s.turnNumber;
    Sound.play('turn');
  }
}

async function clientApplyState(state) {
  if (!state) return;
  Game.state = injectAvatars(state);
  Net.pending = false;
  ensureGameView();
  render();
  clientNotifyTurn();
  if (state.phase === 'finished') showResults();
}

async function clientApplyAction(events, state) {
  Game.state = injectAvatars(state);
  Net.pending = false;
  ensureGameView();
  Game.busy = true;
  await playEvents(events);
  Game.busy = false;
  Game.statusOverride = null;
  render();
  clientNotifyTurn();
  if (state.phase === 'finished') showResults();
}

document.addEventListener('visibilitychange', async () => {
  if (document.visibilityState !== 'visible') return;
  if (Net.role === 'host' && Net.lobby) {
    // O aparelho dormiu? Se alguém assumiu a sala nesse meio-tempo, vira convidado.
    const lobby = Net.lobby;
    if (await probePeer(peerIdFor(lobby.code, (lobby.epoch || 0) + 1), 4000) && Net.role === 'host') becomeClientOf(lobby, (lobby.epoch || 0) + 1);
    return;
  }
  if (Net.role !== 'client') return;
  if (Net.connected) Net.send({ type: 'SYNC_REQUEST' });
  else { clearTimeout(Net.reconnTimer); Net.reconnTimer = null; clientConnect(); }
});

// ---------- Telas: entrar e sala de espera ----------
function openJoin(code) {
  const root = $('#screen-setup');
  root.innerHTML = '';
  const codeInput = h('input', { type: 'text', maxlength: '4', placeholder: 'ABCD', 'aria-label': 'Código da sala', class: 'room-code text-center w-full uppercase', autocomplete: 'off' });
  codeInput.value = code || '';
  codeInput.addEventListener('input', () => { codeInput.value = codeInput.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4); });
  const nameInput = h('input', { type: 'text', maxlength: '12', placeholder: 'Seu apelido', 'aria-label': 'Apelido', class: 'flex-1 min-w-0' });
  nameInput.value = profile.name || '';
  nameInput.addEventListener('input', () => { profile.name = nameInput.value.slice(0, 12); saveProfile(); });
  const go = () => { profile.name = cleanName(nameInput.value); saveProfile(); joinRoom(codeInput.value); };
  codeInput.addEventListener('keydown', e => { if (e.key === 'Enter') go(); });
  root.append(h('div', { class: 'max-w-md mx-auto px-4 py-6 flex flex-col gap-4' },
    setupHeader('Entrar em Sala'),
    section('Código da sala', codeInput),
    section('Você', h('div', { class: 'flex items-center gap-3' },
      h('button', { class: 'shrink-0', 'aria-label': 'Trocar avatar', onclick: () => openAvatarPicker(() => openJoin(codeInput.value)) },
        avatarEl(profile.avatar, null, '!w-14 !h-14 !text-3xl')),
      nameInput)),
    h('button', { class: 'btn btn-primary w-full text-lg py-4', onclick: go }, h('i', { class: 'fa-solid fa-right-to-bracket' }), 'Entrar'),
  ));
  showScreen('setup');
  if (!code) codeInput.focus();
}

async function copyLink(link) {
  try { await navigator.clipboard.writeText(link); toast('Link copiado!'); }
  catch { toast(link); }
}

async function showQr(link) {
  try { if (!window.QRCode) await loadScript(QRCODE_URL); } catch { toast('Não foi possível gerar o QR Code.'); return; }
  const box = h('div', { class: 'bg-white p-3 rounded-xl mx-auto w-fit my-4' });
  new window.QRCode(box, { text: link, width: 220, height: 220 });
  let close;
  close = openModal(h('div', { class: 'text-center' },
    h('h2', { class: 'text-xl font-black', text: `Sala ${Net.code}` }),
    h('p', { class: 'text-sm text-slate-400', text: 'Aponte a câmera do celular para entrar' }),
    box,
    h('button', { class: 'btn btn-ghost w-full', onclick: () => close() }, 'Fechar')));
}

function renderLobby() {
  const L = Net.lobby;
  if (!L) return;
  const root = $('#screen-lobby');
  root.innerHTML = '';
  const isHost = Net.role === 'host';
  const me = L.members.find(m => m.id === Net.myId);
  const link = roomLink(L.code);

  const seatCard = (color) => {
    const m = L.members.find(x => x.color === color);
    const style = `--c:var(--${color})`;
    if (!m) {
      const actions = [];
      if (isHost) {
        actions.push(h('button', { class: 'btn btn-ghost text-sm !min-h-[36px] !py-1', onclick: () => {
          L.members.push({ id: 'bot-' + randomId(4), isBot: true, botLevel: 'medium', name: 'Robô', avatar: BOT_AVATAR, color, ready: true, connected: true });
          lobbyChanged();
        } }, '+ Robô'));
      }
      if (me && !Net.spectator) {
        actions.push(h('button', { class: 'btn btn-ghost text-sm !min-h-[36px] !py-1', onclick: () => {
          if (isHost) { me.color = color; lobbyChanged(); } else Net.send({ type: 'PICK_COLOR', payload: { color } });
        } }, 'Sentar aqui'));
      }
      return h('div', { class: 'card !p-3 flex flex-col gap-2 border-dashed', style: `border-left:6px solid var(--${color})` },
        h('div', { class: 'text-sm text-slate-400', text: `${CMETA[color].sym} ${CMETA[color].name} — livre` }),
        h('div', { class: 'flex gap-2 flex-wrap' }, actions));
    }
    const status = m.isBot ? `🤖 ${LEVEL_NAME[m.botLevel]}` : m.isHost ? '👑 Anfitrião' : !m.connected ? '📡 offline' : m.ready ? '✅ Pronto' : '⏳ Aguardando';
    const controls = [];
    if (isHost && m.isBot) {
      const sel = h('select', { class: 'bg-slate-900 rounded-md text-sm px-1 py-1', 'aria-label': 'Dificuldade do robô' },
        LEVELS.map(([v, t]) => { const o = h('option', { value: v, text: t }); o.selected = v === m.botLevel; return o; }));
      sel.addEventListener('change', () => { m.botLevel = sel.value; lobbyChanged(); });
      controls.push(sel);
    }
    if (isHost && !m.isHost) {
      controls.push(h('button', { class: 'icon-btn !w-9 !h-9', 'aria-label': `Remover ${m.name}`, onclick: () => {
        L.members = L.members.filter(x => x !== m);
        for (const [c, inf] of Net.conns) if (inf.memberId === m.id) { sendTo(c, { type: 'ROOM_CLOSED' }); Net.conns.delete(c); }
        lobbyChanged();
      } }, h('i', { class: 'fa-solid fa-xmark' })));
    }
    return h('div', { class: 'player-row card !p-3' + (m.id === Net.myId ? ' current' : ''), style },
      avatarEl(m.isBot ? BOT_AVATAR : m.avatar, color),
      h('div', { class: 'flex-1 min-w-0' },
        h('div', { class: 'font-semibold truncate', text: `${CMETA[color].sym} ${m.isBot ? 'Robô ' + LEVEL_NAME[m.botLevel] : m.name}${m.id === Net.myId ? ' (você)' : ''}` }),
        h('div', { class: 'text-xs text-slate-400', text: status })),
      ...controls);
  };

  const seated = L.members.filter(m => m.color);
  const waiting = L.members.filter(m => !m.isBot && !m.isHost && (!m.ready || !m.connected));
  const canStart = seated.length >= 2 && !waiting.length;
  let startHint = '';
  if (seated.length < 2) startHint = 'Convide alguém ou adicione um robô.';
  else if (waiting.length) startHint = `Aguardando: ${waiting.map(m => m.name).join(', ')}`;

  const rulesBlock = isHost
    ? [rulesPanel(L.rules, () => { Store.set('ludo:onlineRules', L.rules); lobbyChanged(); }),
      section('Tempo', ...timerControls(L.time, () => { Store.set('ludo:onlineTime', L.time); lobbyChanged(); }))]
    : [h('details', { class: 'card' },
      h('summary', { class: 'cursor-pointer font-semibold', text: 'Regras da partida' }),
      h('ul', { class: 'mt-2 text-sm text-slate-300 flex flex-col gap-1' },
        RULE_DEFS.map(d => h('li', { text: `${L.rules[d.key] ? '✅' : '❌'} ${d.label}` })),
        h('li', { text: `⏱️ ${L.time.timer ? L.time.seconds + 's por ação' : 'sem limite de tempo'}` })))];

  root.append(h('div', { class: 'max-w-xl mx-auto px-4 py-6 flex flex-col gap-4' },
    h('div', { class: 'flex items-center gap-3' },
      h('button', { class: 'icon-btn', 'aria-label': 'Sair da sala', onclick: confirmExit }, h('i', { class: 'fa-solid fa-arrow-left' })),
      h('h1', { class: 'text-2xl font-black flex-1', text: 'Sala de espera' })),
    h('div', { class: 'card text-center flex flex-col gap-3' },
      h('div', { class: 'text-xs uppercase tracking-wider text-slate-400', text: 'Código da sala' }),
      h('div', { class: 'room-code', text: L.code }),
      h('div', { class: 'flex gap-2 justify-center flex-wrap' },
        h('button', { class: 'btn btn-ghost', onclick: () => copyLink(link) }, h('i', { class: 'fa-solid fa-link' }), 'Copiar link'),
        h('button', { class: 'btn btn-ghost', onclick: () => showQr(link) }, h('i', { class: 'fa-solid fa-qrcode' }), 'QR Code'),
        navigator.share ? h('button', { class: 'btn btn-ghost', onclick: () => navigator.share({ title: 'Ludo Supreme', text: `Vem jogar Ludo! Sala ${L.code}`, url: link }).catch(() => {}) },
          h('i', { class: 'fa-solid fa-share-nodes' }), 'Enviar') : null)),
    Net.spectator ? h('p', { class: 'text-center text-amber-300 text-sm', text: 'Você está assistindo esta sala.' }) : null,
    h('div', { class: 'grid sm:grid-cols-2 gap-2' }, E.COLORS.map(seatCard)),
    !isHost && me ? h('button', {
      class: 'btn w-full text-lg py-4 ' + (me.ready ? 'btn-ghost' : 'btn-primary'),
      onclick: () => Net.send({ type: 'READY', payload: { ready: !me.ready } }),
    }, me.ready ? '✅ Pronto! (toque para cancelar)' : 'Estou pronto') : null,
    ...rulesBlock,
    isHost ? h('button', { class: 'btn btn-primary w-full text-lg py-4', disabled: !canStart, onclick: hostStartGame },
      h('i', { class: 'fa-solid fa-dice' }), 'Iniciar partida') : h('p', { class: 'text-center text-sm text-slate-400', text: 'O anfitrião inicia a partida.' }),
    startHint && isHost ? h('p', { class: 'text-center text-sm text-slate-400 -mt-2', text: startHint }) : null,
  ));
}

/* ---------- Entradas globais ---------- */
function clearAfkOnInteraction() {
  const s = Game.state;
  if (!s || $('#screen-game').hidden || Net.role === 'client') return;
  let changed = false;
  s.seats.forEach(seat => { if (isLocalSeat(seat) && seat.afk) { seat.afk = false; seat.timeouts = 0; changed = true; } });
  if (changed) { toast('Bem-vindo de volta!'); if (!Game.busy) proceed(); }
}

document.addEventListener('pointerdown', clearAfkOnInteraction, true);
document.addEventListener('keydown', e => {
  if ($('#screen-game').hidden || !Game.state) return;
  if (document.querySelector('.modal-back')) return;
  if (e.target instanceof HTMLInputElement) return;
  clearAfkOnInteraction();
  if (e.code === 'Space') { e.preventDefault(); actRoll(); return; }
  const n = Number(e.key);
  if (n >= 1 && n <= 4) {
    const s = Game.state;
    if (s.phase === 'playing' && canPick(E.playColor(s, s.turn.seat), n - 1)) actMove(n - 1);
  }
});

$('#die-btn').addEventListener('click', () => actRoll());
$('#btn-exit').addEventListener('click', confirmExit);
$('#btn-rules').addEventListener('click', showRules);
$('#btn-history').addEventListener('click', showHistory);
$('#btn-pause').addEventListener('click', togglePause);
$('#btn-mute').setAttribute('data-mute', '');
$('#btn-mute').addEventListener('click', () => Sound.toggle());

// Hook de diagnóstico (usado pelos testes de fumaça/headless).
// Hook de diagnóstico apenas em desenvolvimento local (testes headless).
if (location.hostname === 'localhost' || location.hostname === '127.0.0.1') {
  window.__ludo = { get state() { return Game.state; }, get busy() { return Game.busy; }, View, E, actRoll, actMove, canPick, layoutTokens };
}

// Início: ?room=XXXX reabre a sala (anfitrião) ou abre a tela de entrada (convidado)
(function boot() {
  const room = (new URLSearchParams(location.search).get('room') || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4);
  if (room.length === 4) {
    const hostSave = Store.get('ludo:host:' + room, null);
    if (hostSave) { hostRoom(hostSave); return; }
    if (Store.get('ludo:session:' + room, null)) { joinRoom(room); return; }
    openJoin(room);
    return;
  }
  renderHome();
})();
requestAnimationFrame(tickTimer);
