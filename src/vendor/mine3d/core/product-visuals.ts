// Продуктовый визуал сцены — свет, пол, тени и безопасная настройка материалов skin3d
import type { SkinObject } from "skin3d";
import {
  NeutralToneMapping,
  AmbientLight,
  Box3,
  CanvasTexture,
  CircleGeometry,
  Color,
  DirectionalLight,
  DoubleSide,
  FrontSide,
  HemisphereLight,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PCFSoftShadowMap,
  PMREMGenerator,
  PlaneGeometry,
  Scene,
  ShadowMaterial,
  SRGBColorSpace,
  Vector3,
} from "three";
import type { Object3D, Texture, WebGLRenderer } from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import type { LightSettings } from "../types";

/** Уровень пола — нижняя точка ног skin3d PlayerObject */
export const FLOOR_Y = -16;

const DEG2RAD = Math.PI / 180;
const RAD2DEG = 180 / Math.PI;

/** Дефолтные значения key-света (сверху-слева — заметные self-shadows на торсе/руках) */
export const DEFAULT_KEY_AZIMUTH_DEG = 58;
export const DEFAULT_KEY_ELEVATION_DEG = 40;
export const DEFAULT_KEY_DISTANCE = 55;

/** Исходный снимок освещения после первого апгрейда графики */
export const DEFAULT_LIGHT_SETTINGS: LightSettings = {
  keyAzimuthDeg: DEFAULT_KEY_AZIMUTH_DEG,
  keyElevationDeg: DEFAULT_KEY_ELEVATION_DEG,
  keyIntensity: 1.75,
  ambientIntensity: 0.28,
  fillIntensity: 0.32,
  shadowRadius: 5.5,
  shadowIntensity: 0.82,
  castShadows: true,
};

/** Пластик inner: усиленный envMap, albedo сохраняем */
const SKIN_ROUGHNESS_INNER = 0.32;
const SKIN_METALNESS_INNER = 0.08;
const SKIN_ENV_MAP_INTENSITY_INNER = 1.05;

/** Outer: только PBR-блик — cutout/DoubleSide/polygonOffset не трогаем */
const SKIN_ROUGHNESS_OUTER = 0.34;
const SKIN_METALNESS_OUTER = 0.06;
const SKIN_ENV_MAP_INTENSITY_OUTER = 0.9;
/** IBL-сцена — дополняет envMap на материалах */
const SCENE_ENV_INTENSITY = 0.62;

/** Настройка shadow map + tone mapping */
export function configureProductRenderer(renderer: WebGLRenderer): void {
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = PCFSoftShadowMap;
  renderer.toneMapping = NeutralToneMapping;
  renderer.toneMappingExposure = 1;
  renderer.outputColorSpace = SRGBColorSpace;
}

/** RoomEnvironment + PMREM — компактная IBL для пластикового блика */
export function createPlasticEnvironment(renderer: WebGLRenderer): Texture {
  const pmrem = new PMREMGenerator(renderer);
  pmrem.compileEquirectangularShader();
  const texture = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  pmrem.dispose();
  return texture;
}

/** Frustum/bias key-света под персонажа (~32 units tall) */
export const DEFAULT_SHADOW_MAP_SIZE = 2048;

function configureKeyLightShadow(
  key: DirectionalLight,
  shadowRadius: number,
  shadowIntensity: number,
  shadowMapSize: number = DEFAULT_SHADOW_MAP_SIZE,
): void {
  key.shadow.mapSize.set(shadowMapSize, shadowMapSize);
  key.shadow.camera.near = 0.5;
  key.shadow.camera.far = 120;
  // Frustum под skin3d в px (~32 units): ноги FLOOR_Y (−16) … макушка (~+16), руки ±~10
  key.shadow.camera.left = -28;
  key.shadow.camera.right = 28;
  key.shadow.camera.top = 28;
  key.shadow.camera.bottom = -28;
  // Малый normalBias — contact/self-shadows на блоках 4–12 units
  key.shadow.bias = -0.0002;
  key.shadow.normalBias = 0.0004;
  key.shadow.radius = shadowRadius;
  key.shadow.intensity = shadowIntensity;
  key.shadow.camera.updateProjectionMatrix();
}

