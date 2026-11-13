// PbrTextures — madeira PBR real (Poly Haven "oak_veneer_01", CC0) em KTX2/Basis.
// KTX2 fica comprimido na GPU (ETC1S/UASTC → ASTC/ETC2/BC conforme o aparelho):
// ~4–8x menos VRAM que JPG/canvas e sem travada de decodificação no celular.
// Carrega depois da primeira cena; se falhar (sem WASM, offline sem cache, arquivo
// ausente) o tabuleiro continua com as texturas procedurais — nada quebra.
import * as THREE from '../../vendor/three.module.min.js';
import { KTX2Loader } from '../../vendor/ktx2/KTX2Loader.js';

const BASE = new URL('../../assets/textures/', import.meta.url).href;
const TRANSCODER = new URL('../../vendor/ktx2/basis/', import.meta.url).href;

export const WOOD_PBR_FILES = ['oak_albedo.ktx2', 'oak_normal.ktx2', 'oak_rough.ktx2'];

export async function loadWoodPBR(renderer) {
  if (typeof WebAssembly !== 'object') return null;
  const loader = new KTX2Loader().setTranscoderPath(TRANSCODER).setWorkerLimit(2);
  try {
    loader.detectSupport(renderer); // (detectSupportAsync é só para WebGPU)
    const [map, normalMap, roughnessMap] = await Promise.all(
      WOOD_PBR_FILES.map((f) => loader.loadAsync(BASE + f))
    );
    map.colorSpace = THREE.SRGBColorSpace;
    normalMap.colorSpace = roughnessMap.colorSpace = THREE.NoColorSpace;
    const aniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    for (const t of [map, normalMap, roughnessMap]) {
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.anisotropy = aniso;
      t.needsUpdate = true;
    }
    return { map, normalMap, roughnessMap };
  } catch (err) {
    console.warn('[PBR] madeira KTX2 indisponível, mantendo procedural:', err?.message || err);
    return null;
  } finally {
    loader.dispose(); // encerra os workers; as texturas já estão na GPU/CPU
  }
}
