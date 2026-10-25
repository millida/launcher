import { useState, type CSSProperties } from 'react'
import { ART, CAST, type ClassCard } from './content'
import './hero-cast.css'

// Искры у горящей карты, ручной разброс: [x, размер px, длительность s, задержка s, снос px].
const SPARKS = [
  ['22%', 5, 3.4, 0, -18],
  ['38%', 7, 4.2, 0.9, -8],
  ['50%', 4, 3.0, 1.7, 4],
  ['62%', 6, 3.8, 0.4, 12],
  ['76%', 4, 3.2, 1.3, 20],
] as const

/**
 * Ряд героев — как первый экран arcania.fun: семь карт, по букве ARCANIA на карту.
 * Под курсором загорается одна карта цветом класса; центральная «Начать играть»
 * зажигает весь ряд и делает то же, что главная кнопка страницы.
 */
export function HeroCast({ installed, onPlay }: { installed: boolean; onPlay: () => void }) {
  const [lit, setLit] = useState<number | null>(null)
  const playIndex = CAST.findIndex((c) => 'play' in c)
  const all = lit === playIndex
  const litCard = lit !== null ? CAST[lit] : undefined
  const tint = all ? '#7bd35a' : litCard && 'color' in litCard ? litCard.color : 'transparent'

  return (
    <div
      className="arc-cast"
      style={{ '--tint': tint, '--glow-x': lit === null ? '50%' : ((lit + 0.5) / CAST.length) * 100 + '%' } as CSSProperties}
      onMouseLeave={() => setLit(null)}
    >
      <div className="arc-cast-glow" aria-hidden="true" />
      <div className="arc-cast-row">
        {CAST.map((c, i) =>
          'play' in c ? (
            <button
              key="play"
              className="arc-card arc-play"
              data-sound="open"
              data-track="arcania_play_card"
              onMouseEnter={() => setLit(i)}
              onFocus={() => setLit(i)}
              onClick={onPlay}
            >
              <Letter ch={c.letter} />
              <span className="arc-play-body">
                <span className="arc-play-circle">
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M8 5.5v13l11-6.5z" fill="currentColor" />
                  </svg>
                </span>
                <b>
                  {installed ? 'Играть' : 'Начать'}
                  <br />
                  {installed ? 'сейчас' : 'играть'}
                </b>
              </span>
            </button>
          ) : (
            <ClassTile key={c.id} card={c} lit={lit === i || all} onEnter={() => setLit(i)} />
          ),
        )}
      </div>
    </div>
  )
}

function ClassTile({ card, lit, onEnter }: { card: ClassCard; lit: boolean; onEnter: () => void }) {
  return (
    <div className="arc-card" data-lit={lit || undefined} style={{ '--c': card.color, '--h': card.height } as CSSProperties} onMouseEnter={onEnter}>
      <span className="arc-tint" aria-hidden="true" />
      <span className="arc-beam" aria-hidden="true" />
      <Letter ch={card.letter} />
      <span className="arc-sparks" aria-hidden="true">
        {SPARKS.map(([x, s, t, d, dx]) => (
          <i key={x} style={{ '--x': x, '--s': s + 'px', '--t': t + 's', '--d': d + 's', '--dx': dx + 'px' } as CSSProperties} />
        ))}
      </span>
      <span className="arc-hero">
        <img src={ART + card.id + '.webp'} alt="" draggable={false} />
      </span>
      <span className="arc-label">
        <small>Стань</small>
        {card.role}
      </span>
    </div>
  )
}

// Две копии буквы в одной ячейке: в покое — только контур, у горящей карты снизу
// вверх поднимается заливка, как свет, наполняющий букву.
function Letter({ ch }: { ch: string }) {
  return (
    <span className="arc-letter" aria-hidden="true">
      <span className="arc-letter-line">{ch}</span>
      <span className="arc-letter-fill">{ch}</span>
    </span>
  )
}
