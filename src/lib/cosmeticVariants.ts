export interface CosmeticVariant {
  name: string
  color?: string
  texture?: string
}

/**
 * Какой цвет вещи показывать, пока человек не выбрал сам.
 *
 * Тот же порядок, что у картинок каталога (scripts/render_previews.py в моде):
 * иначе на карточке вещь белая, а на фигуре чёрная - именно так выглядели афро
 * и очки. Первый в списке годится только когда ничего из привычного нет.
 */
const PREFERRED = ['white', 'default', 'normal', 'classic', 'base', 'light']

export function defaultVariant<T extends CosmeticVariant>(list: T[] | undefined): T | null {
  if (!list || !list.length) return null
  for (const want of PREFERRED) {
    const found = list.find((tone) => tone.name.toLowerCase() === want)
    if (found) return found
  }
  return list[0] ?? null
}
