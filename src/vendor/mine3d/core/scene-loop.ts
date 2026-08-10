// Фасад движка: Three.js + PlayerObject из skin3d, продуктовый рендер под референс
import { PlayerObject } from "skin3d";
import {
  inferModelType,
  isTextureSource,
  loadCapeToCanvas,
  loadSkinToCanvas,
} from "skinview-utils";
import { loadSkinImage } from "./skin-image";
import {
  AxesHelper,
  BoxHelper,
  CameraHelper,
  CanvasTexture,
  Clock,
  ColorManagement,
  DirectionalLightHelper,
  GridHelper,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PerspectiveCamera,
  Raycaster,
  Scene,
  SphereGeometry,
  Vector2,
  Vector3,
  WebGLRenderer,
  type Material,
  type Object3D,
  type Texture,
} from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { MOUSE } from "three";
import { configureSkinCanvasTexture, sanitizeSkinCanvas } from "./skin-texture";
import {
  fitObjectToFrame,
  measureObjectFrame,
  type FrameFitOptions,
  type FrameFitResult,
  type FrameMeasure,
} from "./camera-framing";
import {
  applySkinUVInsets,
  SKIN_OUTER_UV_INSET_TEXELS,
  SKIN_UV_INSET_TEXELS,
} from "./skin-uv-inset";
import { applyStockLegPose } from "./skin-leg-stock";
import { OuterVoxelLayers } from "./skin-outer-voxel";
import {
  animationControlsLegs,
  applyPose,
  blendPoses,
  BustPoseAnimation,
  capturePose,
  CoolPoseAnimation,
  easeOutCubic,
  HeroIdleAnimation,
  resetLimbPose,
  type PoseSnapshot,
  type ShotPresetId,
  type SkinAnimation,
} from "./skin-animations";
import { bodyWorldPosition, feetWorldPosition, PixelParticles } from "./pixel-particles";
import {
  configureProductRenderer,
  createFloorAndContactShadow,
  enableShadows,
  logShadowDiagnostics,
  normalizeSkinDepthBias,
  ProductLighting,
  setupProductLighting,
  setupSceneEnvironment,
  tuneSkinMaterials,
} from "./product-visuals";
import { StudioAtmosphere, STUDIO_CLEAR_COLOR } from "./studio-atmosphere";
import { StudioPostFx } from "./studio-postfx";
import {
  DEFAULT_SKIN_DEBUG_OPTIONS,
  SkinModelType,
  type CameraSettings,
  type EngineOptions,
  type LightSettings,
  type PresentationMode,
  type SkinDebugOptions,
  type SkinDebugStats,
  type SkinSource,
} from "../types";

export type { EngineOptions, SkinSource, CameraSettings, LightSettings, PresentationMode, SkinDebugStats, SkinDebugOptions };
export type { ShotPresetId };
export { DEFAULT_SKIN_DEBUG_OPTIONS };

/** Имя движка в оверлее отладки лаунчера */
export const ENGINE_DISPLAY_NAME = "Mine3D Embedded";
/** Версия движка для HUD отладки */
export const ENGINE_VERSION = "0.2.0";

const MAX_PIXEL_RATIO = 2;

const LOOK_YAW_LIMIT = 1.22;
const LOOK_YAW_SPEED = 4;
const LOOK_YAW_RATE = 9;
const LOOK_AIM_RATE = 12;
const LOOK_WEIGHT_RATE = 5;

const QUALITY_TARGET_FPS = 45;
const QUALITY_WINDOW_SEC = 2.5;
const QUALITY_LOW_PIXEL_RATIO = 1;
const QUALITY_LOW_SHADOW_MAP = 1024;

/** Ближняя/дальняя плоскости камеры; модель ~32 units, орбита ≥ 18 units */
const CAMERA_NEAR = 1;
const CAMERA_FAR = 500;

/** Дефолты камеры продукта */
export const DEFAULT_CAMERA_SETTINGS: CameraSettings = {
  fov: 20,
  zoom: 1.16,
  lookTargetY: 0.5,
  distance: 110,
  autoRotate: false,
  minPolarAngleDeg: 39,
  maxPolarAngleDeg: 96,
};

/** Преобразование типа модели в формат skin3d */
function toSkin3dModelType(type: SkinModelType): "default" | "slim" {
  return type === SkinModelType.Slim ? "slim" : "default";
}

/**
 * Главный класс движка.
 * Геометрия/UV — skin3d; визуал — продуктовый three-quarter shot.
 */
export class SkinViewEngine {
  readonly canvas: HTMLCanvasElement;
  readonly controls: OrbitControls;
  /** Дефолтная hero-idle анимация (можно вернуть через setAnimation) */
  readonly idleAnimation: HeroIdleAnimation;
  /** Освещение сцены — key/fill/ambient, настраивается через публичные методы */
  readonly lighting: ProductLighting;

  private readonly scene: Scene;
  private readonly camera: PerspectiveCamera;
  private readonly renderer: WebGLRenderer;
  private readonly playerObject: PlayerObject;
  private readonly playerWrapper: Group;
  private readonly skinCanvas: HTMLCanvasElement;
  private readonly capeCanvas: HTMLCanvasElement;
  private readonly clock: Clock;
  private readonly lookTarget: Vector3;
  private readonly _floor: Mesh;
  private readonly _ground: Mesh;
  private readonly _contactShadow: Mesh;
  private readonly _atmosphere: StudioAtmosphere;
  /** Bloom + OutputPass — только основной вьювер, не мини-превью */
  private _postFx: StudioPostFx | null = null;
  /** Extrude outer-пикселей в воксели (3D Skin Layers) */
  private readonly _outerVoxels = new OuterVoxelLayers();

  private skinTexture: CanvasTexture | null = null;
  private capeTexture: CanvasTexture | null = null;
  private _envMap: Texture | null = null;
  private _animation: SkinAnimation | null;
  private _freeLegs = false;
  private _transparent = false;
  private _presentation: PresentationMode = "full";
  /** Кроссфейд между анимациями */
  private _blendFrom: PoseSnapshot | null = null;
  private _blendElapsed = 0;
  /** Короткий кроссфейд — смена анимации ощущается почти мгновенной */
  private readonly _blendDuration = 0.12;
  /** Взгляд за курсором (только поверх idle) */
  private _cursorFollow = false;
  private _cursorAimX = 0;
  private _cursorAimY = 0;
  private _smoothAimX = 0;
  private _smoothAimY = 0;
  private _autoDetectModel: boolean;
  private _modelType: SkinModelType;
  // ===== Отладка =====
  private _debugEnabled = false;
  private _debugOpts: SkinDebugOptions = { ...DEFAULT_SKIN_DEBUG_OPTIONS };
  private _hitboxHelper: BoxHelper | null = null;
  private _partHitboxHelpers: BoxHelper[] = [];
  private _axesHelper: AxesHelper | null = null;
  private _gridHelper: GridHelper | null = null;
  private _lightHelper: DirectionalLightHelper | null = null;
  private _shadowCameraHelper: CameraHelper | null = null;
  private _lookTargetHelper: Mesh | null = null;
  private _savedAutoRotate: boolean | null = null;
  private _gpuRenderer = "";
  private _gpuVendor = "";
  private _webglApi = "";
  private _fps = 0;
  private _fpsMin = 0;
  private _fpsAvg = 0;
  private _fpsMax = 0;
  private _frameMs = 0;
  private _fpsFrames = 0;
  private _fpsElapsed = 0;
  private readonly _fpsSamples: number[] = [];
  private _running = false;
  private _rafId = 0;
  private _resizeObserver: ResizeObserver | null = null;
  private _zoom: number;
  private _fov: number;
  private _disposed = false;
  private readonly _uvInsetTexels: number;
  private readonly _outerUvInsetTexels: number;
  private readonly _raycaster = new Raycaster();
  private readonly _pointerNdc = new Vector2();
  private readonly _feetWorld = new Vector3();
  private readonly _particles = new PixelParticles();
  private _particlesEnabled = true;
  private _lookWeight = 0;
  private _lookYaw = 0;
  private _qualityLevel = 0;
  private _qualityElapsed = 0;
  /** Клик по модели: запомнить попадание и точку, чтобы отличить от вращения */
  private _nudgePointerId: number | null = null;
  private _nudgePointerHit = false;
  private _nudgePointerX = 0;
  private _nudgePointerY = 0;
  private _nudgeUnbind: (() => void) | null = null;
  private _dressElapsed = -1;
  private static readonly DRESS_DURATION = 1.15;
  private _shotPreset: ShotPresetId | null = null;
  /** Частицы / «переоделся» — выкл. на мини-превью */
  private readonly _enableEffects: boolean;

