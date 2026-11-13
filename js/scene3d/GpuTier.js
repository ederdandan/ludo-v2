// GpuTier — classifica a GPU em 4 níveis lendo o nome do renderer WebGL.
// Leve e offline (o detect-gpu baixa benchmarks do unpkg em runtime, o que
// quebra o PWA sem rede). O FPS medido no WorldManager continua como rede de
// segurança: o tier só define o ponto de partida.
//   0 = fraco/software · 1 = médio · 2 = celular forte · 3 = desktop completo
// Override para testes: ?tier=0..3 na URL.

function readRenderer() {
  try {
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl2') || c.getContext('webgl');
    if (!gl) return { name: '', webgl: false };
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const name = String(gl.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER) || '');
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return { name, webgl: true };
  } catch {
    return { name: '', webgl: false };
  }
}

function mobileTier(n) {
  if (/apple gpu|apple a1[4-9]|apple m\d/.test(n)) return 2; // iOS só diz "Apple GPU"; iPhones aguentam
  let m = n.match(/adreno[^\d]*(\d{3})/);
  if (m) {
    const v = +m[1];
    if (v >= 640) return 2;
    if (v >= 610) return 1;
    return 0;
  }
  if (/immortalis|xclipse|mali-g7[1-9]\d|mali-g6[2-9]\d|mali-g9\d\d/.test(n)) return 2; // G710+, G615+
  m = n.match(/mali-g(\d+)/);
  if (m) return +m[1] >= 57 ? 1 : 0; // G57/G68/G76/G77/G78 médio; G31/G51/G52 fraco
  if (/mali|powervr|sgx|vivante|videocore/.test(n)) return 0;
  return 1;
}

function desktopTier(n) {
  if (/intel.*(hd graphics [2-5]\d{2,3}|hd graphics$|gma)/.test(n)) return 1;
  return 3;
}

export function detectGpuTier({ mobile = false } = {}) {
  const forced = new URLSearchParams(location.search).get('tier');
  const { name, webgl } = readRenderer();
  const n = name.toLowerCase();
  let tier;
  if (forced !== null && /^[0-3]$/.test(forced)) tier = +forced;
  else if (!webgl || /swiftshader|llvmpipe|softpipe|software|basic render/.test(n)) tier = 0;
  else tier = mobile ? mobileTier(n) : desktopTier(n);
  return { tier, renderer: name };
}

// Perfil de render de cada tier.
export const TIER_PROFILE = [
  { low: true, shadows: false, antialias: false, maxPR: 1.5 },
  { low: true, shadows: false, antialias: true, maxPR: 2 },
  { low: true, shadows: true, antialias: true, maxPR: 2 }, // vidro falso + sombra real de peões/dado
  { low: false, shadows: true, antialias: true, maxPR: 2 },
];
