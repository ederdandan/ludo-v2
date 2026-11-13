// WorldManager — renderer, câmera, luzes, ambiente PMREM, loop e fachada (View)
// usada pelo controlador (js/main.js). Substitui a camada 2D de tabuleiro.
import * as THREE from '../../vendor/three.module.min.js';
import { buildBoard, RESIN_HEX } from './BoardBuilder.js';
import { createPawns } from './PawnManager.js';
import { createDice } from './Dice3D.js';
import { BOARD_HALF_DIAGONAL, BOARD_YAW } from './GridMapper.js';
import { LudoEngine } from '../game-engine.js';
import { detectGpuTier, TIER_PROFILE } from './GpuTier.js';

const FOV = 32;
const ELEV = THREE.MathUtils.degToRad(55);
const PORTRAIT_ELEV = THREE.MathUtils.degToRad(58);
const BOARD_RADIUS = BOARD_HALF_DIAGONAL + 2.0; // inclui a moldura
const SLAB_HALF = 8.45; // meia largura da laje (16.9 / 2)
const SLAB_DEPTH = 1.15;
const LOW_FPS = 30;
const TARGET_FPS = 45;
const MIN_PR = 1;

function buildStudioEnvironment(renderer) {
  const pmrem = new THREE.PMREMGenerator(renderer);
  pmrem.compileEquirectangularShader();
  const env = new THREE.Scene();
  const box = new THREE.BoxGeometry(30, 16, 30);
  const mats = [
    new THREE.MeshBasicMaterial({ color: new THREE.Color(0.16, 0.22, 0.34) }), // +x
    new THREE.MeshBasicMaterial({ color: new THREE.Color(0.07, 0.09, 0.13) }), // -x
    new THREE.MeshBasicMaterial({ color: new THREE.Color(1.35, 1.2, 0.98) }),  // +y (softbox quente)
    new THREE.MeshBasicMaterial({ color: new THREE.Color(0.04, 0.04, 0.05) }), // -y
    new THREE.MeshBasicMaterial({ color: new THREE.Color(0.38, 0.44, 0.55) }), // +z
    new THREE.MeshBasicMaterial({ color: new THREE.Color(0.09, 0.11, 0.16) }), // -z
  ];
  for (const m of mats) m.side = THREE.BackSide;
  const room = new THREE.Mesh(box, mats);
  env.add(room);

  // painel quente lateral + painel frio oposto (dão "vida" ao latão)
  const panel = (w, h, pos, color, intensity) => {
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(w, h),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(...color).multiplyScalar(intensity) })
    );
    m.position.set(...pos);
    m.lookAt(0, 0, 0);
    env.add(m);
  };
  panel(8, 6, [-9, 5, 6], [1.0, 0.85, 0.6], 2.2);
  panel(6, 4, [8, 6, -4], [0.55, 0.75, 1.0], 1.3);

  const tex = pmrem.fromScene(env, 0.04).texture;
  pmrem.dispose();
  env.traverse((o) => {
    if (!o.isMesh) return;
    o.geometry?.dispose?.();
    if (Array.isArray(o.material)) o.material.forEach((m) => m.dispose?.());
    else o.material?.dispose?.();
  });
  return tex;
}

