import { useMemo } from 'react'
import type { CSSProperties } from 'react'
import { Icon } from '../Icon'
import { modeBackground, modeLook } from './modeArt'
import { modeScene } from '../iso/modeScenes'
import { OWN_SERVER, isExclusive } from './data'
import { ONEBLOCK_ART, modeIcon } from './modeIcon'

/** Онлайн коротко, чтобы название влезло в строку: 163 400 → «163 тыс». */
const short = (n: number) =>
  n >= 10000 ? Math.round(n / 1000) + ' тыс' : n >= 1000 ? (n / 1000).toFixed(1).replace('.', ',').replace(',0', '') + ' тыс' : String(n)

/**
 * Плитка режима: мозаика крупных клеток цвета режима со ступенчатым светом,
 * риг режима крупно стоит на нижней кромке и уходит за правый край (владелец
 * 30.09.2026, 15:42: риги в стиле Mojang вместо плоских значков) — тот же
 * набор, что на millida.net/katalog. Снизу — название и
 * онлайн. Нажатие — серверы режима; у нашего сервера-ивента — сразу запуск
 * (lib/ownServer).
 *
 * OneBlock — баннер на две клетки как первый экран mcru.me: ночной осенний
 * фон, логотип сезона, персонаж справа и «Играть».
 */
export function ModeTile({
  cat,
  title,
  online,
  index,
  on,
  onClick,
}: {
  cat: string
  title: string
  online: number
  index: number
  on?: boolean
  onClick: () => void
}) {
  const own = cat === OWN_SERVER.mode
  const art = useMemo(() => {
    const set = modeIcon(cat)
    if (set) return { bg: set.bg, icon: { url: set.icon, w: 16, h: 16 }, k: 0, color: set.color, rig: set.rig }
    // Кода нет в наборе — прежняя сцена из блоков на свету цвета режима.
    const look = modeLook(cat, index)
    const icon = modeScene(cat)
    const k = Math.max(1, Math.floor(Math.min(104 / icon.w, 104 / icon.h) * 2) / 2)
    return { bg: modeBackground(look.color), icon, k, color: look.color, rig: null }
  }, [cat, index])

  if (own)
    return (
      <button
        className={'ph-card ph-mt ph-mt-ob' + (on ? ' on' : '')}
        data-sound="open"
        data-kind="own_server"
        data-id={cat}
        data-pos={index}
        data-src="mode"
        aria-pressed={on}
        aria-label={'Играть в ' + title}
        style={{ '--px-img': 'url(' + ONEBLOCK_ART.bg + ')' } as CSSProperties}
        onClick={onClick}
      >
        <span className="ph-ob2-leaves" aria-hidden="true">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <i key={i} style={{ '--i': i } as CSSProperties} />
          ))}
        </span>
        <img className="ph-ob2-rig" src={ONEBLOCK_ART.rig} alt="" draggable={false} />
        {isExclusive(cat) ? <span className="ph-card-tag excl">Эксклюзив</span> : null}
        <img className="ph-ob2-logo" src={ONEBLOCK_ART.logo} alt="OneBlock" draggable={false} />
        <span className="ph-ob2-foot">
          <span className="btn lg primary ph-mt-play" aria-hidden="true">
            <Icon id="i-play" /> Играть
          </span>
          {online >= 20 ? (
            <span className="ph-mt-on">
              <span className="ph-dot" aria-hidden="true"></span>
              {short(online)} играют
            </span>
          ) : null}
        </span>
        {on ? (
          <span className="ph-card-on" aria-hidden="true">
            <Icon id="i-check" />
          </span>
        ) : null}
      </button>
    )

  return (
    <button
      className={'ph-card ph-mt' + (art.k ? '' : ' is-set') + (art.rig ? ' is-rig' : '') + (on ? ' on' : '')}
      data-i={index % 4}
      data-sound="nav"
      data-kind="mode"
      data-id={cat}
      data-pos={index}
      data-src="mode"
      aria-pressed={on}
      style={{ '--px-img': 'url(' + art.bg + ')', backgroundColor: art.color } as CSSProperties}
      onClick={onClick}
    >
      {isExclusive(cat) ? <span className="ph-card-tag excl">Эксклюзив</span> : null}
      {art.rig ? (
        <img
          className="ph-mt-rig"
          src={art.rig.url}
          width={art.rig.w}
          height={art.rig.h}
          data-wide={art.rig.w > art.rig.h ? 'true' : undefined}
          alt=""
          loading="lazy"
          draggable={false}
        />
      ) : (
        <img
          className="ph-mt-ic"
          src={art.icon.url}
          width={art.k ? art.icon.w * art.k : 96}
          height={art.k ? art.icon.h * art.k : 96}
          alt=""
          draggable={false}
        />
      )}
      <span className="ph-mt-foot">
        <b>{title}</b>
        {/* Соцдоказательство (владелец 24.09): число — только живое и не
            меньше 20, иначе строки нет. */}
        {online >= 20 ? (
          <span className="ph-mt-on">
            <span className="ph-dot" aria-hidden="true"></span>
            {short(online)} играют
          </span>
        ) : null}
      </span>
      {on ? (
        <span className="ph-card-on" aria-hidden="true">
          <Icon id="i-check" />
        </span>
      ) : null}
    </button>
  )
}
