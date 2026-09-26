import { useEffect, useRef, useState } from 'react'
import { claimWelcome, type FragmentProgress, type ItemRef } from '../lib/rubies'
import { getAccount, isMillidaKind } from '../state/accounts'
import { useGameNick } from '../state/gameNick'
import { useUi } from '../state/ui'
import '../styles/pixel/welcome.css'
import { Burst, Confetti, Rays } from './reward/RewardReveal'
import { ItemArt } from './shop/parts'
import { FragBar, RarityFx, RarityPlate } from './shop/rarityUi'
import { rarityProps } from './shop/rarity'

/**
 * Заставка при запуске: «С возвращением, <ник>» на зелёной сцене лобби
 * (правка владельца 23.09.2026: «чтобы чел чувствовал, что о нём заботятся»).
 * Первый запуск — «Добро пожаловать». Раз за запуск, ~2 с, клик пропускает.
 * Уходит пиксельным растворением: клетки гаснут волной от центра, на фронте
 * вспыхивают зелёным (как переход Arcania Lab).
 *
 * Первый запуск аккаунта Millida — подарок новичку (26.09.2026): половина
 * фрагментов нимба, остаток докупается в магазине. Заставка держится дольше и
 * показывает вещь карточкой с полосой фрагментов.
 */

const SEEN_KEY = 'm-welcomed'
const HOLD_MS = 1700
/** С подарком — дольше: вещь должна успеть «упасть» и прочитаться. */
const GIFT_HOLD_MS = 3400
const CELL = 36
const DISSOLVE_MS = 560
const FLASH_MS = 70
let shownThisRun = false

function firstEver(): boolean {
  try {
    const seen = localStorage.getItem(SEEN_KEY)
    localStorage.setItem(SEEN_KEY, '1')
    return !seen
  } catch {
    return false
  }
}

export function Welcome() {
  const logged = useUi((s) => s.logged)
  const gameName = useGameNick((s) => s.name)
  const [phase, setPhase] = useState<'off' | 'in' | 'out'>('off')
  const [first, setFirst] = useState(false)
  const [gift, setGift] = useState<{ item: ItemRef; fragments: FragmentProgress | null } | null>(null)
  const canvas = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    if (!logged || shownThisRun) return
    // Заставка встаёт сразу (слой выше #boot), чтобы лобби не мелькнуло, пока
    // гаснет загрузочный экран. Отсчёт показа начнётся, когда #boot уйдёт.
    shownThisRun = true
    const isFirst = firstEver() || new URLSearchParams(location.search).get('welcome') === 'first'
    setFirst(isFirst)
    setPhase('in')
    const acc = getAccount()
    if (isFirst && acc && isMillidaKind(acc.kind)) {
      void claimWelcome()
        .then((r) => r && r.item && setGift({ item: r.item, fragments: r.fragments ?? null }))
        .catch(() => undefined)
    }
  }, [logged])

  // Держим заставку положенное время только после того, как исчез #boot: иначе
  // отсчёт съедался, пока загрузочный экран ещё сверху.
  useEffect(() => {
    if (phase !== 'in') return
    let hold: ReturnType<typeof setTimeout>
    let poll: ReturnType<typeof setTimeout>
    const start = () => {
      if (document.getElementById('boot')) {
        poll = setTimeout(start, 80)
        return
      }
      hold = setTimeout(() => setPhase('out'), gift ? GIFT_HOLD_MS : HOLD_MS)
    }
    start()
    return () => {
      clearTimeout(hold)
      clearTimeout(poll)
    }
  }, [phase, gift])

  // Растворение: весь слой — холст, клетки стираются по порядку.
  useEffect(() => {
    if (phase !== 'out') return
    const cv = canvas.current
    const ctx = cv?.getContext('2d')
    if (!cv || !ctx || matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setPhase('off')
      return
    }
    const dpr = window.devicePixelRatio || 1
    const w = cv.clientWidth
    const h = cv.clientHeight
    cv.width = Math.round(w * dpr)
    cv.height = Math.round(h * dpr)
    ctx.scale(dpr, dpr)
    const cols = Math.ceil(w / CELL)
    const rows = Math.ceil(h / CELL)
    const cx = w / 2
    const cy = h / 2
    const order: number[] = []
    let max = 0
    for (let y = 0; y < rows; y++)
      for (let x = 0; x < cols; x++) {
        const d = Math.hypot((x + 0.5) * CELL - cx, (y + 0.5) * CELL - cy) * 0.72 + Math.random() * CELL * 3
        order.push(d)
        if (d > max) max = d
      }
    const t0 = performance.now()
    let raf = 0
    const tick = (now: number) => {
      const t = now - t0
      ctx.clearRect(0, 0, w, h)
      let left = 0
      for (let y = 0; y < rows; y++)
        for (let x = 0; x < cols; x++) {
          const at = (order[y * cols + x] / max) * DISSOLVE_MS
          if (t >= at + FLASH_MS) continue
          left++
          ctx.fillStyle = t >= at ? '#3fbf5c' : '#155f2a'
          ctx.fillRect(x * CELL, y * CELL, CELL, CELL)
        }
      if (left) raf = requestAnimationFrame(tick)
      else setPhase('off')
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [phase])

  if (phase === 'off') return null
  const acc = getAccount()
  const nick = (acc && isMillidaKind(acc.kind) && gameName) || acc?.nick || ''

  return (
    <div className={'welcome is-' + phase} onClick={() => setPhase('out')} role="presentation">
      <canvas ref={canvas} className="welcome-cells" aria-hidden="true" />
      {/* Первый вход — миг награды: лучи за логотипом, взрыв пикселей, конфетти. */}
      {first && phase === 'in' ? (
        <>
          <Rays className="welcome-rays" />
          <Confetti n={40} seed={11} />
        </>
      ) : null}
      <div className="welcome-body" aria-live="polite">
        {first && phase === 'in' ? <Burst n={30} spread={320} seed={9} /> : null}
        <img className="welcome-logo" src="/millida-logo.svg" alt="" />
        <span className="welcome-hi">{first ? 'Добро пожаловать' : 'С возвращением,'}</span>
        <b className="welcome-nick">{first ? 'в Millida' : nick || 'игрок'}</b>
        {gift ? (
          <div className="welcome-gift sh-card is-show" {...rarityProps(gift.item.rarity)}>
            <RarityFx />
            <span className="welcome-gift-tag">Подарок</span>
            <ItemArt item={gift.item} size="lg" />
            <b className="sh-card-name">{gift.item.name}</b>
            <span className="welcome-gift-foot">
              <RarityPlate rarity={gift.item.rarity} small />
              {gift.fragments ? (
                <FragBar have={gift.fragments.have} need={gift.fragments.need} rarity={gift.item.rarity} />
              ) : (
                <span className="welcome-gift-on">Надето</span>
              )}
            </span>
          </div>
        ) : null}
      </div>
    </div>
  )
}
