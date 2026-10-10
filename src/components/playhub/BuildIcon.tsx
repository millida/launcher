import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { CSSProperties } from 'react'
import { Icon } from '../Icon'
import { GRASS_BLOCK, ICON_BGS, MR_BGS, MR_SYMBOLS, buildIconOf, fileToCover, makeIcon, mrSymbol, parseIcon, randomIcon } from '../../lib/buildIcon'
import { hasTauri } from '../../ipc/tauri'
import { pickCoverImage } from '../../ipc/commands'
import { showToast } from '../../state/ui'
import { backdropClose } from '../../lib/dismiss'
import '../../styles/pixel/buildicon.css'

/**
 * Квадратная иконка сборки как у проекта в Modrinth: квадрат 72 px глубокого
 * цвета, блок по центру около 48 px (правка владельца 20:00). Рендер набора
 * 96 px показывается уменьшенным, не растянутым; теней и свечения нет.
 */
export function BuildIcon({ icon, size = 72, name }: { icon?: string | null; size?: number; /** Имя сборки: без выбранной иконки — её постоянная случайная. */ name?: string }) {
  const s = parseIcon(name !== undefined ? buildIconOf({ name, icon }) : icon)
  return (
    <span
      className={'bi' + (s.kind === 'photo' ? ' photo' : '') + (s.big ? ' big' : '') + (s.mr ? ' mr' : '')}
      style={{ '--bi-bg': s.bg, '--bi-size': size + 'px' } as CSSProperties}
    >
      <img src={s.src} alt="" draggable={false} loading="lazy" />
    </span>
  )
}

/** Только объёмные значки Modrinth App: старые блоки Millida убраны (владелец 10.10.2026: «тут старое»). */
const BLOCKS = MR_SYMBOLS.map(mrSymbol)
/** Яркие градиенты Modrinth, потом глубокие цвета Millida. */
const BGS: { id: string; css: string }[] = [
  ...MR_BGS.map((g) => ({ id: g.id, css: 'linear-gradient(180deg, ' + g.top + ', ' + g.bottom + ')' })),
  // Сплошной цвет — тоже «картинкой»: фон плиток рисует слой --px-img пиксельной рамки.
  ...ICON_BGS.map((c) => ({ id: c, css: 'linear-gradient(' + c + ', ' + c + ')' })),
]

/**
 * «Изменить» иконку: блок из набора, цвет подложки или своя картинка.
 * Сетка без горизонтальной прокрутки (правка владельца 19:40).
 */
export function IconPicker({
  icon,
  onPick,
  onClose,
}: {
  icon: string
  onPick: (icon: string) => void
  onClose: () => void
}) {
  const cur = parseIcon(icon)
  const curBg = (icon.split('#bg=')[1] || '').trim()
  const [bg, setBg] = useState(BGS.some((b) => b.id === curBg) ? curBg : BGS.some((b) => b.id === '#' + curBg.toLowerCase()) ? '#' + curBg.toLowerCase() : cur.bg)
  const [src, setSrc] = useState(cur.kind === 'block' ? cur.src : mrSymbol('grass-block'))
  const bgCss = (BGS.find((b) => b.id === bg) || { css: 'linear-gradient(' + bg + ', ' + bg + ')' }).css
  const file = useRef<HTMLInputElement>(null)
  const photo = cur.kind === 'photo' ? cur.src : null

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && (e.stopImmediatePropagation(), onClose())
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onClose])

  const block = (b: string) => {
    setSrc(b)
    onPick(makeIcon(b, bg))
  }
  const color = (c: string) => {
    setBg(c)
    onPick(makeIcon(src, c))
  }
  // «Кубик»: случайный значок на подходящем фоне (как новая сборка в Modrinth App).
  const roll = () => {
    const next = randomIcon()
    const [s2, b2] = next.split('#bg=')
    setSrc(s2!)
    setBg(b2!)
    onPick(next)
  }
  const upload = () => {
    if (hasTauri()) {
      pickCoverImage()
        .then((data) => data && onPick(data))
        .catch((e) => showToast('Картинка не подошла: ' + e, 'error'))
      return
    }
    file.current?.click()
  }

  // Портал: карточка под иконкой срезана clip-path, и окно внутри неё обрезалось бы.
  return createPortal(
    <div
      className="ip-bg"
      {...backdropClose(onClose)}
    >
      <div className="ip" role="dialog" aria-label="Иконка сборки">
        <div className="ip-head">
          <BuildIcon icon={photo ? icon : makeIcon(src, bg)} size={72} />
          <b>Иконка</b>
          <button type="button" className="btn sm secondary ip-roll" data-track="icon_random" onClick={roll}>
            <span aria-hidden="true">🎲</span> Случайная
          </button>
          <button className="btn sm ghost ip-x" aria-label="Закрыть" data-sound="close" onClick={onClose}>
            <Icon id="i-x" />
          </button>
        </div>

        <div className="ip-colors" role="radiogroup" aria-label="Фон">
          {BGS.map((c) => (
            <button
              key={c.id}
              type="button"
              className={'ip-color' + (!photo && bg === c.id ? ' on' : '')}
              style={{ '--c': c.css } as CSSProperties}
              aria-label={'Фон ' + c.id}
              aria-pressed={!photo && bg === c.id}
              onClick={() => color(c.id)}
            />
          ))}
        </div>

        <div className="ip-grid">
          {BLOCKS.map((b) => (
            <button
              key={b}
              type="button"
              className={'ip-block' + (b === GRASS_BLOCK ? ' big' : '') + (!photo && src === b ? ' on' : '')}
              style={{ '--c': bgCss } as CSSProperties}
              aria-pressed={!photo && src === b}
              onClick={() => block(b)}
            >
              <img src={b} alt="" draggable={false} loading="lazy" />
            </button>
          ))}
        </div>

        <div className="ip-foot">
          <button type="button" className={'btn sm secondary' + (photo ? ' on' : '')} onClick={upload}>
            <Icon id="i-upload" /> Своя картинка
          </button>
          <button type="button" className="btn sm primary" data-sound="close" onClick={onClose}>
            Готово
          </button>
        </div>
        <input
          ref={file}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          hidden
          onChange={(e) => {
            const f = e.target.files && e.target.files[0]
            e.target.value = ''
            if (!f) return
            fileToCover(f)
              .then(onPick)
              .catch(() => showToast('Картинка не открылась', 'error'))
          }}
        />
      </div>
    </div>,
    document.body,
  )
}
