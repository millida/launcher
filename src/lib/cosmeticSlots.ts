/**
 * Места на теле по-русски. Одна таблица на весь лаунчер: гардероб и магазин
 * показывают одни и те же вещи, и «Шляпа» против «Шляпы» в двух списках
 * читается как два разных места.
 */
export const COSMETIC_SLOT_NAMES: Record<string, string> = {
  CAPE: 'Плащ',
  HAT: 'Шляпа',
  HEAD: 'Голова',
  FACE: 'Лицо',
  EARS: 'Уши',
  BACK: 'Спина',
  WINGS: 'Крылья',
  SHOULDER: 'Плечо',
  SHOULDERS: 'Плечи',
  ARMS: 'Руки',
  HAND: 'Рука',
  WAIST: 'Пояс',
  TOP: 'Верх',
  PANTS: 'Штаны',
  SKIRT: 'Юбка',
  SHOES: 'Обувь',
  FEET: 'Ноги',
  FULL_BODY: 'Костюм',
  ACCESSORY: 'Аксессуар',
  ICON: 'Значок',
  EFFECT: 'Эффект',
  AURA: 'Аура',
  EMOTE: 'Эмоция',
  PET: 'Питомец',
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
