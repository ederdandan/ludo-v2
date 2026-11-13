// Testes do motor de regras (critérios de aceite da SPEC, seção 8).
// Rodar com: node --test tests/engine.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const engineFile = readFileSync(new URL('../js/game-engine.js', import.meta.url), 'utf8');
const src = engineFile.match(/\/\/ ENGINE-START([\s\S]*?)\/\/ ENGINE-END/)[1];
const E = new Function(`${src}\nreturn LudoEngine;`)();

// Partida já em andamento, vez do primeiro assento
function game(colors = ['red', 'yellow'], rules = {}, pieces = {}) {
  const s = E.createGame({
    mode: 'solo',
    players: colors.map((c, i) => ({ color: c, name: c, isBot: i > 0, botLevel: 'hard' })),
    rules,
  });
  s.phase = 'playing';
  s.turn.seat = 0;
  Object.assign(s.pieces, pieces);
  return s;
}
const roll = (s, v) => E.roll(s, () => v);
const kinds = (events) => events.map(e => e.kind);
// posição relativa de `color` na casa absoluta `abs`
const relAt = (color, abs) => (abs - E.OFFSET[color] + 52) % 52;

test('1. todos na base, dado 4: NO_MOVES e turno passa', () => {
  const s = game();
  const ev = roll(s, 4);
  assert.ok(kinds(ev).includes('NO_MOVES'));
  assert.equal(s.turn.seat, 1);
  assert.equal(s.turn.awaiting, 'roll');
});

test('2. todos na base, dado 6: peão vai para rel 0 e rola de novo', () => {
  const s = game();
  roll(s, 6);
  assert.deepEqual(s.turn.validMoves, [0, 1, 2, 3]);
  E.move(s, 0);
  assert.equal(s.pieces.red[0], 0);
  assert.equal(s.turn.seat, 0);
  assert.equal(s.turn.awaiting, 'roll');
});

test('3. três 6 seguidos: terceiro não é jogado e turno passa', () => {
  const s = game(undefined, {}, { red: [10, -1, -1, -1] });
  roll(s, 6); E.move(s, 0);
  roll(s, 6); E.move(s, 0);
  assert.equal(s.pieces.red[0], 22);
  const ev = roll(s, 6);
  assert.ok(kinds(ev).includes('THREE_SIXES'));
  assert.equal(s.turn.seat, 1);
  assert.equal(s.pieces.red[0], 22, 'movimentos anteriores permanecem');
  assert.equal(s.turn.consecutiveSixes, 0);
});

test('3b. penalidade dos três 6 devolve o último peão movido com 6', () => {
  const s = game(undefined, { threeSixesPenalty: true }, { red: [10, -1, -1, -1] });
  roll(s, 6); E.move(s, 0);
  roll(s, 6); E.move(s, 0);
  const ev = roll(s, 6);
  assert.equal(ev.find(e => e.kind === 'THREE_SIXES').penalty.from, 22);
  assert.equal(s.pieces.red[0], -1);
});

test('4. peão em rel 53 com dado 5 é inválido (número exato)', () => {
  const s = game(undefined, {}, { red: [53, 10, -1, -1] });
  roll(s, 5);
  assert.deepEqual(s.turn.validMoves, [1]);
});

test('4b. número exato desligado: excedente é ignorado', () => {
  const s = game(undefined, { exactFinish: false }, { red: [53, 10, -1, -1] });
  roll(s, 5);
  assert.deepEqual(s.turn.validMoves, [0, 1]);
  E.move(s, 0);
  assert.equal(s.pieces.red[0], 56);
});

test('5. peão em rel 53 com dado 3 chega ao centro e ganha rolagem extra', () => {
  const s = game(undefined, {}, { red: [53, 10, -1, -1] });
  roll(s, 3);
  const ev = E.move(s, 0);
  assert.equal(s.pieces.red[0], 56);
  assert.ok(kinds(ev).includes('PIECE_HOME'));
  assert.equal(s.turn.seat, 0);
  assert.equal(s.turn.awaiting, 'roll');
});

