import { Play } from './Play'

/**
 * Главная в раскладке «Классика» (владелец 07.10.2026): лобби как в Brawl Stars —
 * свой персонаж, серия, сундук, плашка сборки и «Играть» — на всё место справа
 * от панели. Сборки и рекомендации — пункт «Мои сборки», каталог — «Каталог».
 */
export function ClassicHome({ on }: { on: boolean }) {
  return (
    <section className={'screen' + (on ? ' on' : '')} id="s-home">
      <div className="ch-stage">
        <Play on={on} />
      </div>
    </section>
  )
}
