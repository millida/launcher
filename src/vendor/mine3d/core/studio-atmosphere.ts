// Спокойный студийный фон: нейтральный градиент, мягкий spot и виньетка
import {
  CanvasTexture,
  Color,
  Group,
  SRGBColorSpace,
} from "three";

const BG_W = 64;
const BG_H = 64;

/**
 * Сдержанная атмосфера исходного апгрейда графики:
 * тёмный уголь → чуть светлее к горизонту, мягкий spot, виньетка.
 */
export class StudioAtmosphere {
  readonly group = new Group();
  readonly backgroundTexture: CanvasTexture;

  private readonly _bgCanvas: HTMLCanvasElement;
  private _time = 0;

  constructor() {
    this._bgCanvas = document.createElement("canvas");
    this._bgCanvas.width = BG_W;
    this._bgCanvas.height = BG_H;
    this.backgroundTexture = new CanvasTexture(this._bgCanvas);
    this.backgroundTexture.colorSpace = SRGBColorSpace;
    this._paintBackground(0);
  }

  setVisible(visible: boolean): void {
    this.group.visible = visible;
  }

  update(delta: number): void {
    if (!this.group.visible) return;
    this._time += Math.min(0.05, Math.max(0, delta));
    this._paintBackground(this._time);
  }

  dispose(): void {
    this.backgroundTexture.dispose();
  }

  private _paintBackground(t: number): void {
    const ctx = this._bgCanvas.getContext("2d");
    if (!ctx) return;

    const breathe = 0.5 + 0.5 * Math.sin(t * 0.2);
    const lift = breathe * 5;

    const topR = 20 + lift;
    const topG = 22 + lift;
    const topB = 28 + lift;
    const midR = 26 + lift * 0.7;
    const midG = 27 + lift * 0.7;
    const midB = 32 + lift * 0.7;
    const botR = 12 + lift * 0.35;
    const botG = 12 + lift * 0.35;
    const botB = 14 + lift * 0.35;

    const g = ctx.createLinearGradient(0, 0, 0, BG_H);
    g.addColorStop(0, `rgb(${topR | 0},${topG | 0},${topB | 0})`);
    g.addColorStop(0.52, `rgb(${midR | 0},${midG | 0},${midB | 0})`);
    g.addColorStop(1, `rgb(${botR | 0},${botG | 0},${botB | 0})`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, BG_W, BG_H);

    const spot = ctx.createRadialGradient(
      BG_W * 0.5,
      BG_H * 0.38,
      BG_W * 0.08,
      BG_W * 0.5,
      BG_H * 0.45,
      BG_W * 0.55,
    );
    spot.addColorStop(0, "rgba(255, 255, 255, 0.055)");
    spot.addColorStop(1, "rgba(0, 0, 0, 0)");
    ctx.fillStyle = spot;
    ctx.fillRect(0, 0, BG_W, BG_H);

    const vg = ctx.createRadialGradient(
      BG_W * 0.5,
      BG_H * 0.42,
      BG_W * 0.15,
      BG_W * 0.5,
      BG_H * 0.5,
      BG_W * 0.8,
    );
    vg.addColorStop(0, "rgba(255, 255, 255, 0.02)");
    vg.addColorStop(0.55, "rgba(0, 0, 0, 0)");
    vg.addColorStop(1, "rgba(0, 0, 0, 0.45)");
    ctx.fillStyle = vg;
    ctx.fillRect(0, 0, BG_W, BG_H);

    this.backgroundTexture.needsUpdate = true;
  }
}

/** Цвет очистки под атмосферу */
export const STUDIO_CLEAR_COLOR = new Color(0x161616);
