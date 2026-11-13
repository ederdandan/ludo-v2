// PostFX — pós-processamento pesado, só para desktop (tier 3).
// Cena em HDR linear (RT half-float com MSAA + depth) → bloom em cadeia de mips
// (prefiltro com joelho suave, downsample 13 taps, upsample tenda aditivo) →
// composição com profundidade de campo de diorama (disco 16 taps ponderado pela
// CoC de cada amostra), vinheta, tone mapping ACES + sRGB e dither.
// Sem addons do three: tudo em ShaderMaterial num triângulo de tela cheia.
import * as THREE from '../../vendor/three.module.min.js';

const LEVELS = 5;

const VS = /* glsl */`
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

const PREFILTER = /* glsl */`
uniform sampler2D tSrc; uniform vec2 texel; uniform float threshold, knee;
varying vec2 vUv;
void main() {
  vec3 c = texture2D(tSrc, vUv + texel * vec2(-0.5, -0.5)).rgb
         + texture2D(tSrc, vUv + texel * vec2( 0.5, -0.5)).rgb
         + texture2D(tSrc, vUv + texel * vec2(-0.5,  0.5)).rgb
         + texture2D(tSrc, vUv + texel * vec2( 0.5,  0.5)).rgb;
  c *= 0.25;
  float br = max(c.r, max(c.g, c.b));
  float soft = clamp(br - threshold + knee, 0.0, 2.0 * knee);
  soft = soft * soft / (4.0 * knee + 1e-4);
  float w = max(soft, br - threshold) / max(br, 1e-4);
  gl_FragColor = vec4(min(c * w, vec3(32.0)), 1.0);
}`;

const DOWN = /* glsl */`
uniform sampler2D tSrc; uniform vec2 texel;
varying vec2 vUv;
vec3 s(vec2 o) { return texture2D(tSrc, vUv + texel * o).rgb; }
void main() {
  vec3 c = s(vec2(0.0)) * 0.125;
  c += (s(vec2(-1.0, -1.0)) + s(vec2(1.0, -1.0)) + s(vec2(-1.0, 1.0)) + s(vec2(1.0, 1.0))) * 0.125;
  c += (s(vec2(-2.0, -2.0)) + s(vec2(2.0, -2.0)) + s(vec2(-2.0, 2.0)) + s(vec2(2.0, 2.0))) * 0.03125;
  c += (s(vec2(0.0, -2.0)) + s(vec2(0.0, 2.0)) + s(vec2(-2.0, 0.0)) + s(vec2(2.0, 0.0))) * 0.0625;
  gl_FragColor = vec4(c, 1.0);
}`;

const UP = /* glsl */`
uniform sampler2D tSrc; uniform vec2 texel;
varying vec2 vUv;
vec3 s(vec2 o) { return texture2D(tSrc, vUv + texel * o).rgb; }
void main() {
  vec3 c = s(vec2(0.0)) * 4.0;
  c += (s(vec2(-1.0, 0.0)) + s(vec2(1.0, 0.0)) + s(vec2(0.0, -1.0)) + s(vec2(0.0, 1.0))) * 2.0;
  c += s(vec2(-1.0, -1.0)) + s(vec2(1.0, -1.0)) + s(vec2(-1.0, 1.0)) + s(vec2(1.0, 1.0));
  gl_FragColor = vec4(c / 16.0, 1.0);
}`;

const COMPOSITE = /* glsl */`
#include <packing>
uniform sampler2D tScene, tDepth, tBloom;
uniform vec2 texel;
uniform float cNear, cFar, focus, range, maxR, bloomStrength, vignette;
varying vec2 vUv;
float coc(vec2 uv) {
  float d = -perspectiveDepthToViewZ(texture2D(tDepth, uv).x, cNear, cFar);
  return smoothstep(range, range * 3.0, abs(d - focus));
}
float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
void main() {
  vec3 col = texture2D(tScene, vUv).rgb;
  float c0 = coc(vUv);
  if (c0 > 0.01) {
    vec3 acc = col; float wsum = 1.0;
    for (int i = 0; i < 16; i++) {
      float fi = float(i);
      vec2 o = vec2(cos(fi * 2.39996), sin(fi * 2.39996)) * sqrt((fi + 0.5) / 16.0);
      vec2 uv = vUv + o * c0 * maxR * texel;
      float w = coc(uv); // amostra nítida (em foco) não vaza sobre o desfoque
      acc += texture2D(tScene, uv).rgb * w; wsum += w;
    }
    col = acc / wsum;
  }
  col += texture2D(tBloom, vUv).rgb * bloomStrength;
  vec2 q = vUv - 0.5;
  col *= 1.0 - vignette * smoothstep(0.12, 0.7, dot(q, q) * 2.0);
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  gl_FragColor.rgb += (hash(gl_FragCoord.xy) - 0.5) / 255.0;
}`;

export function createPostFX(renderer, { bloomStrength = 0.32, threshold = 1.0, knee = 0.5, vignette = 0.38, maxBlur = 7 } = {}) {
  if (!renderer.capabilities.isWebGL2 || !renderer.extensions.has('EXT_color_buffer_float')) return null;

  const rtOpts = { type: THREE.HalfFloatType, depthBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter };
  const sceneRT = new THREE.WebGLRenderTarget(1, 1, {
    type: THREE.HalfFloatType, samples: 4, depthBuffer: true,
    depthTexture: new THREE.DepthTexture(1, 1, THREE.UnsignedIntType),
  });
  const levels = Array.from({ length: LEVELS }, () => new THREE.WebGLRenderTarget(1, 1, rtOpts));

  const quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2));
  quad.frustumCulled = false;
  const mat = (fs, uniforms, extra = {}) => new THREE.ShaderMaterial({
    vertexShader: VS, fragmentShader: fs, uniforms, depthTest: false, depthWrite: false, ...extra,
  });
  const prefilter = mat(PREFILTER, { tSrc: { value: null }, texel: { value: new THREE.Vector2() }, threshold: { value: threshold }, knee: { value: knee } });
  const down = mat(DOWN, { tSrc: { value: null }, texel: { value: new THREE.Vector2() } });
  const up = mat(UP, { tSrc: { value: null }, texel: { value: new THREE.Vector2() } }, { blending: THREE.AdditiveBlending, transparent: true });
  const composite = mat(COMPOSITE, {
    tScene: { value: sceneRT.texture }, tDepth: { value: sceneRT.depthTexture }, tBloom: { value: levels[0].texture },
    texel: { value: new THREE.Vector2() }, cNear: { value: 0.1 }, cFar: { value: 200 },
    focus: { value: 30 }, range: { value: 4 }, maxR: { value: maxBlur },
    bloomStrength: { value: bloomStrength }, vignette: { value: vignette },
  });
  for (const m of [prefilter, down, up]) m.toneMapped = false;

  function pass(material, target) {
    quad.material = material;
    renderer.setRenderTarget(target);
    renderer.render(quad, quadCam);
  }

  const size = new THREE.Vector2();
  const post = {
    enabled: true,
    // focus = distância da câmera ao centro do tabuleiro; range = meia faixa nítida
    setFocus(distance, range) {
      composite.uniforms.focus.value = distance;
      composite.uniforms.range.value = range;
    },
    setSize() {
      renderer.getDrawingBufferSize(size);
      const w = Math.max(1, size.x), h = Math.max(1, size.y);
      sceneRT.setSize(w, h);
      composite.uniforms.texel.value.set(1 / w, 1 / h);
      let lw = w, lh = h;
      for (const rt of levels) {
        lw = Math.max(1, lw >> 1); lh = Math.max(1, lh >> 1);
        rt.setSize(lw, lh);
      }
    },
    render(scene, camera) {
      const u = composite.uniforms;
      u.cNear.value = camera.near;
      u.cFar.value = camera.far;
      const autoClear = renderer.autoClear;

      renderer.setRenderTarget(sceneRT);
      renderer.render(scene, camera);

      prefilter.uniforms.tSrc.value = sceneRT.texture;
      prefilter.uniforms.texel.value.set(1 / sceneRT.width, 1 / sceneRT.height);
      pass(prefilter, levels[0]);
      for (let i = 1; i < LEVELS; i++) {
        down.uniforms.tSrc.value = levels[i - 1].texture;
        down.uniforms.texel.value.set(1 / levels[i - 1].width, 1 / levels[i - 1].height);
        pass(down, levels[i]);
      }
      renderer.autoClear = false;
      for (let i = LEVELS - 2; i >= 0; i--) {
        up.uniforms.tSrc.value = levels[i + 1].texture;
        up.uniforms.texel.value.set(1 / levels[i + 1].width, 1 / levels[i + 1].height);
        pass(up, levels[i]);
      }
      renderer.autoClear = autoClear;

      pass(composite, null);
    },
    dispose() {
      sceneRT.depthTexture.dispose();
      sceneRT.dispose();
      levels.forEach((rt) => rt.dispose());
      [prefilter, down, up, composite].forEach((m) => m.dispose());
      quad.geometry.dispose();
    },
  };
  return post;
}
