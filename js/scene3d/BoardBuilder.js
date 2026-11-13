// BoardBuilder — diorama de madeira: mesa, laje, moldura, 52 casas, retas,
// bases com anéis de latão, hub central e sombras.
import * as THREE from '../../vendor/three.module.min.js';
import { makeWoodTextures, makeSlateTexture, makeContactShadowTexture, makeCellTexture } from './WoodTextures.js';
import { cellToWorld, blockCenter, pointToWorld, BOARD_YAW, SHADOW_DX, SHADOW_DZ } from './GridMapper.js';

export const RESIN_HEX = {
  red: '#a5140d',
  green: '#0b6b1f',
  yellow: '#b8811c',
  blue: '#223a86',
};

// Mapa de profundidade da resina (cinza, multiplica a cor): centro mais claro,
// bordas escurecidas e nuvens leves de pigmento. UV das placas vai de 0 a 1.
function resinDepthTexture(size = 128) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(size * 0.42, size * 0.4, size * 0.05, size / 2, size / 2, size * 0.72);
  grad.addColorStop(0, '#ffffff');
  grad.addColorStop(0.6, '#cfcfcf');
  grad.addColorStop(1, '#5c5c5c');
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 26; i++) {
    const x = rnd() * size, y = rnd() * size, r = size * (0.08 + rnd() * 0.18);
    const cg = g.createRadialGradient(x, y, 0, x, y, r);
    const a = 0.05 + rnd() * 0.07;
    cg.addColorStop(0, rnd() > 0.5 ? `rgba(255,255,255,${a})` : `rgba(0,0,0,${a})`);
    cg.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = cg;
    g.fillRect(0, 0, size, size);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const BASE_ORIGIN = { red: [0, 0], green: [0, 9], yellow: [9, 9], blue: [9, 0] };
const START_COLOR = { 0: 'red', 13: 'green', 26: 'yellow', 39: 'blue' };

// Alturas do tampo entalhado (y local do tabuleiro).
export const DECK_TOP = 0.2;   // superfície de madeira maciça
const GROOVE_TOP = 0.1;        // fundo dos sulcos entre as casas
export const CELL_TOP = 0.15;  // topo das casas entalhadas / saídas
export const LANE_TOP = 0.135; // faixa de resina rebaixada da reta final
export const WELL_TOP = 0.13;  // poço de resina das bases
const CELL_W = 0.92;           // casa (sulco de 8 cm entre elas)
const ARM_INSET = 0.015;       // recuo da parede do rebaixo dos braços
const WELL = 5.3;              // lado do poço das bases

function roundRectShape(w, h, r, cx = 0, cy = 0, ShapeClass = THREE.Shape) {
  const s = new ShapeClass();
  const x = cx - w / 2, y = cy - h / 2;
  s.moveTo(x + r, y);
  s.lineTo(x + w - r, y);
  s.quadraticCurveTo(x + w, y, x + w, y + r);
  s.lineTo(x + w, y + h - r);
  s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  s.lineTo(x + r, y + h);
  s.quadraticCurveTo(x, y + h, x, y + h - r);
  s.lineTo(x, y + r);
  s.quadraticCurveTo(x, y, x + r, y);
  return s;
}

// Placa deitada no plano XZ, com a base em y = 0 e topo em y = h.
function plateGeometry(w, d, h, r = 0.08, bevel = 0.012) {
  const shape = roundRectShape(w - bevel * 2, d - bevel * 2, Math.max(0.02, r - bevel));
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: Math.max(0.001, h - bevel * 2),
    bevelEnabled: bevel > 0,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: 2,
    curveSegments: 5,
  });
  geo.rotateX(-Math.PI / 2);
  geo.translate(0, bevel, 0);
  geo.computeVertexNormals();
  return geo;
}

