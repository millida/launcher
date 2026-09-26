import { useEffect, useState } from 'react'
import { Icon } from './Icon'
import { hasTauri } from '../ipc/tauri'
import { PACK_ACCESS_PREFIX, loadProfileSettings, updateCatalogPack } from '../ipc/commands'
import { keyCatalogPack } from '../lib/installKeys'
import { catalogPackSlug, packUpdateFor, type PackUpdate } from '../lib/packUpdate'
import { forgetPackView, loadPackView } from './premium/packView'
import { runInstall, useInstalls } from '../state/installs'
import { usePackKey } from '../state/packKey'
import { useProfiles } from '../state/profiles'
import { uiConfirm } from '../state/confirm'
import { showToast } from '../state/ui'

async function findPackUpdate(profile: string): Promise<PackUpdate | null> {
  const settings = await loadProfileSettings(profile)
  const slug = catalogPackSlug(settings)
  if (!slug) return null
  return packUpdateFor(settings, await loadPackView(slug))
}

/**
 * The newer published version of a catalogue build. Nothing happens until the
 * player asks: the core then installs it beside the old one and switches only
 * once it is complete.
 */
export function PackUpdateRow({ profile, onUpdated }: { profile: string; onUpdated?: () => void }) {
  const [update, setUpdate] = useState<PackUpdate | null>(null)
  const [round, setRound] = useState(0)
  const task = useInstalls((s) => (update ? s.tasks[keyCatalogPack(update.slug)] : undefined))
  const finished = task?.state === 'done'

  useEffect(() => {
    setUpdate(null)
    if (!hasTauri()) return
    let alive = true
    // A failed check only means no offer this time; the next visit asks again.
    findPackUpdate(profile)
      .then((u) => {
        if (alive) setUpdate(u)
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [profile, round])

  // The update outlives the page that started it, so the page on screen learns
  // the result from the job, not from the click: the player may have closed it
  // or opened another build since.
  useEffect(() => {
    if (!finished) return
    setRound((r) => r + 1)
    onUpdated?.()
  }, [finished])

  if (!update) return null

  const running = !!task && task.state === 'run'
  const label = running ? (task.pct > 0 ? task.label + ' ' + Math.round(task.pct) + '%' : task.label) : 'Обновить'

  const run = (u: PackUpdate) => {
    runInstall({
      key: keyCatalogPack(u.slug),
      title: profile,
      running: 'Обновляем…',
      // The cached card can be older than the version just installed, and
      // compared with it the row would offer that older version as an update.
      // Dropped before the job reports done, so every later read is fresh.
      run: () =>
        updateCatalogPack(profile).then((p) => {
          forgetPackView(u.slug)
          return p
        }),
      onError: (e) => {
        const text = String(e)
        if (text.startsWith(PACK_ACCESS_PREFIX)) {
          usePackKey.getState().show(u.slug, profile, text.slice(PACK_ACCESS_PREFIX.length), () => run(u))
          return
        }
        showToast(text, 'error')
      },
      onDone: () => {
        void useProfiles.getState().refresh()
        showToast('Сборка «' + profile + '» обновлена до версии ' + u.to, 'ok', 'achievement')
      },
    })
  }

  const start = async (u: PackUpdate) => {
    const ok = await uiConfirm(
      'Поставим версию ' +
        u.to +
        ' рядом со старой и перенесём миры, скриншоты и настройки игры. Старая версия удалится, только когда новая встанет на место.',
      { title: 'Обновить «' + profile + '»?', confirmLabel: 'Обновить', danger: false },
    )
    if (ok) run(u)
  }

  return (
    <div className="bx-audit ok" id="bsPackUpdate">
      <div className="bx-audit-row">
        <Icon id="i-download" />
        <span className="bx-audit-text">
          {'Доступна новая версия сборки · ' + update.from + ' → ' + update.to}
        </span>
        <span style={{ flex: 1 }}></span>
        <button
          className="btn sm primary"
          disabled={running}
          data-track="pack_update"
          data-id={update.slug}
          onClick={() => void start(update)}
        >
          {label}
        </button>
      </div>
    </div>
  )
}
