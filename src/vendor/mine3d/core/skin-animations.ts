// Кастомные анимации в духе трейлеров Mojang + бленд поз для переключения.
// Свой базовый класс — без импорта PlayerAnimation из skin3d (конфликт @types/three).

/** Минимальный контракт анимации */
export interface SkinAnimation {
  speed: number;
  paused: boolean;
  progress: number;
  /** Анимация сама крутит ноги (иначе движок держит stock-позу) */
  readonly controlsLegs?: boolean;
  update(player: any, deltaTime: number): void;
}

/** Снимок углов частей тела для кроссфейда */
export interface PoseSnapshot {
  root: { x: number; y: number; z: number; rx: number; ry: number; rz: number };
  head: { x: number; y: number; z: number };
  body: { x: number; y: number; z: number };
  leftArm: { x: number; y: number; z: number };
  rightArm: { x: number; y: number; z: number };
  leftLeg: { x: number; y: number; z: number };
  rightLeg: { x: number; y: number; z: number };
  cape: { x: number; y: number; z: number };
}

const PARTS = [
  "head",
  "body",
  "leftArm",
  "rightArm",
  "leftLeg",
  "rightLeg",
] as const;

function readRot(obj: any): { x: number; y: number; z: number } {
  return { x: obj.rotation.x, y: obj.rotation.y, z: obj.rotation.z };
}

function writeRot(obj: any, r: { x: number; y: number; z: number }): void {
  obj.rotation.x = r.x;
  obj.rotation.y = r.y;
  obj.rotation.z = r.z;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function lerpRot(
  a: { x: number; y: number; z: number },
  b: { x: number; y: number; z: number },
  t: number,
): { x: number; y: number; z: number } {
  return { x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t), z: lerp(a.z, b.z, t) };
}

/** Быстрый ease для короткого кроссфейда */
export function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

/** «Ударная» кривая шага — как в трейлерном спринте */
function punch(x: number): number {
  return Math.sin(x) * Math.abs(Math.sin(x));
}

export function capturePose(player: any): PoseSnapshot {
  return {
    root: {
      x: player.position.x,
      y: player.position.y,
      z: player.position.z,
      rx: player.rotation.x,
      ry: player.rotation.y,
      rz: player.rotation.z,
    },
    head: readRot(player.skin.head),
    body: readRot(player.skin.body),
    leftArm: readRot(player.skin.leftArm),
    rightArm: readRot(player.skin.rightArm),
    leftLeg: readRot(player.skin.leftLeg),
    rightLeg: readRot(player.skin.rightLeg),
    cape: readRot(player.cape),
  };
}

export function applyPose(player: any, pose: PoseSnapshot): void {
  player.position.set(pose.root.x, pose.root.y, pose.root.z);
  player.rotation.x = pose.root.rx;
  player.rotation.y = pose.root.ry;
  player.rotation.z = pose.root.rz;
  writeRot(player.skin.head, pose.head);
  writeRot(player.skin.body, pose.body);
  writeRot(player.skin.leftArm, pose.leftArm);
  writeRot(player.skin.rightArm, pose.rightArm);
  writeRot(player.skin.leftLeg, pose.leftLeg);
  writeRot(player.skin.rightLeg, pose.rightLeg);
  writeRot(player.cape, pose.cape);
}

export function blendPoses(player: any, from: PoseSnapshot, to: PoseSnapshot, t: number): void {
  const k = easeOutCubic(Math.max(0, Math.min(1, t)));
  player.position.set(
    lerp(from.root.x, to.root.x, k),
    lerp(from.root.y, to.root.y, k),
    lerp(from.root.z, to.root.z, k),
  );
  player.rotation.x = lerp(from.root.rx, to.root.rx, k);
  player.rotation.y = lerp(from.root.ry, to.root.ry, k);
  player.rotation.z = lerp(from.root.rz, to.root.rz, k);
  writeRot(player.skin.head, lerpRot(from.head, to.head, k));
  writeRot(player.skin.body, lerpRot(from.body, to.body, k));
  writeRot(player.skin.leftArm, lerpRot(from.leftArm, to.leftArm, k));
  writeRot(player.skin.rightArm, lerpRot(from.rightArm, to.rightArm, k));
  writeRot(player.skin.leftLeg, lerpRot(from.leftLeg, to.leftLeg, k));
  writeRot(player.skin.rightLeg, lerpRot(from.rightLeg, to.rightLeg, k));
  writeRot(player.cape, lerpRot(from.cape, to.cape, k));
}

