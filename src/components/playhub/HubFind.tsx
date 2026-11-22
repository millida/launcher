import { useState } from 'react'
import { Icon } from '../Icon'
import { useT } from '../../i18n'

/**
 * Первый экран библиотеки (владелец 30.09.2026), как на millida.net/katalog:
 * поле и крупная зелёная «Найти». Текст поля — запрос каталога (Enter или «Найти»).
 * The AI builder entry lives only in the modpack catalog, so the home screen stays a plain search.
 */
export function HubFind({ onSearch }: { onSearch: (q: string) => void }) {
  const t = useT()
  const [q, setQ] = useState('')
  return (
    <form
      className="hub-find"
      role="search"
      onSubmit={(e) => {
        e.preventDefault()
        onSearch(q.trim())
      }}
    >
      <label className="input hs-field hub-find-field">
        <Icon id="i-search" />
        <input value={q} placeholder={t('Мод, сборка или карта')} maxLength={200} onChange={(e) => setQ(e.target.value)} />
      </label>
      <button type="submit" className="btn lg primary hub-find-go" data-sound="open" data-track="hub_search">
        {t('Найти')}
      </button>
    </form>
  )
}
