import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Icon } from '../Icon'
import { Milli } from '../milli/Milli'
import { openMilli } from '../../state/milli'
import { useHubTab } from './hubTab'
import '../../styles/pixel/hub-ai-intro.css'

/**
 * Первый экран библиотеки (владелец 30.09.2026), как на millida.net/katalog:
 * поле, крупная зелёная «Найти» и «Собрать с ИИ». Текст поля — запрос
 * каталога (Enter или «Найти») либо просьба к Милли: «Собрать с ИИ» открывает
 * её чат и отправляет написанное.
 *
 * Милли (владелец 04.10.2026): живёт в «окошке» внутри кнопки. При каждом входе
 * вылезает из него, машет и говорит «Привет! Могу собрать тебе сборку», потом
 * пузырь гаснет, а Милли оседает — торчат только глаза, на наведение снова выглядывает.
 * Пузырь — в портале поверх всего, иначе его срезает шапка библиотеки.
 */
export function HubFind({ onSearch }: { onSearch: (q: string) => void }) {
  const [q, setQ] = useState('')
  const [say, setSay] = useState(true)
  const [at, setAt] = useState<{ x: number; y: number; tail: number } | null>(null)
  const peek = useRef<HTMLSpanElement>(null)
  const bub = useRef<HTMLSpanElement>(null)
  useEffect(() => {
    const t = window.setTimeout(() => setSay(false), 4200)
    const off = () => setSay(false)
    window.addEventListener('wheel', off, { passive: true })
    return () => {
      window.clearTimeout(t)
      window.removeEventListener('wheel', off)
    }
  }, [])
  useLayoutEffect(() => {
    const r = peek.current?.parentElement?.getBoundingClientRect()
    const m = peek.current?.getBoundingClientRect()
    if (r && m) setAt({ x: m.left + m.width * 0.5, y: r.top, tail: 0 })
  }, [])
  // пузырь не должен уезжать за правый край окна: сдвигаем его влево, хвост остаётся над Милли
  useLayoutEffect(() => {
    const w = bub.current?.offsetWidth
    if (!at || !w || at.tail) return
    const left = Math.min(at.x - 14, window.innerWidth - w - 12)
    setAt({ ...at, x: left, tail: at.x - left })
  }, [at])
  const ask = () => {
    // Milli lives in the catalog («Ресурсы»); on the library tab the dock hides her and the request sat unseen.
    useHubTab.getState().setAll(true)
    openMilli(q.trim() ? { text: q.trim(), src: 'hub' } : { src: 'hub' })
  }
  return (
    <form
      className="hub-find"
      role="search"
      onSubmit={(e) => {
        e.preventDefault()
        onSearch(q.trim())
      }}
    >
      <label className="input hs-field hub-find-field">
        <Icon id="i-search" />
        <input value={q} placeholder="Мод, сборка, карта или просьба к ИИ" maxLength={200} onChange={(e) => setQ(e.target.value)} />
      </label>
      <button type="submit" className="btn lg primary hub-find-go" data-sound="open" data-track="hub_search">
        Найти
      </button>
      <button type="button" className="btn lg secondary hub-find-ai" data-sound="open" data-track="ai_builder_open" onClick={ask}>
        {/* Милли внутри кнопки: низ спрятан за нижней рамкой, голова и рука выглядывают. */}
        <span className={say ? 'hub-ai-peek is-up' : 'hub-ai-peek'} ref={peek} aria-hidden="true">
          <span className="hub-ai-who">
            <Milli size={64} mode={say ? 'wave' : 'idle'} poke={false} />
          </span>
        </span>
        Собрать с ИИ
      </button>
      {say && at
        ? createPortal(
            <span
              className="hub-ai-say"
              role="status"
              ref={bub}
              style={{ left: at.x, top: at.y, visibility: at.tail ? 'visible' : 'hidden', ['--tail' as string]: `${at.tail - 6}px` }}
            >
              Привет! Могу собрать тебе сборку
            </span>,
            document.body,
          )
        : null}
    </form>
  )
}