/** Yaw плаща в skin3d — без него текстура «задом наперёд» */
const CAPE_YAW = Math.PI;
/** Угол покоя плаща (CapeDefaultAngle из skin3d) */
const CAPE_REST_X = (10.8 * Math.PI) / 180;

export function resetLimbPose(player: any): void {
  player.position.set(0, 0, 0);
  player.rotation.x = 0;
  player.rotation.z = 0;
  for (const name of PARTS) {
    player.skin[name].rotation.set(0, 0, 0);
  }
  // Сохраняем yaw π — иначе плащ смотрит не туда и «15» зеркалится
  player.cape.rotation.set(CAPE_REST_X, CAPE_YAW, 0);
}

abstract class BaseSkinAnimation implements SkinAnimation {
  speed = 1;
  paused = false;
  progress = 0;
  readonly controlsLegs: boolean = false;

  update(player: any, deltaTime: number): void {
    if (this.paused) return;
    const delta = deltaTime * this.speed;
    this.animate(player, delta);
    this.progress += delta;
  }

  protected abstract animate(player: any, delta: number): void;
}

export function animationControlsLegs(animation: SkinAnimation | null): boolean {
  return Boolean(animation?.controlsLegs);
}

/**
 * Trailer idle — «живой» герой: дыхание, slim/classic осанка, толчок по клику.
 */
const NUDGE_RAMP_IN = 0.2;
const NUDGE_HOLD_UNTIL = 0.34;
const NUDGE_LOOK_RELEASE = 0.68;

export class HeroIdleAnimation extends BaseSkinAnimation {
  override readonly controlsLegs = true;
  /**
   * Движок включает при взгляде за курсором: анимация не крутит голову,
   * иначе взгляд и idle-look конфликтуют и выглядят криво.
   */
  suppressAutoLook = false;
  /** Тонкая модель — чуть другая осанка */
  modelSlim = false;

  private _nudgeElapsed = -1;
  private _nudgeImpactPending = false;

  private static readonly NUDGE_DURATION = 1.6;

  nudge(): boolean {
    if (this.isNudging) return false;
    this._nudgeElapsed = 0;
    this._nudgeImpactPending = true;
    return true;
  }

  get isNudging(): boolean {
    return this._nudgeElapsed >= 0;
  }

  /** Блокирует взгляд курсором во время толчка */
  get blocksCursorLook(): boolean {
    return this.isNudging && this._nudgeElapsed < HeroIdleAnimation.NUDGE_DURATION * NUDGE_LOOK_RELEASE;
  }

  consumeNudgeImpact(): boolean {
    const v = this._nudgeImpactPending;
    this._nudgeImpactPending = false;
    return v;
  }

