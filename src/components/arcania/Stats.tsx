import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { CAST, STATS, type ClassCard } from './content'
import { RollingNumber } from './RollingNumber'
import './stats.css'

const CLASSES = CAST.filter((c): c is ClassCard => !('play' in c))

// Искры у слова: позиция, длительность, снос. Сдвиг по номеру разводит слова, чтобы не мигали в такт.
const WORD_SPARKS = [
  ['12%', 2.4, -6],
  ['34%', 2.9, 4],
  ['58%', 2.2, -3],
  ['80%', 2.7, 7],
] as const

/**
 * Сборка в числах — как на arcania.fun: абзац с классами в их цветах, три числа
 * (крутятся разрядами, когда блок попал на экран) и метка полного перевода.
 */
export function Stats() {
  const ref = useRef<HTMLDListElement>(null)
  const [seen, setSeen] = useState(false)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const io = new IntersectionObserver(
      ([e]) => {
        if (!e?.isIntersecting) return
        setSeen(true)
        io.disconnect()
      },
      { threshold: 0.4 },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [])

  return (
    <section className="arc-stats">
      <p className="arc-stats-lead">
        Arcania — сборка, где ты сам выбираешь путь: стань{' '}
        {CLASSES.map((c, i) => (
          <span key={c.id}>
            <span className="arc-word" style={{ '--c': c.color } as CSSProperties}>
              {c.role}
              {WORD_SPARKS.map(([x, dur, dx], j) => (
                <span
                  key={j}
                  aria-hidden
                  className="arc-word-spark"
                  style={{ '--x': x, '--t': `${dur}s`, '--d': `${(i * 0.37 + j * 0.61) % 2.4}s`, '--dx': `${dx}px` } as CSSProperties}
                />
              ))}
            </span>
            {i < CLASSES.length - 2 ? ', ' : i === CLASSES.length - 2 ? ' или ' : ''}
          </span>
        ))}{' '}
        — у каждого класса своё древо навыков.
      </p>

      <dl ref={ref} className="arc-stats-nums">
        {STATS.map((s) => (
          <div key={s.label}>
            <dt>{s.label}</dt>
            <dd>
              <span className="arc-stats-plus">+</span>
              {seen ? <RollingNumber value={s.value} /> : s.value}
            </dd>
          </div>
        ))}
      </dl>

      <div className="arc-stats-ru">
        <span className="arc-flag" aria-hidden>
          <i />
          <i />
          <i />
        </span>
        <p>
          Полный перевод <b>на русский язык</b>
        </p>
      </div>
    </section>
  )
}
