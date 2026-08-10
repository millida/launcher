// Общие типы публичного API Mine3D Embedded
import type { SkinAnimation } from "./core/skin-animations";

/** Тип модели персонажа Minecraft */
export enum SkinModelType {
  Classic = "classic",
  Slim = "slim",
}

/** Источник текстуры скина */
export type SkinSource = string | HTMLImageElement | ImageBitmap | HTMLCanvasElement;

/** Режим показа: полный рост или погрудный кадр */
export type PresentationMode = "full" | "bust";

export interface EngineOptions {
  modelType?: SkinModelType;
  /** Автоопределение slim при загрузке скина (skinview-utils) */
  autoDetectModel?: boolean;
  autoResize?: boolean;
  /** Масштаб камеры, как в skin3d */
  zoom?: number;
  /** Угол обзора камеры */
  fov?: number;
  /**
   * Idle-анимация. true — HeroIdle по умолчанию, false — без анимации,
   * экземпляр SkinAnimation — конкретная анимация.
   */
  idleAnimation?: boolean | SkinAnimation;
  /** Прозрачный фон канваса (без пола и контактной тени) */
  transparent?: boolean;
  /** full — весь персонаж; bust — по грудь, ноги скрыты */
  presentation?: PresentationMode;
  /** OrbitControls (по умолчанию true); для мини-превью лучше false */
  enableControls?: boolean;
  /**
   * antialias канваса (по умолчанию true). На основном вьювере сглаживание
   * силуэта делает SMAA в StudioPostFx — MSAA с NearestFilter даёт кайму по UV.
   */
  antialias?: boolean;
  /** UV-inset inner-слоя в texels (0 = stock UV skin3d, pixel-perfect); по умолчанию 0 */
  uvInsetTexels?: number;
  /** UV-inset outer/overlay-слоя в texels (0 = выкл.) */
  outerUvInsetTexels?: number;
  /** Лог диагностики shadow frustum (только для отладки) */
  debugShadows?: boolean;
  preserveDrawingBuffer?: boolean;
  /**
   * Частицы и эффект «переоделся».
   * false — для мини-превью карточек (по умолчанию true).
   */
  enableEffects?: boolean;
}

/** Снимок настроек камеры для UI и сериализации */
export interface CameraSettings {
  fov: number;
  zoom: number;
  lookTargetY: number;
  distance: number;
  autoRotate: boolean;
  minPolarAngleDeg: number;
  maxPolarAngleDeg: number;
}

/** Снимок настроек освещения для UI и сериализации */
export interface LightSettings {
  keyAzimuthDeg: number;
  keyElevationDeg: number;
  keyIntensity: number;
  ambientIntensity: number;
  fillIntensity: number;
  shadowRadius: number;
  shadowIntensity: number;
  castShadows: boolean;
}

/** Опции визуальной отладки вьювера скинов */
export interface SkinDebugOptions {
  // ===== Оверлеи =====
  hitbox: boolean;
  partHitboxes: boolean;
  axes: boolean;
  grid: boolean;
  lightHelper: boolean;
  shadowCamera: boolean;
  lookTarget: boolean;
  wireframe: boolean;
  // ===== Сцена =====
  floor: boolean;
  ground: boolean;
  contactShadow: boolean;
  atmosphere: boolean;
  particles: boolean;
  postFx: boolean;
  shadows: boolean;
  envMap: boolean;
  // ===== Части скина =====
  head: boolean;
  body: boolean;
  arms: boolean;
  legs: boolean;
  outerLayer: boolean;
  cape: boolean;
  elytra: boolean;
  outerVoxels: boolean;
  // ===== Поведение =====
  pauseAnimation: boolean;
  freezeCamera: boolean;
  forceAutoRotate: boolean;
  flatShading: boolean;
}

/** Дефолты опций отладки (когда панель включена) */
export const DEFAULT_SKIN_DEBUG_OPTIONS: SkinDebugOptions = {
  hitbox: true,
  partHitboxes: false,
  axes: false,
  grid: false,
  lightHelper: false,
  shadowCamera: false,
  lookTarget: false,
  wireframe: false,
  floor: true,
  ground: true,
  contactShadow: true,
  atmosphere: true,
  particles: true,
  postFx: true,
  shadows: true,
  envMap: true,
  head: true,
  body: true,
  arms: true,
  legs: true,
  outerLayer: true,
  cape: true,
  elytra: true,
  outerVoxels: true,
  pauseAnimation: false,
  freezeCamera: false,
  forceAutoRotate: false,
  flatShading: false,
};

/** Снимок отладочной телеметрии вьювера скинов */
export interface SkinDebugStats {
  /** Отображаемое имя движка */
  engine: string;
  engineVersion: string;
  fps: number;
  fpsMin: number;
  fpsAvg: number;
  fpsMax: number;
  /** Длительность последнего кадра, мс */
  frameMs: number;
  /** Строка GPU из WEBGL_debug_renderer_info */
  gpu: string;
  gpuVendor: string;
  webgl: string;
  /**
   * Оценка нагрузки движка на GPU: доля frameMs от бюджета 60 FPS (0–100+).
   * Не системный GPU utilization — приближение по времени кадра.
   */
  gpuLoad: number;
  /** Логический размер канваса */
  width: number;
  height: number;
  /** Drawing buffer */
  bufferWidth: number;
  bufferHeight: number;
  pixelRatio: number;
  drawCalls: number;
  triangles: number;
  geometries: number;
  textures: number;
  programs: number;
  postFx: string;
  skinType: SkinModelType;
  hasCape: boolean;
  hasElytra: boolean;
  presentation: PresentationMode;
  animation: string;
  shotPreset: string;
  cameraFov: number;
  cameraDistance: number;
  cameraZoom: number;
  cameraYaw: number;
  autoRotate: boolean;
  cursorFollow: boolean;
  options: SkinDebugOptions;
}
