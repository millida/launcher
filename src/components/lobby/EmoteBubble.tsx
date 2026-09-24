import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { eltUrl } from '../../lib/eltaller'
import '../../styles/pixel/lobby-bubble.css'

/** Сколько облачко держится на экране. */
const HOLD_MS = 2500
/** Сколько длится уход — столько же, сколько анимация в lobby-bubble.css. */
const OUT_MS = 180
/** Не чаще раза в 8–15 с: облачко над каждой эмоцией приедается. */
const GAP_MIN = 8000
const GAP_MAX = 15000
/** Не на каждую эмоцию — «время от времени». */
const CHANCE = 0.75

/** Смайлы набора eltaller по настроению эмоции (id из manifest.json). */
const MOOD: Record<string, string[]> = {
  happy: ['17', '41', '27', '31', '04', '50', '34', '23', '21', '12', '52'],
  sad: ['01', '06', '13', '38', '37', '15'],
  love: ['22', '46', '32', '49'],
  angry: ['11', '43', '19'],
  think: ['28', '02', '36', '33'],
  cool: ['40', '18', '29'],
  wow: ['07', '48', '55', '47', '31'],
  sleepy: ['10', '51', '16'],
}
const moodEmoji = (mood: string, except?: string) => {
  const list = MOOD[mood] || MOOD.happy!
  const pool = list.length > 1 ? list.filter((x) => x !== except) : list
  return pool[Math.floor(Math.random() * pool.length)]!
}

interface Shown {
  id: string
  x: number
  y: number
  out: boolean
  key: number
}

/**
 * Пиксельное облачко с эмодзи над головой персонажа в лобби. Срабатывает,
 * когда персонаж сам играет эмоцию: LobbyCharacter шлёт в window событие
 * 'lobby-emote'. Встаёт над ником — берёт его место из самого ника
 * (.mc-nametag, тот же расчёт nametagSpot), поэтому рисуется в ту же сцену.
 *
 * Для проверки: window.dispatchEvent(new CustomEvent('lobby-emote', { detail: { force: true } }))
 * — без паузы и без броска кубика.
 */
export function EmoteBubble() {
  const [shown, setShown] = useState<Shown | null>(null)
  const [host, setHost] = useState<HTMLElement | null>(null)
  const nextAt = useRef(0)
  const timers = useRef<ReturnType<typeof setTimeout>[]>([])
  const lastId = useRef<string | undefined>(undefined)

  useEffect(() => {
    const clear = () => {
      for (const t of timers.current) clearTimeout(t)
      timers.current = []
    }
    const onEmote = (ev: Event) => {
      const detail = (ev as CustomEvent<{ force?: boolean; mood?: string; head?: { x: number; y: number; r: number } | null } | null>)
        .detail
      const force = !!detail?.force
      const now = Date.now()
      if (!force && (now < nextAt.current || Math.random() > CHANCE)) return
      const stage = document.querySelector<HTMLElement>('.lobby-char.shown')
      if (!stage) return
      nextAt.current = now + GAP_MIN + Math.random() * (GAP_MAX - GAP_MIN)
      const id = moodEmoji(detail?.mood || 'happy', lastId.current)
      lastId.current = id
      clear()
      setHost(stage)
      // Справа от головы на уровне глаз, хвостиком к лицу. Нет данных о
      // голове — по центру сцены на уровне верхней трети.
      const head = detail?.head
      const x = head ? head.x + head.r * 1.6 : stage.clientWidth / 2 + 60
      const y = head ? head.y + head.r * 0.4 : stage.clientHeight * 0.3
      setShown({ id, x, y, out: false, key: now })
      timers.current.push(
        setTimeout(() => setShown((s) => (s ? { ...s, out: true } : s)), HOLD_MS),
        setTimeout(() => setShown(null), HOLD_MS + OUT_MS),
      )
    }
    window.addEventListener('lobby-emote', onEmote)
    return () => {
      window.removeEventListener('lobby-emote', onEmote)
      clear()
    }
  }, [])

  if (!shown || !host || !host.isConnected) return null
  return createPortal(
    <div
      key={shown.key}
      className={'emote-bubble' + (shown.out ? ' out' : '')}
      style={{ left: shown.x + 'px', top: shown.y + 'px' }}
      aria-hidden="true"
    >
      <div className="eb-body">
        <img src={eltUrl(shown.id)} alt="" draggable={false} />
      </div>
      <span className="eb-tail" />
    </div>,
    host,
  )
}
