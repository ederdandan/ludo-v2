// WoodTextures — madeira, ardósia e sombra de contato 100% procedurais.
// Nenhuma imagem externa: canvas → CanvasTexture (map + normalMap + roughnessMap).
import * as THREE from '../../vendor/three.module.min.js';

// PRNG determinístico: o tabuleiro parece o mesmo a cada carregamento.
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeCanvas(w, h = w) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

function finish(canvas, { repeat = 1, aniso = 8 } = {}) {
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeat, repeat);
  tex.anisotropy = aniso;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// Normal map a partir de um canvas de altura (Sobel com wrap).
function normalFromHeight(heightCanvas, strength = 2.2) {
  const w = heightCanvas.width, h = heightCanvas.height;
  const src = heightCanvas.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, w, h).data;
  const out = makeCanvas(w, h);
  const octx = out.getContext('2d');
  const img = octx.createImageData(w, h);
  const d = img.data;
  const at = (x, y) => src[(((y + h) % h) * w + ((x + w) % w)) * 4] / 255;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dx = (at(x + 1, y) - at(x - 1, y)) * strength;
      const dy = (at(x, y + 1) - at(x, y - 1)) * strength;
      // normal ( -dx, -dy, 1 ) normalizada → [0,255]
      const nx = -dx, ny = -dy, nz = 1;
      const len = Math.hypot(nx, ny, nz) || 1;
      const i = (y * w + x) * 4;
      d[i] = ((nx / len) * 0.5 + 0.5) * 255;
      d[i + 1] = ((ny / len) * 0.5 + 0.5) * 255;
      d[i + 2] = ((nz / len) * 0.5 + 0.5) * 255;
      d[i + 3] = 255;
    }
  }
  octx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(out);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 8;
  return tex;
}

// ---------------------------------------------------------------------------
// Madeira nobre clara (carvalho): veios longos, nós ocasionais, leve vinheta.
// ---------------------------------------------------------------------------
export function makeWoodTextures(opts = {}) {
  const {
    size = 1024, seed = 20260212,
    base = '#e3c5a4', light = '#f2ddc2', grain = '#a56a3d', dark = '#7c4a2a',
  } = opts;
  const rnd = mulberry32(seed);

  // --- albedo ---
  const alb = makeCanvas(size);
  const ctx = alb.getContext('2d');
  const g = ctx.createLinearGradient(0, 0, size, size);
  g.addColorStop(0, base);
  g.addColorStop(0.45, light);
  g.addColorStop(1, base);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);

  // manchas amplas de tonalidade
  for (let i = 0; i < 26; i++) {
    const x = rnd() * size, y = rnd() * size, r = size * (0.06 + rnd() * 0.16);
    const rg = ctx.createRadialGradient(x, y, 0, x, y, r);
    rg.addColorStop(0, `rgba(165,106,61,${0.05 + rnd() * 0.07})`);
    rg.addColorStop(1, 'rgba(165,106,61,0)');
    ctx.fillStyle = rg;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  }

  // veios: curvas longas no eixo Y com desvio senoidal
  const drawGrain = (target, color, count, alpha, widthMax) => {
    const c = target.getContext('2d');
    c.save();
    c.strokeStyle = color;
    c.lineCap = 'round';
    for (let i = 0; i < count; i++) {
      const x0 = rnd() * size;
      const amp = 6 + rnd() * 26;
      const freq = 0.006 + rnd() * 0.012;
      const phase = rnd() * Math.PI * 2;
      const drift = (rnd() - 0.5) * size * 0.25;
      c.globalAlpha = alpha * (0.35 + rnd() * 0.65);
      c.lineWidth = 0.6 + rnd() * widthMax;
      c.beginPath();
      for (let y = -10; y <= size + 10; y += 6) {
        const x = x0 + drift * (y / size) + Math.sin(y * freq + phase) * amp + Math.sin(y * freq * 3.1 + phase) * amp * 0.22;
        if (y === -10) c.moveTo(x, y); else c.lineTo(x, y);
      }
      c.stroke();
    }
    c.restore();
  };

  drawGrain(alb, grain, 190, 0.16, 3.2);
  drawGrain(alb, dark, 70, 0.12, 1.6);
  drawGrain(alb, light, 90, 0.22, 2.4);

  // nós (raros)
  for (let k = 0; k < 3; k++) {
    const cx = rnd() * size, cy = rnd() * size;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(rnd() * Math.PI);
    for (let ring = 0; ring < 7; ring++) {
      ctx.beginPath();
      ctx.ellipse(0, 0, 6 + ring * 7, 16 + ring * 13, 0, 0, Math.PI * 2);
      ctx.strokeStyle = ring % 2 ? 'rgba(124,74,42,.35)' : 'rgba(165,106,61,.28)';
      ctx.lineWidth = 1.2;
      ctx.stroke();
    }
    ctx.restore();
  }

  // vinheta suave
  const vg = ctx.createRadialGradient(size / 2, size / 2, size * 0.25, size / 2, size / 2, size * 0.78);
  vg.addColorStop(0, 'rgba(0,0,0,0)');
  vg.addColorStop(1, 'rgba(60,30,10,.18)');
  ctx.fillStyle = vg;
  ctx.fillRect(0, 0, size, size);

  // --- height (menor, desfocado) ---
  const hsize = 512;
  const hgt = makeCanvas(hsize);
  const hctx = hgt.getContext('2d');
  hctx.fillStyle = '#808080';
  hctx.fillRect(0, 0, hsize, hsize);
  hctx.save();
  hctx.scale(hsize / size, hsize / size);
  drawGrain(hgt, '#ffffff', 150, 0.10, 3.4);
  drawGrain(hgt, '#3a3a3a', 90, 0.10, 2.4);
  hctx.restore();
  hctx.filter = 'blur(0.6px)';
  hctx.drawImage(hgt, 0, 0);

  const map = finish(alb, { repeat: 1 });
  const normalMap = normalFromHeight(hgt, 1.5);
  normalMap.repeat.set(1, 1);
  const roughness = new THREE.CanvasTexture(alb);
  roughness.wrapS = roughness.wrapT = THREE.RepeatWrapping;
  roughness.anisotropy = 8;

  return { map, normalMap, roughnessMap: roughness };
}