// Tampo com rebaixos: placa arredondada com furos (x/z de mundo), topo em y = h.
// O bisel cresce o contorno e encolhe os furos, então compensa nos dois.
function deckGeometry(size, r, holes, h, bevel) {
  const shape = roundRectShape(size - bevel * 2, size - bevel * 2, r - bevel);
  for (const o of holes) {
    shape.holes.push(roundRectShape(o.w + bevel * 2, o.d + bevel * 2, o.r + bevel, o.x, -o.z, THREE.Path));
  }
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: h - bevel * 2, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel,
    bevelSegments: 2, curveSegments: 6,
  });
  geo.rotateX(-Math.PI / 2);
  geo.translate(0, bevel, 0);
  geo.computeVertexNormals();
  return geo;
}

// Moldura plana (quadro arredondado vazado) de lado `w` e largura `t`.
function frameGeometry(w, r, t, h) {
  const shape = roundRectShape(w, w, r);
  shape.holes.push(roundRectShape(w - t * 2, w - t * 2, Math.max(0.02, r - t), 0, 0, THREE.Path));
  const geo = new THREE.ExtrudeGeometry(shape, { depth: h, bevelEnabled: false, curveSegments: 8 });
  geo.rotateX(-Math.PI / 2);
  return geo;
}

// ExtrudeGeometry gera UV em unidades de mundo; normaliza para 0..1 (textura da casa).
function normalizeUV(geo) {
  const uv = geo.attributes.uv;
  if (!uv) return geo;
  let minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity;
  for (let i = 0; i < uv.count; i++) {
    const u = uv.getX(i), v = uv.getY(i);
    if (u < minU) minU = u; if (u > maxU) maxU = u;
    if (v < minV) minV = v; if (v > maxV) maxV = v;
  }
  const du = maxU - minU || 1, dv = maxV - minV || 1;
  for (let i = 0; i < uv.count; i++) {
    uv.setXY(i, (uv.getX(i) - minU) / du, (uv.getY(i) - minV) / dv);
  }
  uv.needsUpdate = true;
  return geo;
}

function starShape(outer = 0.22, inner = 0.095) {
  const s = new THREE.Shape();
  for (let i = 0; i < 10; i++) {
    const a = (Math.PI / 5) * i - Math.PI / 2;
    const r = i % 2 ? inner : outer;
    const x = Math.cos(a) * r, y = Math.sin(a) * r;
    if (i === 0) s.moveTo(x, y); else s.lineTo(x, y);
  }
  s.closePath();
  return s;
}

function triangleShape(a, b, c) {
  const s = new THREE.Shape();
  s.moveTo(a[0], a[1]);
  s.lineTo(b[0], b[1]);
  s.lineTo(c[0], c[1]);
  s.closePath();
  return s;
}