function applyInnerMaterialTuning(mat: MeshStandardMaterial, envMap?: Texture | null): void {
  mat.color.set(0xffffff);
  mat.roughness = SKIN_ROUGHNESS_INNER;
  mat.metalness = SKIN_METALNESS_INNER;
  if (envMap) {
    mat.envMap = envMap;
    mat.envMapIntensity = SKIN_ENV_MAP_INTENSITY_INNER;
  }
}

/** Только roughness/metalness/envMap — stock cutout outer не ломаем */
function applyOuterMaterialTuning(mat: MeshStandardMaterial, envMap?: Texture | null): void {
  mat.roughness = SKIN_ROUGHNESS_OUTER;
  mat.metalness = SKIN_METALNESS_OUTER;
  if (envMap) {
    mat.envMap = envMap;
    mat.envMapIntensity = SKIN_ENV_MAP_INTENSITY_OUTER;
  }
  // alphaToCoverage даёт «призрачные» боксы outer-слоя — не включаем
  mat.alphaToCoverage = false;
}

/**
 * Безопасная настройка MeshStandardMaterial skin3d in-place.
 * Материалы на мешах не заменяются — skin.map setter продолжает работать.
 */
export function tuneSkinMaterials(
  skin: SkinObject,
  envMap?: Texture | null,
  skinMap?: Texture | null,
): void {
  const tuned = new Set<MeshStandardMaterial>();

  skin.traverse((obj) => {
    if (!(obj instanceof Mesh)) return;
    // outer3d — отдельный клон с polygonOffset; не перетирать как inner
    if (obj.name === "outer3d" || obj.name === "outer3dGroup") return;
    const isOuter = obj.name === "outer";
    const materials = Array.isArray(obj.material) ? obj.material : [obj.material];

    for (const entry of materials) {
      if (!(entry instanceof MeshStandardMaterial)) continue;
      if (tuned.has(entry)) continue;
      tuned.add(entry);

      try {
        if (skinMap) {
          entry.map = skinMap;
        }
        if (isOuter) {
          applyOuterMaterialTuning(entry, envMap);
        } else {
          applyInnerMaterialTuning(entry, envMap);
        }
        entry.alphaToCoverage = false;
        entry.needsUpdate = true;
      } catch (err) {
        console.warn("[skinviewengine] tuneSkinMaterials: пропуск материала", err);
      }
    }
  });
}

/**
 * Убирает polygonOffset со всех материалов скина.
 *
 * skin3d вешает polygonOffset (factor/units = 1) только на руки и ноги
 * (layer1MaterialBiased/layer2MaterialBiased), а на голову и торс — нет.
 * Overlay-боксы соседних частей пересекаются, и их передние грани строго
 * копланарны (например, рукав и куртка — обе на z = ±2.25). Разный bias у
 * копланарных граней делает результат depth-теста нестабильным от пикселя к
 * пикселю — отсюда тонкие линии в 1 px по рёбрам на стыках рука–торс и
 * бедро–торс.
 *
 * Единый bias (его отсутствие) делает исход детерминированным: при равной
 * глубине побеждает то, что нарисовано раньше, а порядок задаёт renderOrder.
 * Геометрия, UV и текстуры не меняются.
 */
export function normalizeSkinDepthBias(root: Object3D): void {
  root.traverse((obj) => {
    if (!(obj instanceof Mesh)) return;
    // outer3d специально держит отрицательный polygonOffset против z-fighting с inner
    if (obj.name === "outer3d") return;

    const materials = Array.isArray(obj.material) ? obj.material : [obj.material];
    for (const entry of materials) {
      if (!(entry instanceof MeshStandardMaterial)) continue;
      if (!entry.polygonOffset && entry.polygonOffsetFactor === 0) continue;

      entry.polygonOffset = false;
      entry.polygonOffsetFactor = 0;
      entry.polygonOffsetUnits = 0;
      entry.needsUpdate = true;
    }
  });
}

