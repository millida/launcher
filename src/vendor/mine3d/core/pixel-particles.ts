// Пыль у пола + аура смены скина + мягкие спрайт-светлячки (без плоских «боксов»)
import {
  AdditiveBlending,
  BoxGeometry,
  CanvasTexture,
  Color,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  Sprite,
  SpriteMaterial,
  Vector3,
  type Material,
  type Object3D,
} from "three";
import { FLOOR_Y } from "./product-visuals";

type FxKind = "dust" | "firefly" | "pulse" | "mote";

interface Particle {
  obj: Object3D;
  material: Material & { opacity: number; dispose: () => void };
  vx: number;
  vy: number;
  vz: number;
  life: number;
  maxLife: number;
  startSize: number;
  endSize: number;
  drag: number;
  maxOpacity: number;
  twinkle: number;
  kind: FxKind;
}

const MOTE_COLORS = [0xffffff, 0xe8eef8, 0xfff4e0, 0xd8e4ff];
const AMBIENT_MOTE_TARGET = 12;

const DUST_GEO = new BoxGeometry(1, 1, 1);
const GLOW_GEO = new PlaneGeometry(1, 1);
const DUST_COLORS = [0x9a9284, 0xc4b498, 0x7a7468, 0xd2c4a8, 0xb0a898, 0xe8dcc8];

/** Общая мягкая текстура для Sprite — не dispose на каждую частицу */
const SOFT_GLOW_MAP = createSoftGlowTexture();

/** Пиксельная пыль / аура смены скина */
export class PixelParticles {
  readonly group = new Group();
  private readonly _pool: Particle[] = [];

  /** Дым пыли от удара о пол */
  spawnDust(origin: Vector3, count = 48): void {
    for (let i = 0; i < count; i++) {
      const color = DUST_COLORS[(Math.random() * DUST_COLORS.length) | 0]!;
      const mat = new MeshBasicMaterial({
        color: new Color(color),
        transparent: true,
        opacity: 1,
        depthWrite: false,
      });
      const mesh = new Mesh(DUST_GEO, mat);
      const startSize = 0.7 + Math.random() * 1.1;
      mesh.scale.setScalar(startSize);
      mesh.position.copy(origin);
      mesh.position.x += (Math.random() - 0.5) * 5.5;
      mesh.position.z += (Math.random() - 0.5) * 5.5;
      mesh.position.y += Math.random() * 0.8;
      mesh.rotation.set(Math.random() * 1.5, Math.random() * 2, Math.random() * 1.5);
      mesh.renderOrder = 5;

      const angle = Math.random() * Math.PI * 2;
      const outward = 3.5 + Math.random() * 7;
      this.group.add(mesh);
      this._pool.push({
        obj: mesh,
        material: mat,
        vx: Math.cos(angle) * outward,
        vy: 1.2 + Math.random() * 3.2,
        vz: Math.sin(angle) * outward,
        life: 0,
        maxLife: 0.85 + Math.random() * 0.65,
        startSize,
        endSize: startSize * (2.6 + Math.random() * 1.8),
        drag: 2.2 + Math.random() * 1.2,
        maxOpacity: 0.95,
        twinkle: 0,
        kind: "dust",
      });
    }
  }

  /**
   * Аура «переоделся»: мягкая волна у ног + светлячки,
   * которые тихо поднимаются вдоль тела (не разлетаются конфетти).
   */
  spawnSparkles(origin: Vector3, count = 22): void {
    this._spawnPulse(origin);
    this._spawnFireflies(origin, count);
  }

  /**
   * Фоновые пылинки вокруг персонажа (Sprite — всегда к камере, без «боксов»).
   */
  ensureAmbientMotes(origin: Vector3): void {
    let motes = 0;
    for (const p of this._pool) {
      if (p.kind === "mote") motes++;
    }
    const need = AMBIENT_MOTE_TARGET - motes;
    for (let i = 0; i < need; i++) {
      this._spawnMote(origin);
    }
  }