export function buildBoard(E) {
  const group = new THREE.Group();
  group.name = 'board';

  // ---------------- texturas ----------------
  const woodTex = makeWoodTextures();
  // UVs de ExtrudeGeometry estão em unidades de mundo: repete a textura a cada ~3 unidades.
  for (const t of [woodTex.map, woodTex.normalMap, woodTex.roughnessMap]) {
    if (t) t.repeat.set(0.3, 0.3);
  }
  const slateTex = makeSlateTexture();
  const cellTex = makeCellTexture();
  const contactTex = makeContactShadowTexture();

  // ---------------- materiais ----------------
  const wood = new THREE.MeshStandardMaterial({
    map: woodTex.map, normalMap: woodTex.normalMap, normalScale: new THREE.Vector2(0.6, 0.6),
    roughness: 0.48, metalness: 0.03, envMapIntensity: 1.0,
  });
  // casas: madeira clara com veio e variação por instância
  const woodCell = new THREE.MeshStandardMaterial({
    map: cellTex, color: '#e9cfae', roughness: 0.52, metalness: 0.02, envMapIntensity: 0.7,
  });
  const woodDark = new THREE.MeshStandardMaterial({
    color: '#4d2f1a', roughness: 0.72, metalness: 0.02, envMapIntensity: 0.6,
  });
  const woodFrame = new THREE.MeshStandardMaterial({
    map: woodTex.map, normalMap: woodTex.normalMap, normalScale: new THREE.Vector2(0.5, 0.5),
    color: '#bd9468', roughness: 0.44, metalness: 0.04, envMapIntensity: 0.85,
  });
  const brass = new THREE.MeshStandardMaterial({
    color: '#e0bb7d', metalness: 0.95, roughness: 0.18, envMapIntensity: 1.7,
    emissive: '#2a1c08', emissiveIntensity: 0.25,
  });
  const ivory = new THREE.MeshPhysicalMaterial({
    color: '#efe3cc', roughness: 0.3, clearcoat: 0.55, clearcoatRoughness: 0.25, metalness: 0.0,
  });
  const slate = new THREE.MeshStandardMaterial({
    map: slateTex, roughness: 0.9, metalness: 0.0, color: '#b9c6da',
  });

  const resin = {};
  const resinColors = {};
  for (const [color, hex] of Object.entries(RESIN_HEX)) {
    resinColors[color] = new THREE.Color(hex);
    resin[color] = new THREE.MeshPhysicalMaterial({
      color: hex,
      roughness: 0.3,
      metalness: 0.0,
      transmission: 0.0,
      thickness: 0.6,
      ior: 1.46,
      clearcoat: 0.85,
      clearcoatRoughness: 0.14,
      attenuationColor: new THREE.Color(hex),
      attenuationDistance: 0.4,
      emissive: new THREE.Color(hex),
      emissiveIntensity: 0.03,
      envMapIntensity: 0.5,
      side: THREE.FrontSide,
    });
  }

  const allResin = Object.values(resin);
  const materials = { wood, woodDark, woodFrame, brass, ivory, slate, resin };

  // ---------------- mesa ----------------
  const table = new THREE.Mesh(new THREE.PlaneGeometry(90, 90), slate);
  table.rotation.x = -Math.PI / 2;
  table.position.y = -1.24;
  table.receiveShadow = true;
  table.name = 'table';
  group.add(table);

  // sombra de contato suave sob o tabuleiro
  const contact = new THREE.Mesh(
    new THREE.PlaneGeometry(24, 24),
    new THREE.MeshBasicMaterial({ map: contactTex, transparent: true, depthWrite: false, opacity: 0.9 })
  );
  contact.rotation.x = -Math.PI / 2;
  contact.position.y = -1.22;
  contact.renderOrder = 1;
  group.add(contact);

  // ---------------- laje + tampo entalhado ----------------
  // Tampo maciço de madeira (topo em DECK_TOP) com rebaixos: os 4 braços do
  // percurso (casas entalhadas, separadas por sulcos escuros) e as 4 bases
  // (poço de resina com filete de latão). O hub central é o próprio tampo.
  const slab = new THREE.Mesh(plateGeometry(16.9, 16.9, 1.15, 0.62, 0.035), woodFrame);
  slab.position.y = -1.15;
  slab.castShadow = true;
  slab.receiveShadow = true;
  group.add(slab);

  const armRects = [[6, 0, 3, 6], [0, 6, 6, 3], [6, 9, 3, 6], [9, 6, 6, 3]].map(([r, c, rows, cols]) => {
    const { x, z } = blockCenter(r, c, rows, cols);
    return { x, z, w: cols, d: rows };
  });
  const baseRects = E.COLORS.map((color) => {
    const [r0, c0] = BASE_ORIGIN[color];
    return { color, ...blockCenter(r0, c0, 6, 6) };
  });
  const holes = [
    ...armRects.map((a) => ({ x: a.x, z: a.z, w: a.w - ARM_INSET * 2, d: a.d - ARM_INSET * 2, r: 0.14 })),
    ...baseRects.map((b) => ({ x: b.x, z: b.z, w: WELL, d: WELL, r: 0.42 })),
  ];
  const deck = new THREE.Mesh(deckGeometry(16.9, 0.62, holes, DECK_TOP, 0.03), woodFrame);
  deck.castShadow = false; // rebaixos rasos: shadow map gera acne; o AO pré-calculado cobre
  deck.receiveShadow = true;
  deck.name = 'deck';
  group.add(deck);

  // fundo dos braços (aparece só nos sulcos entre as casas)
  for (const a of armRects) {
    const floor = new THREE.Mesh(plateGeometry(a.w, a.d, GROOVE_TOP, 0.14, 0.01), woodDark);
    floor.position.set(a.x, 0, a.z);
    floor.receiveShadow = true;
    group.add(floor);
  }

  // ---------------- casas ----------------
  const plates = new Map(); // chave "r,c" → {x,z}
  const cells = [];
  E.TRACK.forEach(([r, c], abs) => {
    const { x, z } = cellToWorld(r, c);
    plates.set(`${r},${c}`, { x, z, abs });
    cells.push({ r, c, x, z, abs });
  });
  for (const color of E.COLORS) {
    E.HOME[color].forEach(([r, c], k) => {
      const { x, z } = cellToWorld(r, c);
      plates.set(`${r},${c}`, { x, z, abs: null });
      cells.push({ r, c, x, z, abs: null, home: color, k });
    });
  }

  const dummy = new THREE.Object3D();
  const tint = new THREE.Color();
  // casas de madeira entalhadas: topo abaixo do tampo, sulcos escuros entre elas
  const woodCellGeo = normalizeUV(plateGeometry(CELL_W, CELL_W, CELL_TOP - GROOVE_TOP, 0.06, 0.008));
  const woodCells = cells.filter((c) => c.abs != null && !START_COLOR[c.abs]);
  const woodInst = new THREE.InstancedMesh(woodCellGeo, woodCell, woodCells.length);
  woodInst.castShadow = true;
  woodInst.receiveShadow = true;
  woodCells.forEach((c, i) => {
    dummy.position.set(c.x, GROOVE_TOP, c.z);
    dummy.updateMatrix();
    woodInst.setMatrixAt(i, dummy.matrix);
    const k = 0.93 + ((i * 37) % 11) / 11 * 0.09;
    tint.setRGB(k, k * 0.975, k * 0.94);
    woodInst.setColorAt(i, tint);
  });
  woodInst.instanceMatrix.needsUpdate = true;
  if (woodInst.instanceColor) woodInst.instanceColor.needsUpdate = true;
  group.add(woodInst);

  // casas de saída: resina sobre base de latão (o latão aparece como filete)
  const startCells = cells.filter((c) => c.abs != null && START_COLOR[c.abs]);
  const brassStart = new THREE.InstancedMesh(plateGeometry(0.97, 0.97, CELL_TOP - 0.01 - GROOVE_TOP, 0.08, 0.008), brass, startCells.length);
  brassStart.receiveShadow = true;
  startCells.forEach((c, i) => {
    dummy.position.set(c.x, GROOVE_TOP, c.z);
    dummy.updateMatrix();
    brassStart.setMatrixAt(i, dummy.matrix);
  });
  brassStart.instanceMatrix.needsUpdate = true;
  group.add(brassStart);
  for (const c of startCells) {
    const m = new THREE.Mesh(plateGeometry(0.88, 0.88, CELL_TOP - GROOVE_TOP, 0.07, 0.008), resin[START_COLOR[c.abs]]);
    m.position.set(c.x, GROOVE_TOP, c.z);
    m.receiveShadow = true;
    group.add(m);
  }

  // retas finais: uma faixa contínua de resina rebaixada, moldura de latão e
  // divisórias finas de latão entre as casas
  const lanes = [];
  const dividerGeo = new THREE.BoxGeometry(0.026, 0.012, 0.86);
  const dividerInst = new THREE.InstancedMesh(dividerGeo, brass, E.COLORS.length * 4);
  let di = 0;
  for (const color of E.COLORS) {
    const list = cells.filter((c) => c.home === color);
    const xs = list.map((c) => c.x), zs = list.map((c) => c.z);
    const x0 = Math.min(...xs), x1 = Math.max(...xs), z0 = Math.min(...zs), z1 = Math.max(...zs);
    const lane = { color, x: (x0 + x1) / 2, z: (z0 + z1) / 2, w: x1 - x0 + 1, d: z1 - z0 + 1 };
    lanes.push(lane);
    const frame = new THREE.Mesh(plateGeometry(lane.w - 0.03, lane.d - 0.03, LANE_TOP - 0.01 - GROOVE_TOP, 0.08, 0.008), brass);
    frame.position.set(lane.x, GROOVE_TOP, lane.z);
    frame.receiveShadow = true;
    group.add(frame);
    const strip = new THREE.Mesh(plateGeometry(lane.w - 0.12, lane.d - 0.12, LANE_TOP - GROOVE_TOP, 0.06, 0.008), resin[color]);
    strip.position.set(lane.x, GROOVE_TOP, lane.z);
    strip.receiveShadow = true;
    group.add(strip);
    const horizontal = lane.w > lane.d;
    for (let k = 0; k < list.length - 1; k++) {
      dummy.position.set((list[k].x + list[k + 1].x) / 2, LANE_TOP + 0.002, (list[k].z + list[k + 1].z) / 2);
      dummy.rotation.set(0, horizontal ? 0 : Math.PI / 2, 0);
      dummy.updateMatrix();
      dividerInst.setMatrixAt(di++, dummy.matrix);
    }
  }
  dummy.rotation.set(0, 0, 0);
  dividerInst.count = di;
  dividerInst.instanceMatrix.needsUpdate = true;
  group.add(dividerInst);

  // estrelas de latão embutidas nas casas seguras (exceto saídas)
  const starCells = [...E.SAFE].filter((abs) => !START_COLOR[abs]).map((abs) => plates.get(`${E.TRACK[abs][0]},${E.TRACK[abs][1]}`));
  const starGeo = new THREE.ExtrudeGeometry(starShape(0.3, 0.13), { depth: 0.012, bevelEnabled: true, bevelSize: 0.008, bevelThickness: 0.006, bevelSegments: 1, curveSegments: 5 });
  starGeo.rotateX(-Math.PI / 2);
  const starInst = new THREE.InstancedMesh(starGeo, brass, starCells.length);
  starInst.castShadow = false;
  starCells.forEach((c, i) => {
    dummy.position.set(c.x, CELL_TOP - 0.008, c.z);
    dummy.updateMatrix();
    starInst.setMatrixAt(i, dummy.matrix);
  });
  starInst.instanceMatrix.needsUpdate = true;
  group.add(starInst);

  // ---------------- bases ----------------
  // poço rebaixado no tampo: resina com filete de latão na borda e anéis nas cavidades
  const baseGroups = {};
  for (const { color, x, z } of baseRects) {
    const bg = new THREE.Group();
    bg.position.set(x, 0, z);

    const well = new THREE.Mesh(plateGeometry(WELL + 0.02, WELL + 0.02, WELL_TOP, 0.42, 0.012), resin[color]);
    well.receiveShadow = true;
    bg.add(well);

    const brassRim = new THREE.Mesh(frameGeometry(WELL, 0.42, 0.07, 0.012), brass);
    brassRim.position.y = WELL_TOP - 0.004;
    bg.add(brassRim);

    // anéis das 4 cavidades
    for (let i = 0; i < 4; i++) {
      const p = pointToWorld(E.pointOf, color, -1, i);
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.32, 0.032, 10, 28), brass);
      ring.rotation.x = -Math.PI / 2;
      ring.position.set(p.x - x, WELL_TOP + 0.008, p.z - z);
      ring.castShadow = true;
      bg.add(ring);
    }
    group.add(bg);
    baseGroups[color] = bg;
  }

  // ---------------- hub central ----------------
  const tri = {
    red: triangleShape([-1.44, -1.44], [-1.44, 1.44], [0, 0]),
    green: triangleShape([-1.44, -1.44], [1.44, -1.44], [0, 0]),
    yellow: triangleShape([1.44, -1.44], [1.44, 1.44], [0, 0]),
    blue: triangleShape([-1.44, 1.44], [1.44, 1.44], [0, 0]),
  };
  for (const color of E.COLORS) {
    const geo = new THREE.ShapeGeometry(tri[color]);
    geo.rotateX(-Math.PI / 2);
    const m = new THREE.Mesh(geo, resin[color]);
    m.position.y = DECK_TOP + 0.002;
    group.add(m);
  }
  // divisórias de latão nas diagonais
  for (const rot of [Math.PI / 4, -Math.PI / 4]) {
    const divider = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.022, 4.06), brass);
    divider.position.y = DECK_TOP + 0.009;
    divider.rotation.y = rot;
    group.add(divider);
  }
  const hubCap = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.18, 0.06, 20), brass);
  hubCap.position.y = DECK_TOP + 0.02;
  group.add(hubCap);
  // ---------------- AO pré-calculado ----------------
  // Celular não tem shadow map: uma textura única (gerada uma vez em canvas) escurece
  // o fundo das ranhuras junto às casas, à moldura, às bases e ao hub — oclusão
  // ambiente + uma sombra curta na direção da luz principal. As casas tampam a
  // película por cima, então só as frestas ficam escuras.
  const AO_SPAN = 15.6;
  const aoTex = (() => {
    const S = 1024, k = S / AO_SPAN, OFF = 4000;
    const c = document.createElement('canvas');
    c.width = c.height = S;
    const ctx = c.getContext('2d');
    ctx.fillStyle = 'rgba(0,0,0,.2)';
    ctx.fillRect(0, 0, S, S);
    const px = (x) => (x + AO_SPAN / 2) * k;
    // casters: [x, z, w, d, altura, raio] — o AO cobre só o fundo dos braços
    const casters = [];
    for (const cl of cells) {
      if (cl.home) continue;
      const w = START_COLOR[cl.abs] ? 0.97 : CELL_W;
      casters.push([cl.x, cl.z, w, w, CELL_TOP - GROOVE_TOP, 0.07]);
    }
    for (const ln of lanes) casters.push([ln.x, ln.z, ln.w - 0.03, ln.d - 0.03, LANE_TOP - GROOVE_TOP, 0.08]);
    // paredes do rebaixo: faixas do tampo em volta de cada braço
    const T = 2;
    for (const a of armRects) {
      const hw = a.w / 2 - ARM_INSET, hd = a.d / 2 - ARM_INSET, h = DECK_TOP - GROOVE_TOP;
      casters.push([a.x, a.z - hd - T / 2, a.w, T, h, 0], [a.x, a.z + hd + T / 2, a.w, T, h, 0],
        [a.x - hw - T / 2, a.z, T, a.d, h, 0], [a.x + hw + T / 2, a.z, T, a.d, h, 0]);
    }
    function pass(alpha, blurU, dirScale) {
      ctx.save();
      ctx.shadowColor = `rgba(0,0,0,${alpha})`;
      ctx.shadowBlur = blurU * k;
      ctx.fillStyle = '#000';
      for (const [x, z, w, d, h, r] of casters) {
        ctx.shadowOffsetX = OFF + SHADOW_DX * h * dirScale * k;
        ctx.shadowOffsetY = SHADOW_DZ * h * dirScale * k;
        ctx.beginPath();
        if (ctx.roundRect) ctx.roundRect(px(x - w / 2) - OFF, px(z - d / 2), w * k, d * k, r * k);
        else ctx.rect(px(x - w / 2) - OFF, px(z - d / 2), w * k, d * k);
        ctx.fill();
      }
      ctx.restore();
    }
    pass(0.5, 0.16, 0);   // oclusão larga
    pass(0.55, 0.05, 0);  // canto de contato
    pass(0.4, 0.07, 1);   // sombra curta direcional
    const t = new THREE.CanvasTexture(c);
    t.anisotropy = 4;
    return t;
  })();
  const aoGeo = new THREE.PlaneGeometry(AO_SPAN, AO_SPAN);
  aoGeo.rotateX(-Math.PI / 2);
  const aoMat = new THREE.MeshBasicMaterial({
    color: 0x000000, map: aoTex, transparent: true, depthWrite: false, opacity: 0.6, // sem polygonOffset: em ângulo rasante ele furava os poços
  });
  const aoFloor = new THREE.Mesh(aoGeo, aoMat);
  aoFloor.position.y = GROOVE_TOP + 0.003;
  aoFloor.renderOrder = 1;
  aoFloor.name = 'floor-ao';
  group.add(aoFloor);

  group.rotation.y = BOARD_YAW;

  // ---------------- qualidade ----------------
  // Mobile: sem transmission. A resina vira um "vidro falso" opaco — cor profunda,
  // verniz brilhante e um mapa de profundidade (centro claro, bordas escuras, nuvens
  // sutis) que imita a luz atravessando o bloco. Opaca para não lavar a cor com a
  // madeira clara de baixo (era o que deixava tudo pastel).
  const depthTex = resinDepthTexture();
  // UV 0..1 nas peças de resina (as placas saem em unidades de mundo) p/ o mapa caber.
  const resinGeos = new Set();
  group.traverse((o) => { if (o.isMesh && allResin.includes(o.material)) resinGeos.add(o.geometry); });
  resinGeos.forEach(normalizeUV);
  // Tons vivos do vidro falso (sem transmission a cor base escura fica barrenta).
  const LOW_HEX = { red: '#b8160d', green: '#0d8128', yellow: '#cf8f0a', blue: '#2140b8' };
  const desk = new Map(allResin.map((m) => [m, {
    color: m.color.clone(), emissive: m.emissive.clone(),
    roughness: m.roughness, clearcoatRoughness: m.clearcoatRoughness,
    envMapIntensity: m.envMapIntensity, emissiveIntensity: m.emissiveIntensity,
  }]));
  let low = false;
  function setLowQuality(value) {
    if (low === value) return;
    low = value;
    aoMat.opacity = value ? 1 : 0.6;
    for (const [color, m] of Object.entries(resin)) {
      m.transparent = false;
      m.opacity = 1;
      if (value) {
        m.transmission = 0;
        m.map = depthTex;
        m.color.set(LOW_HEX[color]);
        m.emissive.set(LOW_HEX[color]);
        m.roughness = 0.34;
        m.clearcoat = 0.7;
        m.clearcoatRoughness = 0.22;
        m.envMapIntensity = 0.55;
        m.emissiveIntensity = 0.06;
      } else {
        const d = desk.get(m);
        m.color.copy(d.color); m.emissive.copy(d.emissive);
        m.roughness = d.roughness; m.clearcoatRoughness = d.clearcoatRoughness;
        m.envMapIntensity = d.envMapIntensity; m.emissiveIntensity = d.emissiveIntensity;
        m.map = null;
        m.clearcoat = 0.85;
        m.transmission = 0.86;
      }
      m.needsUpdate = true;
    }
    group.traverse((o) => {
      if (o.isMesh) { o.castShadow = !value && o.castShadow; }
    });
  }

  // Troca a madeira procedural pela PBR KTX2 (chamado quando o carregamento assíncrono termina).
  let pbrTex = null;
  function applyWoodPBR(t) {
    pbrTex = t;
    for (const [m, tint, rough, ns] of [[wood, '#ffffff', 0.8, 0.8], [woodFrame, '#f3e4d2', 0.75, 0.7]]) {
      for (const k of ['map', 'normalMap', 'roughnessMap']) {
        const tex = t[k].clone(); // clone compartilha a imagem na GPU, só muda repeat
        tex.repeat.set(0.22, 0.22);
        tex.needsUpdate = true;
        m[k] = tex;
      }
      m.color.set(tint);
      m.roughness = rough;
      m.normalScale.set(ns, ns);
      m.needsUpdate = true;
    }
    for (const tex of [woodTex.map, woodTex.normalMap, woodTex.roughnessMap]) tex?.dispose?.();
  }

  return {
    group, materials, plates, setLowQuality, applyWoodPBR,
    cells, starCells, baseGroups,
    dispose() {
      group.traverse((o) => {
        if (o.isMesh) {
          o.geometry?.dispose?.();
          if (Array.isArray(o.material)) o.material.forEach((m) => m.dispose?.());
          else o.material?.dispose?.();
        }
      });
      for (const t of [woodTex.map, woodTex.normalMap, slateTex, contactTex, depthTex, aoTex]) t?.dispose?.();
      if (pbrTex) for (const t of Object.values(pbrTex)) t.dispose();
    },
  };
}
