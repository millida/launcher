import { useEffect, useRef, useState } from 'react'
import { Icon } from '../Icon'
import { PxIcon } from '../PxIcon'
import { LOADER_NAME, loaderId } from '../../lib/format'
import { Cover } from '../Cover'
import { BuildIcon } from '../playhub/BuildIcon'
import { loaderTone } from './site'
import type { Profile } from '../../ipc/commands'
import { showToast } from '../../state/ui'
import { intlTag, useT } from '../../i18n'

/*
 * Верх каталога: для какой сборки ищем (клик — сменить) и поле ИИ-помощника.
 * Помощник пока без бэкенда: ключ и эндпоинт не готовы, поэтому отправка
 * только говорит «Скоро» и ничего не ставит.
 */

/**
 * «Для какой сборки ищем» (владелец 10.10.2026: «самая полезная кнопка — сделай её
 * охуенно»). Один блок из двух частей:
 *  - сборка: значок, имя, версия и ядро; клик — выпадающий список сборок прямо тут,
 *    без окна на весь экран; внизу — «Новая сборка»;
 *  - что показывать: «Подходит» (только то, что запустится в этой сборке) или «Всё» —
 *    с числом материалов у каждого, чтобы было видно, сколько отсекает фильтр.
 */
export function CatalogFor({
  build,
  builds,
  scoped,
  fitCount,
  allCount,
  onSelect,
  onScope,
  onNew,
  custom = false,
}: {
  /** Выдача сужена своими версией/ядром, не под сборку. */
  custom?: boolean
  build: Profile | null
  builds: Profile[]
  /** Выдача отфильтрована под сборку. */
  scoped: boolean
  fitCount: number | null
  allCount: number | null
  onSelect: (name: string) => void
  onScope: (on: boolean) => void
  onNew: () => void
}) {
  const t = useT()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const down = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    const key = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('pointerdown', down)
    document.addEventListener('keydown', key)
    return () => {
      document.removeEventListener('pointerdown', down)
      document.removeEventListener('keydown', key)
    }
  }, [open])
  const n = (v: number | null) => (v == null ? '' : v.toLocaleString(intlTag()))
  return (
    <div className="cfor-wrap" data-private ref={ref}>
      <section className="card cfor" aria-label={t('Для какой сборки')}>
        <div className="cfor-h">{t('Ставлю в сборку')}</div>
        <div className="cfor-row">
          <span className="cfor-cover">
            {build ? <BuildIcon icon={build.icon} name={build.name} size={40} /> : <Cover url={null} />}
          </span>
          <span className="cfor-text">
            <b>{build ? build.name : t('Сборка не выбрана')}</b>
            {build ? (
              <small>
                {build.version} · <span style={{ color: loaderTone(loaderId(build)) || undefined }}>{LOADER_NAME(build)}</span>
              </small>
            ) : null}
          </span>
        </div>
        <button type="button" className="btn sm secondary cfor-change" aria-haspopup="listbox" aria-expanded={open} data-track="for_build" onClick={() => setOpen((v) => !v)}>
          {build ? t('Сменить сборку') : t('Выбрать сборку')}
          <Icon id="i-chev-d" />
        </button>
        {build ? (
          <button type="button" className="cfor-fit" role="switch" aria-checked={scoped} data-track={scoped ? 'for_build_all' : 'for_build_fit'} onClick={() => onScope(!scoped)}>
            <span className={'tgl sm' + (scoped ? ' on' : '')} aria-hidden="true" />
            <span className="cfor-fit-t">
              <b>{t('Только подходящее')}</b>
              <small>{scoped ? (fitCount != null ? t('{n} запустится в этой сборке', { n: n(fitCount) }) : t('то, что запустится в этой сборке')) : (custom ? t('свои фильтры версии и ядра') : t('показано всё')) + (allCount != null ? ' · ' + n(allCount) : '')}</small>
            </span>
          </button>
        ) : null}
      </section>
      {open ? (
        <div className="cfor-pop" role="listbox" aria-label={t('Сборки')}>
          <div className="cfor-pop-h">{t('Куда ставить моды')}</div>
          <div className="cfor-list">
            {builds.map((p) => {
              const on = !!build && p.name === build.name
              return (
                <button
                  key={p.name}
                  type="button"
                  role="option"
                  aria-selected={on}
                  className={'cfor-item' + (on ? ' on' : '')}
                  onClick={() => {
                    setOpen(false)
                    onSelect(p.name)
                  }}
                >
                  <span className="cfor-cover sm">
                    <BuildIcon icon={p.icon} name={p.name} size={34} />
                  </span>
                  <span className="cfor-item-t">
                    <b>{p.name}</b>
                    <small>
                      {p.version} · <span style={{ color: loaderTone(loaderId(p)) || undefined }}>{LOADER_NAME(p)}</span>
                    </small>
                  </span>
                  {on ? <Icon id="i-check" /> : null}
                </button>
              )
            })}
          </div>
          <button
            type="button"
            className="cfor-new"
            data-track="for_build_new"
            onClick={() => {
              setOpen(false)
              onNew()
            }}
          >
            <Icon id="i-plus" /> {t('Новая сборка')}
          </button>
        </div>
      ) : null}
    </div>
  )
}

export function CatalogAsk() {
  const t = useT()
  const [v, setV] = useState('')
  const send = () => {
    if (!v.trim()) return
    showToast(t('ИИ-помощник — скоро'), 'ok', false)
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
      <input placeholder={t('Опиши сборку…')} value={v} maxLength={300} onChange={(e) => setV(e.target.value)} />
      <button type="submit" className="btn sm primary" disabled={!v.trim()}>
        <Icon id="i-send" />
        {t('Собрать')}
      </button>
    </form>
  )
}
