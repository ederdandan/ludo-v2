// Dice3D — dado de marfim com pips rebaixados, tumbling e clique/toque.
import * as THREE from '../../vendor/three.module.min.js';
import { makeBlobTexture } from './WoodTextures.js';

const SIZE = 0.72;
const HALF = SIZE / 2;
const PIP_R = 0.044;
const PIP_STEP = 0.17;

// Geometria de cubo arredondado (projeção de SDF) — sem dependências de examples.
function roundedBoxGeometry(size, radius, seg = 6) {
  const geo = new THREE.BoxGeometry(size, size, size, seg, seg, seg);
  const pos = geo.attributes.position;
  const inner = size / 2 - radius;
  const v = new THREE.Vector3();
  const q = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    q.set(
      Math.max(-inner, Math.min(inner, v.x)),
      Math.max(-inner, Math.min(inner, v.y)),
      Math.max(-inner, Math.min(inner, v.z))
    );
    const n = v.clone().sub(q);
    const len = n.length();
    if (len > 1e-5) {
      n.multiplyScalar(radius / len);
      v.copy(q).add(n);
    } else {
      v.copy(q).addScaledVector(v.clone().normalize(), radius);
    }
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  geo.computeVertexNormals();
  return geo;
}

// coordenadas 2D no plano da face (-1..1)
const PIPS = {
  1: [[0, 0]],
  2: [[-1, -1], [1, 1]],
  3: [[-1, -1], [0, 0], [1, 1]],
  4: [[-1, -1], [1, -1], [-1, 1], [1, 1]],
  5: [[-1, -1], [1, -1], [0, 0], [-1, 1], [1, 1]],
  6: [[-1, -1], [-1, 0], [-1, 1], [1, -1], [1, 0], [1, 1]],
};

const FACES = {
  1: { normal: [0, 1, 0], up: [0, 0, -1] },
  6: { normal: [0, -1, 0], up: [0, 0, 1] },
  2: { normal: [1, 0, 0], up: [0, 0, -1] },
  5: { normal: [-1, 0, 0], up: [0, 0, -1] },
  3: { normal: [0, 0, 1], up: [0, 0, 1] },
  4: { normal: [0, 0, -1], up: [0, 0, 1] },
};

function quatFor(value) {
  const { normal } = FACES[value];
  const from = new THREE.Vector3(...normal);
  const to = new THREE.Vector3(0, 1, 0);
  return new THREE.Quaternion().setFromUnitVectors(from, to);
}

export function createDice() {
  const group = new THREE.Group();
  group.name = 'dice';

  const bodyMat = new THREE.MeshPhysicalMaterial({
    color: '#e9dcc4', roughness: 0.33, metalness: 0.0,
    clearcoat: 0.5, clearcoatRoughness: 0.28, envMapIntensity: 1.0,
    emissive: '#2a1d10', emissiveIntensity: 0.12,
  });
  const pipMat = new THREE.MeshStandardMaterial({ color: '#191512', roughness: 0.72, metalness: 0.05 });

  const body = new THREE.Mesh(roundedBoxGeometry(SIZE, 0.075, 7), bodyMat);
  body.castShadow = true;
  body.receiveShadow = true;
  group.add(body);

  const pipGeo = new THREE.CylinderGeometry(PIP_R, PIP_R, 0.02, 16);
  for (const [value, list] of Object.entries(PIPS)) {
    const { normal, up } = FACES[Number(value)];
    const n = new THREE.Vector3(...normal);
    const u = new THREE.Vector3(...up);
    const v = new THREE.Vector3().crossVectors(n, u).normalize();
    const center = n.clone().multiplyScalar(HALF - 0.006);
    for (const [a, b] of list) {
      const pip = new THREE.Mesh(pipGeo, pipMat);
      pip.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), n);
      pip.position.copy(center)
        .addScaledVector(u, b * PIP_STEP)
        .addScaledVector(v, a * PIP_STEP);
      group.add(pip);
    }
  }

  // sombra de contato suave
  const blob = new THREE.Mesh(
    new THREE.PlaneGeometry(HALF * 3.4, HALF * 3.4),
    new THREE.MeshBasicMaterial({ color: 0x000000, map: makeBlobTexture(), transparent: true, opacity: 0.3, depthWrite: false })
  );
  blob.rotation.x = -Math.PI / 2;
  blob.position.y = -HALF + 0.004;
  blob.renderOrder = 2;
  group.add(blob);

  group.position.set(0, 0.13 + HALF, 0.02);

  let spin = null;
  let current = 1;

  function setImmediate(value) {
    current = value;
    group.quaternion.copy(quatFor(value));
    spin = null;
  }

  function roll(value, { dur = 720, reduced = false } = {}) {
    const startQ = group.quaternion.clone();
    const targetQ = quatFor(value);
    const total = reduced ? 260 : dur;
    const axis = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize();
    return new Promise((resolve) => {
      spin = {
        startQ, targetQ, t: 0, total,
        spinQ: new THREE.Quaternion().setFromAxisAngle(axis, Math.PI * (reduced ? 1 : 3)),
        startY: group.position.y,
        resolve,
      };
      current = value;
      // rede de segurança: se o rAF for suspenso (aba oculta), conclui mesmo assim
      setTimeout(() => {
        if (!spin) return;
        group.quaternion.copy(targetQ);
        group.position.y = spin.startY;
        const done = spin.resolve;
        spin = null;
        done();
      }, total + 220);
    });
  }

  function update(dt) {
    if (!spin) return;
    spin.t += dt * 1000;
    const k = Math.min(1, spin.t / spin.total);
    if (k < 0.62) {
      const e = k / 0.62;
      const spinAngle = Math.PI * 2 * (1.6 + 1.4 * e);
      const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0.35, 0.2).normalize(), spinAngle * e);
      group.quaternion.copy(spin.startQ).multiply(q);
      group.position.y = spin.startY + Math.sin(Math.PI * e) * 0.12;
    } else {
      const e = (k - 0.62) / 0.38;
      const eased = 1 - Math.pow(1 - e, 3);
      group.quaternion.copy(spin.startQ).slerp(spin.targetQ, eased);
      const bounce = Math.sin(Math.PI * Math.min(1, e * 1.15)) * 0.16 * (1 - e);
      group.position.y = spin.startY + bounce;
      if (k >= 1) {
        group.quaternion.copy(spin.targetQ);
        group.position.y = spin.startY;
        const done = spin.resolve;
        spin = null;
        done();
      }
    }
  }

  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  function pick(clientX, clientY, camera, dom) {
    const rect = dom.getBoundingClientRect();
    pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointer, camera);
    const hits = raycaster.intersectObject(body, false);
    return hits.length > 0;
  }

  function setLowQuality(low, shadows = !low) {
    bodyMat.clearcoat = low ? 0.1 : 0.5;
    bodyMat.needsUpdate = true;
    blob.material.opacity = shadows ? 0.3 : 0.55;
  }

  return { group, roll, setImmediate, update, pick, setLowQuality, get value() { return current; } };
}
