import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { CSSProperties } from 'react'
import { Icon } from '../Icon'
import { BLOCK_ICONS } from '../../lib/icons'
import { DEFAULT_BLOCK, GRASS_BLOCK, ICON_BGS, fileToCover, makeIcon, parseIcon } from '../../lib/buildIcon'
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
export function BuildIcon({ icon, size = 72 }: { icon?: string | null; size?: number }) {
  const s = parseIcon(icon)
  return (
    <span
      className={'bi' + (s.kind === 'photo' ? ' photo' : '') + (s.big ? ' big' : '')}
      style={{ '--bi-bg': s.bg, '--bi-size': size + 'px' } as CSSProperties}
    >
      <img src={s.src} alt="" draggable={false} loading="lazy" />
    </span>
  )
}

const BLOCKS = [DEFAULT_BLOCK, GRASS_BLOCK, ...BLOCK_ICONS.filter((b) => b !== DEFAULT_BLOCK)]

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
  const [bg, setBg] = useState(cur.bg)
  const [src, setSrc] = useState(cur.kind === 'block' ? cur.src : DEFAULT_BLOCK)
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
          <button className="btn sm ghost ip-x" aria-label="Закрыть" data-sound="close" onClick={onClose}>
            <Icon id="i-x" />
          </button>
        </div>

        <div className="ip-colors" role="radiogroup" aria-label="Фон">
          {ICON_BGS.map((c) => (
            <button
              key={c}
              type="button"
              className={'ip-color' + (!photo && bg === c ? ' on' : '')}
              style={{ '--c': c } as CSSProperties}
              aria-label={'Фон ' + c}
              aria-pressed={!photo && bg === c}
              onClick={() => color(c)}
            />
          ))}
        </div>

        <div className="ip-grid">
          {BLOCKS.map((b) => (
            <button
              key={b}
              type="button"
              className={'ip-block' + (b === GRASS_BLOCK ? ' big' : '') + (!photo && src === b ? ' on' : '')}
              style={{ '--c': bg } as CSSProperties}
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