export function createView({ canvas, onPick, onDieClick, reducedMotion = false, mobile = false }) {
  // Tier da GPU define o ponto de partida; o FPS medido no loop só desce a partir dele.
  const gpu = detectGpuTier({ mobile });
  const profile = TIER_PROFILE[gpu.tier];
  const renderer = new THREE.WebGLRenderer({
    // MSAA também no celular (tier >= 1): sem ele as bordas ficam serrilhadas.
    canvas, antialias: profile.antialias, alpha: false, powerPreference: 'high-performance',
  });
  // Resolução adaptativa: começa nítida (até o teto do tier) e só reduz se o FPS não sustentar.
  let pixelRatio = Math.min(window.devicePixelRatio || 1, profile.maxPR);
  renderer.setPixelRatio(pixelRatio);
  renderer.shadowMap.enabled = profile.shadows;
  // Celular forte: PCF simples (o soft custa ~4x mais amostras).
  renderer.shadowMap.type = profile.low ? THREE.PCFShadowMap : THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.94;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#161b24');

  const camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 200);
  const camTarget = new THREE.Vector3(0, -0.75, 0);

  // ---- ambiente e luzes ----
  scene.environment = buildStudioEnvironment(renderer);
  if ('environmentIntensity' in scene) scene.environmentIntensity = 0.85;

  const hemi = new THREE.HemisphereLight('#fff6e6', '#101724', 0.34);
  scene.add(hemi);

  const key = new THREE.DirectionalLight('#fff2d2', 2.85);
  key.position.set(8, 14, 7);
  key.castShadow = profile.shadows;
  const shadowRes = profile.low ? 1024 : 2048;
  key.shadow.mapSize.set(shadowRes, shadowRes);
  key.shadow.camera.left = -13;
  key.shadow.camera.right = 13;
  key.shadow.camera.top = 13;
  key.shadow.camera.bottom = -13;
  key.shadow.camera.near = 2;
  key.shadow.camera.far = 55;
  key.shadow.bias = -0.0004;
  key.shadow.normalBias = 0.02;
  scene.add(key);

  const fill = new THREE.PointLight('#bcd9ff', 42, 40, 2);
  fill.position.set(-11, 9, -8);
  scene.add(fill);

  const rim = new THREE.DirectionalLight('#ffd9a8', 0.85);
  rim.position.set(-6, 6, 14);
  scene.add(rim);

  // luz frontal fria: dá contorno e brilho aos peões de resina
  const front = new THREE.DirectionalLight('#dce9ff', 1.05);
  front.position.set(-3, 5, 14);
  scene.add(front);

  // luz prática sobre o tabuleiro: suaviza a sombra dentro das bases
  const top = new THREE.DirectionalLight('#fff4e0', 0.6);
  top.position.set(0, 10, 1);
  scene.add(top);

  // ---- tabuleiro, peões, dado ----
  const board = buildBoard(LudoEngine);
  scene.add(board.group);

  const pawns = createPawns(LudoEngine);
  board.group.add(pawns.group);

  const dice = createDice();
  board.group.add(dice.group);

  // anel de prévia (destino de uma jogada)
  const previewGroup = new THREE.Group();
  const previewRing = new THREE.Mesh(
    new THREE.RingGeometry(0.3, 0.42, 36),
    new THREE.MeshBasicMaterial({ color: '#ffe9a8', transparent: true, opacity: 0.85, depthWrite: false })
  );
  previewRing.rotation.x = -Math.PI / 2;
  const previewDisc = new THREE.Mesh(
    new THREE.CircleGeometry(0.28, 30),
    new THREE.MeshBasicMaterial({ color: '#ffe9a8', transparent: true, opacity: 0.22, depthWrite: false })
  );
  previewDisc.rotation.x = -Math.PI / 2;
  previewGroup.add(previewRing, previewDisc);
  previewGroup.visible = false;
  previewGroup.position.y = 0.09;
  board.group.add(previewGroup);

  const state = {
    pickableColor: null,
    valid: new Set(),
    dist: 40,
    az: 0,
    el: 0,
    baseElev: ELEV,
    targetAz: 0,
    targetEl: 0,
    last: performance.now(),
    running: true,
    low: false,
    shadows: true,
  };

  // low = vidro falso sem transmission; shadows = shadow map real (peões/dado no tier 2).
  function applyQuality(low, shadows = !low) {
    if (state.low === low && state.shadows === shadows) return;
    state.low = low;
    state.shadows = shadows;
    renderer.shadowMap.enabled = shadows;
    key.castShadow = shadows;
    board.setLowQuality(low);
    pawns.setLowQuality(low, shadows);
    dice.setLowQuality(low, shadows);
    scene.traverse((o) => { if (o.isMesh && o.material) o.material.needsUpdate = true; });
  }

  applyQuality(profile.low, profile.shadows);

  // Faixa vertical livre entre o HUD de cima (topo, cards superiores) e o de baixo
  // (cards inferiores, dock). Só usada no retrato, onde o HUD empilha acima/abaixo.
  function safeBand(h) {
    let top = 0, bottom = h;
    const game = document.getElementById('screen-game');
    if (game && !game.hidden) {
      for (const el of game.querySelectorAll('.hud-top, #players > *, .dock')) {
        const r = el.getBoundingClientRect();
        if (!r.height) continue;
        if ((r.top + r.bottom) / 2 < h / 2) top = Math.max(top, r.bottom);
        else bottom = Math.min(bottom, r.top);
      }
    }
    if (bottom - top < h * 0.35) return { top: 0, bottom: h };
    return { top, bottom };
  }

  const _v = new THREE.Vector3();
  function projectedBox(w, h) {
    updateCamera();
    camera.updateMatrixWorld();
    board.group.updateMatrixWorld(true);
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const x of [-SLAB_HALF, SLAB_HALF]) for (const z of [-SLAB_HALF, SLAB_HALF]) for (const y of [0.1, -SLAB_DEPTH]) {
      board.group.localToWorld(_v.set(x, y, z)).project(camera);
      const px = (_v.x + 1) / 2 * w, py = (1 - _v.y) / 2 * h;
      minX = Math.min(minX, px); maxX = Math.max(maxX, px);
      minY = Math.min(minY, py); maxY = Math.max(maxY, py);
    }
    return { minX, maxX, minY, maxY };
  }

  function fit() {
    const w = canvas.clientWidth || window.innerWidth;
    const h = canvas.clientHeight || window.innerHeight;
    const aspect = w / h;
    const portrait = aspect < 1;
    camera.aspect = aspect;
    camera.clearViewOffset();
    const vFov = THREE.MathUtils.degToRad(FOV);
    const hFov = 2 * Math.atan(Math.tan(vFov / 2) * aspect);

    if (!portrait) {
      board.group.rotation.y = BOARD_YAW;
      state.baseElev = ELEV;
      const halfH = BOARD_RADIUS * Math.sin(state.baseElev);
      const distV = halfH / Math.tan(vFov / 2);
      const distH = BOARD_RADIUS / Math.tan(hFov / 2);
      state.dist = Math.max(distV, distH) * 1.18;
      camera.updateProjectionMatrix();
      updateCamera();
      return;
    }

    // Retrato: tabuleiro alinhado à tela (sem giro de 45°) ocupa ~41% mais largura,
    // e a câmera é ajustada por projeção real para preencher a faixa livre entre os HUDs.
    board.group.rotation.y = 0;
    state.baseElev = PORTRAIT_ELEV;
    camera.updateProjectionMatrix();
    const band = safeBand(h);
    const availW = w * 0.96;
    const availH = (band.bottom - band.top) * 0.96;
    state.dist = SLAB_HALF / Math.tan(hFov / 2) * 1.2;
    for (let i = 0; i < 4; i++) {
      const b = projectedBox(w, h);
      const s = Math.max((b.maxX - b.minX) / availW, (b.maxY - b.minY) / availH);
      state.dist *= s;
    }
    const b = projectedBox(w, h);
    const shiftY = (band.top + band.bottom) / 2 - (b.minY + b.maxY) / 2;
    if (Math.abs(shiftY) > 0.5) {
      camera.setViewOffset(w, h, 0, -shiftY, w, h);
    }
    camera.updateProjectionMatrix();
    updateCamera();
  }

  // O HUD (cards dos jogadores) é montado depois do resize; refaz o enquadramento
  // quando a faixa livre muda.
  let bandSig = '';
  function checkBand() {
    const h = canvas.clientHeight || window.innerHeight;
    const w = canvas.clientWidth || window.innerWidth;
    if (w >= h) return;
    const b = safeBand(h);
    const sig = `${w}x${h}:${Math.round(b.top)}-${Math.round(b.bottom)}`;
    if (sig !== bandSig) { bandSig = sig; fit(); }
  }

  function updateCamera() {
    const az = state.az;
    const el = state.baseElev + state.el;
    const r = state.dist;
    camera.position.set(
      camTarget.x + Math.cos(el) * Math.sin(az) * r,
      camTarget.y + Math.sin(el) * r,
      camTarget.z + Math.cos(el) * Math.cos(az) * r
    );
    camera.lookAt(camTarget);
  }

  function resize() {
    const w = canvas.clientWidth || window.innerWidth;
    const h = canvas.clientHeight || window.innerHeight;
    renderer.setSize(w, h, false);
    fit();
  }

  // ---- interação ----
  let downAt = null;
  function onDown(e) {
    downAt = { x: e.clientX, y: e.clientY, t: performance.now() };
  }
  function onUp(e) {
    if (!downAt) return;
    const moved = Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y);
    const dt = performance.now() - downAt.t;
    downAt = null;
    if (moved > 14 || dt > 900) return; // arrasto/long-press: não seleciona
    const hit = pawns.pick(e.clientX, e.clientY, camera, canvas);
    if (hit && state.pickableColor === hit.color && state.valid.has(hit.piece)) {
      onPick && onPick(hit.color, hit.piece);
      return;
    }
    if (dice.pick(e.clientX, e.clientY, camera, canvas)) {
      onDieClick && onDieClick();
    }
  }

  function onMove(e) {
    if (reducedMotion) return;
    const nx = (e.clientX / window.innerWidth) * 2 - 1;
    const ny = (e.clientY / window.innerHeight) * 2 - 1;
    state.targetAz = -nx * THREE.MathUtils.degToRad(2.5);
    state.targetEl = ny * THREE.MathUtils.degToRad(1.4);
  }

  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointerup', onUp);
  window.addEventListener('pointermove', onMove, { passive: true });

  // ---- loop ----
  let frames = 0;
  let fpsTime = -1.5; // aquecimento: ignora compilação de shaders/carregamento
  let measured = false;
  let bandTime = 0;
  function loop(now) {
    if (!state.running) return;
    requestAnimationFrame(loop);
    const dt = Math.min(0.05, (now - state.last) / 1000 || 0.016);
    state.last = now;

    if (!reducedMotion) {
      state.az += (state.targetAz - state.az) * Math.min(1, dt * 4);
      state.el += (state.targetEl - state.el) * Math.min(1, dt * 4);
      updateCamera();
    }

    pawns.update(dt);
    dice.update(dt);
    renderer.render(scene, camera);

    bandTime += dt;
    if (bandTime >= 0.4) { bandTime = 0; checkBand(); }

    // Escalonamento só para baixo: reduz a resolução em degraus de 0.25 até o FPS
    // sustentar; no piso (1x), cai para a qualidade baixa (sem sombras/transmissão).
    if (!measured) {
      fpsTime += dt;
      if (fpsTime > 0) frames++;
      if (fpsTime >= 2) {
        const fps = frames / fpsTime;
        frames = 0;
        fpsTime = 0;
        if (fps < TARGET_FPS && pixelRatio > MIN_PR) {
          pixelRatio = Math.max(MIN_PR, pixelRatio - 0.25);
          renderer.setPixelRatio(pixelRatio);
        } else if (fps < LOW_FPS && (!state.low || state.shadows)) {
          applyQuality(true, false);
          measured = true;
        } else {
          measured = true;
        }
      }
    }
  }

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      state.running = false;
    } else if (!state.running) {
      state.running = true;
      state.last = performance.now();
      requestAnimationFrame(loop);
    }
  });

  window.addEventListener('resize', resize);

  // ---- fachada usada pelo controlador ----
  const view = {
    scene, camera, renderer, board, pawns, dice,
    resize,
    gpu,
    setQuality: applyQuality,

    setDie(v) { dice.setImmediate(v || 1); },
    roll(v) { return dice.roll(v, { reduced: reducedMotion }); },

    reset(gameState) {
      pawns.sync(gameState, {}, new Set(), { instant: true, pickableColor: null, validMoves: [] });
      view.clearPreview();
    },

    sync(gameState, override = {}, returning = new Set(), opts = {}) {
      pawns.sync(gameState, override, returning, opts);
      if (opts.pickableColor !== undefined) {
        state.pickableColor = opts.pickableColor;
        state.valid = new Set(opts.validMoves || []);
        pawns.setPickable(opts.pickableColor, opts.validMoves || []);
      }
    },

    setPickable(color, validMoves) {
      state.pickableColor = color;
      state.valid = new Set(validMoves || []);
      pawns.setPickable(color, validMoves || []);
    },

    clearPreview() {
      previewGroup.visible = false;
    },

    preview(color, rel, piece) {
      if (rel == null) return view.clearPreview();
      const p = pawns.posFor(color, rel, piece);
      previewGroup.position.set(p.x, 0.085, p.z);
      const hex = RESIN_HEX[color] || '#ffe9a8';
      previewRing.material.color.set(hex);
      previewDisc.material.color.set(hex);
      previewGroup.visible = true;
    },

    animateMove(e) { return pawns.animateMove(e, reducedMotion ? 40 : 160); },
    animateCapture(e) { return pawns.animateCapture(e); },
    animateHome(e) { return pawns.animateHome(e); },
    animateReturn(p) { return pawns.animateReturn(p); },

    tick(dt) { pawns.update(dt); dice.update(dt); },
  };

  resize();
  requestAnimationFrame(loop);
  window.__ludoView = view;
  return view;
}
