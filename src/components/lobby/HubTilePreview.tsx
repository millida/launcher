// Только dev: плитки лобби под сундуком Battle Pass, для скриншотов.
// Подключается своим hubtile-preview.html, в основной бандл не попадает.
import '../../preview'
import { createRoot } from 'react-dom/client'
import '../../styles/01-base.css'
import '../../styles/02-kit.css'
import '../../styles/05-media.css'
import '../../styles/12-pixel.css'
import '../../styles/pixel/shell.css'
import { SvgSprite } from '../SvgSprite'
import { initAccent } from '../../lib/accent'
import { useDaily } from '../../state/daily'
import { usePlus } from '../../state/plus'
import { useShopGift } from '../shop/giftState'
import { DailyChest } from '../daily'
import { demoStatus } from '../daily/demoTrack'
import { HubTile } from './HubTile'

void initAccent()

const q = new URLSearchParams(location.search)
useDaily.setState({ status: demoStatus({ day: 3 }), load: async () => {} })
usePlus.setState({ load: async () => {}, active: false })
if (q.has('gift')) useShopGift.setState({ known: true, gift: { claimed: false, refreshAt: new Date(Date.now() + 3_600_000).toISOString() } } as never)

function Preview() {
  return (
    <div style={{ minHeight: '100vh', background: '#121212', color: 'var(--m-fg)', padding: 24 }}>
      <SvgSprite />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, width: 196 }}>
        <DailyChest hero />
        <HubTile kind="shop" />
        <HubTile kind="server" />
      </div>
    </div>
  )
}

createRoot(document.getElementById('root')!).render(<Preview />)