test('6. captura em casa não segura: adversário volta à base e rolagem extra', () => {
  const s = game(undefined, {}, { red: [10, -1, -1, -1], yellow: [relAt('yellow', 14), -1, -1, -1] });
  roll(s, 4);
  const ev = E.move(s, 0);
  assert.ok(kinds(ev).includes('CAPTURE'));
  assert.equal(s.pieces.yellow[0], -1);
  assert.equal(s.turn.seat, 0);
  assert.equal(s.turn.awaiting, 'roll');
});

test('7. parar na estrela com adversário: coexistem', () => {
  const s = game(undefined, {}, { red: [4, -1, -1, -1], yellow: [relAt('yellow', 8), -1, -1, -1] });
  roll(s, 4);
  const ev = E.move(s, 0);
  assert.ok(!kinds(ev).includes('CAPTURE'));
  assert.equal(E.absPos('red', s.pieces.red[0]), 8);
  assert.equal(E.absPos('yellow', s.pieces.yellow[0]), 8);
});

test('8. sair da base com adversário na casa de saída: coexistem', () => {
  const s = game(undefined, {}, { yellow: [relAt('yellow', 0), -1, -1, -1] });
  roll(s, 6);
  const ev = E.move(s, 0);
  assert.ok(!kinds(ev).includes('CAPTURE'));
  assert.equal(s.pieces.red[0], 0);
  assert.equal(E.absPos('yellow', s.pieces.yellow[0]), 0);
});

test('9. atravessar casa com adversário sem parar: sem captura', () => {
  const s = game(undefined, {}, { red: [10, -1, -1, -1], yellow: [relAt('yellow', 12), -1, -1, -1] });
  roll(s, 4);
  E.move(s, 0);
  assert.equal(s.pieces.red[0], 14);
  assert.equal(E.absPos('yellow', s.pieces.yellow[0]), 12);
});

test('10. Vermelho em rel 50 com dado 1 entra na reta (7,1)', () => {
  const s = game(undefined, {}, { red: [50, -1, -1, -1] });
  roll(s, 1);
  E.move(s, 0);
  assert.equal(s.pieces.red[0], 51);
  assert.deepEqual(E.pointOf('red', 51, 0), [7.5, 1.5]);
});

test('10b. retas finais de todas as cores começam na casa certa', () => {
  assert.deepEqual(E.pointOf('green', 51, 0), [1.5, 7.5]);
  assert.deepEqual(E.pointOf('yellow', 51, 0), [7.5, 13.5]);
  assert.deepEqual(E.pointOf('blue', 51, 0), [13.5, 7.5]);
  // rel 50 de cada cor é a casa de entrada da reta
  assert.equal(E.absPos('green', 50), 11);
  assert.equal(E.absPos('yellow', 50), 24);
  assert.equal(E.absPos('blue', 50), 37);
});

test('11. captura com 6 concede apenas uma rolagem extra', () => {
  const s = game(undefined, {}, { red: [8, -1, -1, -1], yellow: [relAt('yellow', 14), -1, -1, -1] });
  roll(s, 6);
  const ev = E.move(s, 0);
  assert.equal(ev.filter(e => e.kind === 'EXTRA').length, 1);
  roll(s, 2);
  E.move(s, 0);
  assert.equal(s.turn.seat, 1, 'depois do 2 a vez passa');
});

test('12. jogador termina com jogada que daria extra: vez passa ao próximo', () => {
  const s = game(['red', 'green', 'yellow'], {}, { red: [56, 56, 56, 53] });
  roll(s, 3);
  const ev = E.move(s, 3);
  assert.ok(kinds(ev).includes('PLAYER_FINISHED'));
  assert.equal(s.seats[0].finishedRank, 1);
  assert.equal(s.turn.seat, 1);
  assert.equal(s.phase, 'playing');
});

test('12b. turnos pulam jogadores que já terminaram', () => {
  const s = game(['red', 'green', 'yellow'], {}, { red: [56, 56, 56, 56] });
  s.seats[0].finishedRank = 1;
  s.ranking = [0];
  s.turn.seat = 2;
  roll(s, 2);
  assert.equal(s.turn.seat, 1);
});

test('12c. com 2 jogadores, o primeiro a terminar encerra a partida', () => {
  const s = game(undefined, {}, { red: [56, 56, 56, 53] });
  roll(s, 3);
  const ev = E.move(s, 3);
  assert.ok(kinds(ev).includes('GAME_OVER'));
  assert.equal(s.phase, 'finished');
  assert.deepEqual(s.ranking, [0, 1]);
});

