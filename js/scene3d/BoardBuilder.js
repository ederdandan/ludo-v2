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

function roundRectShape(w, h, r) {
  const s = new THREE.Shape();
  const x = -w / 2, y = -h / 2;
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

  // ---------------- laje + moldura ----------------
  const slab = new THREE.Mesh(plateGeometry(16.9, 16.9, 1.15, 0.62, 0.035), woodFrame);
  slab.position.y = -1.15;
  slab.castShadow = true;
  slab.receiveShadow = true;
  group.add(slab);

  // superfície interna (fundo das ranhuras)
  const playfield = new THREE.Mesh(plateGeometry(15.55, 15.55, 0.14, 0.18, 0.01), woodDark);
  playfield.position.y = -0.14;
  playfield.receiveShadow = true;
  group.add(playfield);

  // lábio da moldura (4 barras) + filete de latão interno
  const lipGeo = plateGeometry(16.9, 0.72, 0.16, 0.3, 0.02);
  const lipSide = plateGeometry(0.72, 16.9, 0.16, 0.3, 0.02);
  const lipY = 0.0;
  for (const [geo, x, z] of [
    [lipGeo, 0, -8.09], [lipGeo, 0, 8.09], [lipSide, -8.09, 0], [lipSide, 8.09, 0],
  ]) {
    const m = new THREE.Mesh(geo, woodFrame);
    m.position.set(x, lipY, z);
    m.castShadow = true; m.receiveShadow = true;
    group.add(m);
  }
  // filete de latão no perímetro interno do tabuleiro
  for (const [w, d, x, z] of [[15.6, 0.03, 0, -7.78], [15.6, 0.03, 0, 7.78], [0.03, 15.6, -7.78, 0], [0.03, 15.6, 7.78, 0]]) {
    const bar = new THREE.Mesh(new THREE.BoxGeometry(w, 0.014, d), brass);
    bar.position.set(x, 0.012, z);
    group.add(bar);
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

  const woodCellGeo = normalizeUV(plateGeometry(0.88, 0.88, 0.045, 0.085, 0.008));
  const woodCells = cells.filter((c) => c.abs == null || !START_COLOR[c.abs]);
  const woodInst = new THREE.InstancedMesh(woodCellGeo, woodCell, woodCells.length);
  woodInst.castShadow = true;
  woodInst.receiveShadow = true;
  const dummy = new THREE.Object3D();
  const tint = new THREE.Color();
  woodCells.forEach((c, i) => {
    dummy.position.set(c.x, 0.0, c.z);
    dummy.updateMatrix();
    woodInst.setMatrixAt(i, dummy.matrix);
    const k = 0.93 + ((i * 37) % 11) / 11 * 0.09;
    tint.setRGB(k, k * 0.975, k * 0.94);
    woodInst.setColorAt(i, tint);
  });
  woodInst.instanceMatrix.needsUpdate = true;
  if (woodInst.instanceColor) woodInst.instanceColor.needsUpdate = true;
  group.add(woodInst);

  // base de latão sob as casas de resina (faz o filete dourado)
  const resinCells = cells.filter((c) => (c.abs != null && START_COLOR[c.abs]) || c.home);
  const brassPlateGeo = plateGeometry(0.97, 0.97, 0.05, 0.1, 0.008);
  const brassInst = new THREE.InstancedMesh(brassPlateGeo, brass, resinCells.length);
  brassInst.castShadow = false;
  brassInst.receiveShadow = true;
  resinCells.forEach((c, i) => {
    dummy.position.set(c.x, 0.0, c.z);
    dummy.updateMatrix();
    brassInst.setMatrixAt(i, dummy.matrix);
  });
  brassInst.instanceMatrix.needsUpdate = true;
  group.add(brassInst);

  const resinInst = {};
  for (const color of E.COLORS) {
    const list = resinCells.filter((c) => (c.abs != null ? START_COLOR[c.abs] === color : c.home === color));
    const geo = plateGeometry(0.9, 0.9, 0.05, 0.09, 0.008);
    const inst = new THREE.InstancedMesh(geo, resin[color], list.length);
    inst.castShadow = true;
    inst.receiveShadow = true;
    list.forEach((c, i) => {
      dummy.position.set(c.x, 0.012, c.z);
      dummy.updateMatrix();
      inst.setMatrixAt(i, dummy.matrix);
    });
    inst.instanceMatrix.needsUpdate = true;
    group.add(inst);
    resinInst[color] = inst;
  }

  // estrelas de latão nas casas seguras (exceto saídas)
  const starCells = [...E.SAFE].filter((abs) => !START_COLOR[abs]).map((abs) => plates.get(`${E.TRACK[abs][0]},${E.TRACK[abs][1]}`));
  const starGeo = new THREE.ExtrudeGeometry(starShape(0.34, 0.15), { depth: 0.03, bevelEnabled: true, bevelSize: 0.01, bevelThickness: 0.008, bevelSegments: 1, curveSegments: 5 });
  starGeo.rotateX(-Math.PI / 2);
  const starInst = new THREE.InstancedMesh(starGeo, brass, starCells.length);
  starInst.castShadow = false;
  starCells.forEach((c, i) => {
    dummy.position.set(c.x, 0.05, c.z);
    dummy.rotation.set(0, 0, 0);
    dummy.updateMatrix();
    starInst.setMatrixAt(i, dummy.matrix);
  });
  starInst.instanceMatrix.needsUpdate = true;
  group.add(starInst);

  // ---------------- bases ----------------
  const baseGroups = {};
  for (const color of E.COLORS) {
    const [r0, c0] = BASE_ORIGIN[color];
    const { x, z } = blockCenter(r0, c0, 6, 6);
    const bg = new THREE.Group();
    bg.position.set(x, 0, z);

    const rim = new THREE.Mesh(plateGeometry(5.98, 5.98, 0.16, 0.34, 0.02), woodFrame);
    rim.receiveShadow = true; rim.castShadow = true;
    bg.add(rim);

    const groove = new THREE.Mesh(plateGeometry(5.66, 5.66, 0.02, 0.3, 0.006), woodDark);
    groove.position.y = 0.16;
    bg.add(groove);

    const well = new THREE.Mesh(plateGeometry(5.4, 5.4, 0.05, 0.26, 0.012), resin[color]);
    well.position.y = 0.18;
    well.receiveShadow = true;
    bg.add(well);

    const brassRim = new THREE.Mesh(plateGeometry(5.5, 5.5, 0.016, 0.27, 0.005), brass);
    brassRim.position.y = 0.184;
    bg.add(brassRim);

    // anéis das 4 cavidades
    for (let i = 0; i < 4; i++) {
      const p = pointToWorld(E.pointOf, color, -1, i);
      // p é mundial; converte para o grupo da base
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.32, 0.032, 10, 28), brass);
      ring.rotation.x = -Math.PI / 2;
      ring.position.set(p.x - x, 0.238, p.z - z);
      ring.castShadow = true;
      bg.add(ring);
    }
    group.add(bg);
    baseGroups[color] = bg;
  }

  // ---------------- hub central ----------------
  const hub = new THREE.Mesh(plateGeometry(2.98, 2.98, 0.08, 0.16, 0.012), wood);
  hub.position.y = 0.02;
  hub.receiveShadow = true;
  group.add(hub);

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
    m.position.y = 0.101;
    group.add(m);
  }
  // divisórias de latão nas diagonais
  for (const rot of [Math.PI / 4, -Math.PI / 4]) {
    const divider = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.022, 4.06), brass);
    divider.position.y = 0.108;
    divider.rotation.y = rot;
    group.add(divider);
  }
  const hubCap = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.18, 0.06, 20), brass);
  hubCap.position.y = 0.12;
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
    // casters: [x, z, w, d, altura, raio]
    const casters = [];
    for (const cl of cells) {
      const resinCell = (cl.abs != null && START_COLOR[cl.abs]) || cl.home;
      const w = resinCell ? 0.97 : 0.88;
      casters.push([cl.x, cl.z, w, w, 0.05, 0.09]);
    }
    for (const bgc of Object.values(baseGroups)) casters.push([bgc.position.x, bgc.position.z, 5.98, 5.98, 0.24, 0.34]);
    casters.push([0, 0, 2.98, 2.98, 0.1, 0.16]);
    const L = 7.73, T = 3; // moldura: retângulos além da borda interna
    casters.push([0, -L - T / 2, 20, T, 0.16, 0], [0, L + T / 2, 20, T, 0.16, 0],
      [-L - T / 2, 0, T, 20, 0.16, 0], [L + T / 2, 0, T, 20, 0.16, 0]);
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
    color: 0x000000, map: aoTex, transparent: true, depthWrite: false, opacity: 0.6,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
  });
  const aoFloor = new THREE.Mesh(aoGeo, aoMat);
  aoFloor.position.y = 0.003;
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

  return {
    group, materials, plates, setLowQuality,
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
    },
  };
}