  protected animate(player: any, delta: number): void {
    const t = this.progress;
    const breathe = Math.sin(t * 1.35);
    const wind = Math.sin(t * 2.1) * 0.5 + Math.sin(t * 3.4) * 0.5;
    const weight = 0.55 + Math.sin(t * 0.35) * 0.45;
    const slim = this.modelSlim ? 1 : 0;

    // Спокойная стойка: лёгкое дыхание, руки у тела (не «распахнуты»)
    player.skin.body.rotation.x = 0.02 + breathe * 0.025 - slim * 0.01;
    player.skin.body.rotation.z = (weight - 0.5) * (0.04 + slim * 0.02);

    const busyHead = this.blocksCursorLook;
    if (this.suppressAutoLook && !busyHead) {
      player.skin.body.rotation.y = -0.04 + slim * 0.02;
      player.skin.head.rotation.set(-0.03, 0, 0);
    } else {
      const lookRaw = Math.sin(t * 0.55);
      const look = lookRaw * lookRaw * lookRaw;
      player.skin.body.rotation.y = -0.06 + look * 0.06 + slim * 0.02;
      player.skin.head.rotation.y = look * 0.4;
      player.skin.head.rotation.x = -0.04 + Math.sin(t * 0.8) * 0.05;
      player.skin.head.rotation.z = look * 0.03 + slim * 0.02;
    }

    // Руки почти вдоль тела; z ≈ ±0.06 — естественный зазор, не разведение
    player.skin.leftArm.rotation.x = -0.05 + breathe * 0.035 + slim * 0.02;
    player.skin.leftArm.rotation.z = 0.06 + wind * 0.015 - slim * 0.015;
    player.skin.rightArm.rotation.x = -0.03 + Math.sin(t * 0.9 + 1.2) * 0.04;
    player.skin.rightArm.rotation.z = -0.06 - weight * 0.02 + slim * 0.015;

    // Ноги почти параллельно — ощущение «стоит», а не контрапоста
    player.skin.leftLeg.rotation.x = -0.03 * weight;
    player.skin.rightLeg.rotation.x = 0.04 * weight + slim * 0.02;
    player.skin.leftLeg.rotation.z = 0.015;
    player.skin.rightLeg.rotation.z = -0.015;

    player.cape.rotation.x = Math.PI * 0.1 + wind * 0.06 + breathe * 0.02;

    if (this._nudgeElapsed >= 0) {
      this._nudgeElapsed += delta;
      const u = this._nudgeElapsed / HeroIdleAnimation.NUDGE_DURATION;
      if (u >= 1) this._nudgeElapsed = -1;
      else this._applyNudgeOverlay(player, u);
    }
  }

  private _applyNudgeOverlay(player: any, u: number): void {
    let push: number;
    if (u < NUDGE_RAMP_IN) {
      const x = u / NUDGE_RAMP_IN;
      push = x * x * (3 - 2 * x);
    } else if (u < NUDGE_HOLD_UNTIL) {
      push = 1;
    } else {
      const x = (u - NUDGE_HOLD_UNTIL) / (1 - NUDGE_HOLD_UNTIL);
      push = 1 - x * x * (3 - 2 * x);
    }

    const shakeEnv = push * (u < 0.55 ? 1 : Math.max(0, 1 - (u - 0.55) / 0.3));
    const shake = Math.sin(u * Math.PI * 11) * shakeEnv;

    player.position.z -= 1.55 * push;
    player.position.y += 0.2 * push;
    player.rotation.x -= 0.32 * push;
    player.rotation.z += shake * 0.05;

    player.skin.body.rotation.x -= 0.18 * push;
    player.skin.body.rotation.z += shake * 0.04;
    player.skin.head.rotation.y += shake * 0.42;
    player.skin.head.rotation.z += shake * 0.22;
    player.skin.head.rotation.x -= 0.1 * push + Math.abs(shake) * 0.06;

    player.skin.leftArm.rotation.x -= 0.55 * push;
    player.skin.rightArm.rotation.x -= 0.5 * push;
    player.skin.leftArm.rotation.z += 0.35 * push;
    player.skin.rightArm.rotation.z -= 0.35 * push;
    player.skin.leftLeg.rotation.x -= 0.18 * push;
    player.skin.rightLeg.rotation.x += 0.22 * push;
    player.cape.rotation.x += 0.12 * push;
  }
}

/**
 * Trailer sprint — широкий шаг, сильный наклон, плащ парусом,
 * противоположный мах рук; темп чуть выше среднего игрового спринта.
 */
export class TrailerRunAnimation extends BaseSkinAnimation {
  override readonly controlsLegs = true;

