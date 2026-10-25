import { useEffect, useState } from 'react'
import { Icon } from '../Icon'
import { PackInstallButton } from '../premium/PackInstall'
import { useT } from '../../i18n'
import { installedPack } from '../../lib/lobbyPlay'
import { keyCatalogPack } from '../../lib/installKeys'
import { ARCANIA_LEGACY_VERSION, ARCANIA_SLUG } from '../../lib/arcaniaRelease'
import type { PremiumPack } from '../../lib/premium'
import { useInstalls } from '../../state/installs'
import { useProfiles } from '../../state/profiles'

const LEGACY: PremiumPack = { id: ARCANIA_SLUG, slug: ARCANIA_SLUG, title: 'Arcania ' + ARCANIA_LEGACY_VERSION }

/** Arcania 1.4.3 is its own catalog pack and its own build, so 2.0 never replaces its worlds. */
export function ArcaniaLegacy({ onPlay }: { onPlay: (build: string) => void }) {
  const t = useT()
  const profiles = useProfiles((s) => s.profiles)
  const justInstalled = useInstalls((s) => !!s.done[keyCatalogPack(ARCANIA_SLUG)])
  const [build, setBuild] = useState<string | null | undefined>(undefined)

  useEffect(() => {
    let alive = true
    void installedPack(ARCANIA_SLUG, profiles).then((name) => alive && setBuild(name))
    return () => {
      alive = false
    }
  }, [profiles, justInstalled])

  const label = t('Продолжить играть в {version}', { version: ARCANIA_LEGACY_VERSION })
  if (build === undefined) return null
  if (build)
    return (
      <button className="btn sm ghost" data-sound="open" data-track="play" data-src="arcania_legacy" onClick={() => onPlay(build)}>
        <Icon id="i-play" /> {label}
      </button>
    )
  return <PackInstallButton pack={LEGACY} size="sm" ghost label={label} />
}
