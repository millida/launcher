import { PxSymbols } from './PxIcon'

/**
 * Общий спрайт значков: `<Icon id="i-…" />` ссылается сюда через <use>.
 *
 * С 23.09.2026 все значки пиксельные (приказ владельца «все иконки пиксельные,
 * как сообщение»): тонкие контурные Lucide рядом с пиксельным интерфейсом
 * больше не живут. Рисунки — в `pxArt.ts`, по одному на id.
 */
export function SvgSprite() {
  return (
    <svg width="0" height="0" style={{ position: 'absolute' }} aria-hidden="true">
      <PxSymbols />
    </svg>
  )
}
