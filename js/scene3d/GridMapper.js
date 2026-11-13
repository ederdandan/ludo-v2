// GridMapper — converte o grid lógico 15x15 do motor para coordenadas de mundo.
// Mundo: x → direita, z → para a câmera (sul), y → cima.
// O tabuleiro é girado +45° no grupo raiz (ver WorldManager), o que coloca
// vermelho a Oeste, verde ao Norte, amarelo a Leste e azul ao Sul — como na referência.

export const GRID = 15;
export const HALF = GRID / 2; // 7.5
export const CELL = 1;

// Índice de coluna/linha (0..14) → centro da célula em unidades de mundo.
// A célula 0 ocupa [-7.5, -6.5]; a 14 ocupa [6.5, 7.5].
export const colToX = (col) => col - HALF + 0.5;
export const rowToZ = (row) => row - HALF + 0.5;

export const cellToWorld = (row, col) => ({ x: colToX(col), z: rowToZ(row) });

// engine.pointOf devolve [linha + 0.5, coluna + 0.5] (centro da célula).
export function pointToWorld(pointOf, color, rel, idx) {
  const [r, c] = pointOf(color, rel, idx);
  return { x: c - HALF, z: r - HALF };
}

// Canto superior esquerdo de um bloco de `rows` x `cols` começando em (row, col).
export function blockCenter(row, col, rows = 1, cols = 1) {
  return { x: col + cols / 2 - HALF, z: row + rows / 2 - HALF };
}

// Rotação aplicada ao grupo do tabuleiro (45°, sentido anti-horário visto de cima).
export const BOARD_YAW = Math.PI / 4;

// Raio da bbox do tabuleiro girado (meia-diagonal) — usado no enquadramento.
export const BOARD_HALF_DIAGONAL = Math.SQRT2 * (GRID / 2);

// Direção (no plano local do tabuleiro) para onde a luz principal (8,14,7) projeta
// sombras, por unidade de altura. Usada nas sombras falsas/AO pré-calculado, que só
// importam no celular (sem shadow map) — lá o uso é em retrato, onde o tabuleiro
// fica sem o giro de 45°, então local = mundo.
export const SHADOW_DX = -8 / 14;
export const SHADOW_DZ = -7 / 14;
