import type { MouseEvent } from 'react'
import { Icon } from '../Icon'
import { showToast } from '../../state/ui'
import { STAR_LIMIT, useCatalogStars, useStarred } from '../../state/catalogStars'
import type { SiteCard } from './site'
import { useCatalogCtx } from './target'
import { useT } from '../../i18n'

export function StarButton({ section, card, wide, undo }: { section: string; card: SiteCard; wide?: boolean; undo?: boolean }) {
  const t = useT()
  const on = useStarred(section, card.slug)
  const server = useCatalogCtx().target.kind === 'server'
  const label = on ? t('Убрать из избранного') : t('В избранное')
  const toggle = (e: MouseEvent) => {
    e.stopPropagation()
    const result = useCatalogStars.getState().toggle(section, card)
    if (result === 'off' && undo)
      showToast(t('Убрано из избранного'), 'ok', false, { label: t('Вернуть'), run: () => void useCatalogStars.getState().toggle(section, card) })
    if (result === 'full') showToast(t('В избранном уже {n} — убери лишнее', { n: STAR_LIMIT }), 'error', false)
    if (result === 'failed') showToast(t('Не удалось сохранить избранное: память лаунчера недоступна'), 'error', false)
  }
  if (server) return null
  if (wide)
    return (
      <button className={'btn md secondary mr-star-wide' + (on ? ' on' : '')} aria-pressed={on} data-track={on ? 'star_off' : 'star_on'} onClick={toggle}>
        <Icon id="i-star" />
        {on ? t('В избранном') : t('В избранное')}
      </button>
    )
  return (
    <button className={'mr-star' + (on ? ' on' : '')} aria-pressed={on} aria-label={label} data-tip={label} data-track={on ? 'star_off' : 'star_on'} onClick={toggle}>
      <Icon id="i-star" />
    </button>
  )
}
