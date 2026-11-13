// PawnManager — peões torneados em resina, realce de jogadas válidas,
// prévia de destino, raycasting e animações (salto por casa, captura, chegada).
import * as THREE from '../../vendor/three.module.min.js';
import { RESIN_HEX } from './BoardBuilder.js';
import { SHADOW_DX, SHADOW_DZ } from './GridMapper.js';
import { makeBlobTexture } from './WoodTextures.js';

const PAWN_HEIGHT = 0.66;
// Peões maiores (leitura no celular): mais largos e bem mais altos.
const PAWN_WIDE = 1.14;
const PAWN_TALL = 1.32;
const TRACK_Y = 0.062;
const BASE_Y = 0.238;
const GOAL_Y = 0.135;

function latheProfile() {
  const p = [
    [0.001, 0.0], [0.30, 0.0], [0.315, 0.022], [0.295, 0.052],
    [0.215, 0.078], [0.155, 0.112], [0.128, 0.20], [0.152, 0.238],
    [0.10, 0.262], [0.086, 0.33], [0.138, 0.372], [0.166, 0.432],
    [0.152, 0.50], [0.112, 0.558], [0.055, 0.598], [0.001, PAWN_HEIGHT],
  ];
  return p.map(([x, y]) => new THREE.Vector2(x * 1.24 * PAWN_WIDE, y * 1.5 * PAWN_TALL));
}

