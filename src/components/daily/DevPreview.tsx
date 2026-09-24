// Только dev: витрина сундука и радио для скриншотов. Подключается своим
// preview.html, в основной бандл не попадает.
import '../../preview'
import { createRoot } from 'react-dom/client'
import '../../styles/01-base.css'
import '../../styles/02-kit.css'
import '../../styles/04-hosting.css'
import '../../styles/05-media.css'
import '../../styles/12-pixel.css'
import '../../styles/pixel/shell.css'
import '../../styles/pixel/shop.css'
import { SvgSprite } from '../SvgSprite'
import { initAccent } from '../../lib/accent'
import { useDaily } from '../../state/daily'
import { usePlus } from '../../state/plus'
import { RadioToggle } from '../radio'
import { initMusic } from '../../state/music'
import { DailyChest } from './DailyChest'
import type { DailyView } from './track'
import { demoStatus } from './demoTrack'

initMusic()
void initAccent()

const q = new URLSearchParams(location.search)
const state = q.get('state') || 'ready'

// Схема 23.09.2026: трек, вещь двух недель. `&day=1..7`, `&have=N`,
// `&legacy=1` — старый ответ без трека, `&claim=1` — сразу «Забрать»,
// `&days=7` — служба отдаёт один цикл, остальное клиент достраивает прогнозом.
const legacy = q.has('legacy')
const fresh = demoStatus({
  day: Number(q.get('day')) || 3,
  plus: state === 'plus',
  claimed: state === 'claimed',
  have: q.has('have') ? Number(q.get('have')) : undefined,
  days: q.has('days') ? Number(q.get('days')) : undefined,
})
const base: DailyView = legacy ? { ...fresh, track: undefined, weekItem: undefined, plusMultiplier: 2 } : fresh
if (state !== 'live') {
  useDaily.setState({ status: base, load: async () => {} })
  usePlus.setState({ load: async () => {}, active: state === 'plus' })
  // Цена PLUS — живая, из публичных правил прода: придумывать её нельзя.
  fetch('/papi/v2/rubies/rules')
    .then((r) => r.json())
    .then((r) => {
      const plus = r?.packs?.plus
      if (plus) useDaily.setState({ plus: { active: state === 'plus', priceKopecks: plus.priceKopecks, items: plus.items } as never })
    })
    .catch(() => undefined)
}
if (q.has('modal')) useDaily.setState({ modal: true })
// `&hold=1` — «Забрать» не получает ответа: сундук трясётся, пока смотрим.
if (q.has('hold')) useDaily.setState({ claim: async () => useDaily.setState({ busy: 'claim', reveal: null }) })
if (q.has('claim')) setTimeout(() => void useDaily.getState().claim(), 600)

function Preview() {
  return (
    <div style={{ position: 'relative', minHeight: '100vh', background: 'var(--m-bg)', color: 'var(--m-fg)' }}>
      <SvgSprite />
      <div
        style={{
          position: 'relative',
          height: 420,
          margin: 16,
          background: '#27402f url(/hero-11.png) center/cover',
        }}
      >
        <div style={{ position: 'absolute', top: 14, left: 14 }}>
          <DailyChest compact />
        </div>
        <div className="hero-tools">
          <RadioToggle />
        </div>
      </div>
      <div style={{ margin: 16 }}>
        <DailyChest />
      </div>
    </div>
  )
}

createRoot(document.getElementById('root')!).render(<Preview />)
