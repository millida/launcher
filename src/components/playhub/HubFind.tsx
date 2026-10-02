import { useState } from 'react'
import { Icon } from '../Icon'
import { Milli } from '../milli/Milli'
import { openMilli } from '../../state/milli'
import { useHubTab } from './hubTab'

/**
 * Первый экран библиотеки (владелец 30.09.2026), как на millida.net/katalog:
 * поле, крупная зелёная «Найти» и «Собрать с ИИ». Текст поля — запрос
 * каталога (Enter или «Найти») либо просьба к Милли: «Собрать с ИИ» открывает
 * её чат и отправляет написанное.
 */
export function HubFind({ onSearch }: { onSearch: (q: string) => void }) {
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
        <input value={q} placeholder="Мод, сборка, карта или просьба к ИИ" maxLength={200} onChange={(e) => setQ(e.target.value)} />
      </label>
      <button type="submit" className="btn lg primary hub-find-go" data-sound="open" data-track="hub_search">
        Найти
      </button>
      <button
        type="button"
        className="btn lg secondary hub-find-ai"
        data-sound="open"
        data-track="ai_builder_open"
        onClick={() => {
          // Milli lives in the catalog («Ресурсы»); on the library tab the dock hides her and the request sat unseen.
          useHubTab.getState().setAll(true)
          openMilli(q.trim() ? { text: q.trim(), src: 'hub' } : { src: 'hub' })
        }}
      >
        <Milli size={24} mode="idle" /> Собрать с ИИ
      </button>
    </form>
  )
}