  private _spawnMote(origin: Vector3): void {
    const color = MOTE_COLORS[(Math.random() * MOTE_COLORS.length) | 0]!;
    const mat = new SpriteMaterial({
      map: SOFT_GLOW_MAP,
      color: new Color(color),
      transparent: true,
      opacity: 0,
      depthWrite: false,
      depthTest: true,
      blending: AdditiveBlending,
    });
    const sprite = new Sprite(mat);
    const size = 0.7 + Math.random() * 1.1;
    sprite.scale.setScalar(size);

    const angle = Math.random() * Math.PI * 2;
    const radius = 4 + Math.random() * 10;
    sprite.position.set(
      origin.x + Math.cos(angle) * radius,
      FLOOR_Y + 3 + Math.random() * 20,
      origin.z + Math.sin(angle) * radius,
    );
    sprite.renderOrder = 8;
    this.group.add(sprite);

    this._pool.push({
      obj: sprite,
      material: mat,
      vx: (Math.random() - 0.5) * 0.7,
      vy: 0.3 + Math.random() * 0.55,
      vz: (Math.random() - 0.5) * 0.7,
      life: 0,
      maxLife: 5 + Math.random() * 5,
      startSize: size,
      endSize: size * 0.7,
      drag: 0.15,
      maxOpacity: 0.2 + Math.random() * 0.14,
      twinkle: 2 + Math.random() * 3.5,
      kind: "mote",
    });
  }

  /** Мягкая светящаяся волна на полу */
  private _spawnPulse(origin: Vector3): void {
    const mat = new MeshBasicMaterial({
      color: new Color(0xd8e8ff),
      transparent: true,
      opacity: 0.55,
      depthWrite: false,
      depthTest: true,
      blending: AdditiveBlending,
      side: DoubleSide,
    });
    const mesh = new Mesh(GLOW_GEO, mat);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(origin.x, FLOOR_Y + 0.12, origin.z);
    mesh.scale.setScalar(2);
    mesh.renderOrder = 0;
    this.group.add(mesh);
    this._pool.push({
      obj: mesh,
      material: mat,
      vx: 0,
      vy: 0,
      vz: 0,
      life: 0,
      maxLife: 0.7,
      startSize: 2,
      endSize: 22,
      drag: 0,
      maxOpacity: 0.5,
      twinkle: 0,
      kind: "pulse",
    });
  }

  /** Светлячки — Sprite, медленный подъём вокруг силуэта */
  private _spawnFireflies(origin: Vector3, count: number): void {
    const colors = [0xffffff, 0xe8f0ff, 0xfff0d0, 0xd0ecff];
    for (let i = 0; i < count; i++) {
      const color = colors[(Math.random() * colors.length) | 0]!;
      const mat = new SpriteMaterial({
        map: SOFT_GLOW_MAP,
        color: new Color(color),
        transparent: true,
        opacity: 0,
        depthWrite: false,
        depthTest: false,
        blending: AdditiveBlending,
      });
      const sprite = new Sprite(mat);
      const size = 0.9 + Math.random() * 1.2;
      sprite.scale.setScalar(size);
      const angle = Math.random() * Math.PI * 2;
      const radius = 2.5 + Math.random() * 5.5;
      sprite.position.set(
        origin.x + Math.cos(angle) * radius,
        FLOOR_Y + 1 + Math.random() * 18,
        origin.z + Math.sin(angle) * radius,
      );
      sprite.renderOrder = 20;
      this.group.add(sprite);

      this._pool.push({
        obj: sprite,
        material: mat,
        vx: (Math.random() - 0.5) * 1.2,
        vy: 2.2 + Math.random() * 3.5,
        vz: (Math.random() - 0.5) * 1.2,
        life: 0,
        maxLife: 0.75 + Math.random() * 0.7,
        startSize: size,
        endSize: size * 0.35,
        drag: 0.4,
        maxOpacity: 0.7 + Math.random() * 0.25,
        twinkle: 5 + Math.random() * 7,
        kind: "firefly",
      });
    }
  }

