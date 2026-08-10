// ===== Публичный API Mine3D Embedded =====
// Three.js-обёртка над skin3d PlayerObject для рендера Minecraft-скинов

export {
  SkinViewEngine,
  DEFAULT_CAMERA_SETTINGS,
  ENGINE_VERSION,
  ENGINE_DISPLAY_NAME,
} from "./core/scene-loop";
export { DEFAULT_LIGHT_SETTINGS, ProductLighting } from "./core/product-visuals";
export {
  computeVisibleBounds,
  fitObjectToFrame,
  measureObjectFrame,
  type FrameFitOptions,
  type FrameFitResult,
  type FrameMeasure,
  type NdcBox,
} from "./core/camera-framing";
export {
  HeroIdleAnimation,
  TrailerRunAnimation,
  BustPoseAnimation,
  WaveHelloAnimation,
  SneakAnimation,
  LookAroundAnimation,
  CoolPoseAnimation,
  GlideAnimation,
  VictoryAnimation,
  SadAnimation,
  DanceAnimation,
  createSkinAnimation,
  animationControlsLegs,
  resetPlayerRootPose,
  type SkinAnimation,
  type SkinAnimId,
  type ShotPresetId,
} from "./core/skin-animations";
export {
  SkinModelType,
  DEFAULT_SKIN_DEBUG_OPTIONS,
  type EngineOptions,
  type SkinSource,
  type CameraSettings,
  type LightSettings,
  type PresentationMode,
  type SkinDebugStats,
  type SkinDebugOptions,
} from "./types";

// Анимации skin3d (idle, walk и др.) — совместимы с PlayerObject
export {
  IdleAnimation,
  WalkingAnimation as WalkAnimation,
  RunningAnimation,
  PlayerAnimation,
} from "skin3d";
