// Загрузка PNG-скина: remote — через CORS, local/blob/data — без crossOrigin
import { loadImage } from "skinview-utils";

/** URL внешнего ресурса (нужен crossOrigin для canvas) */
export function isRemoteSkinUrl(source: string): boolean {
  return /^https?:\/\//i.test(source);
}

/** Загрузка изображения скина с корректным режимом CORS */
export function loadSkinImage(source: string): Promise<HTMLImageElement> {
  if (isRemoteSkinUrl(source)) {
    return loadImage(source);
  }

  return new Promise((resolve, reject) => {
    const image = document.createElement("img");
    image.onload = () => {
      if (image.naturalWidth <= 0 || image.naturalHeight <= 0) {
        reject(new Error(`Пустое изображение (${source})`));
        return;
      }
      resolve(image);
    };
    image.onerror = () => reject(new Error(`Не удалось декодировать PNG (${source})`));
    // blob:/data:/same-origin — crossOrigin ломает загрузку и taint-ит canvas
    image.src = source;
  });
}
