import { t } from '../i18n'
/**
 * Места на теле по-русски. Одна таблица на весь лаунчер: гардероб и магазин
 * показывают одни и те же вещи, и «Шляпа» против «Шляпы» в двух списках
 * читается как два разных места.
 */
export const COSMETIC_SLOT_NAMES: Record<string, string> = {
  get CAPE() { return t('Плащ') },
  get HAT() { return t('Шляпа') },
  get HEAD() { return t('Голова') },
  get FACE() { return t('Лицо') },
  get EARS() { return t('Уши') },
  get BACK() { return t('Спина') },
  get WINGS() { return t('Крылья') },
  get SHOULDER() { return t('Плечо') },
  get SHOULDERS() { return t('Плечи') },
  get ARMS() { return t('Руки') },
  get HAND() { return t('Рука') },
  get WAIST() { return t('Пояс') },
  get TOP() { return t('Верх') },
  get PANTS() { return t('Штаны') },
  get SKIRT() { return t('Юбка') },
  get SHOES() { return t('Обувь') },
  get FEET() { return t('Ноги') },
  get FULL_BODY() { return t('Костюм') },
  get ACCESSORY() { return t('Аксессуар') },
  get ICON() { return t('Значок') },
  get EFFECT() { return t('Эффект') },
  get AURA() { return t('Аура') },
  get EMOTE() { return t('Эмоция') },
  get PET() { return t('Питомец') },
}

export const cosmeticSlotName = (slot: string) => COSMETIC_SLOT_NAMES[slot] || slot

/**
 * Значок места на теле. Раньше вкладку рисовала картинка первой вещи в
 * категории: у «Головы» первой шла вещь без превью, и вкладка выходила пустой,
 * а мелкие превью на телефоне не читались. Значок одинаково читаем везде.
 */
const COSMETIC_SLOT_ICONS: Record<string, string> = {
  CAPE: 'i-cape',
  HAT: 'i-hat',
  HEAD: 'i-crown',
  FACE: 'i-glasses',
  EARS: 'i-ear',
  BACK: 'i-backpack',
  WINGS: 'i-wings',
  SHOULDER: 'i-hand',
  SHOULDERS: 'i-hand',
  ARMS: 'i-hand',
  HAND: 'i-hand',
  WAIST: 'i-pants',
  TOP: 'i-shirt',
  PANTS: 'i-pants',
  SKIRT: 'i-pants',
  SHOES: 'i-shoes',
  FEET: 'i-shoes',
  FULL_BODY: 'i-body',
  ACCESSORY: 'i-gem',
  ICON: 'i-star',
  EFFECT: 'i-zap',
  AURA: 'i-sparkle',
  EMOTE: 'i-smile',
  PET: 'i-paw',
}

export const cosmeticSlotIcon = (slot: string) => COSMETIC_SLOT_ICONS[slot] || 'i-box'

/**
 * Прибавка к размеру вещи по месту на теле - та же лестница, что в моде
 * (CosmeticSlot.extraInflate), и там же её объяснение. Шкала Essential: номер
 * группы на сотую долю пикселя, начиная с сотой.
 *
 * Прибавка разводит грани нулевой толщины, а скин из-под костюма убирает маска.
 * Пока её считали защитой от скина, она доходила до половины пикселя, и вокруг
 * рукава была видна кайма в четверть ширины руки.
 */
export function cosmeticInflate(slot: string): number {
  switch (slot) {
    case 'PANTS':
      return 0.01
    case 'TOP':
    case 'HEAD':
    case 'FACE':
      return 0.02
    case 'BACK':
    case 'SKIRT':
    case 'WAIST':
    case 'EARS':
      return 0.03
    case 'HAT':
    case 'FULL_BODY':
      return 0.04
    case 'ACCESSORY':
    case 'ARMS':
    case 'SHOES':
    case 'HAND':
    case 'FEET':
    case 'SHOULDER':
    case 'SHOULDERS':
      return 0.05
    default:
      return 0.01
  }
}

/**
 * Надслои скина в игре раздуты ровно на четверть пикселя (рукава, куртка,
 * штанины) и на половину (шляпа). Куб вещи, чья толщина вместе с прибавкой
 * места выходит ровно туда же, кладёт грани в плоскость надслоя: наплечники
 * (inflate 0.2 + 0.05 места) рябили с рукавом. Такой куб отодвигается на сотую -
 * шаг лестницы мест, - и вещь ложится поверх надслоя. Остальных кубов правило
 * не касается: у каталога таких четыре вещи (наплечники, лапки на руках и ногах).
 * Та же поправка в моде - MeshBuilder.cubeInflate.
 */
const SKIN_LAYERS = [0.25, 0.5]
const SKIN_LAYER_CLEARANCE = 0.01

export function cubeInflate(own: number, extra: number): number {
  const total = own + extra
  return SKIN_LAYERS.some((layer) => Math.abs(total - layer) < 0.005) ? total + SKIN_LAYER_CLEARANCE : total
}
