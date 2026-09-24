// Только dev: лист сундуков всех уровней и стадий для скриншотов.
import '../../preview'
import { createRoot } from 'react-dom/client'
import '../../styles/01-base.css'
import '../../styles/02-kit.css'
import '../../styles/12-pixel.css'
import '../../styles/pixel/shell.css'
import '../../styles/pixel/daily.css'
import type { ChestTier } from '../../lib/rubies'
import { chestSprite } from './chestSprite'

const TIERS: ChestTier[] = ['COMMON', 'RARE', 'EPIC', 'LEGEND']
const STATES = [{}, { crack: 1 }, { crack: 2 }, { crack: 3 }, { crack: 4 }, { open: true }, { gray: true }]

function Sheet() {
  return (
    <div style={{ padding: 16, display: 'grid', gap: 18, background: 'var(--m-bg)', minHeight: '100vh' }}>
      <div style={{ display: 'flex', gap: 24, alignItems: 'flex-end' }}>
        {TIERS.map((t) => (
          <img key={t} src={chestSprite(t)} width={240} height={276} style={{ imageRendering: 'pixelated' }} />
        ))}
      </div>
      {TIERS.map((t) => (
        <div key={t} style={{ display: 'flex', gap: 10 }}>
          {STATES.map((s, i) => (
            <img key={i} src={chestSprite(t, s)} width={120} height={138} style={{ imageRendering: 'pixelated' }} />
          ))}
        </div>
      ))}
    </div>
  )
}

createRoot(document.getElementById('root')!).render(<Sheet />)