/** castShadow/receiveShadow и shadowSide для inner/outer skin3d */
export function enableShadows(root: Object3D): void {
  root.traverse((obj) => {
    if (!(obj instanceof Mesh)) return;

    const layer = obj.name;
    if (layer !== "inner" && layer !== "outer") return;

    obj.castShadow = true;
    obj.receiveShadow = true;

    const materials = Array.isArray(obj.material) ? obj.material : [obj.material];
    for (const entry of materials) {
      if (!(entry instanceof MeshStandardMaterial)) continue;

      if (layer === "inner") {
        // Opaque inner — основной приёмник self-shadows (виден через cutout outer)
        entry.shadowSide = FrontSide;
      } else {
        // Cutout outer (transparent+alphaTest): DoubleSide для cast/receive на overlay
        entry.shadowSide = DoubleSide;
        // depthWrite=true (дефолт при alphaTest) — корректная запись в shadow map
        entry.depthWrite = true;
      }
      entry.needsUpdate = true;
    }
  });
}

/** Однократная диагностика: bbox персонажа vs frustum shadow camera key-света */
export function logShadowDiagnostics(root: Object3D, key: DirectionalLight): void {
  const box = new Box3().setFromObject(root);
  if (box.isEmpty()) {
    console.warn("[skinviewengine] shadow diagnostics: пустой bbox игрока");
    return;
  }

  const cam = key.shadow.camera;
  const frustum = {
    left: cam.left,
    right: cam.right,
    bottom: cam.bottom,
    top: cam.top,
    near: cam.near,
    far: cam.far,
  };

  const size = new Vector3();
  box.getSize(size);
  const center = new Vector3();
  box.getCenter(center);

  const inFrustum =
    box.min.x >= frustum.left &&
    box.max.x <= frustum.right &&
    box.min.y >= frustum.bottom &&
    box.max.y <= frustum.top;

  console.info("[skinviewengine] shadow diagnostics", {
    playerBBox: {
      min: { x: box.min.x, y: box.min.y, z: box.min.z },
      max: { x: box.max.x, y: box.max.y, z: box.max.z },
      size: { x: size.x, y: size.y, z: size.z },
      center: { x: center.x, y: center.y, z: center.z },
    },
    shadowFrustum: frustum,
    playerInsideFrustum: inFrustum,
    keyLight: {
      position: { x: key.position.x, y: key.position.y, z: key.position.z },
      castShadow: key.castShadow,
      shadowIntensity: key.shadow.intensity,
      shadowRadius: key.shadow.radius,
      mapSize: [key.shadow.mapSize.x, key.shadow.mapSize.y],
    },
  });

  if (!inFrustum) {
    console.warn(
      "[skinviewengine] bbox игрока выходит за shadow frustum — self-shadows могут обрезаться",
    );
  }
}

/**
 * Обёртка над источниками света сцены — публичные сеттеры для демо и интеграций.
 */
export class ProductLighting {
  readonly ambient: AmbientLight;
  readonly hemi: HemisphereLight;
  readonly key: DirectionalLight;
  readonly fill: DirectionalLight;
  /** Контровой свет — читаемый силуэт */
  readonly rim: DirectionalLight;

  private keyDistance: number;

  constructor(scene: Scene) {
    this.ambient = new AmbientLight(0xf0f2f8, DEFAULT_LIGHT_SETTINGS.ambientIntensity);
    scene.add(this.ambient);

    this.hemi = new HemisphereLight(0xe8eef8, 0x2a2a30, 0.42);
    scene.add(this.hemi);

    this.key = new DirectionalLight(0xfff6ec, DEFAULT_LIGHT_SETTINGS.keyIntensity);
    this.keyDistance = DEFAULT_KEY_DISTANCE;
    this.applyKeySpherical(
      DEFAULT_LIGHT_SETTINGS.keyAzimuthDeg,
      DEFAULT_LIGHT_SETTINGS.keyElevationDeg,
      this.keyDistance,
    );
    configureKeyLightShadow(
      this.key,
      DEFAULT_LIGHT_SETTINGS.shadowRadius,
      DEFAULT_LIGHT_SETTINGS.shadowIntensity,
    );
    this.key.castShadow = DEFAULT_LIGHT_SETTINGS.castShadows;
    this.key.target.position.set(0, 0, 0);
    scene.add(this.key);
    scene.add(this.key.target);

    this.fill = new DirectionalLight(0xc8d4f0, DEFAULT_LIGHT_SETTINGS.fillIntensity);
    this.fill.position.set(14, 10, -12);
    scene.add(this.fill);

    this.rim = new DirectionalLight(0xb8c8ff, 0.55);
    this.rim.position.set(-20, 12, -24);
    scene.add(this.rim);
  }

