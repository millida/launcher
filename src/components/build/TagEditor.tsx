import { useState } from 'react'
import { setContentTags } from '../../ipc/commands'
import { hasTauri } from '../../ipc/tauri'
import { apiErrorText } from '../../lib/apiError'
import { showToast } from '../../state/ui'
import { Icon } from '../Icon'
import { useT } from '../../i18n'
import '../../styles/pixel/build-extras.css'

export const TAG_MAX = 24

export function TagEditor({
  profile,
  kind,
  file,
  tags,
  known,
  onSaved,
}: {
  profile: string
  kind: string
  file: string
  tags: string[]
  known: string[]
  onSaved: () => void
}) {
  const t = useT()
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const save = (next: string[]) => {
    if (!hasTauri()) {
      showToast(t('Доступно в приложении'))
      return
    }
    setBusy(true)
    setContentTags(profile, kind, file, next)
      .then(() => {
        setDraft('')
        onSaved()
      })
      .catch((e) => showToast(apiErrorText(e, t('Не удалось сохранить теги')), 'error'))
      .finally(() => setBusy(false))
  }
  const add = (raw: string) => {
    const tag = raw.trim()
    if (!tag || tags.some((x) => x.toLowerCase() === tag.toLowerCase())) return setDraft('')
    save([...tags, tag])
  }
  const offers = known.filter((k) => !tags.includes(k)).slice(0, 6)
  return (
    <div className="bx-tags">
      {tags.map((tag) => (
        <button key={tag} type="button" className="bx-tag on" disabled={busy} aria-label={t('Убрать тег {tag}', { tag })} onClick={() => save(tags.filter((x) => x !== tag))}>
          {tag} <Icon id="i-x" />
        </button>
      ))}
      {offers.map((tag) => (
        <button key={tag} type="button" className="bx-tag" disabled={busy} onClick={() => add(tag)}>
          <Icon id="i-plus" /> {tag}
        </button>
      ))}
      {tags.length < 5 ? (
        <input
          className="input bx-tag-input"
          value={draft}
          maxLength={TAG_MAX}
          disabled={busy}
          placeholder={t('Новый тег')}
          spellCheck={false}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              add(draft)
            }
          }}
        />
      ) : null}
    </div>
  )
}