  update(delta: number): void {
    const dt = Math.min(0.05, Math.max(0, delta));
    for (let i = this._pool.length - 1; i >= 0; i--) {
      const p = this._pool[i]!;
      p.life += dt;
      const u = p.life / p.maxLife;
      if (u >= 1) {
        this.group.remove(p.obj);
        p.material.dispose();
        this._pool.splice(i, 1);
        continue;
      }

      if (p.kind === "pulse") {
        const size = p.startSize + (p.endSize - p.startSize) * easeOutQuad(u);
        p.obj.scale.setScalar(size);
        p.material.opacity = (1 - u) * (1 - u) * p.maxOpacity;
        continue;
      }

      if (p.kind === "firefly" || p.kind === "mote") {
        const sway = p.kind === "mote" ? 0.35 : 0.8;
        p.vx += Math.sin(p.life * 3.2 + p.twinkle) * sway * dt;
        p.vz += Math.cos(p.life * 2.7) * sway * dt;
        p.vx *= Math.exp(-p.drag * dt);
        p.vz *= Math.exp(-p.drag * dt);

        p.obj.position.x += p.vx * dt;
        p.obj.position.y += p.vy * dt;
        p.obj.position.z += p.vz * dt;

        const fadeIn = p.kind === "mote" ? 0.15 : 0.2;
        const fadeOut = p.kind === "mote" ? 0.75 : 0.65;
        const envelope =
          u < fadeIn ? u / fadeIn : u > fadeOut ? 1 - (u - fadeOut) / (1 - fadeOut) : 1;
        const twinkle = 0.55 + 0.45 * Math.abs(Math.sin(p.life * p.twinkle));
        p.material.opacity = envelope * twinkle * p.maxOpacity;
        const s = p.startSize * (0.85 + twinkle * 0.35);
        p.obj.scale.setScalar(s);
        continue;
      }

      // dust
      const damp = Math.exp(-p.drag * dt);
      p.vx *= damp;
      p.vz *= damp;
      p.vy += (1.6 - p.vy * 1.2) * dt;
      p.obj.position.x += p.vx * dt;
      p.obj.position.y += p.vy * dt;
      p.obj.position.z += p.vz * dt;
      p.obj.rotation.y += dt * 2.4;
      p.obj.rotation.x += dt * 1.6;
      const fade = u < 0.55 ? 1 : 1 - ((u - 0.55) / 0.45) ** 2;
      p.material.opacity = fade * p.maxOpacity;
      const size = p.startSize + (p.endSize - p.startSize) * easeOutQuad(u);
      p.obj.scale.setScalar(size);
    }
  }

  dispose(): void {
    for (const p of this._pool) {
      this.group.remove(p.obj);
      p.material.dispose();
    }
    this._pool.length = 0;
  }
}

/** Мягкий круглый блик для Sprite */
function createSoftGlowTexture(): CanvasTexture {
  const size = 64;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    const c = size / 2;
    const g = ctx.createRadialGradient(c, c, 0, c, c, c);
    g.addColorStop(0, "rgba(255,255,255,1)");
    g.addColorStop(0.35, "rgba(255,255,255,0.55)");
    g.addColorStop(0.7, "rgba(255,255,255,0.12)");
    g.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
  }
  const tex = new CanvasTexture(canvas);
  return tex;
}

function easeOutQuad(t: number): number {
  return 1 - (1 - t) * (1 - t);
}

/** Точка пыли у пола под персонажем */
export function feetWorldPosition(
  player: { getWorldPosition: (v: Vector3) => Vector3 },
  out: Vector3,
): Vector3 {
  player.getWorldPosition(out);
  out.y = FLOOR_Y + 0.4;
  return out;
}

/** Центр тела для ауры смены скина */
export function bodyWorldPosition(
  player: { getWorldPosition: (v: Vector3) => Vector3 },
  out: Vector3,
): Vector3 {
  player.getWorldPosition(out);
  out.y += 2;
  return out;
}