  setShadowMapSize(size: number): void {
    if (this.key.shadow.mapSize.x === size) return;
    this.key.shadow.mapSize.set(size, size);
    this.key.shadow.map?.dispose();
    this.key.shadow.map = null;
  }

  /** Текущие настройки освещения */
  getSettings(): LightSettings {
    const { azimuthDeg, elevationDeg } = this.getKeyAzimuthElevation();
    return {
      keyAzimuthDeg: azimuthDeg,
      keyElevationDeg: elevationDeg,
      keyIntensity: this.key.intensity,
      ambientIntensity: this.ambient.intensity,
      fillIntensity: this.fill.intensity,
      shadowRadius: this.key.shadow.radius ?? DEFAULT_LIGHT_SETTINGS.shadowRadius,
      shadowIntensity: this.key.shadow.intensity ?? DEFAULT_LIGHT_SETTINGS.shadowIntensity,
      castShadows: this.key.castShadow,
    };
  }

  /** Частичное применение настроек */
  applySettings(partial: Partial<LightSettings>): void {
    if (partial.keyAzimuthDeg !== undefined || partial.keyElevationDeg !== undefined) {
      const current = this.getKeyAzimuthElevation();
      this.setKeyLightAzimuthElevation(
        partial.keyAzimuthDeg ?? current.azimuthDeg,
        partial.keyElevationDeg ?? current.elevationDeg,
      );
    }
    if (partial.keyIntensity !== undefined) {
      this.setKeyLightIntensity(partial.keyIntensity);
    }
    if (partial.ambientIntensity !== undefined) {
      this.setAmbientIntensity(partial.ambientIntensity);
    }
    if (partial.fillIntensity !== undefined) {
      this.setFillIntensity(partial.fillIntensity);
    }
    if (partial.shadowRadius !== undefined) {
      this.setShadowRadius(partial.shadowRadius);
    }
    if (partial.shadowIntensity !== undefined) {
      this.setShadowIntensity(partial.shadowIntensity);
    }
    if (partial.castShadows !== undefined) {
      this.setCastShadows(partial.castShadows);
    }
  }

  /** Сброс освещения к дефолтам продукта */
  resetToDefaults(): void {
    this.applySettings(DEFAULT_LIGHT_SETTINGS);
  }

  /** Позиция key-света в декартовых координатах */
  setKeyLightPosition(x: number, y: number, z: number): void {
    this.key.position.set(x, y, z);
    this.keyDistance = this.key.position.length();
  }

  /** Key-свет через азимут/высоту (градусы) и опциональную дистанцию */
  setKeyLightAzimuthElevation(
    azimuthDeg: number,
    elevationDeg: number,
    distance = this.keyDistance,
  ): void {
    this.keyDistance = distance;
    this.applyKeySpherical(azimuthDeg, elevationDeg, distance);
  }

  /** Текущий азимут/высота key-света */
  getKeyAzimuthElevation(): { azimuthDeg: number; elevationDeg: number; distance: number } {
    const { x, y, z } = this.key.position;
    const distance = Math.sqrt(x * x + y * y + z * z) || this.keyDistance;
    const elevationDeg = Math.asin(Math.max(-1, Math.min(1, y / distance))) * RAD2DEG;
    const azimuthDeg = Math.atan2(x, z) * RAD2DEG;
    return { azimuthDeg, elevationDeg, distance };
  }