  constructor(canvas: HTMLCanvasElement, options: EngineOptions = {}) {
    this.canvas = canvas;
    this._autoDetectModel = options.autoDetectModel ?? true;
    this._modelType = options.modelType ?? SkinModelType.Classic;
    this._zoom = options.zoom ?? DEFAULT_CAMERA_SETTINGS.zoom;
    this._fov = options.fov ?? DEFAULT_CAMERA_SETTINGS.fov;
    this._uvInsetTexels = options.uvInsetTexels ?? SKIN_UV_INSET_TEXELS;
    this._outerUvInsetTexels = options.outerUvInsetTexels ?? SKIN_OUTER_UV_INSET_TEXELS;
    this._enableEffects = options.enableEffects !== false;
    this.lookTarget = new Vector3(0, DEFAULT_CAMERA_SETTINGS.lookTargetY, 0);

    this.skinCanvas = document.createElement("canvas");
    this.capeCanvas = document.createElement("canvas");
    this.clock = new Clock();

    this.idleAnimation = new HeroIdleAnimation();
    if (options.idleAnimation === false) {
      this._animation = null;
    } else if (options.idleAnimation && typeof options.idleAnimation === "object") {
      this._animation = options.idleAnimation;
    } else {
      this._animation = this.idleAnimation;
    }
    this._freeLegs = animationControlsLegs(this._animation);

    // ===== Three.js сцена =====
    ColorManagement.enabled = true;
    this.scene = new Scene();
    this._atmosphere = new StudioAtmosphere();
    this.scene.background = this._atmosphere.backgroundTexture;
    this.scene.add(this._atmosphere.group);
    this.lighting = setupProductLighting(this.scene);
    const floorParts = createFloorAndContactShadow(this.scene);
    this._floor = floorParts.floor;
    this._ground = floorParts.ground;
    this._contactShadow = floorParts.contactShadow;

    // near/far под масштаб персонажа (~32 units) и minDistance орбиты: узкий
    // диапазон даёт запас точности depth-буфера на копланарных гранях overlay
    this.camera = new PerspectiveCamera(this._fov, 1, CAMERA_NEAR, CAMERA_FAR);

    // alpha всегда включён — прозрачный режим переключается setClearColor/background
    this.renderer = new WebGLRenderer({
      canvas: this.canvas,
      antialias: options.antialias ?? true,
      preserveDrawingBuffer: options.preserveDrawingBuffer === true,
      alpha: true,
      premultipliedAlpha: false,
      powerPreference: "high-performance",
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, MAX_PIXEL_RATIO));
    this.renderer.setClearColor(0x222222, 1);
    this.renderer.sortObjects = true;
    configureProductRenderer(this.renderer);
    this._readGpuInfo();

    this._envMap = setupSceneEnvironment(this.scene, this.renderer);

    // Постпроцессинг: bloom + SMAA (не MSAA — с NearestFilter даёт чёрные/белые полосы)
    if (this._enableEffects && !options.transparent) {
      this._postFx = new StudioPostFx(this.renderer, this.scene, this.camera);
      this._postFx.setPixelRatio(this.renderer.getPixelRatio());
    }

    // ===== Модель игрока (skin3d) =====
    this.playerObject = new PlayerObject();
    this.playerObject.name = "player";
    this.playerObject.skin.visible = false;
    this.playerObject.cape.visible = false;
    this.playerObject.elytra.visible = false;
    this.playerObject.ears.visible = false;
    this.playerObject.skin.modelType = toSkin3dModelType(this._modelType);
    this._applyLegPoseCorrection();
    this._configureSkinMeshRendering();
    this._applySkinUVInsets();
    tuneSkinMaterials(this.playerObject.skin, this._envMap);
    enableShadows(this.playerObject.skin);
    if (options.debugShadows) {
      logShadowDiagnostics(this.playerObject, this.lighting.key);
    }

    this.playerWrapper = new Group();
    this.playerWrapper.add(this.playerObject);
    this.scene.add(this.playerWrapper);
    this.scene.add(this._particles.group);

    // ===== Орбита камеры =====
    this.controls = new OrbitControls(this.camera, this.canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.enablePan = true;
    this.controls.screenSpacePanning = true;
    this.controls.panSpeed = 0.6;
    this.controls.rotateSpeed = 0.85;
    this.controls.zoomSpeed = 1.1;
    this.controls.minDistance = 18;
    this.controls.maxDistance = DEFAULT_CAMERA_SETTINGS.distance;
    this.controls.minPolarAngle = (DEFAULT_CAMERA_SETTINGS.minPolarAngleDeg * Math.PI) / 180;
    this.controls.maxPolarAngle = (DEFAULT_CAMERA_SETTINGS.maxPolarAngleDeg * Math.PI) / 180;
    this.controls.mouseButtons = {
      LEFT: MOUSE.ROTATE,
      MIDDLE: MOUSE.DOLLY,
      RIGHT: MOUSE.PAN,
    };
    this.controls.enabled = options.enableControls !== false;
    if (this.controls.enabled) {
      this._setupAltPan(canvas);
    }
    this._setupPlayerNudge(canvas);
    this.controls.target.copy(this.lookTarget);

    this.resetCameraPose();

    if (options.autoResize !== false) {
      this._setupAutoResize(canvas);
    } else {
      this.setSize(canvas.clientWidth || 300, canvas.clientHeight || 400);
    }

    if (options.transparent) this.setTransparentBackground(true);
    if (options.presentation === "bust") this.setPresentationMode("bust");
  }

  /** Текущая анимация персонажа */
  get animation(): SkinAnimation | null {
    return this._animation;
  }

  /**
   * Смена анимации с плавным кроссфейдом (~0.38 с).
   * null — заморозить текущую позу.
   */
  setAnimation(animation: SkinAnimation | null): void {
    // Снимок до смены — из него начинаем бленд к новой анимации
    this._blendFrom = capturePose(this.playerObject);
    this._blendElapsed = 0;
    this._animation = animation;
    this._freeLegs = animationControlsLegs(animation);
    if (animation) animation.progress = 0;
    this._syncIdleModelSlim();
    this._syncIdleLookSuppression();
    // Взгляд за курсором имеет смысл только в idle
    if (!(animation instanceof HeroIdleAnimation)) {
      this._cursorAimX = 0;
      this._cursorAimY = 0;
    }
  }

  /** Включить/выключить взгляд головы за курсором (idle) */
  setCursorFollow(enabled: boolean): void {
    this._cursorFollow = enabled;
    if (!enabled) {
      this._cursorAimX = 0;
      this._cursorAimY = 0;
    }
    this._syncIdleLookSuppression();
  }

  /** Idle не анимирует голову, пока взгляд ведёт курсор */
  private _syncIdleLookSuppression(): void {
    if (this._animation instanceof HeroIdleAnimation) {
      this._animation.suppressAutoLook = this._cursorFollow;
    }
  }

  private _syncIdleModelSlim(): void {
    if (this._animation instanceof HeroIdleAnimation) {
      this._animation.modelSlim = this._modelType === SkinModelType.Slim;
    }
  }

  get cursorFollow(): boolean {
    return this._cursorFollow;
  }

  /**
   * Цель взгляда относительно сцены: центр = 0, y вверх.
   * Допускаем чуть больше ±1 — курсор на боковых панелях тоже тянет взгляд.
   */
  setCursorAim(x: number, y: number): void {
    this._cursorAimX = Math.max(-1.4, Math.min(1.4, x));
    this._cursorAimY = Math.max(-1.25, Math.min(1.25, y));
  }

  /**
   * Реакция «подтолкнули» в idle: шаг назад, тряска головой, возврат.
   * @returns false, если сейчас не idle
   */
  nudge(): boolean {
    if (!(this._animation instanceof HeroIdleAnimation)) return false;
    return this._animation.nudge();
  }

  get shotPreset(): ShotPresetId | null {
    return this._shotPreset;
  }

  /**
   * Пресет кадра под скриншот: герой / бюст / спина / Discord.
   * Кадрирование (fitPlayerToFrame) вызывает UI со своими fill-опциями.
   */
  applyShotPreset(id: ShotPresetId): void {
    this._shotPreset = id;
    this.setCursorFollow(false);
    this.setCursorAim(0, 0);
    const bustLike = id === "bust" || id === "discord";
    this.playerObject.skin.leftLeg.visible = !bustLike;
    this.playerObject.skin.rightLeg.visible = !bustLike;
    this.setPlayerYaw(id === "back" ? Math.PI : 0);

    if (id === "hero") this.setAnimation(new CoolPoseAnimation());
    else if (id === "bust") this.setAnimation(new BustPoseAnimation(0));
    else if (id === "discord") this.setAnimation(new BustPoseAnimation(1));
    else this.setAnimation(new HeroIdleAnimation());

    this.resetCameraPose();
  }

  /** Сброс пресета скриншота (ноги/yaw) — анимацию задаёт вызывающий код */
  clearShotPreset(): void {
    this._shotPreset = null;
    this.playerWrapper.rotation.y = 0;
    if (this._presentation === "full") {
      this.playerObject.skin.leftLeg.visible = true;
      this.playerObject.skin.rightLeg.visible = true;
    }
    this.setPlayerYaw(0);
  }

  get transparentBackground(): boolean {
    return this._transparent;
  }

  /** Прозрачный фон: без атмосферы, пола и контактной тени */
  setTransparentBackground(enabled: boolean): void {
    this._transparent = enabled;
    if (enabled) {
      this.scene.background = null;
      this.renderer.setClearColor(0x000000, 0);
      this._floor.visible = false;
      this._ground.visible = false;
      this._contactShadow.visible = false;
      this._atmosphere.setVisible(false);
      this._postFx?.setBloomBoost(0);
    } else {
      this.scene.background = this._atmosphere.backgroundTexture;
      this.renderer.setClearColor(STUDIO_CLEAR_COLOR, 1);
      if (this._debugEnabled) this._applySceneVisibility();
      else {
        this._floor.visible = true;
        this._ground.visible = true;
        this._contactShadow.visible = true;
        this._atmosphere.setVisible(true);
      }
    }
  }

  setContactShadowVisible(visible: boolean): void {
    this._contactShadow.visible = visible;
  }

  setBodyPartsVisible(visible: boolean): void {
    const skin = this.playerObject.skin;
    skin.body.visible = visible;
    skin.leftArm.visible = visible;
    skin.rightArm.visible = visible;
    skin.leftLeg.visible = visible;
    skin.rightLeg.visible = visible;
  }

  get presentationMode(): PresentationMode {
    return this._presentation;
  }

  /**
   * full — весь рост; bust — ноги скрыты, hero-поза и прозрачный фон.
   * Для карточек/аватаров: после смены режима нужен fitPlayerToFrame.
   */
  setPresentationMode(mode: PresentationMode): void {
    this._presentation = mode;
    if (this._debugEnabled) this._applySkinPartVisibility();
    else this._applyPresentationVisibility();

    if (mode === "bust") {
      this.setTransparentBackground(true);
      this.setAnimation(new BustPoseAnimation());
    }
  }

  /** Загрузка скина — единый пайплайн для файла, URL и data URL */
  async setSkin(source: SkinSource): Promise<void> {
    const hadSkin = this.playerObject.skin.visible;
    const resolved = isTextureSource(source)
      ? source
      : await loadSkinImage(source as string);

    loadSkinToCanvas(this.skinCanvas, resolved);
    sanitizeSkinCanvas(this.skinCanvas);
    this.recreateSkinTexture();
    this._syncModelAndUVsAfterSkinLoad();
    tuneSkinMaterials(this.playerObject.skin, this._envMap, this.skinTexture);
    // Идемпотентно: renderOrder и depth-bias не должны зависеть от порядка загрузок
    this._configureSkinMeshRendering();
    enableShadows(this.playerObject.skin);

    this.playerObject.skin.visible = true;
    // setSkin не должен возвращать ноги в bust-режиме
    if (this._debugEnabled) this._syncDebugOverlays();
    else this._applyPresentationVisibility();
    this._syncIdleModelSlim();

    // Повторная смена — короткий «переоделся» (не на карточках-превью)
    if (hadSkin && this._enableEffects) this._playDressEffect();
  }

  /** Определение типа модели и применение UV-inset (идемпотентно) */
  private _syncModelAndUVsAfterSkinLoad(): void {
    if (this._autoDetectModel) {
      const inferred = inferModelType(this.skinCanvas);
      this.setModelType(
        inferred === "slim" ? SkinModelType.Slim : SkinModelType.Classic,
      );
    } else {
      this._applySkinUVInsets();
    }
  }

  /** @deprecated Используйте setSkin */
  async loadSkin(source: string): Promise<void> {
    await this.setSkin(source);
  }

  /**
   * Загрузка плаща (cape). null — скрыть и освободить текстуру.
   * Источник: URL, data URL, Image/Canvas (как у setSkin).
   */
  async setCape(source: SkinSource | null): Promise<void> {
    if (source === null) {
      this.clearCape();
      return;
    }

    const resolved = isTextureSource(source)
      ? source
      : await loadSkinImage(source as string);

    loadCapeToCanvas(this.capeCanvas, resolved);
    this.recreateCapeTexture();
    this.playerObject.backEquipment = "cape";
  }

  /** Скрыть плащ и освободить cape-текстуру */
  clearCape(): void {
    this.playerObject.backEquipment = null;
    this.playerObject.cape.map = null;
    this.playerObject.elytra.map = null;
    this.capeTexture?.dispose();
    this.capeTexture = null;
  }

  /** @deprecated Используйте setCape */
  async loadCape(source: SkinSource | null): Promise<void> {
    await this.setCape(source);
  }

  /** Переключение classic (Steve) / slim (Alex) */
  setModelType(type: SkinModelType): void {
    this._modelType = type;
    this.playerObject.skin.modelType = toSkin3dModelType(type);
    this._applySkinUVInsets();
    // Listeners skin3d сбрасывают scale рук — пересобираем 3D outer
    this._rebuildOuterVoxels();
    this._syncIdleModelSlim();
  }

  get modelType(): SkinModelType {
    return this._modelType;
  }

  /** Включить/выключить сбор телеметрии и активные debug-оверлеи */
  setDebugEnabled(enabled: boolean): void {
    this._debugEnabled = !!enabled;
    this._syncDebugOverlays();
  }

  getDebugEnabled(): boolean {
    return this._debugEnabled;
  }

  /** Частичное обновление визуальных опций отладки */
  setDebugOptions(partial: Partial<SkinDebugOptions>): void {
    this._debugOpts = { ...this._debugOpts, ...partial };
    this._syncDebugOverlays();
  }

  getDebugOptions(): SkinDebugOptions {
    return { ...this._debugOpts };
  }

  /** Текущий снимок телеметрии для HUD */
  getDebugStats(): SkinDebugStats {
    const render = this.renderer.info.render;
    const memory = this.renderer.info.memory;
    const programs = this.renderer.info.programs?.length ?? 0;
    const budgetMs = 1000 / 60;
    const gpuLoad = Math.min(999, Math.round((this._frameMs / budgetMs) * 100));
    const el = this.renderer.domElement;
    const animName = this._animation
      ? (this._animation.constructor?.name || "SkinAnimation")
      : "none";
    return {
      engine: ENGINE_DISPLAY_NAME,
      engineVersion: ENGINE_VERSION,
      fps: this._fps,
      fpsMin: this._fpsMin,
      fpsAvg: this._fpsAvg,
      fpsMax: this._fpsMax,
      frameMs: Math.round(this._frameMs * 10) / 10,
      gpu: this._gpuRenderer || "Unknown GPU",
      gpuVendor: this._gpuVendor || "Unknown",
      webgl: this._webglApi || "WebGL",
      gpuLoad,
      width: el.clientWidth || 0,
      height: el.clientHeight || 0,
      bufferWidth: el.width || 0,
      bufferHeight: el.height || 0,
      pixelRatio: Math.round(this.renderer.getPixelRatio() * 100) / 100,
      drawCalls: render.calls,
      triangles: render.triangles,
      geometries: memory.geometries,
      textures: memory.textures,
      programs,
      postFx:
        this._postFx && !this._transparent && this._debugOpts.postFx
          ? "bloom+SMAA"
          : "direct",
      skinType: this._modelType,
      hasCape: !!(this.capeTexture && this.playerObject.cape.visible),
      hasElytra: !!this.playerObject.elytra.visible,
      presentation: this._presentation,
      animation: animName,
      shotPreset: this._shotPreset ?? "none",
      cameraFov: Math.round(this._fov * 10) / 10,
      cameraDistance: Math.round(this.getCameraDistance() * 10) / 10,
      cameraZoom: Math.round(this._zoom * 100) / 100,
      cameraYaw: Math.round(this.playerObject.rotation.y * 100) / 100,
      autoRotate: this.controls.autoRotate,
      cursorFollow: this._cursorFollow,
      options: this.getDebugOptions(),
    };
  }

  /** Поворот модели вокруг Y (рад); π — вид со спины для превью плаща */
  setPlayerYaw(yaw: number): void {
    this.playerObject.rotation.y = yaw;
  }

  get playerYaw(): number {
    return this.playerObject.rotation.y;
  }

  get disposed(): boolean {
    return this._disposed;
  }

  // ===== Камера =====

  /** Текущий FOV перспективной камеры (градусы) */
  getCameraFov(): number {
    return this._fov;
  }

  /** Установка FOV и обновление projection matrix */
  setCameraFov(fov: number): void {
    this._fov = Math.max(10, Math.min(120, fov));
    this.camera.fov = this._fov;
    this.camera.updateProjectionMatrix();
  }

  /** Масштаб камеры (skin3d zoom) — сохраняется в настройках, не меняет текущую дистанцию */
  getZoom(): number {
    return this._zoom;
  }

  setZoom(zoom: number): void {
    this._zoom = Math.max(0.1, Math.min(4, zoom));
  }

  /** Высота точки look-at (орбитальный центр) */
  getLookTargetY(): number {
    return this.lookTarget.y;
  }

  setLookTargetY(y: number): void {
    this.lookTarget.y = y;
    this.controls.target.y = y;
    this.camera.lookAt(this.lookTarget);
  }

  /** Дистанция камеры от точки look-at */
  getCameraDistance(): number {
    return this.camera.position.distanceTo(this.controls.target);
  }

  /** Задать дистанцию, сохраняя направление обзора */
  setCameraDistance(distance: number): void {
    const clamped = Math.max(this.controls.minDistance, Math.min(this.controls.maxDistance, distance));
    this.applyCameraDistance(clamped);
  }

  /** Автовращение орбиты */
  getAutoRotate(): boolean {
    return this.controls.autoRotate;
  }

  setAutoRotate(enabled: boolean): void {
    this.controls.autoRotate = enabled;
    this.controls.autoRotateSpeed = 1.2;
  }

  /** Ограничения полярного угла орбиты (градусы от вертикали) */
  getPolarLimitsDeg(): { min: number; max: number } {
    return {
      min: (this.controls.minPolarAngle * 180) / Math.PI,
      max: (this.controls.maxPolarAngle * 180) / Math.PI,
    };
  }

  setPolarLimitsDeg(minDeg: number, maxDeg: number): void {
    const min = Math.max(0, Math.min(minDeg, maxDeg - 1));
    const max = Math.min(180, Math.max(maxDeg, min + 1));
    this.controls.minPolarAngle = (min * Math.PI) / 180;
    this.controls.maxPolarAngle = (max * Math.PI) / 180;
  }

  /** Снимок настроек камеры для UI */
  getCameraSettings(): CameraSettings {
    const polar = this.getPolarLimitsDeg();
    return {
      fov: this.getCameraFov(),
      zoom: this.getZoom(),
      lookTargetY: this.getLookTargetY(),
      distance: this.getCameraDistance(),
      autoRotate: this.getAutoRotate(),
      minPolarAngleDeg: polar.min,
      maxPolarAngleDeg: polar.max,
    };
  }

  /** Частичное применение настроек камеры */
  applyCameraSettings(partial: Partial<CameraSettings>): void {
    if (partial.fov !== undefined) this.setCameraFov(partial.fov);
    if (partial.zoom !== undefined) this.setZoom(partial.zoom);
    if (partial.lookTargetY !== undefined) this.setLookTargetY(partial.lookTargetY);
    if (partial.distance !== undefined) this.setCameraDistance(partial.distance);
    if (partial.autoRotate !== undefined) this.setAutoRotate(partial.autoRotate);
    if (partial.minPolarAngleDeg !== undefined || partial.maxPolarAngleDeg !== undefined) {
      const polar = this.getPolarLimitsDeg();
      this.setPolarLimitsDeg(
        partial.minPolarAngleDeg ?? polar.min,
        partial.maxPolarAngleDeg ?? polar.max,
      );
    }
  }

  /** Сброс камеры к product shot по умолчанию */
  resetCamera(): void {
    this._fov = DEFAULT_CAMERA_SETTINGS.fov;
    this._zoom = DEFAULT_CAMERA_SETTINGS.zoom;
    this.lookTarget.y = DEFAULT_CAMERA_SETTINGS.lookTargetY;
    this.setPolarLimitsDeg(
      DEFAULT_CAMERA_SETTINGS.minPolarAngleDeg,
      DEFAULT_CAMERA_SETTINGS.maxPolarAngleDeg,
    );
    this.controls.autoRotate = DEFAULT_CAMERA_SETTINGS.autoRotate;
    this.resetCameraPose();
  }

  // ===== Кадрирование =====

  /**
   * Замер кадрирования: экранный bbox модели (NDC), доля кадра и смещение от
   * центра. Камеру не меняет — нужен для проверки кадра в тестах и отладке.
   */
  measurePlayerFrame(): FrameMeasure | null {
    return measureObjectFrame(this.playerWrapper, this.camera);
  }

  /**
   * Кадрирование модели под текущий размер канваса: персонаж целиком, по центру
   * и на заданную долю кадра. Направление обзора (орбита) сохраняется —
   * меняются только дистанция и точка look-at.
   *
   * Перед замером кратко ставится нейтральная стойка (без смещений анимации),
   * иначе бег/плащ уводят центр кадра. После замера поза восстанавливается.
   */
  fitPlayerToFrame(options: FrameFitOptions = {}): FrameFitResult | null {
    const savedPose = capturePose(this.playerObject);
    const savedProgress = this._animation?.progress ?? 0;
    const savedBlend = this._blendFrom;
    const savedBlendElapsed = this._blendElapsed;

    // Стабильный кадр: без root-offset анимаций и без бленда
    this._blendFrom = null;
    resetLimbPose(this.playerObject);
    if (this._presentation === "bust") {
      const bust = new BustPoseAnimation(0);
      bust.progress = 0.8;
      bust.update(this.playerObject, 0);
    } else {
      applyStockLegPose(this.playerObject.skin);
    }
    this._applyPresentationVisibility();

    const result = fitObjectToFrame(this.playerWrapper, this.camera, this.lookTarget, {
      ...options,
      centerX: true,
      // По умолчанию строго по центру; явный offsetY от вызывающего сохраняем
      offsetY: options.offsetY ?? 0,
    });

    applyPose(this.playerObject, savedPose);
    if (this._animation) this._animation.progress = savedProgress;
    this._blendFrom = savedBlend;
    this._blendElapsed = savedBlendElapsed;
    this._applyPresentationVisibility();

    if (!result) return null;

    // Лимиты орбиты должны вмещать новую дистанцию, иначе следующий
    // controls.update() вернёт камеру к прежнему радиусу
    if (result.distance > this.controls.maxDistance) this.controls.maxDistance = result.distance;
    if (result.distance < this.controls.minDistance) this.controls.minDistance = result.distance;
    this.controls.target.copy(this.lookTarget);
    this.controls.update();
    return result;
  }

  // ===== Освещение =====

  /** Текущие настройки освещения */
  getLightSettings(): LightSettings {
    return this.lighting.getSettings();
  }

  /** Частичное применение настроек света */
  applyLightSettings(partial: Partial<LightSettings>): void {
    this.lighting.applySettings(partial);
  }

  /** Сброс освещения к дефолтам */
  resetLighting(): void {
    this.lighting.resetToDefaults();
  }

  /** Запуск render loop */
  start(): void {
    if (this._running || this._disposed) return;
    this._running = true;
    this.clock.start();
    this._tick();
  }

  /** Остановка render loop */
  stop(): void {
    this._running = false;
    cancelAnimationFrame(this._rafId);
    this.clock.stop();
  }

  get qualityLevel(): number {
    return this._qualityLevel;
  }

  private _adaptQuality(deltaTime: number): void {
    if (this._qualityLevel >= 2) return;
    this._qualityElapsed += deltaTime;
    if (this._qualityElapsed < QUALITY_WINDOW_SEC) return;
    this._qualityElapsed = 0;
    if (this._fpsSamples.length < 3 || this._fpsAvg <= 0 || this._fpsAvg >= QUALITY_TARGET_FPS) return;

    this._qualityLevel += 1;
    if (this._qualityLevel === 1) {
      this.renderer.setPixelRatio(QUALITY_LOW_PIXEL_RATIO);
      this._postFx?.setPixelRatio(QUALITY_LOW_PIXEL_RATIO);
      this.lighting.setShadowMapSize(QUALITY_LOW_SHADOW_MAP);
      this._particlesEnabled = false;
      this._particles.group.visible = false;
    } else {
      this.lighting.setCastShadows(false);
      this._contactShadow.visible = true;
    }
    this._fpsSamples.length = 0;
  }

  /** Один кадр без запуска loop — для статичных мини-превью */
  renderFrame(): void {
    if (this._disposed) return;
    // В статичном кадре кроссфейд не нужен — сразу конечная поза
    this._blendFrom = null;
    this._sampleAnimationPose(0);
    this.controls.update();
    this._renderFrame();
  }

  /**
   * Семпл текущей анимации в модель + опциональный кроссфейд.
   * delta=0 — поза без продвижения progress (карточки).
   */
  private _sampleAnimationPose(deltaTime: number): void {
    resetLimbPose(this.playerObject);
    this._animation?.update(this.playerObject, deltaTime);
    if (!this._freeLegs) this._applyLegPoseCorrection();

    if (this._blendFrom) {
      const target = capturePose(this.playerObject);
      this._blendElapsed += Math.max(deltaTime, 0);
      const t = this._blendDuration <= 0 ? 1 : this._blendElapsed / this._blendDuration;
      blendPoses(this.playerObject, this._blendFrom, target, t);
      if (t >= 1) {
        this._blendFrom = null;
        applyPose(this.playerObject, target);
      }
    }
  }

  /** Освобождение GPU-ресурсов */
  dispose(): void {
    if (this._disposed) return;
    this._disposed = true;
    this.stop();
    this._nudgeUnbind?.();
    this._nudgeUnbind = null;
    this._disposeDebugOverlays();
    this._particles.dispose();
    this._atmosphere.dispose();
    this._postFx?.dispose();
    this._postFx = null;
    this._resizeObserver?.disconnect();
    this._outerVoxels.dispose(this.playerObject.skin);
    this.controls.dispose();
    this.skinTexture?.dispose();
    this.capeTexture?.dispose();
    this._envMap?.dispose();
    this.renderer.dispose();
  }

  /** Product pose ног (±1.9, y=−12, z=0) — после idle ноги не анимируем */
  private _applyLegPoseCorrection(): void {
    applyStockLegPose(this.playerObject.skin);
  }

  /** Видимость ног по режиму presentation */
  private _applyPresentationVisibility(): void {
    const showLegs = this._presentation === "full";
    this.playerObject.skin.leftLeg.visible = showLegs;
    this.playerObject.skin.rightLeg.visible = showLegs;
  }

  /**
   * Порядок отрисовки и единый depth-bias — против тонких линий на стыках.
   *
   * Overlay соседних частей пересекается копланарными гранями, поэтому исход
   * depth-теста должен решаться порядком, а не bias'ом (см. normalizeSkinDepthBias).
   * inner → outer торса/головы → outer конечностей: на стыке рука–торс и
   * бедро–торс выигрывает непрерывная поверхность куртки, а не полоска рукава.
   */
  private _configureSkinMeshRendering(): void {
    const skin = this.playerObject.skin;

    skin.traverse((obj) => {
      if (!(obj instanceof Mesh)) return;
      obj.renderOrder = obj.name === "outer" ? 1 : 0;
    });

    // Штанины overlay перекрывают друг друга в центре (позиция ±1.9 при ширине 4.2),
    // поэтому у каждой конечности свой порядок — исход не зависит от сортировки сцены
    const limbs = [skin.rightArm, skin.leftArm, skin.rightLeg, skin.leftLeg];
    limbs.forEach((part, index) => {
      (part.outerLayer as Mesh).renderOrder = 2 + index;
    });

    normalizeSkinDepthBias(skin);
    // Extrude outer → 3D-воксели (после bias/order)
    this._rebuildOuterVoxels();
  }

  /** Пересборка 3D Skin Layers из текущего canvas */
  private _rebuildOuterVoxels(): void {
    this._outerVoxels.rebuild(
      this.playerObject.skin,
      this.skinCanvas,
      this._modelType === SkinModelType.Slim,
      this.skinTexture,
      this._envMap,
    );
  }

  /** UV-inset на stock-мeshах после setSkinUVs (skin3d) */
  private _applySkinUVInsets(): void {
    applySkinUVInsets(this.playerObject.skin, {
      insetTexels: this._uvInsetTexels,
      outerInsetTexels: this._outerUvInsetTexels,
    });
  }

  /** Текстура скина — skin3d map setter раздаёт map на все 4 материала */
  private recreateSkinTexture(): void {
    this.skinTexture?.dispose();
    this.skinTexture = new CanvasTexture(this.skinCanvas);
    configureSkinCanvasTexture(this.skinTexture);
    this.playerObject.skin.map = this.skinTexture;
  }

  /** Текстура плаща — общая для cape и elytra (как в skin3d) */
  private recreateCapeTexture(): void {
    this.capeTexture?.dispose();
    this.capeTexture = new CanvasTexture(this.capeCanvas);
    configureSkinCanvasTexture(this.capeTexture);
    this.playerObject.cape.map = this.capeTexture;
    this.playerObject.elytra.map = this.capeTexture;
  }

  /**
   * В idle полностью задаёт угол головы/корпуса по курсору
   * (idle при этом не крутит голову — см. suppressAutoLook).
   */
  private _applyCursorLook(deltaTime: number): void {
    const idle = this._animation instanceof HeroIdleAnimation ? this._animation : null;
    const wantLook = this._cursorFollow && idle !== null;
    const targetWeight = wantLook && !idle.blocksCursorLook ? 1 : 0;
    const weightK = 1 - Math.exp(-LOOK_WEIGHT_RATE * Math.max(0, deltaTime));
    this._lookWeight += (targetWeight - this._lookWeight) * weightK;

    if (this._lookWeight < 0.002) {
      this._lookWeight = 0;
      if (targetWeight === 0) {
        this._smoothAimX = 0;
        this._smoothAimY = 0;
        this._lookYaw = 0;
        return;
      }
    }

    const aimK = 1 - Math.exp(-LOOK_AIM_RATE * Math.max(0, deltaTime));
    this._smoothAimX += ((wantLook ? this._cursorAimX : 0) - this._smoothAimX) * aimK;
    this._smoothAimY += ((wantLook ? this._cursorAimY : 0) - this._smoothAimY) * aimK;

    const viewYaw = Math.atan2(
      this.camera.position.x - this.playerWrapper.position.x,
      this.camera.position.z - this.playerWrapper.position.z,
    );
    const modelYaw = this.playerWrapper.rotation.y + this.playerObject.rotation.y;
    const desired = viewYaw - modelYaw + this._smoothAimX * 0.62;
    const wrapped = Math.atan2(Math.sin(desired), Math.cos(desired));
    const targetYaw = Math.max(-LOOK_YAW_LIMIT, Math.min(LOOK_YAW_LIMIT, wrapped));

    const eased =
      this._lookYaw +
      (targetYaw - this._lookYaw) * (1 - Math.exp(-LOOK_YAW_RATE * Math.max(0, deltaTime)));
    const step = LOOK_YAW_SPEED * Math.max(0, deltaTime);
    const diff = eased - this._lookYaw;
    this._lookYaw += Math.abs(diff) <= step ? diff : Math.sign(diff) * step;

    const head = this.playerObject.skin.head;
    const body = this.playerObject.skin.body;
    const w = this._lookWeight;
    // В skin3d: +y — влево/вправо, +x — вниз; нейтральный pitch −0.04
    head.rotation.y += (this._lookYaw - head.rotation.y) * w;
    head.rotation.x += (-0.04 - this._smoothAimY * 0.4 - head.rotation.x) * w;
    head.rotation.z += (this._lookYaw * 0.07 - head.rotation.z) * w;
    body.rotation.y += (-0.08 + this._lookYaw * 0.2 - body.rotation.y) * w;
  }


  private _tick = (): void => {
    if (!this._running || this._disposed) return;

    const deltaTime = this.clock.getDelta();
    this._frameMs = deltaTime * 1000;
    this._fpsFrames += 1;
    this._fpsElapsed += deltaTime;
    if (this._fpsElapsed >= 0.5) {
      this._fps = Math.round(this._fpsFrames / this._fpsElapsed);
      this._fpsFrames = 0;
      this._fpsElapsed = 0;
      this._fpsSamples.push(this._fps);
      while (this._fpsSamples.length > 8) this._fpsSamples.shift();
      this._fpsMin = Math.min(...this._fpsSamples);
      this._fpsMax = Math.max(...this._fpsSamples);
      this._fpsAvg = Math.round(
        this._fpsSamples.reduce((a, b) => a + b, 0) / this._fpsSamples.length,
      );
    }
    const animDt = this._debugEnabled && this._debugOpts.pauseAnimation ? 0 : deltaTime;
    this._sampleAnimationPose(animDt);
    if (!(this._debugEnabled && this._debugOpts.pauseAnimation)) {
      this._applyCursorLook(deltaTime);
      this._updateDressEffect(deltaTime);
    }
    this._syncIdleFx(deltaTime);
    this._atmosphere.update(deltaTime);
    if (this._particlesEnabled && (!this._debugEnabled || this._debugOpts.particles)) {
      this._particles.update(deltaTime);
    }
    this._adaptQuality(deltaTime);
    this.controls.update();
    if (this._hitboxHelper) this._hitboxHelper.update();
    for (const h of this._partHitboxHelpers) h.update();
    if (this._lightHelper) this._lightHelper.update();
    if (this._shadowCameraHelper) this._shadowCameraHelper.update();
    if (this._lookTargetHelper) this._lookTargetHelper.position.copy(this.lookTarget);
    this._renderFrame();

    this._rafId = requestAnimationFrame(this._tick);
  };

  private _readGpuInfo(): void {
    try {
      const gl = this.renderer.getContext() as WebGLRenderingContext;
      this._webglApi = this.renderer.capabilities.isWebGL2 ? "WebGL 2" : "WebGL 1";
      const dbg = gl.getExtension("WEBGL_debug_renderer_info");
      if (!dbg) return;
      this._gpuRenderer = String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) || "")
        .replace(/\s+/g, " ")
        .trim();
      this._gpuVendor = String(gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL) || "")
        .replace(/\s+/g, " ")
        .trim();
    } catch {
      this._gpuRenderer = "";
      this._gpuVendor = "";
    }
  }

  private _syncDebugOverlays(): void {
    if (!this._debugEnabled) {
      this._restoreProductVisuals();
      return;
    }
    const o = this._debugOpts;
    if (o.hitbox) this._ensureHitbox();
    else this._disposeHitbox();
    if (o.partHitboxes) this._ensurePartHitboxes();
    else this._disposePartHitboxes();
    if (o.axes) this._ensureAxes();
    else this._disposeAxes();
    if (o.grid) this._ensureGrid();
    else this._disposeGrid();
    if (o.lightHelper) this._ensureLightHelper();
    else this._disposeLightHelper();
    if (o.shadowCamera) this._ensureShadowCameraHelper();
    else this._disposeShadowCameraHelper();
    if (o.lookTarget) this._ensureLookTargetHelper();
    else this._disposeLookTargetHelper();

    this._applyWireframe(o.wireframe);
    this._applyFlatShading(o.flatShading);
    this._applyEnvMap(o.envMap);
    this._applySkinPartVisibility();
    this._applySceneVisibility();
    this.lighting.setCastShadows(o.shadows);
    this.renderer.shadowMap.enabled = o.shadows;
    this.controls.enabled = !o.freezeCamera;

    if (o.forceAutoRotate) {
      if (this._savedAutoRotate === null) this._savedAutoRotate = this.controls.autoRotate;
      this.controls.autoRotate = true;
      this.controls.autoRotateSpeed = 1.2;
    } else if (this._savedAutoRotate !== null) {
      this.controls.autoRotate = this._savedAutoRotate;
      this._savedAutoRotate = null;
    }
  }

  /** Вернуть продуктовую картинку после выключения отладки */
  private _restoreProductVisuals(): void {
    this._disposeDebugOverlays();
    this._applyWireframe(false);
    this._applyFlatShading(false);
    this._applyEnvMap(true);
    this.playerObject.skin.head.visible = true;
    this.playerObject.skin.body.visible = true;
    this.playerObject.skin.leftArm.visible = true;
    this.playerObject.skin.rightArm.visible = true;
    this._applyPresentationVisibility();
    // setOuterLayerVisible(true) снова включает flat outer поверх вокселей — нельзя
    this.playerObject.skin.setOuterLayerVisible(true);
    this._outerVoxels.restoreProductVisibility();
    if (this.capeTexture) this.playerObject.cape.visible = true;
    // elytra остаётся как есть (обычно скрыта)
    if (!this._transparent) {
      this._floor.visible = true;
      this._ground.visible = true;
      this._contactShadow.visible = true;
      this._atmosphere.setVisible(true);
    }
    this.lighting.setCastShadows(true);
    this.renderer.shadowMap.enabled = true;
    this.controls.enabled = true;
    if (this._savedAutoRotate !== null) {
      this.controls.autoRotate = this._savedAutoRotate;
      this._savedAutoRotate = null;
    }
  }

  private _applySceneVisibility(): void {
    if (this._transparent) return;
    const o = this._debugOpts;
    this._floor.visible = o.floor;
    this._ground.visible = o.ground;
    this._contactShadow.visible = o.contactShadow;
    this._atmosphere.setVisible(o.atmosphere);
  }

  private _applySkinPartVisibility(): void {
    const o = this._debugOpts;
    const skin = this.playerObject.skin;
    skin.head.visible = o.head;
    skin.body.visible = o.body;
    skin.leftArm.visible = o.arms;
    skin.rightArm.visible = o.arms;
    const showLegs = o.legs && this._presentation === "full";
    skin.leftLeg.visible = showLegs;
    skin.rightLeg.visible = showLegs;
    // Сначала общий флаг skin3d, затем воксели переопределяют заменённые части
    skin.setOuterLayerVisible(o.outerLayer);
    this._outerVoxels.syncVisibility(o.outerLayer, o.outerVoxels);
    if (this.capeTexture) this.playerObject.cape.visible = o.cape;
    if (!o.elytra) this.playerObject.elytra.visible = false;
  }

  private _disposeDebugOverlays(): void {
    this._disposeHitbox();
    this._disposePartHitboxes();
    this._disposeAxes();
    this._disposeGrid();
    this._disposeLightHelper();
    this._disposeShadowCameraHelper();
    this._disposeLookTargetHelper();
  }

  private _ensureHitbox(): void {
    if (this._hitboxHelper) {
      this._hitboxHelper.update();
      return;
    }
    // PlayerObject из skin3d тянет другой @types/three — приводим к локальному Object3D
    this._hitboxHelper = new BoxHelper(this.playerObject as unknown as Object3D, 0xb0b0b4);
    this._hitboxHelper.name = "skin-debug-hitbox";
    this.scene.add(this._hitboxHelper);
  }

  private _disposeHitbox(): void {
    if (!this._hitboxHelper) return;
    this.scene.remove(this._hitboxHelper);
    this._hitboxHelper.dispose();
    this._hitboxHelper = null;
  }

  private _ensurePartHitboxes(): void {
    if (this._partHitboxHelpers.length) {
      for (const h of this._partHitboxHelpers) h.update();
      return;
    }
    const skin = this.playerObject.skin;
    const parts: Object3D[] = [
      skin.head as unknown as Object3D,
      skin.body as unknown as Object3D,
      skin.leftArm as unknown as Object3D,
      skin.rightArm as unknown as Object3D,
      skin.leftLeg as unknown as Object3D,
      skin.rightLeg as unknown as Object3D,
    ];
    const colors = [0xe06c75, 0x61afef, 0xe5c07b, 0xe5c07b, 0x98c379, 0x98c379];
    parts.forEach((part, i) => {
      const helper = new BoxHelper(part, colors[i]);
      helper.name = `skin-debug-part-hitbox-${i}`;
      this.scene.add(helper);
      this._partHitboxHelpers.push(helper);
    });
  }

  private _disposePartHitboxes(): void {
    for (const h of this._partHitboxHelpers) {
      this.scene.remove(h);
      h.dispose();
    }
    this._partHitboxHelpers = [];
  }

  private _ensureAxes(): void {
    if (this._axesHelper) return;
    this._axesHelper = new AxesHelper(28);
    this._axesHelper.name = "skin-debug-axes";
    this.playerWrapper.add(this._axesHelper);
  }

  private _disposeAxes(): void {
    if (!this._axesHelper) return;
    this.playerWrapper.remove(this._axesHelper);
    this._axesHelper.dispose();
    this._axesHelper = null;
  }

  private _ensureGrid(): void {
    if (this._gridHelper) return;
    this._gridHelper = new GridHelper(80, 16, 0x888888, 0x555555);
    this._gridHelper.name = "skin-debug-grid";
    this._gridHelper.position.y = -15.99;
    this.scene.add(this._gridHelper);
  }

  private _disposeGrid(): void {
    if (!this._gridHelper) return;
    this.scene.remove(this._gridHelper);
    this._gridHelper.dispose();
    this._gridHelper = null;
  }

  private _ensureLightHelper(): void {
    if (this._lightHelper) return;
    this._lightHelper = new DirectionalLightHelper(this.lighting.key, 12, 0xffcc66);
    this._lightHelper.name = "skin-debug-light";
    this.scene.add(this._lightHelper);
  }

  private _disposeLightHelper(): void {
    if (!this._lightHelper) return;
    this.scene.remove(this._lightHelper);
    this._lightHelper.dispose();
    this._lightHelper = null;
  }

  private _ensureShadowCameraHelper(): void {
    if (this._shadowCameraHelper) return;
    this._shadowCameraHelper = new CameraHelper(this.lighting.key.shadow.camera);
    this._shadowCameraHelper.name = "skin-debug-shadow-cam";
    this.scene.add(this._shadowCameraHelper);
  }

  private _disposeShadowCameraHelper(): void {
    if (!this._shadowCameraHelper) return;
    this.scene.remove(this._shadowCameraHelper);
    this._shadowCameraHelper.dispose();
    this._shadowCameraHelper = null;
  }

  private _ensureLookTargetHelper(): void {
    if (this._lookTargetHelper) return;
    this._lookTargetHelper = new Mesh(
      new SphereGeometry(1.2, 12, 12),
      new MeshBasicMaterial({ color: 0xff6b6b, depthTest: false }),
    );
    this._lookTargetHelper.name = "skin-debug-look-target";
    this._lookTargetHelper.renderOrder = 999;
    this._lookTargetHelper.position.copy(this.lookTarget);
    this.scene.add(this._lookTargetHelper);
  }

  private _disposeLookTargetHelper(): void {
    if (!this._lookTargetHelper) return;
    this.scene.remove(this._lookTargetHelper);
    this._lookTargetHelper.geometry.dispose();
    (this._lookTargetHelper.material as Material).dispose();
    this._lookTargetHelper = null;
  }

  private _applyWireframe(enabled: boolean): void {
    this._forEachSkinMaterial((m) => {
      if (typeof m.wireframe === "boolean") m.wireframe = enabled;
    });
  }

  private _applyFlatShading(enabled: boolean): void {
    this._forEachSkinMaterial((m) => {
      const std = m as MeshStandardMaterial;
      if ("flatShading" in std) {
        std.flatShading = enabled;
        std.needsUpdate = true;
      }
    });
  }

  private _applyEnvMap(enabled: boolean): void {
    if (enabled) {
      tuneSkinMaterials(this.playerObject.skin, this._envMap, this.skinTexture);
      return;
    }
    this._forEachSkinMaterial((m) => {
      const std = m as MeshStandardMaterial;
      if ("envMapIntensity" in std) std.envMapIntensity = 0;
    });
  }

  private _forEachSkinMaterial(fn: (m: Material & { wireframe?: boolean }) => void): void {
    this.playerObject.skin.traverse((obj) => {
      const mesh = obj as unknown as Mesh;
      if (!mesh.isMesh) return;
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const mat of mats) {
        if (mat) fn(mat as Material & { wireframe?: boolean });
      }
    });
  }

  /**
   * Основной вьювер — composer (bloom + SMAA).
   * Transparent/превью — прямой рендер.
   */
  private _renderFrame(): void {
    // postFx из _debugOpts учитывается всегда — иначе в браузере
    // нельзя отключить сломанный composer без включения панели отладки.
    const usePost =
      !!this._postFx && !this._transparent && !!this._debugOpts.postFx;
    if (usePost) {
      this._postFx!.render();
      return;
    }
    this.renderer.render(this.scene, this.camera);
  }

  /** Пыль у пола при толчке */
  private _syncIdleFx(_deltaTime: number): void {
    if (!this._enableEffects) return;
    if (this._debugEnabled && !this._debugOpts.particles) return;
    if (!(this._animation instanceof HeroIdleAnimation)) return;
    if (this._animation.consumeNudgeImpact()) {
      feetWorldPosition(this.playerObject, this._feetWorld);
      this._particles.spawnDust(this._feetWorld, 22);
    }
  }

  private _playDressEffect(): void {
    if (!this._enableEffects) return;
    if (this._debugEnabled && !this._debugOpts.particles) return;
    this._dressElapsed = 0;
    bodyWorldPosition(this.playerObject, this._feetWorld);
    // Одна вспышка при смене скина (без второго mid-burst)
    this._particles.spawnSparkles(this._feetWorld, 24);
  }

  private _updateDressEffect(deltaTime: number): void {
    if (this._dressElapsed < 0) return;
    this._dressElapsed += deltaTime;
    const u = this._dressElapsed / SkinViewEngine.DRESS_DURATION;
    if (u >= 1) {
      this._dressElapsed = -1;
      this.playerWrapper.rotation.y = 0;
      this._setSkinEmissive(0);
      this._postFx?.setBloomBoost(0);
      return;
    }

    // Плавный оборот + одна emissive-вспышка в начале
    this.playerWrapper.rotation.y = easeOutCubic(Math.min(1, u / 0.85)) * Math.PI * 2;
    const flash = u < 0.35 ? Math.sin((u / 0.35) * Math.PI) : 0;
    this._setSkinEmissive(flash * 2.8);
    this._postFx?.setBloomBoost(flash);
  }

  private _setSkinEmissive(intensity: number): void {
    this.playerObject.skin.traverse((obj: Object3D) => {
      const mesh = obj as Mesh;
      if (!mesh.isMesh) return;
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const mat of mats) {
        if (mat instanceof MeshStandardMaterial) {
          mat.emissive.setRGB(intensity, intensity * 0.95, intensity * 0.8);
          mat.emissiveIntensity = intensity > 0 ? 1 : 0;
        }
      }
    });
  }

  /** Размер viewport (CSS-пиксели); при autoResize вызывается автоматически */
  setSize(width: number, height: number): void {
    const safeWidth = Math.max(1, Math.floor(width));
    const safeHeight = Math.max(1, Math.floor(height));

    this.camera.aspect = safeWidth / safeHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(safeWidth, safeHeight, false);
    this._postFx?.setSize(safeWidth, safeHeight);
  }

  /** Дистанция камеры — формула skin3d adjustCameraDistance */
  private computeCameraDistance(): number {
    let distance =
      4.5 +
      16.5 / Math.tan(((this._fov / 180) * Math.PI) / 2) / this._zoom;
    return Math.max(10, Math.min(distance, 256));
  }

  /** Дистанция по умолчанию: явная из DEFAULT_CAMERA_SETTINGS или формула skin3d */
  private getDefaultCameraDistance(): number {
    if (DEFAULT_CAMERA_SETTINGS.distance > 0) {
      return DEFAULT_CAMERA_SETTINGS.distance;
    }
    return this.computeCameraDistance();
  }

  /** Трёхчетвертный product shot: сверху-спереди-слева */
  resetCameraPose(): void {
    this.applyCameraDistance(this.getDefaultCameraDistance(), true);
  }

  /** Перемещение камеры на заданную дистанцию от look-at */
  private applyCameraDistance(distance: number, useDefaultDirection = false): void {
    if (useDefaultDirection) {
      const direction = new Vector3(-0.58, 0.26, 0.78).normalize();
      this.camera.position.copy(this.lookTarget).addScaledVector(direction, distance);
    } else {
      const offset = this.camera.position.clone().sub(this.controls.target);
      if (offset.lengthSq() < 1e-6) {
        offset.set(-0.58, 0.26, 0.78).normalize();
      } else {
        offset.normalize();
      }
      this.camera.position.copy(this.controls.target).addScaledVector(offset, distance);
    }
    this.camera.lookAt(this.lookTarget);
    this.controls.target.copy(this.lookTarget);
    this.controls.update();
  }

  private _setupAltPan(canvas: HTMLCanvasElement): void {
    const restoreRotate = (): void => {
      this.controls.mouseButtons.LEFT = MOUSE.ROTATE;
    };
    canvas.addEventListener("pointerdown", (e) => {
      if (e.altKey) this.controls.mouseButtons.LEFT = MOUSE.PAN;
    });
    canvas.addEventListener("pointerup", restoreRotate);
    canvas.addEventListener("pointerleave", restoreRotate);
  }

  /**
   * Idle: короткий клик по модели = толчок.
   * Drag камеры не считается кликом.
   */
  private _setupPlayerNudge(canvas: HTMLCanvasElement): void {
    const CLICK_PX = 8;

    const onDown = (e: PointerEvent): void => {
      if (e.button !== 0 || this._disposed) return;
      if (!(this._animation instanceof HeroIdleAnimation)) return;
      this._nudgePointerId = e.pointerId;
      this._nudgePointerX = e.clientX;
      this._nudgePointerY = e.clientY;
      this._nudgePointerHit = this._hitPlayerAt(e.clientX, e.clientY);
    };

    const onUp = (e: PointerEvent): void => {
      if (this._nudgePointerId !== e.pointerId) return;
      const hit = this._nudgePointerHit;
      const dx = e.clientX - this._nudgePointerX;
      const dy = e.clientY - this._nudgePointerY;
      this._nudgePointerId = null;
      this._nudgePointerHit = false;
      if (!hit || this._disposed) return;
      if (dx * dx + dy * dy > CLICK_PX * CLICK_PX) return;
      this.nudge();
    };

    const onCancel = (e: PointerEvent): void => {
      if (this._nudgePointerId === e.pointerId) {
        this._nudgePointerId = null;
        this._nudgePointerHit = false;
      }
    };

    canvas.addEventListener("pointerdown", onDown);
    canvas.addEventListener("pointerup", onUp);
    canvas.addEventListener("pointercancel", onCancel);
    this._nudgeUnbind = () => {
      canvas.removeEventListener("pointerdown", onDown);
      canvas.removeEventListener("pointerup", onUp);
      canvas.removeEventListener("pointercancel", onCancel);
    };
  }

  /** Попадание луча в меши персонажа */
  private _hitPlayerAt(clientX: number, clientY: number): boolean {
    const rect = this.canvas.getBoundingClientRect();
    if (rect.width < 2 || rect.height < 2) return false;
    this._pointerNdc.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    this._pointerNdc.y = -(((clientY - rect.top) / rect.height) * 2 - 1);
    this._raycaster.setFromCamera(this._pointerNdc, this.camera);
    return this._raycaster.intersectObject(this.playerWrapper, true).length > 0;
  }

  private _setupAutoResize(canvas: HTMLCanvasElement): void {
    const applySize = (): void => {
      const width = canvas.clientWidth || 300;
      const height = canvas.clientHeight || 400;
      this.setSize(width, height);
    };

    applySize();
    this._resizeObserver = new ResizeObserver(applySize);
    this._resizeObserver.observe(canvas);
  }
}
