import { useEffect, useRef, useState } from 'react'
import { packwizCheck, packwizUpdate } from '../../ipc/commands'
import type { PackwizCheck } from '../../ipc/commands'
import { hasTauri } from '../../ipc/tauri'
import { apiErrorText } from '../../lib/apiError'
import { showToast } from '../../state/ui'
import { Icon } from '../Icon'
import { useT } from '../../i18n'

const autoKey = (p: string) => 'm-packwiz-auto-' + p

function readAuto(profile: string): boolean {
  try {
    return localStorage.getItem(autoKey(profile)) !== '0'
  } catch {
    return true
  }
}

/** A build linked to a packwiz pack: checks the pack on open and follows it unless the player turned that off. */
export function PackwizRow({ profile, running, onUpdated }: { profile: string; running: boolean; onUpdated: () => void }) {
  const t = useT()
  const [st, setSt] = useState<PackwizCheck | null>(null)
  const [busy, setBusy] = useState(false)
  const [auto, setAuto] = useState(() => readAuto(profile))
  const seq = useRef(0)

  const update = (quiet: boolean) => {
    setBusy(true)
    packwizUpdate(profile)
      .then((r) => {
        setSt((s) => (s ? { ...s, newer: false } : s))
        onUpdated()
        if (!quiet || r.added || r.removed) showToast(t('Пак обновлён: новых файлов {added}, убрано {removed}', { added: r.added, removed: r.removed }), 'ok')
        if (r.skipped.length) showToast(t('Не скачались: {list}', { list: r.skipped.join(', ') }), 'error')
      })
      .catch((e) => showToast(apiErrorText(e, t('Не удалось обновить пак')), 'error'))
      .finally(() => setBusy(false))
  }

  useEffect(() => {
    setSt(null)
    setAuto(readAuto(profile))
    if (!hasTauri()) return
    const mine = ++seq.current
    packwizCheck(profile)
      .then((c) => {
        if (mine !== seq.current) return
        setSt(c)
        if (c.linked && c.newer && readAuto(profile) && !running) update(true)
      })
      .catch(() => mine === seq.current && setSt(null))
  }, [profile])

  if (!st || !st.linked) return null
  return (
    <div className="set-row">
      <span className="lab">
        {t('Пак packwiz')}
        <small>{st.version || st.url}</small>
      </span>
      <span
        className={'tgl' + (auto ? ' on' : '')}
        role="switch"
        aria-checked={auto}
        aria-label={t('Обновлять сам')}
        title={t('Обновлять сам')}
        onClick={() => {
          const next = !auto
          setAuto(next)
          try {
            localStorage.setItem(autoKey(profile), next ? '1' : '0')
          } catch {
            /* the switch holds for this session */
          }
        }}
      />
      {st.newer ? (
        <button className="btn sm primary" disabled={busy || running} onClick={() => update(false)}>
          <Icon id="i-arrow-up" /> {busy ? t('Обновляем…') : t('Обновить')}
        </button>
      ) : null}
    </div>
  )
}