export function createPawns(E) {
  const group = new THREE.Group();
  group.name = 'pawns';
  // manchas de contato (falsas sombras) separadas, para não subirem no salto
  const shadowGroup = new THREE.Group();
  group.add(shadowGroup);
  const blobGeo = new THREE.PlaneGeometry(0.98 * PAWN_WIDE, 0.98 * PAWN_WIDE);
  const blobTex = makeBlobTexture();
  let blobStrength = 0.36; // mais forte no celular (sem shadow map)

  const geo = new THREE.LatheGeometry(latheProfile(), 28);
  geo.computeVertexNormals();

  const footGeo = new THREE.CylinderGeometry(0.315 * PAWN_WIDE, 0.33 * PAWN_WIDE, 0.03, 26);
  const footMat = new THREE.MeshStandardMaterial({ color: '#d4af6a', metalness: 0.9, roughness: 0.3 });

  const PAWN_HEX = { red: '#c62222', green: '#2b9440', yellow: '#dfa428', blue: '#3a56c8' };
  const mat = {};
  const highMat = {};
  for (const color of E.COLORS) {
    const hex = new THREE.Color(PAWN_HEX[color] || RESIN_HEX[color]);
    mat[color] = new THREE.MeshPhysicalMaterial({
      color: hex, roughness: 0.08, metalness: 0.0,
      transmission: 0.1, thickness: 0.5, ior: 1.46,
      clearcoat: 1.0, clearcoatRoughness: 0.03,
      attenuationColor: hex, attenuationDistance: 0.5,
      emissive: hex, emissiveIntensity: 0.17,
      envMapIntensity: 1.8,
    });
    highMat[color] = new THREE.MeshPhysicalMaterial({
      color: hex.clone().offsetHSL(0, 0.05, 0.08), roughness: 0.06, metalness: 0.0,
      transmission: 0.1, thickness: 0.45, ior: 1.46, clearcoat: 1,
      emissive: hex, emissiveIntensity: 0.2, envMapIntensity: 1.6,
    });
  }

  const ringGeo = new THREE.RingGeometry(0.34 * PAWN_WIDE, 0.47 * PAWN_WIDE, 36);
  ringGeo.rotateX(-Math.PI / 2);

  const pawns = new Map(); // "color-i"
  const byColor = new Map();
  const tweens = [];
  let pickableColor = null;
  let pickableSet = new Set();
  let hoverKey = null;
  let clock = 0;

  function makePawn(color, i) {
    const root = new THREE.Group();
    root.name = `pawn-${color}-${i}`;

    const body = new THREE.Mesh(geo, mat[color]);
    body.castShadow = true;
    body.receiveShadow = true;
    body.userData = { color, piece: i };
    root.add(body);

    const foot = new THREE.Mesh(footGeo, footMat);
    foot.position.y = 0.016;
    foot.userData = { color, piece: i };
    root.add(foot);

    const ring = new THREE.Mesh(
      ringGeo,
      new THREE.MeshBasicMaterial({ color: RESIN_HEX[color], transparent: true, opacity: 0.0, depthWrite: false })
    );
    ring.position.y = 0.012;
    ring.renderOrder = 3;
    root.add(ring);

    group.add(root);

    const blob = new THREE.Mesh(
      blobGeo,
      new THREE.MeshBasicMaterial({ color: 0x000000, map: blobTex, transparent: true, opacity: 0.26, depthWrite: false })
    );
    blob.rotation.x = -Math.PI / 2;
    blob.renderOrder = 2;
    shadowGroup.add(blob);

    const rec = { root, body, foot, ring, blob, color, piece: i, y: BASE_Y, tween: null, phase: Math.random() * 6.28 };
    pawns.set(`${color}-${i}`, rec);
    return rec;
  }

  for (const color of E.COLORS) {
    const list = [];
    for (let i = 0; i < 4; i++) list.push(makePawn(color, i));
    byColor.set(color, list);
  }

  // ---------- posições ----------
  const spreadOffsets = {
    1: [[0, 0]],
    2: [[-0.19, 0], [0.19, 0]],
    3: [[-0.2, -0.12], [0.2, -0.12], [0, 0.2]],
    4: [[-0.19, -0.19], [0.19, -0.19], [-0.19, 0.19], [0.19, 0.19]],
  };

  function worldFor(color, rel, idx) {
    const [r, c] = E.pointOf(color, rel, idx);
    let x = c - 7.5, z = r - 7.5;
    let y = TRACK_Y;
    if (rel < 0) y = BASE_Y;
    else if (rel === E.GOAL) {
      y = GOAL_Y;
      const a = (idx / 4) * Math.PI * 2;
      x += Math.cos(a) * 0.62;
      z += Math.sin(a) * 0.62;
    }
    return { x, y, z };
  }

  // Posições visíveis no momento (respeitando override de animação).
  function visibleRel(state, color, i, override) {
    const ov = override && override[color];
    return ov && ov[i] != null ? ov[i] : state.pieces[color][i];
  }

  function computeLayout(state, override) {
    const groups = new Map();
    const list = [];
    for (const seat of state.seats) {
      for (let i = 0; i < 4; i++) {
        const rel = visibleRel(state, seat.color, i, override);
        const w = worldFor(seat.color, rel, i);
        const key = rel < 0 ? `base:${seat.color}:${i}` : `${w.x.toFixed(2)},${w.z.toFixed(2)}`;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push({ color: seat.color, i, rel, w, key });
        list.push({ color: seat.color, i, rel });
      }
    }
    const result = [];
    for (const items of groups.values()) {
      const n = Math.min(items.length, 4);
      const offs = spreadOffsets[n] || [[0, 0]];
      const scale = items.length > 1 ? 0.72 : 1;
      items.forEach((it, k) => {
        const [dx, dz] = offs[k] || [0, 0];
        result.push({ ...it, x: it.w.x + dx, y: it.w.y, z: it.w.z + dz, scale });
      });
    }
    return { result, activeColors: new Set(state.seats.map((s) => s.color)) };
  }

  // ---------- tweens ----------
  function tweenTo(rec, to, { dur = 160, hop = 0, scale = 1 } = {}) {
    return new Promise((resolve) => {
      const from = { x: rec.root.position.x, y: rec.root.position.y, z: rec.root.position.z, s: rec.root.scale.x };
      const t = { rec, from, to, dur, hop, scale, t: 0, resolve };
      if (rec.tween) { rec.tween.resolve(); tweens.splice(tweens.indexOf(rec.tween), 1); }
      rec.tween = t;
      tweens.push(t);
      if (dur <= 0) { applyTween(t, 1); finish(t); return; }
      // rede de segurança: rAF suspenso (aba oculta) não pode travar o jogo
      setTimeout(() => {
        if (rec.tween !== t) return;
        applyTween(t, 1);
        const ix = tweens.indexOf(t);
        if (ix >= 0) tweens.splice(ix, 1);
        finish(t);
      }, dur + 260);
    });
  }

  function applyTween(t, k) {
    const e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
    const { from, to } = t;
    t.rec.root.position.x = from.x + (to.x - from.x) * e;
    t.rec.root.position.z = from.z + (to.z - from.z) * e;
    t.rec.root.position.y = from.y + (to.y - from.y) * e + Math.sin(Math.PI * k) * t.hop;
    const s = from.s + (t.scale - from.s) * e;
    t.rec.root.scale.setScalar(s);
  }

  function finish(t) {
    t.rec.tween = null;
    t.resolve();
  }

  function update(dt) {
    clock += dt;
    for (let i = tweens.length - 1; i >= 0; i--) {
      const t = tweens[i];
      t.t += dt * 1000 / t.dur;
      if (t.t >= 1) {
        applyTween(t, 1);
        tweens.splice(i, 1);
        finish(t);
      } else {
        applyTween(t, t.t);
      }
    }
    // anéis, oscilação dos jogáveis e sombra de contato
    for (const rec of pawns.values()) {
      const isPick = pickableColor === rec.color && pickableSet.has(rec.piece);
      const target = isPick ? 0.75 : 0;
      const m = rec.ring.material;
      m.opacity += (target - m.opacity) * Math.min(1, dt * 10);
      if (isPick && !rec.tween) {
        rec.root.position.y = (rec.baseY != null ? rec.baseY : TRACK_Y) + 0.05 + Math.sin(clock * 4 + rec.phase) * 0.02;
      }
      rec.ring.visible = m.opacity > 0.02;

      const ground = rec.baseY != null ? rec.baseY : TRACK_Y;
      const air = Math.max(0, rec.root.position.y - ground);
      rec.blob.visible = rec.root.visible;
      // desloca na direção da luz (sobe → a sombra se afasta e esmaece)
      const sh = 0.16 + air;
      rec.blob.position.set(rec.root.position.x + SHADOW_DX * sh, ground + 0.006, rec.root.position.z + SHADOW_DZ * sh);
      rec.blob.material.opacity = blobStrength * Math.max(0.15, 1 - air * 1.4);
      rec.blob.scale.setScalar(1 + Math.min(0.3, air * 0.5));
    }
  }

  // ---------- API ----------
  function sync(state, override, returning = new Set(), opts = {}) {
    const { result, activeColors } = computeLayout(state, override);
    for (const [color, list] of byColor) {
      const active = activeColors.has(color);
      for (const rec of list) {
        rec.root.visible = active;
      }
    }
    for (const it of result) {
      const rec = pawns.get(`${it.color}-${it.i}`);
      if (!rec) continue;
      rec.baseY = it.y;
      if (rec.tween) continue; // animação em curso tem prioridade
      rec.root.scale.setScalar(it.scale);
      const moving = Math.hypot(rec.root.position.x - it.x, rec.root.position.z - it.z) > 0.001;
      if (opts.instant || !moving) {
        rec.root.position.set(it.x, it.y, it.z);
      } else {
        tweenTo(rec, { x: it.x, y: it.y, z: it.z }, { dur: 140, scale: it.scale });
      }
    }
    if (opts.pickableColor !== undefined) setPickable(opts.pickableColor, opts.validMoves || []);
  }

  function setPickable(color, validMoves) {
    pickableColor = color;
    pickableSet = new Set(validMoves || []);
  }

  function clearPickable() {
    pickableColor = null;
    pickableSet = new Set();
  }

  function posFor(color, rel, idx) {
    return worldFor(color, rel, idx);
  }

  async function animateMove(event, stepMs = 160) {
    const rec = pawns.get(`${event.color}-${event.piece}`);
    if (!rec) return;
    const path = event.path && event.path.length ? event.path : [event.to];
    for (const rel of path) {
      const w = worldFor(event.color, rel, event.piece);
      await tweenTo(rec, w, { dur: stepMs, hop: 0.26, scale: 1 });
      rec.baseY = w.y;
    }
  }

  async function animateCapture(event) {
    const moves = [];
    event.victims.forEach((v, k) => {
      const rec = pawns.get(`${v.color}-${v.piece}`);
      if (!rec) return;
      const w = worldFor(v.color, -1, v.piece);
      moves.push(tweenTo(rec, w, { dur: 520, hop: 1.15 }).then(() => { rec.baseY = BASE_Y; }));
    });
    await Promise.all(moves);
  }

  function animateHome(event) {
    const rec = pawns.get(`${event.color}-${event.piece}`);
    if (!rec) return Promise.resolve();
    const w = worldFor(event.color, E.GOAL, event.piece);
    return tweenTo(rec, w, { dur: 260, hop: 0.45 });
  }

  function animateReturn(penalty) {
    const rec = pawns.get(`${penalty.color}-${penalty.piece}`);
    if (!rec) return Promise.resolve();
    const w = worldFor(penalty.color, -1, penalty.piece);
    return tweenTo(rec, w, { dur: 480, hop: 0.9 });
  }

  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  function pick(clientX, clientY, camera, dom) {
    const rect = dom.getBoundingClientRect();
    pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointer, camera);
    const targets = [];
    for (const rec of pawns.values()) if (rec.root.visible) targets.push(rec.body, rec.foot);
    const hits = raycaster.intersectObjects(targets, false);
    if (!hits.length) return null;
    return hits[0].object.userData;
  }

  // Mobile: sem transmission. Vidro falso — opaco, saturado, verniz espelhado e
  // emissivo mais alto para parecer iluminado por dentro.
  function setLowQuality(low, shadows = !low) {
    // Sem shadow map a bolha faz todo o contato; com ele, só complementa.
    blobStrength = shadows ? 0.36 : 0.62;
    for (const color of E.COLORS) {
      for (const m of [mat[color], highMat[color]]) {
        m.transparent = false; m.opacity = 1;
        m.transmission = low ? 0 : (m === mat[color] ? 0.55 : 0.1);
        m.emissiveIntensity = low ? (m === mat[color] ? 0.3 : 0.38) : (m === mat[color] ? 0.17 : 0.2);
        m.envMapIntensity = low ? 1.4 : (m === mat[color] ? 1.8 : 1.6);
        m.needsUpdate = true;
      }
    }
  }

  return {
    group, pawns, update, sync, setPickable, clearPickable, posFor,
    animateMove, animateCapture, animateHome, animateReturn, pick, setLowQuality,
    setStep: () => {},
    get hoverKey() { return hoverKey; },
    set hoverKey(v) { hoverKey = v; },
  };
}