test('12d. encerrar no 1º vencedor ordena o resto pelo progresso', () => {
  const s = game(['red', 'green', 'yellow'], { endOnFirstWinner: true },
    { red: [56, 56, 56, 53], green: [5, -1, -1, -1], yellow: [30, 20, -1, -1] });
  roll(s, 3);
  E.move(s, 3);
  assert.equal(s.phase, 'finished');
  assert.deepEqual(s.ranking, [0, 2, 1]);
});

test('17. distribuição padrão de cores', () => {
  assert.deepEqual(E.defaultColorsFor(2), ['red', 'yellow']);
  assert.deepEqual(E.defaultColorsFor(3), ['red', 'green', 'yellow']);
});

test('19. Modo Solo, 1 adversário, jogador Vermelho: bot no Amarelo', () => {
  assert.deepEqual(E.seatColorsFor('red', 1), ['red', 'yellow']);
  assert.deepEqual(E.seatColorsFor('green', 1), ['green', 'blue']);
});

test('20. Modo Solo, 3 adversários: 4 cores ocupadas', () => {
  assert.deepEqual(E.seatColorsFor('blue', 3).sort(), ['blue', 'green', 'red', 'yellow']);
  assert.deepEqual(E.seatColorsFor('green', 2), ['green', 'yellow', 'blue']);
});

test('22. bot Difícil prefere captura a sair da base', () => {
  const s = game(['red', 'yellow'], {}, { red: [-1, 9, -1, -1], yellow: [relAt('yellow', 15), -1, -1, -1] });
  roll(s, 6);
  assert.ok(s.turn.validMoves.includes(0) && s.turn.validMoves.includes(1));
  assert.equal(E.chooseMove(s, 'hard'), 1);
});

test('23. bot Difícil prefere a estrela a uma casa ameaçada', () => {
  const s = game(['red', 'green'], {}, { red: [3, 20, 56, 56], green: [relAt('green', 22), -1, -1, -1] });
  roll(s, 5);
  assert.deepEqual(s.turn.validMoves, [0, 1]);
  assert.equal(E.chooseMove(s, 'hard'), 0);
});

test('bot Médio segue as prioridades: captura antes de chegar ao centro', () => {
  const s = game(['red', 'yellow'], {}, { red: [52, 10, -1, -1], yellow: [relAt('yellow', 14), -1, -1, -1] });
  roll(s, 4);
  assert.equal(E.chooseMove(s, 'medium'), 1);
});

test('bot Médio foge de ameaça quando não há nada melhor', () => {
  // peão 0 em abs 20 ameaçado por amarelo em abs 17; peão 1 em abs 30 livre
  const s = game(['red', 'yellow'], {}, { red: [20, 30, -1, -1], yellow: [relAt('yellow', 17), -1, -1, -1] });
  roll(s, 4);
  assert.equal(E.chooseMove(s, 'medium'), 0);
});

test('bot Fácil sempre devolve um movimento válido', () => {
  const s = game(['red', 'yellow'], {}, { red: [5, 10, 20, -1] });
  roll(s, 3);
  for (let k = 0; k < 50; k++) assert.ok(s.turn.validMoves.includes(E.chooseMove(s, 'easy')));
});

test('bloqueio: barreira adversária impede ultrapassar', () => {
  const y = relAt('yellow', 12);
  const s = game(['red', 'yellow'], { blocks: true }, { red: [10, -1, -1, -1], yellow: [y, y, -1, -1] });
  roll(s, 4);
  assert.deepEqual(s.turn.validMoves, []);
});

test('bloqueio: barreira na casa de saída impede sair da base', () => {
  const y = relAt('yellow', 0);
  const s = game(['red', 'yellow'], { blocks: true }, { yellow: [y, y, -1, -1] });
  roll(s, 6);
  assert.deepEqual(s.turn.validMoves, []);
  assert.equal(s.turn.seat, 0, 'com 6 sem movimento, rola de novo');
});

test('sair com 1 quando a regra da casa está ativa', () => {
  const s = game(undefined, { exitOn: [1, 6] });
  roll(s, 1);
  assert.deepEqual(s.turn.validMoves, [0, 1, 2, 3]);
  E.move(s, 0);
  assert.equal(s.pieces.red[0], 0);
  assert.equal(s.turn.seat, 1, 'sair com 1 não dá rolagem extra');
});

