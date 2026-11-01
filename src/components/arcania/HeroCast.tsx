import { useState, type CSSProperties } from 'react'
import { useT } from '../../i18n'
import { CAST, art, type ClassCard } from './content'
import { useArcaniaArt } from './useArcaniaArt'
import './hero-cast.css'

const SPARKS = [
  ['22%', 5, 3.4, 0, -18],
  ['38%', 7, 4.2, 0.9, -8],
  ['50%', 4, 3.0, 1.7, 4],
  ['62%', 6, 3.8, 0.4, 12],
  ['76%', 4, 3.2, 1.3, 20],
] as const

export function HeroCast({ installed, onPlay }: { installed: boolean; onPlay: () => void }) {
  useArcaniaArt()
  const t = useT()
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
                  {installed ? t('Играть') : t('Начать')}
                  <br />
                  {installed ? t('сейчас') : t('играть')}
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
  const t = useT()
  return (
    <div className="arc-card" data-lit={lit || undefined} style={{ '--c': card.color, '--h': card.height } as CSSProperties} onMouseEnter={onEnter}>
      <span className="arc-tint" aria-hidden="true" />
      <span className="arc-beam" aria-hidden="true" />
      <Letter ch={card.letter} />
      <span className="arc-sparks" aria-hidden="true">
        {SPARKS.map(([x, s, dur, d, dx]) => (
          <i key={x} style={{ '--x': x, '--s': s + 'px', '--t': dur + 's', '--d': d + 's', '--dx': dx + 'px' } as CSSProperties} />
        ))}
      </span>
      <span className="arc-hero">
        <img src={art(card.id + '.webp')} alt="" draggable={false} />
      </span>
      <span className="arc-label">
        <small>{t('Стань')}</small>
        {t(card.role)}
      </span>
    </div>
  )
}

// Two stacked copies of the letter: the fill rises over the outline, so a lit card reads as light filling it.
function Letter({ ch }: { ch: string }) {
  return (
    <span className="arc-letter" aria-hidden="true">
      <span className="arc-letter-line">{ch}</span>
      <span className="arc-letter-fill">{ch}</span>
    </span>
  )
}
