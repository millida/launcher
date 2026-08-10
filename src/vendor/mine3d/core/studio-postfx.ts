// Постпроцессинг: bloom + SMAA (без MSAA — с NearestFilter он даёт чёрные/белые каймы)
import {
  UnsignedByteType,
  Vector2,
  WebGLRenderTarget,
  type Camera,
  type Scene,
  type WebGLRenderer,
} from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { SMAAPass } from "three/examples/jsm/postprocessing/SMAAPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";

const BLOOM_BASE = 0.14;
const BLOOM_RADIUS = 0.45;
const BLOOM_THRESHOLD = 0.92;

/**
 * Bloom + SMAA.
 * MSAA на RT с Minecraft NearestFilter даёт выборку соседних текселей атласа
 * (тёмные/светлые полосы по рёбрам). SMAA сглаживает силуэт в экранном пространстве.
 * UnsignedByteType вместо HalfFloat — стабильнее в браузерном ANGLE/WebGL2.
 */
export class StudioPostFx {
  private readonly _composer: EffectComposer;
  private readonly _bloom: UnrealBloomPass;
  private readonly _smaa: SMAAPass;
  private readonly _size = new Vector2(1, 1);

  constructor(renderer: WebGLRenderer, scene: Scene, camera: Camera) {
    const size = renderer.getSize(new Vector2());
    const pixelRatio = renderer.getPixelRatio();

    // Без samples: MSAA ломает pixel-art скин (кайма по UV)
    const renderTarget = new WebGLRenderTarget(
      Math.max(1, Math.floor(size.width * pixelRatio)),
      Math.max(1, Math.floor(size.height * pixelRatio)),
      { type: UnsignedByteType, samples: 0 },
    );
    renderTarget.texture.name = "StudioPostFx.rt";

    this._composer = new EffectComposer(renderer, renderTarget);
    this._composer.addPass(new RenderPass(scene, camera));

    this._bloom = new UnrealBloomPass(
      new Vector2(1, 1),
      BLOOM_BASE,
      BLOOM_RADIUS,
      BLOOM_THRESHOLD,
    );
    this._composer.addPass(this._bloom);

    // three@0.156: SMAAPass(width, height); типы @types/three новее — без аргументов
    const smaaW = Math.max(1, Math.floor(size.width * pixelRatio));
    const smaaH = Math.max(1, Math.floor(size.height * pixelRatio));
    this._smaa = new (SMAAPass as unknown as new (w: number, h: number) => SMAAPass)(
      smaaW,
      smaaH,
    );
    this._composer.addPass(this._smaa);
    this._composer.addPass(new OutputPass());
  }

  setSize(width: number, height: number): void {
    this._size.set(width, height);
    this._composer.setSize(width, height);
    this._bloom.resolution.set(width, height);
  }

  setPixelRatio(ratio: number): void {
    this._composer.setPixelRatio(ratio);
  }

  /** Временный буст bloom (0…1) — вспышка смены скина */
  setBloomBoost(amount: number): void {
    const t = Math.max(0, Math.min(1, amount));
    this._bloom.strength = BLOOM_BASE + t * 0.35;
  }

  render(): void {
    this._composer.render();
  }

  dispose(): void {
    this._composer.dispose();
  }
}
