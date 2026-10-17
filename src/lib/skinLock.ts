import { loadPlus, loadWardrobe } from './gameProfile'
import { t } from '../i18n'
import { uiChoice } from '../state/confirm'
import { setScreen } from '../state/ui'
import { isOrderedSkin, skinLockVerdict, type SkinLockVerdict } from './skinLockRule'

const PROBE_TIMEOUT_MS = 4000

function skinWidth(url: string): Promise<number> {
  return new Promise((resolve) => {
    const img = new Image()
    const timer = setTimeout(() => resolve(0), PROBE_TIMEOUT_MS)
    img.onload = () => {
      clearTimeout(timer)
      resolve(img.naturalWidth)
    }
    img.onerror = () => {
      clearTimeout(timer)
      resolve(0)
    }
    img.src = url
  })
}

interface SkinLock {
  verdict: SkinLockVerdict
  side: number
}

async function readSkinLock(): Promise<SkinLock> {
  const [plus, wardrobe] = await Promise.all([loadPlus(), loadWardrobe()])
  const url = wardrobe.active.skinUrl
  if (plus.active || !url) return { verdict: 'play', side: 0 }
  const orderedSkin = isOrderedSkin(url, wardrobe.items)
  const side = orderedSkin ? 0 : await skinWidth(url)
  return { verdict: skinLockVerdict({ millidaSkin: true, plusActive: plus.active, orderedSkin, skinWidth: side }), side }
}

/// Resolves true when the launch must stop. A failed check lets the game start:
/// a network hiccup must not lock a player out of a skin they may well be allowed.
export async function holdLaunchForHdSkin(): Promise<boolean> {
  const lock = await readSkinLock().catch(() => null)
  if (!lock || lock.verdict === 'play') return false
  const choice = await uiChoice(
    t('Скин {side}×{side} — HD, а HD-скины работают только с PLUS. Подписка закончилась: продли PLUS или надень обычный скин 64×64, и игра запустится.', {
      side: lock.side,
    }),
    {
      title: t('HD-скин без PLUS'),
      confirmLabel: t('Продлить PLUS'),
      cancelLabel: t('Сменить скин'),
      danger: false,
    },
  )
  if (choice === 'yes') setScreen('premium')
  if (choice === 'no') setScreen('skins')
  return true
}
