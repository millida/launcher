import type { MouseEvent } from 'react'
import { Icon } from '../Icon'
import { showToast } from '../../state/ui'
import { STAR_LIMIT, useCatalogStars, useStarred } from '../../state/catalogStars'
import type { SiteCard } from './site'
import { useCatalogCtx } from './target'

export function StarButton({ section, card, wide, undo }: { section: string; card: SiteCard; wide?: boolean; undo?: boolean }) {
  const on = useStarred(section, card.slug)
  const server = useCatalogCtx().target.kind === 'server'
  const label = on ? 'Убрать из избранного' : 'В избранное'
  const toggle = (e: MouseEvent) => {
    e.stopPropagation()
    const result = useCatalogStars.getState().toggle(section, card)
    if (result === 'off' && undo)
      showToast('Убрано из избранного', 'ok', false, { label: 'Вернуть', run: () => void useCatalogStars.getState().toggle(section, card) })
    if (result === 'full') showToast('В избранном уже ' + STAR_LIMIT + ' — убери лишнее', 'error', false)
    if (result === 'failed') showToast('Не удалось сохранить избранное: память лаунчера недоступна', 'error', false)
  }
  if (server) return null
  if (wide)
    return (
      <button className={'btn md secondary mr-star-wide' + (on ? ' on' : '')} aria-pressed={on} data-track={on ? 'star_off' : 'star_on'} onClick={toggle}>
        <Icon id="i-star" />
        {on ? 'В избранном' : 'В избранное'}
      </button>
    )
  return (
    <button className={'mr-star' + (on ? ' on' : '')} aria-pressed={on} aria-label={label} data-tip={label} data-track={on ? 'star_off' : 'star_on'} onClick={toggle}>
      <Icon id="i-star" />
    </button>
  )
}
