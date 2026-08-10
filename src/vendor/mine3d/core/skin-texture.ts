// Санитизация canvas-скина и настройка CanvasTexture для skin3d
import { ClampToEdgeWrapping, NearestFilter, SRGBColorSpace, type CanvasTexture } from "three";

/** Порог: обнуляем только полностью прозрачные тексели (alpha==0 или шум экспорта) */
const SANITIZE_ALPHA_THRESHOLD = 1;

/**
 * Обнуляет RGB и alpha только у полностью прозрачных текселей.
 * Не трогает полупрозрачные края overlay — агрессивный порог 128 давал артефакты на outer-слое.
 */
export function sanitizeSkinCanvas(canvas: HTMLCanvasElement): void {
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return;

  const { width, height } = canvas;
  const imgData = ctx.getImageData(0, 0, width, height);
  const d = imgData.data;

  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] < SANITIZE_ALPHA_THRESHOLD) {
      d[i] = 0;
      d[i + 1] = 0;
      d[i + 2] = 0;
      d[i + 3] = 0;
    }
  }

  ctx.putImageData(imgData, 0, 0);
}

/**
 * Параметры CanvasTexture для Minecraft-скина — pixel-perfect, без mip/dilate.
 * Совместимо с skin3d Render.recreateSkinTexture + ColorManagement.enabled.
 */
export function configureSkinCanvasTexture(texture: CanvasTexture): void {
  texture.magFilter = NearestFilter;
  texture.minFilter = NearestFilter;
  texture.wrapS = ClampToEdgeWrapping;
  texture.wrapT = ClampToEdgeWrapping;
  texture.colorSpace = SRGBColorSpace;
  texture.anisotropy = 1;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
}

/**
 * Для полностью прозрачных текселей копирует RGB от ближайшего непрозрачного соседа, alpha остаётся 0.
 * Убирает белую/тёмную кайму при выборке на границе UV-островов (overlay и inner).
 */
export function padTextureEdgeRGB(canvas: HTMLCanvasElement): void {
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return;

  const { width, height } = canvas;
  const imgData = ctx.getImageData(0, 0, width, height);
  const d = imgData.data;
  const maxRadius = Math.max(width, height);

  const pixelIndex = (x: number, y: number): number => (y * width + x) * 4;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = pixelIndex(x, y);
      if (d[i + 3] !== 0) continue;

      outer: for (let r = 1; r <= maxRadius; r++) {
        for (let dy = -r; dy <= r; dy++) {
          for (let dx = -r; dx <= r; dx++) {
            if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;

            const nx = x + dx;
            const ny = y + dy;
            if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;

            const ni = pixelIndex(nx, ny);
            if (d[ni + 3] === 0) continue;

            d[i] = d[ni];
            d[i + 1] = d[ni + 1];
            d[i + 2] = d[ni + 2];
            break outer;
          }
        }
      }
    }
  }

  ctx.putImageData(imgData, 0, 0);
}

// broken — do not use: любой dilate overlay на этом атласе даёт белые артефакты (outline/strips)
// на outer-слое; outer-текстура должна оставаться pristine после sanitize.
