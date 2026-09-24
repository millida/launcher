import { useState } from 'react'
import { Icon } from '../Icon'
import { PackKeyModal } from '../PackKeyModal'
import { hasTauri } from '../../ipc/tauri'
import { PACK_ACCESS_PREFIX, installCatalogPack } from '../../ipc/commands'
import { keyCatalogPack } from '../../lib/installKeys'
import { runInstall, useInstalls } from '../../state/installs'
import { trackTimed } from '../../lib/telemetry'
import { useProfiles } from '../../state/profiles'
import { showToast } from '../../state/ui'
import type { PremiumPack } from '../../lib/premium'
import { DEMO_USER } from '../../lib/demo'
import { catalogInstallTracker } from '../../lib/install'

/// Установка платной сборки каталога — тем же путём, каким она шла из раздела
/// «Контент»: доступ проверяет сервер, отказ открывает окно ключа, после
/// активации установка продолжается сама.
export function PackInstallButton({ pack, size }: { pack: PremiumPack; size?: 'sm' }) {
  const [keyFor, setKeyFor] = useState<string | null>(null)
  const slug = pack.slug || ''
  const task = useInstalls((s) => s.tasks[keyCatalogPack(slug)])
  const done = useInstalls((s) => s.done[keyCatalogPack(slug)])
  const running = !!task && task.state === 'run'
  const label = running
    ? task.pct > 0
      ? task.label + ' ' + Math.round(task.pct) + '%'
      : task.label
    : done
      ? 'Установлено'
      : 'Установить'

  const start = () => {
    if (!slug) return
    if (!hasTauri()) {
      // Демо в браузере: здесь только платные сборки — показываем баннер «нет доступа».
      if (DEMO_USER) {
        setKeyFor('')
        return
      }
      showToast('Установка сборок — в приложении', 'error')
      return
    }
    const startedAt = performance.now()
    const installed = catalogInstallTracker('premium', slug, 'premium')
    runInstall({
      key: keyCatalogPack(slug),
      title: pack.title || slug,
      running: 'Скачивание…',
      run: () => installCatalogPack(slug),
      onError: (e) => {
        const text = String(e)
        if (text.startsWith(PACK_ACCESS_PREFIX)) {
          setKeyFor(text.slice(PACK_ACCESS_PREFIX.length))
          return
        }
        showToast(text, 'error')
      },
      onDone: (p) => {
        trackTimed('modpack_install', startedAt, {
          name: slug,
          kind: 'modpack',
          mc: p.version,
          loader: p.loader || (p.fabric ? 'fabric' : 'vanilla'),
          source: 'millida',
        })
        installed()
        useProfiles.getState().setSelected(p.name)
        void useProfiles.getState().refresh()
        showToast('Сборка «' + p.name + '» готова к запуску', 'ok', 'achievement')
      },
    })
  }

  return (
    <>
      {keyFor !== null ? (
        <PackKeyModal
          slug={slug}
          title={pack.title}
          reason={keyFor}
          onClose={() => setKeyFor(null)}
          onUnlocked={start}
        />
      ) : null}
      <button
        className={'btn primary' + (size === 'sm' ? ' sm' : '')}
        disabled={running || done}
        data-track="install"
        data-kind="premium"
        data-id={slug}
        onClick={start}
      >
        <Icon id="i-download" /> {label}
      </button>
    </>
  )
}