  setKeyLightIntensity(intensity: number): void {
    this.key.intensity = intensity;
  }

  setAmbientIntensity(intensity: number): void {
    this.ambient.intensity = intensity;
  }

  setFillIntensity(intensity: number): void {
    this.fill.intensity = intensity;
  }

  setShadowRadius(radius: number): void {
    this.key.shadow.radius = radius;
  }

  setShadowIntensity(intensity: number): void {
    this.key.shadow.intensity = intensity;
  }

  setCastShadows(enabled: boolean): void {
    this.key.castShadow = enabled;
    if (enabled) {
      configureKeyLightShadow(
        this.key,
        this.key.shadow.radius ?? DEFAULT_LIGHT_SETTINGS.shadowRadius,
        this.key.shadow.intensity ?? DEFAULT_LIGHT_SETTINGS.shadowIntensity,
      );
    }
  }

  private applyKeySpherical(azimuthDeg: number, elevationDeg: number, distance: number): void {
    const azRad = azimuthDeg * DEG2RAD;
    const elRad = elevationDeg * DEG2RAD;
    const y = distance * Math.sin(elRad);
    const horizontal = distance * Math.cos(elRad);
    const x = horizontal * Math.sin(azRad);
    const z = horizontal * Math.cos(azRad);
    this.key.position.set(x, y, z);
  }
}

/** Освещение сцены — key, fill, hemisphere, ambient */
export function setupProductLighting(scene: Scene): ProductLighting {
  return new ProductLighting(scene);
}

/** Диск-пол + shadow catcher + мягкая контактная тень под ногами */
export function createFloorAndContactShadow(scene: Scene): {
  floor: Mesh;
  contactShadow: Mesh;
  ground: Mesh;
} {
  const ground = new Mesh(
    new CircleGeometry(48, 64),
    new MeshStandardMaterial({
      color: 0x121214,
      roughness: 0.88,
      metalness: 0.12,
      envMapIntensity: 0.35,
    }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = FLOOR_Y - 0.04;
  ground.receiveShadow = true;
  scene.add(ground);

  const floor = new Mesh(
    new PlaneGeometry(200, 200),
    new ShadowMaterial({ opacity: 0.24, color: 0x000000 }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = FLOOR_Y;
  floor.receiveShadow = true;
  scene.add(floor);

  const contactShadow = createContactShadowBlob();
  scene.add(contactShadow);

  return { floor, contactShadow, ground };
}

/** Радиальный декаль-тень под ступнями (мягче, чем shadow map) */
function createContactShadowBlob(): Mesh {
  const size = 256;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("Canvas 2D недоступен для контактной тени");
  }

  const center = size / 2;
  const gradient = ctx.createRadialGradient(center, center, 0, center, center, center);
  gradient.addColorStop(0, "rgba(0, 0, 0, 0.22)");
  gradient.addColorStop(0.25, "rgba(0, 0, 0, 0.12)");
  gradient.addColorStop(0.55, "rgba(0, 0, 0, 0.04)");
  gradient.addColorStop(0.82, "rgba(0, 0, 0, 0.01)");
  gradient.addColorStop(1, "rgba(0, 0, 0, 0)");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);

  const texture = new CanvasTexture(canvas);
  const material = new MeshBasicMaterial({
    map: texture,
    transparent: true,
    depthWrite: false,
  });

  const mesh = new Mesh(new PlaneGeometry(58, 36), material);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.set(0, FLOOR_Y + 0.05, 0.5);
  mesh.renderOrder = 1;
  return mesh;
}

/** Сплошной фон #222 как на референсе */
export function createProductBackground(): Color {
  return new Color(0x222222);
}

/** IBL-сцена и envMap для материалов скина */
export function setupSceneEnvironment(scene: Scene, renderer: WebGLRenderer): Texture {
  const envMap = createPlasticEnvironment(renderer);
  scene.environment = envMap;
  scene.environmentIntensity = SCENE_ENV_INTENSITY;
  return envMap;
}
