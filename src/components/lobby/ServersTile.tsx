import { useEffect, useState } from 'react'
import { setScreen } from '../../state/ui'
import { Logo } from '../ServerRow'
import { useRatingFeed } from '../../state/ratingFeed'
import { honestOnline } from '../../lib/onlineHonest'
import { liveInterval } from '../../lib/liveInterval'
import { fmtN } from '../../lib/format'
import { useT } from '../../i18n'
import '../../styles/pixel/hubtile.css'
import '../../styles/pixel/servers-tile.css'

/**
 * Плитка «Серверы» в левом столбце лобби: размер и рамка соседних плиток, Стив с вывеской.
 * Зовёт живым: сколько людей прямо сейчас играет на первой десятке рейтинга (честный онлайн, тот же список, что на сайте)
 * и по очереди сами серверы с их онлайном. «!» и золотая рамка — пока сегодня не заходили.
 */
const SEEN_KEY = 'm-servers-seen'
const FACT_MS = 3500
const SIGN_MS = 2200

const today = () => new Date().toISOString().slice(0, 10)
const seenToday = () => {
  try {
    return localStorage.getItem(SEEN_KEY) === today()
  } catch {
    return true
  }
}

export function ServersTile({ on }: { on: boolean }) {
  const t = useT()
  const feed = useRatingFeed({ step: 10, on })
  const [i, setI] = useState(0)
  const [k, setK] = useState(0)
  const [seen, setSeen] = useState(seenToday)
  const live = feed.list.filter((s) => s.isOnline && honestOnline(s) > 0)
  const playing = live.reduce((n, s) => n + honestOnline(s), 0)
  // В строке — самые людные из десятки.
  const crowd = [...live].sort((a, b) => honestOnline(b) - honestOnline(a)).slice(0, 4)
  const n = crowd.length

  const three = Math.min(3, feed.list.length)
  useEffect(() => {
    if (!on || three < 2) return
    return liveInterval(() => setK((x) => x + 1), SIGN_MS)
  }, [on, three])

  useEffect(() => {
    if (!on || n < 2) return
    return liveInterval(() => setI((x) => x + 1), FACT_MS)
  }, [on, n])

  const fact = n ? crowd[i % n]! : null
  // На табличке у Стива — логотипы первой тройки рейтинга по очереди.
  const top3 = feed.list.slice(0, 3)
  const open = () => {
    try {
      localStorage.setItem(SEEN_KEY, today())
    } catch {
      // без хранилища «!» просто останется до следующего запуска
    }
    setSeen(true)
    setScreen('servers')
  }

  return (
    <button
      type="button"
      className={'ht ht-servers' + (seen ? '' : ' is-gift')}
      data-sound="nav"
      data-track="tile_servers"
      data-section="lobby_tiles"
      onClick={open}
      aria-label={t('Серверы') + (playing ? ': ' + t('{n} играют', { n: fmtN(playing) }) : '')}
    >
      <span className="ht-frame" aria-hidden="true">
        <span className="ht-plate">
          <span className="ht-rays" />
          <span className="ht-edge-t" />
        </span>
      </span>
      <span className="px-run-ring ht-run" aria-hidden="true" />
      <span className="ht-artbox" aria-hidden="true">
        <img className="ht-art" src="/lobby/servers@2x.png" alt="" draggable={false} />
        {top3.length ? (
          <span className="svt-sign">
            {top3.map((sv, j) => (
              <span key={sv.slug || sv.name} className={j === k % top3.length ? 'is-on' : undefined}>
                <Logo sv={sv} />
              </span>
            ))}
          </span>
        ) : null}
      </span>
      <span className="ht-band">
        <b className="ht-title">{t('Серверы')}</b>
        {fact ? (
          <span className="ht-sub svt-fact" key={fact.slug || fact.name}>
            <span className="svt-fact-n">{fact.name}</span>
            <b>{fmtN(honestOnline(fact))}</b>
          </span>
        ) : null}
        {playing ? (
          <span className="ht-ribbon svt-live">
            <i />
            {t('{n} играют', { n: fmtN(playing) })}
          </span>
        ) : null}
      </span>
      {seen ? null : (
        <span className="ht-gift" aria-hidden="true">
          !
        </span>
      )}
    </button>
  )
}