  protected animate(player: any): void {
    const t = this.progress * 9.6;
    const stride = Math.sin(t);
    const strideOpp = Math.sin(t + Math.PI);
    const plant = punch(t);
    const plantOpp = punch(t + Math.PI);
    const bob = Math.abs(Math.sin(t));

    player.rotation.x = 0.26;
    player.rotation.z = stride * 0.035;
    player.position.y = bob * 0.55;
    player.position.x = stride * 0.08;

    player.skin.body.rotation.x = 0.12;
    player.skin.body.rotation.y = stride * 0.12;
    player.skin.body.rotation.z = stride * 0.04;

    player.skin.head.rotation.x = -0.18;
    player.skin.head.rotation.y = stride * 0.07;
    player.skin.head.rotation.z = -stride * 0.03;

    // Ноги — широкий театральный шаг
    player.skin.leftLeg.rotation.x = strideOpp * 1.15;
    player.skin.rightLeg.rotation.x = stride * 1.15;
    player.skin.leftLeg.rotation.z = plantOpp * 0.06;
    player.skin.rightLeg.rotation.z = -plant * 0.06;

    // Руки — противоположный мах с раскрытием в стороны
    player.skin.leftArm.rotation.x = stride * 1.25;
    player.skin.rightArm.rotation.x = strideOpp * 1.25;
    player.skin.leftArm.rotation.z = 0.22 + Math.abs(stride) * 0.12;
    player.skin.rightArm.rotation.z = -0.22 - Math.abs(strideOpp) * 0.12;

    player.cape.rotation.x = Math.PI * 0.42 + bob * 0.14;
  }
}

/** Приветствие — мягкое и милое: лёгкий подскок, наклон головы, ласковый мах */
export class WaveHelloAnimation extends BaseSkinAnimation {
  override readonly controlsLegs = true;

  protected animate(player: any): void {
    const t = this.progress * 5.0;
    const wave = Math.sin(t);
    // Мягкий «радостный» подскок в такт маху
    const bounce = 0.5 - 0.5 * Math.cos(t);

    player.position.y = bounce * 0.35;
    player.rotation.z = wave * 0.025;

    // Голова чуть набок и к камере — «привет!»
    player.skin.head.rotation.x = -0.1 + bounce * 0.03;
    player.skin.head.rotation.y = 0.22 + wave * 0.08;
    player.skin.head.rotation.z = 0.16 + wave * 0.06;

    player.skin.body.rotation.x = 0.05;
    player.skin.body.rotation.y = 0.12;
    player.skin.body.rotation.z = -0.05 + wave * 0.03;

    // Рука поднята не до предела и мягко качается — без «сломанного» плеча
    player.skin.rightArm.rotation.x = -0.2 + wave * 0.12;
    player.skin.rightArm.rotation.y = 0.2;
    player.skin.rightArm.rotation.z = -Math.PI * 0.58 + wave * 0.32;

    // Вторая рука чуть прижата, тоже чуть оживает
    player.skin.leftArm.rotation.x = -0.22;
    player.skin.leftArm.rotation.y = 0;
    player.skin.leftArm.rotation.z = 0.18 + bounce * 0.05;

    // Вес на одну ногу — милая стойка
    player.skin.leftLeg.rotation.set(-0.08, 0, 0.04);
    player.skin.rightLeg.rotation.set(0.12, 0, -0.05);
    player.cape.rotation.x = Math.PI * 0.09 + bounce * 0.03;
  }
}

/** Красться — низкий шаг, взгляд строго вперёд по направлению движения */
export class SneakAnimation extends BaseSkinAnimation {
  override readonly controlsLegs = true;

