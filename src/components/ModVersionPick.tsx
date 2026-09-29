import { useEffect, useState } from 'react'
import { Select } from './Select'
import type { SelectOption } from './Select'
import { contentVersions, setContentVersion } from '../ipc/commands'
import type { VersionChoice } from '../ipc/commands'
import { showToast } from '../state/ui'
import { apiErrorText } from '../lib/apiError'

const CHANNEL: Record<string, string> = { beta: 'бета', alpha: 'альфа' }

export function versionOptions(list: readonly VersionChoice[]): SelectOption[] {
  return list.map((v) => ({
    value: v.id,
    label: v.number || v.id,
    sub: [v.current ? 'стоит сейчас' : '', CHANNEL[v.channel] ?? ''].filter(Boolean).join(' · ') || undefined,
  }))
}

export function ModVersionPick({
  profile,
  kind,
  file,
  current,
  onChanged,
}: {
  profile: string
  kind: string
  file: string
  current: string
  onChanged: () => void
}) {
  const [list, setList] = useState<VersionChoice[] | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let live = true
    setList(null)
    contentVersions(profile, kind, file)
      .then((l) => live && setList(l))
      .catch((e) => {
        if (!live) return
        setList([])
        showToast(apiErrorText(e, 'Не удалось получить версии мода'), 'error')
      })
    return () => {
      live = false
    }
  }, [profile, kind, file])

  const cur = list?.find((v) => v.current)?.id ?? ''
  return (
    <Select
      value={cur}
      width={220}
      search
      disabled={busy || !list || list.length === 0}
      placeholder={busy ? 'Меняем…' : current || 'Версия'}
      options={versionOptions(list ?? [])}
      onChange={(id) => {
        if (id === cur) return
        setBusy(true)
        setContentVersion(profile, kind, file, id)
          .then(() => {
            showToast('Версия изменена', 'ok')
            onChanged()
          })
          .catch((e) => showToast(apiErrorText(e, 'Не удалось сменить версию'), 'error'))
          .finally(() => setBusy(false))
      }}
    />
  )
}
