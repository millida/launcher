import { Suspense, lazy, useEffect, useState } from 'react'
import type { ComponentType } from 'react'
import { useEverTrue } from './everTrue'
import { whenIdle } from './idle'

type Loader = () => Promise<{ default: ComponentType }>

/** Чанк не пришёл (обновление посреди сеанса, диск): окно просто не откроется, а не уронит интерфейс. */
const missing = (e: unknown): { default: ComponentType } => {
  console.warn('[lateMount] chunk was not loaded', e)
  return { default: () => null }
}

/**
 * Окно или подвал, нужные не каждому сеансу: чанк с их кодом грузится при первой
 * надобности (`wanted()` стало true), а не в стартовом бандле. Смонтированный раз
 * остаётся в дереве — закрывающая анимация доигрывается, как и прежде.
 */
export function lazyHost(load: Loader, wanted: () => boolean): ComponentType {
  const Inner = lazy(() => load().catch(missing))
  function Host() {
    const need = useEverTrue(wanted())
    if (!need) return null
    return (
      <Suspense fallback={null}>
        <Inner />
      </Suspense>
    )
  }
  return Host
}

/**
 * Вспомогательный интерфейс, который можно показать не с первым кадром, а после
 * простоя (кнопка помощника, подсказки): код приходит отдельным чанком.
 */
export function lateMount(load: Loader, quietMs = 800): ComponentType {
  const Inner = lazy(() => load().catch(missing))
  function Late() {
    const [on, setOn] = useState(false)
    useEffect(() => whenIdle(() => setOn(true), quietMs), [])
    if (!on) return null
    return (
      <Suspense fallback={null}>
        <Inner />
      </Suspense>
    )
  }
  return Late
}

/** То же, что lazyHost, для компонента со свойствами: `wanted` смотрит на них (например, `on`). */
export function lazyHostWith<P extends object>(
  load: () => Promise<{ default: ComponentType<P> }>,
  wanted: (props: P) => boolean,
): ComponentType<P> {
  const Inner = lazy(() => load().catch((e) => ({ default: missing(e).default as ComponentType<P> })))
  function Host(props: P) {
    const need = useEverTrue(wanted(props))
    if (!need) return null
    return (
      <Suspense fallback={null}>
        <Inner {...props} />
      </Suspense>
    )
  }
  return Host
}
