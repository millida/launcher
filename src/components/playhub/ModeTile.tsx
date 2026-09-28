import { useMemo } from 'react'
import type { CSSProperties } from 'react'
import { Icon } from '../Icon'
import { modeBackground, modeLook } from './modeArt'
import { modeScene } from '../iso/modeScenes'
import { ONEBLOCK_BANNER, OWN_SERVER, isExclusive } from './data'

/** Онлайн коротко, чтобы название влезло в строку: 163 400 → «163 тыс». */
const short = (n: number) =>
  n >= 10000 ? Math.round(n / 1000) + ' тыс' : n >= 1000 ? (n / 1000).toFixed(1).replace('.', ',').replace(',0', '') + ' тыс' : String(n)

/**
 * Плитка режима: фон в свете лобби цвета режима, крупный пиксельный значок
 * по центру, снизу — название и онлайн одной строкой. Нажатие — серверы
 * режима; у нашего сервера-ивента — сразу запуск (lib/ownServer).
 * Картинки считаются один раз (modeArt кэширует).
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
  const art = useMemo(() => {
    const look = modeLook(cat, index)
    // Объёмная сцена из блоков вместо плоского значка (правка владельца 23:00).
    const icon = modeScene(cat)
    // Шаг — половинками: на Retina 1.5 css = 3 пикселя экрана, без мыла.
    const k = Math.max(1, Math.floor(Math.min(104 / icon.w, 104 / icon.h) * 2) / 2)
    return { bg: modeBackground(look.color), icon, k }
  }, [cat, index])
  const own = cat === OWN_SERVER.mode
  const banner = own ? ONEBLOCK_BANNER : null

  return (
    <button
      className={'ph-card ph-mt' + (banner ? ' has-banner' : '') + (own ? ' is-own' : '') + (on ? ' on' : '')}
      data-i={index % 4}
      data-sound="nav"
      data-kind={own ? 'own_server' : 'mode'}
      data-id={cat}
      data-pos={index}
      data-src="mode"
      aria-pressed={on}
      aria-label={own ? 'Играть в ' + title : undefined}
      style={{ '--px-img': 'url(' + (banner || art.bg) + ')' } as CSSProperties}
      onClick={onClick}
    >
      {isExclusive(cat) ? <span className="ph-card-tag excl">Эксклюзив</span> : null}
      {banner ? (
        <span className="ph-mt-ic" aria-hidden="true"></span>
      ) : (
        <img
          className="ph-mt-ic"
          src={art.icon.url}
          width={art.icon.w * art.k}
          height={art.icon.h * art.k}
          alt=""
          draggable={false}
        />
      )}
      <span className="ph-mt-foot">
        <b>{title}</b>
        {/* Соцдоказательство (владелец 24.09): число — только живое и не
            меньше 20, иначе строки нет. Сейчас это онлайн режима по рейтингу;
            «через Millida» подключим, когда API начнёт его отдавать. */}
        {online >= 20 ? (
          <span className="ph-mt-on">
            <span className="ph-dot" aria-hidden="true"></span>
            {short(online)} играют
          </span>
        ) : null}
      </span>
      {own ? (
        <span className="btn md primary ph-mt-play" aria-hidden="true">
          <Icon id="i-play" /> Играть
        </span>
      ) : null}
      {on ? (
        <span className="ph-card-on" aria-hidden="true">
          <Icon id="i-check" />
        </span>
      ) : null}
    </button>
  )
}