test('sem bônus de captura: capturar com dado comum passa a vez', () => {
  const s = game(undefined, { captureBonus: false }, { red: [10, -1, -1, -1], yellow: [relAt('yellow', 14), -1, -1, -1] });
  roll(s, 4);
  E.move(s, 0);
  assert.equal(s.pieces.yellow[0], -1);
  assert.equal(s.turn.seat, 1);
});

test('modo rápido começa com 1 peão na saída', () => {
  const s = E.createGame({ players: [{ color: 'red' }, { color: 'yellow' }], rules: { quickMode: true } });
  assert.deepEqual(s.pieces.red, [0, -1, -1, -1]);
});

test('sorteio inicial: empate no maior valor rola de novo só entre empatados', () => {
  const s = E.createGame({ players: [{ color: 'red' }, { color: 'green' }, { color: 'yellow' }] });
  const seq = [5, 5, 2, 3, 6];
  const res = E.chooseFirst(s, () => seq.shift());
  assert.equal(res.rounds.length, 2);
  assert.deepEqual(res.rounds[1].map(x => x.seat), [0, 1]);
  assert.equal(res.winner, 1);
  assert.equal(s.turn.seat, 1);
});

test('intenções fora de hora são rejeitadas', () => {
  const s = game();
  assert.equal(E.move(s, 0), null, 'mover antes de rolar');
  roll(s, 6);
  assert.equal(E.roll(s, () => 3), null, 'rolar quando deve mover');
  assert.equal(E.move(s, 9), null, 'peão inexistente');
});

test('dado com crypto fica entre 1 e 6 e cobre todos os valores', () => {
  const seen = new Set();
  for (let k = 0; k < 2000; k++) {
    const v = E.cryptoRng();
    assert.ok(v >= 1 && v <= 6);
    seen.add(v);
  }
  assert.equal(seen.size, 6);
});

test('partidas inteiras entre bots terminam com ranking completo', () => {
  for (const level of ['easy', 'medium', 'hard']) {
    const s = E.createGame({
      players: E.COLORS.map(c => ({ color: c, name: c, isBot: true, botLevel: level })),
    });
    E.chooseFirst(s);
    let guard = 0;
    while (s.phase === 'playing' && guard++ < 20000) {
      if (s.turn.awaiting === 'roll') E.roll(s);
      else E.move(s, E.chooseMove(s, level));
    }
    assert.equal(s.phase, 'finished', `nível ${level}`);
    assert.equal(s.ranking.length, 4);
    assert.equal(new Set(s.ranking).size, 4);
  }
});

test('duplas: quem terminou move os peões do parceiro e parceiros não se capturam', () => {
  const s = game(['red', 'green', 'yellow', 'blue'], { teams: true },
    { red: [56, 56, 56, 56], yellow: [10, -1, -1, -1], green: [-1, -1, -1, -1], blue: [-1, -1, -1, -1] });
  assert.equal(E.playColor(s, 0), 'yellow');
  roll(s, 3);
  assert.deepEqual(s.turn.validMoves, [0]);
  E.move(s, 0);
  assert.equal(s.pieces.yellow[0], 13);
});

test('duplas: a dupla que leva os 8 peões vence', () => {
  const s = game(['red', 'green', 'yellow', 'blue'], { teams: true },
    { red: [56, 56, 56, 56], yellow: [56, 56, 56, 53] });
  roll(s, 3);
  const ev = E.move(s, 3);
  assert.ok(kinds(ev).includes('TEAM_FINISHED'));
  assert.equal(s.phase, 'finished');
  assert.deepEqual(s.seats.map(x => x.finishedRank), [1, 2, 1, 2]);
});

test('duplas: encerrar antes do fim classifica por dupla', () => {
  const s = game(['red', 'green', 'yellow', 'blue'], { teams: true },
    { red: [30, -1, -1, -1], yellow: [20, -1, -1, -1], green: [5, -1, -1, -1], blue: [-1, -1, -1, -1] });
  E.endEarly(s);
  assert.deepEqual(s.seats.map(x => x.finishedRank), [1, 2, 1, 2]);
});