// ---------------------------------------------------------------------------
// Textura das casas: madeira clara com veio sutil, scale 1:1 por casa.
// ---------------------------------------------------------------------------
export function makeCellTexture(size = 256) {
  const rnd = mulberry32(4242);
  const c = makeCanvas(size);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#e3c4a1';
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < 30; i++) {
    const y0 = rnd() * size;
    const amp = 1 + rnd() * 4;
    ctx.strokeStyle = `rgba(150,96,55,${0.04 + rnd() * 0.06})`;
    ctx.lineWidth = 0.6 + rnd() * 1.6;
    ctx.beginPath();
    for (let x = -4; x <= size + 4; x += 6) {
      const y = y0 + Math.sin(x * 0.03 + i) * amp + Math.sin(x * 0.07 + i * 2) * amp * 0.4;
      if (x === -4) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  const vg = ctx.createLinearGradient(0, 0, size, size);
  vg.addColorStop(0, 'rgba(255,255,255,.10)');
  vg.addColorStop(1, 'rgba(120,70,30,.07)');
  ctx.fillStyle = vg;
  ctx.fillRect(0, 0, size, size);

  // moldura gravada (cada casa usa a textura inteira)
  ctx.strokeStyle = 'rgba(88,52,22,.30)';
  ctx.lineWidth = Math.max(2, size * 0.012);
  ctx.strokeRect(size * 0.035, size * 0.035, size * 0.93, size * 0.93);
  ctx.strokeStyle = 'rgba(255,248,232,.16)';
  ctx.lineWidth = Math.max(1, size * 0.006);
  ctx.strokeRect(size * 0.06, size * 0.06, size * 0.88, size * 0.88);

  return finish(c, { repeat: 1, aniso: 4 });
}

// ---------------------------------------------------------------------------
// Ardósia / feltro grafite da mesa.
// ---------------------------------------------------------------------------
export function makeSlateTexture(size = 1024) {
  const rnd = mulberry32(77123);
  const c = makeCanvas(size);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#3a424f';
  ctx.fillRect(0, 0, size, size);

  const img = ctx.getImageData(0, 0, size, size);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (rnd() - 0.5) * 16;
    d[i] = Math.max(0, Math.min(255, d[i] + n));
    d[i + 1] = Math.max(0, Math.min(255, d[i + 1] + n));
    d[i + 2] = Math.max(0, Math.min(255, d[i + 2] + n * 1.1));
  }
  ctx.putImageData(img, 0, 0);

  // fibras finas
  for (let i = 0; i < 900; i++) {
    const x = rnd() * size, y = rnd() * size, len = 6 + rnd() * 40;
    ctx.strokeStyle = `rgba(${180 + rnd() * 40},${190 + rnd() * 40},${210 + rnd() * 30},${0.012 + rnd() * 0.02})`;
    ctx.lineWidth = 0.6;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + len, y + (rnd() - 0.5) * 3);
    ctx.stroke();
  }

  return finish(c, { repeat: 8, aniso: 8 });
}

// ---------------------------------------------------------------------------
// Textura alfa de sombra de contato (radial), usada sob o tabuleiro.
// ---------------------------------------------------------------------------
export function makeContactShadowTexture(size = 512) {
  const c = makeCanvas(size);
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(size / 2, size / 2, size * 0.16, size / 2, size / 2, size * 0.5);
  g.addColorStop(0, 'rgba(0,0,0,.78)');
  g.addColorStop(0.55, 'rgba(0,0,0,.45)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
