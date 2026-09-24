import { useState } from 'react'
import { Icon } from '../Icon'
import { PxIcon } from '../PxIcon'
import { LOADER_NAME } from '../../lib/format'
import type { Profile } from '../../ipc/commands'
import { showToast } from '../../state/ui'

/*
 * Верх каталога: для какой сборки ищем (клик — сменить) и поле ИИ-помощника.
 * Помощник пока без бэкенда: ключ и эндпоинт не готовы, поэтому отправка
 * только говорит «Скоро» и ничего не ставит.
 */

export function CatalogFor({
  build,
  scoped,
  onPick,
  onToggle,
}: {
  build: Profile | null
  /** Выдача отфильтрована под сборку. */
  scoped: boolean
  onPick: () => void
  onToggle: () => void
}) {
  return (
    <div className="cat3-for" data-private>
      <button type="button" className="mk-pill cat3-for-btn" data-track="for_build" onClick={onPick}>
        <Icon id="i-box2" />
        <span className="cat3-for-lab">Для:</span>
        {build ? (
          <b>
            {build.name} · {build.version} · {LOADER_NAME(build)}
          </b>
        ) : (
          <b>выбери сборку</b>
        )}
        <Icon id="i-chev-r" />
      </button>
      {build ? (
        <button type="button" className="facet-reset" data-track={scoped ? 'for_build_all' : 'for_build_fit'} onClick={onToggle}>
          {scoped ? 'Показать всё' : 'Только подходящее'}
        </button>
      ) : null}
    </div>
  )
}

export function CatalogAsk() {
  const [v, setV] = useState('')
  const send = () => {
    if (!v.trim()) return
    showToast('ИИ-помощник — скоро', 'ok', false)
  }
  return (
    <form
      className="input cat3-ask"
      onSubmit={(e) => {
        e.preventDefault()
        send()
      }}
    >
      <PxIcon name="sparkle" size={18} className="px-icon cat3-ask-ic" />
      <input placeholder="Опиши сборку…" value={v} maxLength={300} onChange={(e) => setV(e.target.value)} />
      <button type="submit" className="btn sm primary" disabled={!v.trim()}>
        <Icon id="i-send" />
        Собрать
      </button>
    </form>
  )
}