  protected animate(player: any): void {
    const t = this.progress * 3.8;
    const stride = Math.sin(t);
    const tense = 0.5 + Math.sin(t * 2.2) * 0.5;

    player.position.y = -1.5;
    // Наклон вперёд как у бега — смотрит туда же, куда идёт
    player.rotation.x = 0.2;

    player.skin.body.rotation.x = 0.16;
    player.skin.body.rotation.y = stride * 0.05;
    player.skin.body.rotation.z = 0;

    // Голова вперёд/чуть вниз на путь — без поворотов «назад»
    player.skin.head.rotation.x = -0.1;
    player.skin.head.rotation.y = Math.sin(t * 0.45) * 0.06;
    player.skin.head.rotation.z = 0;

    player.skin.leftLeg.rotation.x = stride * 0.5;
    player.skin.rightLeg.rotation.x = -stride * 0.5;
    player.skin.leftArm.rotation.x = -stride * 0.4 - 0.28;
    player.skin.rightArm.rotation.x = stride * 0.4 - 0.28;
    player.skin.leftArm.rotation.z = 0.18 + tense * 0.05;
    player.skin.rightArm.rotation.z = -0.18 - tense * 0.05;

    player.cape.rotation.x = Math.PI * 0.2;
  }
}

/** Обзор — резкие взгляды по сторонам с «паузами» на краях */
export class LookAroundAnimation extends BaseSkinAnimation {
  override readonly controlsLegs = true;

  protected animate(player: any): void {
    const t = this.progress * 0.85;
    const lookRaw = Math.sin(t);
    const look = lookRaw * Math.abs(lookRaw) * Math.abs(lookRaw);
    const peek = Math.sin(t * 2.4);

    player.skin.head.rotation.y = look * 0.95;
    player.skin.head.rotation.x = -0.08 + peek * 0.1;
    player.skin.head.rotation.z = look * 0.06;
    player.skin.body.rotation.y = look * 0.28;
    player.skin.body.rotation.z = -look * 0.04;

    player.skin.leftArm.rotation.x = -0.2 - Math.abs(look) * 0.1;
    player.skin.rightArm.rotation.x = -0.15 - Math.abs(look) * 0.08;
    player.skin.leftArm.rotation.z = 0.14 + Math.abs(look) * 0.08;
    player.skin.rightArm.rotation.z = -0.14 - Math.abs(look) * 0.08;

    player.skin.leftLeg.rotation.x = -0.06;
    player.skin.rightLeg.rotation.x = 0.1;
    player.cape.rotation.x = Math.PI * 0.1 + Math.abs(look) * 0.03;
  }
}

/** Крутая стойка — вес на бедре, рука на груди, взгляд в камеру */
export class CoolPoseAnimation extends BaseSkinAnimation {
  override readonly controlsLegs = true;

  protected animate(player: any): void {
    const t = this.progress;
    const breathe = Math.sin(t * 1.25);

    player.skin.body.rotation.y = -0.32;
    player.skin.body.rotation.z = 0.08;
    player.skin.body.rotation.x = 0.05 + breathe * 0.02;

    player.skin.head.rotation.y = 0.48;
    player.skin.head.rotation.x = -0.12 + breathe * 0.025;
    player.skin.head.rotation.z = 0.05;

    player.skin.leftArm.rotation.x = -1.05;
    player.skin.leftArm.rotation.z = 0.42;
    player.skin.leftArm.rotation.y = 0.25;
    player.skin.rightArm.rotation.x = -0.55;
    player.skin.rightArm.rotation.z = -0.55;
    player.skin.rightArm.rotation.y = -0.15;

    player.skin.leftLeg.rotation.x = -0.05;
    player.skin.rightLeg.rotation.x = 0.18;
    player.skin.rightLeg.rotation.z = -0.08;

    player.cape.rotation.x = Math.PI * 0.14 + breathe * 0.03;
  }
}

/** Победа — руки вверх, подскоки */
export class VictoryAnimation extends BaseSkinAnimation {
  override readonly controlsLegs = true;

