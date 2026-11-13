// LudoEngine — motor de regras puro (sem DOM, sem rede).
// Extraído de index.html v1 preservando os marcadores usados pelos testes.
// Testes: node tests/engine.test.mjs

// ENGINE-START
/* Motor de regras puro (sem DOM). O mesmo motor servirá ao Host online. */
const LudoEngine = (() => {
  'use strict';
  const COLORS = ['red', 'green', 'yellow', 'blue'];
  const OFFSET = { red: 0, green: 13, yellow: 26, blue: 39 };
  const TEAM = { red: 0, yellow: 0, green: 1, blue: 1 };
  const SAFE = new Set([0, 8, 13, 21, 26, 34, 39, 47]);
  const LAST_MAIN = 50;
  const GOAL = 56;
  const TRACK = [
    [6, 1], [6, 2], [6, 3], [6, 4], [6, 5], [5, 6], [4, 6], [3, 6], [2, 6], [1, 6], [0, 6], [0, 7], [0, 8],
    [1, 8], [2, 8], [3, 8], [4, 8], [5, 8], [6, 9], [6, 10], [6, 11], [6, 12], [6, 13], [6, 14], [7, 14], [8, 14],
    [8, 13], [8, 12], [8, 11], [8, 10], [8, 9], [9, 8], [10, 8], [11, 8], [12, 8], [13, 8], [14, 8], [14, 7], [14, 6],
    [13, 6], [12, 6], [11, 6], [10, 6], [9, 6], [8, 5], [8, 4], [8, 3], [8, 2], [8, 1], [8, 0], [7, 0], [6, 0],
  ];
  const HOME = {
    red: [[7, 1], [7, 2], [7, 3], [7, 4], [7, 5]],
    green: [[1, 7], [2, 7], [3, 7], [4, 7], [5, 7]],
    yellow: [[7, 13], [7, 12], [7, 11], [7, 10], [7, 9]],
    blue: [[13, 7], [12, 7], [11, 7], [10, 7], [9, 7]],
  };
  const BASE_ORIGIN = { red: [0, 0], green: [0, 9], yellow: [9, 9], blue: [9, 0] };
  const BASE_SLOTS = [[1, 1], [1, 4], [4, 1], [4, 4]];
  // Centro de cada triângulo de chegada, em coordenadas de casa [linha, coluna]
  const GOAL_POINT = { red: [7.5, 6.5], green: [6.5, 7.5], yellow: [7.5, 8.5], blue: [8.5, 7.5] };

  const DEFAULT_RULES = {
    exitOn: [6], blocks: false, captureBonus: true, finishBonus: true,
    threeSixesLimit: true, threeSixesPenalty: false, exactFinish: true,
    endOnFirstWinner: false, teams: false, autoSingleMove: true,
    quickMode: false, turnSeconds: 20,
  };

  // Pesos do bot Difícil (seção 5.10.3)
  const HARD_WEIGHTS = {
    capture: 100, finish: 80, enterHome: 60, exitBase: 50, safe: 30, barrier: 25,
    progress: 1, threatened: -40, leaveSafeToThreat: -20, othersThreatened: -10,
  };

  const absPos = (color, rel) => (rel >= 0 && rel <= LAST_MAIN) ? (rel + OFFSET[color]) % 52 : null;

  function cryptoRng() {
    const buf = new Uint8Array(1);
    let x;
    do { globalThis.crypto.getRandomValues(buf); x = buf[0]; } while (x >= 252); // sem viés de módulo
    return (x % 6) + 1;
  }

  function pointOf(color, rel, idx) {
    if (rel < 0) {
      const [r0, c0] = BASE_ORIGIN[color];
      const [r, c] = BASE_SLOTS[idx];
      return [r0 + r + 0.5, c0 + c + 0.5];
    }
    if (rel <= LAST_MAIN) { const [r, c] = TRACK[absPos(color, rel)]; return [r + 0.5, c + 0.5]; }
    if (rel < GOAL) { const [r, c] = HOME[color][rel - 51]; return [r + 0.5, c + 0.5]; }
    return GOAL_POINT[color];
  }

  // Cores na mesa no Modo Solo: 1 adversário fica na cor oposta; 2 ou 3 seguem o sentido horário.
  function seatColorsFor(playerColor, opponents) {
    const i = COLORS.indexOf(playerColor);
    if (opponents === 1) return [playerColor, COLORS[(i + 2) % 4]];
    return Array.from({ length: opponents + 1 }, (_, k) => COLORS[(i + k) % 4]);
  }

  // Distribuição padrão por número de jogadores (seção 4.1)
  function defaultColorsFor(n) {
    if (n === 2) return ['red', 'yellow'];
    if (n === 3) return ['red', 'green', 'yellow'];
    return COLORS.slice();
  }

  const colorsInPlay = (state) => state.seats.map(s => s.color);
  const isOpponent = (state, a, b) => a !== b && !(state.rules.teams && TEAM[a] === TEAM[b]);

  function createGame({ mode = 'solo', players, rules = {} }) {
    const r = { ...DEFAULT_RULES, ...rules };
    const seats = players.slice()
      .sort((a, b) => COLORS.indexOf(a.color) - COLORS.indexOf(b.color))
      .map((p, i) => ({
        seat: i, color: p.color, name: p.name, avatar: p.avatar || null, owner: p.owner || null,
        isBot: !!p.isBot, botLevel: p.isBot ? (p.botLevel || 'medium') : null,
        connected: true, afk: false, finishedRank: null, timeouts: 0,
      }));
    if (r.teams && seats.length !== 4) r.teams = false; // duplas só com a mesa completa
    const pieces = {};
    for (const s of seats) pieces[s.color] = r.quickMode ? [0, -1, -1, -1] : [-1, -1, -1, -1];
    return {
      gameId: Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
      stateVersion: 0, mode, phase: 'choosingFirst', rules: r, seats, pieces,
      turn: freshTurn(0), turnNumber: 0, ranking: [], lastEvents: [], log: [],
    };
  }

  function freshTurn(seat) {
    return { seat, awaiting: 'roll', dice: null, consecutiveSixes: 0, validMoves: [], lastSixPiece: null, deadline: null };
  }

  function bump(state, events) {
    state.stateVersion++;
    state.lastEvents = events;
  }

  // Sorteio de quem começa: maior valor; empatados no maior rolam de novo entre si.
  function chooseFirst(state, rng = cryptoRng) {
    let contenders = state.seats.map(s => s.seat);
    const rounds = [];
    let winner;
    for (;;) {
      const round = contenders.map(seat => ({ seat, value: rng() }));
      rounds.push(round);
      const max = Math.max(...round.map(x => x.value));
      const top = round.filter(x => x.value === max).map(x => x.seat);
      if (top.length === 1) { winner = top[0]; break; }
      contenders = top;
    }
    state.phase = 'playing';
    state.turn = freshTurn(winner);
    state.turnNumber = 1;
    const events = [{ kind: 'FIRST', rounds, winner }, { kind: 'TURN', seat: winner }];
    bump(state, events);
    return { rounds, winner, events };
  }

  function opponentBarrierAt(state, color, abs) {
    for (const c of colorsInPlay(state)) {
      if (!isOpponent(state, color, c)) continue;
      let n = 0;
      for (const r of state.pieces[c]) if (r >= 0 && r <= LAST_MAIN && absPos(c, r) === abs) n++;
      if (n >= 2) return true;
    }
    return false;
  }

  function computeValidMoves(state, color, dice) {
    const rules = state.rules;
    const res = [];
    state.pieces[color].forEach((rel, i) => {
      if (rel === GOAL) return;
      if (rel < 0) {
        if (!rules.exitOn.includes(dice)) return;
        if (rules.blocks && opponentBarrierAt(state, color, OFFSET[color])) return;
        res.push(i);
        return;
      }
      let target = rel + dice;
      if (target > GOAL) {
        if (rules.exactFinish) return;
        target = GOAL;
      }
      if (rules.blocks) {
        for (let p = rel + 1; p <= Math.min(target, LAST_MAIN); p++) {
          if (opponentBarrierAt(state, color, absPos(color, p))) return;
        }
      }
      res.push(i);
    });
    return res;
  }

  // Cor que o assento move: no modo duplas, quem já levou os 4 peões move os do parceiro.
  function playColor(state, seatIdx) {
    const seat = state.seats[seatIdx];
    if (state.rules.teams && state.pieces[seat.color].every(r => r === GOAL)) {
      const partner = state.seats.find(s => s.color !== seat.color && TEAM[s.color] === TEAM[seat.color]);
      if (partner) return partner.color;
    }
    return seat.color;
  }

  function unfinishedSeats(state) {
    return state.seats.filter(s => s.finishedRank == null);
  }

  function nextTurn(state, events) {
    const n = state.seats.length;
    let seat = state.turn.seat;
    for (let k = 1; k <= n; k++) {
      const cand = (state.turn.seat + k) % n;
      if (state.seats[cand].finishedRank == null) { seat = cand; break; }
    }
    state.turn = freshTurn(seat);
    state.turnNumber++;
    events.push({ kind: 'TURN', seat });
  }

  const progressOf = (state, color) => state.pieces[color].reduce((a, r) => a + r + 1, 0);

  function finishGame(state, events) {
    if (state.rules.teams) { // classifica por dupla, pelo progresso somado
      const teamProgress = (team) => state.seats.filter(s => TEAM[s.color] === team).reduce((a, s) => a + progressOf(state, s.color), 0);
      const order = [0, 1].sort((a, b) => teamProgress(b) - teamProgress(a));
      state.ranking = [];
      order.forEach((team, k) => state.seats.filter(s => TEAM[s.color] === team).forEach(s => {
        s.finishedRank = k + 1;
        state.ranking.push(s.seat);
      }));
      state.phase = 'finished';
      state.turn.awaiting = null;
      state.turn.validMoves = [];
      events.push({ kind: 'GAME_OVER', ranking: state.ranking.slice() });
      return;
    }
    const rest = unfinishedSeats(state)
      .sort((a, b) => progressOf(state, b.color) - progressOf(state, a.color));
    for (const s of rest) {
      state.ranking.push(s.seat);
      s.finishedRank = state.ranking.length;
    }
    state.phase = 'finished';
    state.turn.awaiting = null;
    state.turn.validMoves = [];
    events.push({ kind: 'GAME_OVER', ranking: state.ranking.slice() });
  }

  function roll(state, rng = cryptoRng) {
    const t = state.turn;
    if (state.phase !== 'playing' || t.awaiting !== 'roll') return null;
    const color = playColor(state, t.seat);
    const dice = rng();
    t.dice = dice;
    t.deadline = null;
    const events = [{ kind: 'ROLL', seat: t.seat, color, value: dice }];
    t.consecutiveSixes = dice === 6 ? t.consecutiveSixes + 1 : 0;

    if (state.rules.threeSixesLimit && t.consecutiveSixes >= 3) {
      let penalty = null;
      if (state.rules.threeSixesPenalty && t.lastSixPiece != null) {
        const rel = state.pieces[color][t.lastSixPiece];
        if (rel >= 0 && rel <= LAST_MAIN) {
          state.pieces[color][t.lastSixPiece] = -1;
          penalty = { color, piece: t.lastSixPiece, from: rel };
        }
      }
      events.push({ kind: 'THREE_SIXES', seat: t.seat, color, penalty });
      nextTurn(state, events);
      bump(state, events);
      return events;
    }

    const valid = computeValidMoves(state, color, dice);
    t.validMoves = valid;
    if (!valid.length) {
      events.push({ kind: 'NO_MOVES', seat: t.seat, color, value: dice });
      if (dice === 6) {
        t.awaiting = 'roll';
        events.push({ kind: 'EXTRA', seat: t.seat, reason: 'six' });
      } else {
        nextTurn(state, events);
      }
    } else {
      t.awaiting = 'move';
    }
    bump(state, events);
    return events;
  }

  function move(state, pieceIdx) {
    const t = state.turn;
    if (state.phase !== 'playing' || t.awaiting !== 'move' || !t.validMoves.includes(pieceIdx)) return null;
    const seat = state.seats[t.seat];
    const color = playColor(state, t.seat);
    const dice = t.dice;
    const from = state.pieces[color][pieceIdx];
    let to, path;
    if (from < 0) { to = 0; path = [0]; }
    else {
      to = Math.min(from + dice, GOAL);
      path = [];
      for (let p = from + 1; p <= to; p++) path.push(p);
    }
    state.pieces[color][pieceIdx] = to;
    t.deadline = null;
    t.validMoves = [];
    if (dice === 6) t.lastSixPiece = pieceIdx;

    const events = [{ kind: 'MOVE', seat: t.seat, color, piece: pieceIdx, from, to, path, dice }];
    let extra = false;

    if (to === GOAL) {
      events.push({ kind: 'PIECE_HOME', seat: t.seat, color, piece: pieceIdx });
      if (state.rules.finishBonus) extra = true;
    }

    const a = absPos(color, to);
    if (a !== null && !SAFE.has(a)) {
      const victims = [];
      for (const c of colorsInPlay(state)) {
        if (!isOpponent(state, color, c)) continue;
        state.pieces[c].forEach((r, j) => {
          if (r >= 0 && r <= LAST_MAIN && absPos(c, r) === a) {
            victims.push({ color: c, piece: j, from: r });
            state.pieces[c][j] = -1;
          }
        });
      }
      if (victims.length) {
        events.push({ kind: 'CAPTURE', seat: t.seat, color, victims });
        if (state.rules.captureBonus) extra = true;
      }
    }

    if (state.rules.teams) {
      const team = state.seats.filter(s => TEAM[s.color] === TEAM[color]);
      if (team.every(s => state.pieces[s.color].every(r => r === GOAL))) {
        const others = state.seats.filter(s => TEAM[s.color] !== TEAM[color]);
        state.ranking = [...team, ...others].map(s => s.seat);
        team.forEach(s => { s.finishedRank = 1; });
        others.forEach(s => { s.finishedRank = 2; });
        events.push({ kind: 'TEAM_FINISHED', seat: t.seat, seats: team.map(s => s.seat) });
        state.phase = 'finished';
        t.awaiting = null;
        events.push({ kind: 'GAME_OVER', ranking: state.ranking.slice() });
        bump(state, events);
        return events;
      }
      if (color === seat.color && state.pieces[color].every(r => r === GOAL)) t.lastSixPiece = null; // passa a mover o parceiro
    } else if (seat.finishedRank == null && state.pieces[color].every(r => r === GOAL)) {
      state.ranking.push(seat.seat);
      seat.finishedRank = state.ranking.length;
      events.push({ kind: 'PLAYER_FINISHED', seat: seat.seat, rank: seat.finishedRank });
      if (state.rules.endOnFirstWinner || unfinishedSeats(state).length <= 1) finishGame(state, events);
      else nextTurn(state, events); // rolagem extra descartada
      bump(state, events);
      return events;
    }

    if (dice === 6 || extra) {
      t.awaiting = 'roll';
      events.push({ kind: 'EXTRA', seat: t.seat, reason: dice === 6 ? 'six' : 'bonus' });
    } else {
      nextTurn(state, events);
    }
    bump(state, events);
    return events;
  }

  // Encerra a partida antes do fim natural (ex.: "Encerrar" no Modo Solo)
  function endEarly(state) {
    const events = [];
    finishGame(state, events);
    bump(state, events);
    return events;
  }

  // ---------- Algoritmo dos bots ----------
  function threatCount(state, pieces, color, abs) {
    let n = 0;
    for (const c of colorsInPlay(state)) {
      if (!isOpponent(state, color, c)) continue;
      for (const r of pieces[c]) {
        if (r < 0 || r > LAST_MAIN) continue;
        const d = (abs - absPos(c, r) + 52) % 52;
        if (d >= 1 && d <= 6 && r + d <= LAST_MAIN) n++;
      }
    }
    return n;
  }

  function analyzeMove(state, color, i, dice) {
    const from = state.pieces[color][i];
    const to = from < 0 ? 0 : Math.min(from + dice, GOAL);
    const after = {};
    for (const c in state.pieces) after[c] = state.pieces[c].slice();
    after[color][i] = to;
    const toAbs = absPos(color, to);
    const victims = [];
    if (toAbs !== null && !SAFE.has(toAbs)) {
      for (const c in after) {
        if (!isOpponent(state, color, c)) continue;
        after[c].forEach((r, j) => {
          if (r >= 0 && r <= LAST_MAIN && absPos(c, r) === toAbs) { victims.push({ color: c, piece: j, from: r }); after[c][j] = -1; }
        });
      }
    }
    const exposed = (rel) => rel >= 0 && rel <= LAST_MAIN && !SAFE.has(absPos(color, rel));
    const threatAfter = exposed(to) ? threatCount(state, after, color, toAbs) : 0;
    const threatBefore = exposed(from) ? threatCount(state, state.pieces, color, absPos(color, from)) : 0;
    let othersThreatened = 0;
    after[color].forEach((r, j) => {
      if (j !== i && exposed(r) && threatCount(state, after, color, absPos(color, r)) > 0) othersThreatened++;
    });
    const formsBarrier = !!state.rules.blocks && toAbs !== null &&
      after[color].filter(r => r >= 0 && r <= LAST_MAIN && absPos(color, r) === toAbs).length >= 2;
    return {
      piece: i, from, to, steps: from < 0 ? 1 : to - from, victims,
      captureProgress: victims.reduce((s, v) => s + v.from, 0),
      finishes: to === GOAL,
      entersHome: to > LAST_MAIN && to < GOAL && from <= LAST_MAIN,
      exitsBase: from < 0,
      safeLanding: toAbs !== null && SAFE.has(toAbs),
      fromSafe: from >= 0 && from <= LAST_MAIN && SAFE.has(absPos(color, from)),
      threatAfter, threatBefore, othersThreatened, formsBarrier,
    };
  }

  function hardScore(a) {
    const w = HARD_WEIGHTS;
    let s = 0;
    if (a.victims.length) s += w.capture + a.captureProgress;
    if (a.finishes) s += w.finish;
    if (a.entersHome) s += w.enterHome;
    if (a.exitsBase) s += w.exitBase;
    if (a.safeLanding) s += w.safe;
    if (a.formsBarrier) s += w.barrier;
    s += w.progress * a.steps;
    s += w.threatened * a.threatAfter;
    if (a.fromSafe && a.threatAfter > 0) s += w.leaveSafeToThreat;
    s += w.othersThreatened * a.othersThreatened;
    return s;
  }

  const byAdvance = (a, b) => b.from - a.from;

  // Prioridades do nível Médio e do autoplay (seção 5.5)
  const MEDIUM_TIERS = [
    [a => a.victims.length > 0, (a, b) => b.captureProgress - a.captureProgress || byAdvance(a, b)],
    [a => a.finishes, byAdvance],
    [a => a.exitsBase, byAdvance],
    [a => a.threatBefore > 0 && a.threatAfter === 0, (a, b) => b.threatBefore - a.threatBefore || byAdvance(a, b)],
    [a => a.safeLanding, byAdvance],
    [() => true, byAdvance],
  ];

  function chooseMove(state, level = 'medium', rand = Math.random) {
    const t = state.turn;
    const moves = t.validMoves;
    if (!moves.length) return null;
    if (moves.length === 1) return moves[0];
    const color = playColor(state, t.seat);
    const list = moves.map(i => analyzeMove(state, color, i, t.dice));

    if (level === 'easy') {
      const caps = list.filter(a => a.victims.length);
      const rest = list.filter(a => !a.victims.length);
      let pool = list;
      if (caps.length) pool = (rest.length && rand() < 0.3) ? rest : caps;
      return pool[Math.floor(rand() * pool.length)].piece;
    }
    if (level === 'hard') {
      list.forEach(a => { a.score = hardScore(a); });
      list.sort((a, b) => b.score - a.score || byAdvance(a, b));
      return list[0].piece;
    }
    for (const [match, cmp] of MEDIUM_TIERS) {
      const tier = list.filter(match);
      if (tier.length) return tier.sort(cmp)[0].piece;
    }
    return list[0].piece;
  }

  return {
    COLORS, OFFSET, TEAM, SAFE, TRACK, HOME, GOAL, LAST_MAIN, DEFAULT_RULES, HARD_WEIGHTS,
    absPos, pointOf, cryptoRng, seatColorsFor, defaultColorsFor, isOpponent, playColor,
    createGame, chooseFirst, computeValidMoves, roll, move, endEarly,
    analyzeMove, hardScore, chooseMove, progressOf,
  };
})();
// ENGINE-END

export { LudoEngine };
