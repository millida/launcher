// Лёгкая часть снимков набора: размеры кадра, кадр по месту вещи, пропорции. Отдельно от
// outfitSnapshot.ts, который тянет three.js: экраны магазина берут отсюда числа и не грузят 3D.

/**
 * Размер кадра — ровно как показ в карточке (3:4, CSS-пиксели): движок сам
 * рендерит с запасом плотности экрана, и картинка не пережимается браузером.
 */
export const SHOT_W = 240
export const SHOT_H = 320

export type ShotFocus = 'full' | 'body' | 'head' | 'upper' | 'legs' | 'back'

const SLOT_FOCUS: Record<string, ShotFocus> = {
  HAT: 'head', HEAD: 'head', FACE: 'head', EARS: 'head',
  BACK: 'back', WINGS: 'back', CAPE: 'back',
  SHOES: 'legs', FEET: 'legs', PANTS: 'legs', SKIRT: 'legs',
  PET: 'full',
  ARMS: 'upper', HAND: 'upper', SHOULDERS: 'upper', SHOULDER: 'upper', ACCESSORY: 'upper',
}
export const focusOf = (slot: string): ShotFocus => SLOT_FOCUS[slot] ?? 'body'

/**
 * Пропорции кадра (ширина/высота) — те же, что у плитки: иначе браузер
 * растягивал снимок 3:4 в квадрат, и персонаж с крыльями выходил сплюснутым.
 * Округляем до 0,05, чтобы соседние плитки делили кэш.
 */
export const shotAspect = (w: number, h: number) => (w > 0 && h > 0 ? Math.max(0.4, Math.min(2.5, Math.round((w / h) * 20) / 20)) : SHOT_W / SHOT_H)