  protected animate(player: any): void {
    const t = this.progress * 6.2;
    const bounce = 0.5 - 0.5 * Math.cos(t);
    const sway = Math.sin(t);

    player.position.y = bounce * 1.1;
    player.rotation.z = sway * 0.04;

    player.skin.head.rotation.x = -0.15 + bounce * 0.05;
    player.skin.head.rotation.y = sway * 0.1;
    player.skin.body.rotation.x = -0.06;
    player.skin.body.rotation.y = sway * 0.06;

    player.skin.leftArm.rotation.z = 2.35 + sway * 0.12;
    player.skin.rightArm.rotation.z = -2.35 - sway * 0.12;
    player.skin.leftArm.rotation.x = -0.15 + bounce * 0.1;
    player.skin.rightArm.rotation.x = -0.15 + bounce * 0.1;

    player.skin.leftLeg.rotation.x = -0.15 * bounce;
    player.skin.rightLeg.rotation.x = 0.2 * bounce;
    player.cape.rotation.x = Math.PI * 0.12 + bounce * 0.08;
  }
}

/** Грусть — плечи опущены, взгляд в пол */
export class SadAnimation extends BaseSkinAnimation {
  override readonly controlsLegs = true;

  protected animate(player: any): void {
    const t = this.progress;
    const sigh = Math.sin(t * 1.1);

    player.skin.head.rotation.x = 0.42 + sigh * 0.04;
    player.skin.head.rotation.y = -0.12;
    player.skin.head.rotation.z = -0.08;
    player.skin.body.rotation.x = 0.18;
    player.skin.body.rotation.z = -0.04;
    player.skin.body.rotation.y = 0.06;

    player.skin.leftArm.rotation.x = 0.15;
    player.skin.rightArm.rotation.x = 0.2;
    player.skin.leftArm.rotation.z = 0.08;
    player.skin.rightArm.rotation.z = -0.06;
    player.skin.leftArm.rotation.y = 0.05;
    player.skin.rightArm.rotation.y = -0.05;

    player.skin.leftLeg.rotation.x = -0.05;
    player.skin.rightLeg.rotation.x = 0.08;
    player.cape.rotation.x = Math.PI * 0.06 + sigh * 0.015;
  }
}

/** Танец — ритмичные шаги и мах руками */
export class DanceAnimation extends BaseSkinAnimation {
  override readonly controlsLegs = true;

  protected animate(player: any): void {
    const t = this.progress * 7.4;
    const beat = Math.sin(t);
    const beatOpp = Math.sin(t + Math.PI);
    const bob = Math.abs(Math.sin(t * 2));

    player.position.y = bob * 0.65;
    player.rotation.z = beat * 0.08;
    player.skin.body.rotation.y = beat * 0.28;
    player.skin.body.rotation.z = beat * 0.06;
    player.skin.body.rotation.x = 0.06;

    player.skin.head.rotation.y = beat * 0.2;
    player.skin.head.rotation.z = -beat * 0.08;
    player.skin.head.rotation.x = -0.08 + bob * 0.05;

    player.skin.leftArm.rotation.x = beatOpp * 0.9;
    player.skin.rightArm.rotation.x = beat * 0.9;
    player.skin.leftArm.rotation.z = 0.55 + bob * 0.25;
    player.skin.rightArm.rotation.z = -0.55 - bob * 0.25;

    player.skin.leftLeg.rotation.x = beat * 0.55;
    player.skin.rightLeg.rotation.x = beatOpp * 0.55;
    player.skin.leftLeg.rotation.z = 0.06;
    player.skin.rightLeg.rotation.z = -0.06;
    player.cape.rotation.x = Math.PI * 0.16 + bob * 0.1;
  }
}

/** Парение — пикирующий «cinema»-ракурс из трейлеров с elytra */
export class GlideAnimation extends BaseSkinAnimation {
  override readonly controlsLegs = true;

  protected animate(player: any): void {
    const t = this.progress;
    const bob = Math.sin(t * 1.7);
    const bank = Math.sin(t * 0.9);

    player.rotation.x = -0.72;
    player.rotation.z = bank * 0.12;
    player.position.y = 1.6 + bob * 0.4;

    player.skin.head.rotation.x = 0.45;
    player.skin.head.rotation.y = bank * 0.1;
    player.skin.body.rotation.x = 0.08;

    player.skin.leftArm.rotation.z = 0.95 + bob * 0.06;
    player.skin.rightArm.rotation.z = -0.95 - bob * 0.06;
    player.skin.leftArm.rotation.x = -0.45;
    player.skin.rightArm.rotation.x = -0.45;
    player.skin.leftArm.rotation.y = 0.2;
    player.skin.rightArm.rotation.y = -0.2;

    player.skin.leftLeg.rotation.x = 0.35 + bob * 0.05;
    player.skin.rightLeg.rotation.x = 0.2 - bob * 0.05;
    player.skin.leftLeg.rotation.z = 0.08;
    player.skin.rightLeg.rotation.z = -0.08;

    player.cape.rotation.x = Math.PI * 0.72 + bob * 0.08;
  }
}

/** Погрудные позы для карточек — постеровый вайб */
export class BustPoseAnimation extends BaseSkinAnimation {
  constructor(private readonly variant = 0) {
    super();
  }

  protected animate(player: any): void {
    const t = this.progress;
    const breathe = Math.sin(t * 1.4) * 0.02;
    const v = this.variant % 4;

    player.position.y = 0;
    player.rotation.z = v === 2 ? -0.06 : 0.04;

    if (v === 0) {
      player.skin.head.rotation.y = 0.45;
      player.skin.head.rotation.x = -0.1 + breathe;
      player.skin.body.rotation.y = -0.22;
      player.skin.leftArm.rotation.x = -0.65;
      player.skin.leftArm.rotation.z = 0.78;
      player.skin.rightArm.rotation.x = 0.05;
      player.skin.rightArm.rotation.z = -0.42;
    } else if (v === 1) {
      player.skin.head.rotation.y = -0.3;
      player.skin.head.rotation.x = -0.06 + breathe;
      player.skin.body.rotation.y = 0.18;
      player.skin.leftArm.rotation.x = -1.05;
      player.skin.leftArm.rotation.z = 0.28;
      player.skin.rightArm.rotation.x = -1.1;
      player.skin.rightArm.rotation.z = -0.18;
    } else if (v === 2) {
      player.skin.head.rotation.y = 0.95;
      player.skin.head.rotation.x = -0.12 + breathe;
      player.skin.body.rotation.y = 0.52;
      player.skin.leftArm.rotation.x = -0.25;
      player.skin.leftArm.rotation.z = 0.5;
      player.skin.rightArm.rotation.x = -0.45;
      player.skin.rightArm.rotation.z = -0.65;
    } else {
      player.skin.head.rotation.y = -0.18;
      player.skin.head.rotation.x = 0.06 + breathe;
      player.skin.body.rotation.y = -0.12;
      player.skin.leftArm.rotation.x = -0.2;
      player.skin.leftArm.rotation.z = 0.22;
      player.skin.rightArm.rotation.x = -1.45;
      player.skin.rightArm.rotation.z = -0.4;
    }

    player.cape.rotation.x = Math.PI * 0.16 + breathe;
  }
}

export function resetPlayerRootPose(player: any): void {
  player.position.set(0, 0, 0);
  player.rotation.x = 0;
  player.rotation.z = 0;
}

export type SkinAnimId =
  | "idle"
  | "run"
  | "wave"
  | "sneak"
  | "look"
  | "cool"
  | "glide"
  | "victory"
  | "sad"
  | "dance";

/** Пресеты кадра под скриншот */
export type ShotPresetId = "hero" | "bust" | "back" | "discord";

export function createSkinAnimation(id: SkinAnimId): SkinAnimation {
  switch (id) {
    case "run":
      return new TrailerRunAnimation();
    case "wave":
      return new WaveHelloAnimation();
    case "sneak":
      return new SneakAnimation();
    case "look":
      return new LookAroundAnimation();
    case "cool":
      return new CoolPoseAnimation();
    case "glide":
      return new GlideAnimation();
    case "victory":
      return new VictoryAnimation();
    case "sad":
      return new SadAnimation();
    case "dance":
      return new DanceAnimation();
    case "idle":
    default:
      return new HeroIdleAnimation();
  }
}
