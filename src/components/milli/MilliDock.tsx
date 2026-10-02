import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { PxIcon } from '../PxIcon'
import { Milli } from './Milli'
import { MilliPackCard } from './MilliPack'
import { MilliPlusButton } from './MilliPlus'
import { SUPPORT_URL, openExt } from '../../lib/api'
import { LOADER_LABEL, MILLI_TEXT_MAX, milliCounterChip, milliLeft, milliResetText } from '../../lib/milli'
import type { MilliError, MilliMessage, MilliStatus } from '../../lib/milli'
import { useHasMillida } from '../../state/auth'
import {
  closeMilli,
  newMilliChat,
  openMilli,
  openMilliSession,
  refreshMilliPlans,
  refreshMilliStatus,
  retryMilli,
  sendMilli,
  setMilliEnhanced,
  showMilliHistory,
  useMilli,
} from '../../state/milli'
import { openModal, useUi } from '../../state/ui'
import { useHubTab } from '../playhub/hubTab'
import { usePlus } from '../../state/plus'
import { isMilliScreen } from '../../lib/milliScreens'
import '../../styles/pixel/milli.css'

/*
 * Милли в лаунчере (30.09.2026): только в каталоге — кнопка-Милли в правом
 * нижнем углу, чат панелью справа. На остальных экранах в том же углу кнопка
 * поддержки. Поддержка есть и в меню панели Милли.
 */

const EXAMPLES = ['Хоррор с зомби', 'Техно и заводы', 'Уютная ферма', 'Магия и данжи']

function Composer() {
  const [text, setText] = useState('')
  const pending = useMilli((s) => s.pending)
  // Счётчик на нуле — отправка ждёт сброса (карточка лимита уже сказала когда).
  const out = useMilli((s) => !!s.status && (s.status.day.remaining <= 0 || s.status.month.remaining <= 0))
  const focusSeq = useMilli((s) => s.focusSeq)
  const preset = useMilli((s) => s.preset)
  const hasMessages = useMilli((s) => s.messages.length > 0)
  const ref = useRef<HTMLTextAreaElement>(null)
  useEffect(() => {
    if (focusSeq) ref.current?.focus()
  }, [focusSeq])
  const submit = () => {
    const t = text.trim()
    if (!t || pending || out) return
    setText('')
    void sendMilli(t)
  }
  const status = useMilli((s) => s.status)
  return (
    <>
      {status ? <EnhancedToggle status={status} /> : null}
      <form
        className="mlc"
        onSubmit={(e) => {
          e.preventDefault()
          submit()
        }}
      >
        {preset && !hasMessages ? (
          <span className="mlc-preset">
            {preset.mcVersion ? <span className="mpk-plate">{preset.mcVersion}</span> : null}
            {preset.loader ? <span className="mpk-plate">{LOADER_LABEL[preset.loader]}</span> : null}
            <button type="button" className="mpk-x" aria-label="Убрать версию" onClick={() => useMilli.setState({ preset: null })}>
              <PxIcon name="x" size={12} />
            </button>
          </span>
        ) : null}
        <span className="mlc-row">
          <label className="input mlc-input">
            <textarea
              ref={ref}
              rows={1}
              value={text}
              maxLength={MILLI_TEXT_MAX}
              aria-label="Сообщение Милли"
              placeholder="Напиши Милли…"
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault()
                  submit()
                }
              }}
            />
          </label>
          <button type="submit" className="btn md primary mlc-send" aria-label="Отправить" data-track="milli_send" disabled={!text.trim() || pending || out}>
            <PxIcon name="send" size={18} />
          </button>
        </span>
      </form>
    </>
  )
}

/**
 * «Улучшенная сборка» (PLUS): второй проход — проверка совместимости, моды на
 * FPS, шейдеры и ресурспаки под версию. У бесплатного строка заперта замком
 * с кнопкой PLUS — она ведёт сразу в оплату.
 */
function EnhancedToggle({ status }: { status: MilliStatus }) {
  const enhanced = useMilli((s) => s.enhanced)
  if (!status.plus) {
    return (
      <div className="ml-enh">
        <span className="ml-enh-btn locked" aria-disabled="true">
          <PxIcon name="lock" size={12} />
          Улучшенная сборка
        </span>
        <MilliPlusButton label="PLUS" track="milli_plus_upsell" src="enhanced" />
      </div>
    )
  }
  if (status.features.enhanced === false) return null
  return (
    <div className="ml-enh">
      <button
        type="button"
        className={'ml-enh-btn' + (enhanced ? ' on' : '')}
        aria-pressed={enhanced}
        data-track="milli_enhanced"
        onClick={() => setMilliEnhanced(!enhanced)}
      >
        <PxIcon name="sparkle" size={12} />
        Улучшенная сборка
        <span className="ml-enh-sw" aria-hidden="true" />
      </button>
    </div>
  )
}

function Chips({ items, src }: { items: string[]; src: string }) {
  const pending = useMilli((s) => s.pending)
  if (!items.length) return null
  return (
    <div className="ml-chips" role="group" aria-label="Подсказки">
      {items.map((x, i) => (
        <button key={x} type="button" className="seg ml-chip" data-track="milli_chip" data-src={src} data-pos={i} disabled={pending} onClick={() => void sendMilli(x)}>
          {x}
        </button>
      ))}
    </div>
  )
}

function Bubble({ m, last }: { m: MilliMessage; last: boolean }) {
  if (m.role === 'user') {
    return (
      <div className="ml-msg me">
        <p className="ml-bubble">{m.text}</p>
      </div>
    )
  }
  return (
    <div className="ml-msg">
      <Milli size={40} className="ml-ava" />
      <div className="ml-col">
        {m.text ? <p className="ml-bubble">{m.text}</p> : null}
        {m.pack ? <MilliPackCard pack={m.pack} /> : null}
        {last ? <Chips items={m.suggestions ?? []} src="reply" /> : null}
      </div>
    </div>
  )
}

/** Без входа — Милли машет и одна кнопка (владелец 30.09 16:11: «дизайн, а не текст»). */
function Gate() {
  return (
    <div className="ml-state">
      <Milli size={136} mode="wave" />
      <button type="button" className="btn lg primary" data-track="milli_login" onClick={() => openModal('accModal')}>
        <PxIcon name="login" size={12} />
        Войти
      </button>
    </div>
  )
}

function ErrorCard({ e }: { e: MilliError }) {
  const status = useMilli((s) => s.status)
  if (e.kind === 'limit') {
    const c = status ? (e.scope === 'month' ? status.month : status.day) : null
    const when = c ? milliResetText(c.resetAt) : ''
    return (
      <div className="ml-limit" role="alert">
        <Milli size={56} mode="think" />
        <span className="ml-limit-text">
          <b>{e.text}</b>
          {when ? <span>Снова {when}</span> : null}
        </span>
        {!status?.plus ? <MilliPlusButton track="milli_plus_upsell" src="limit" /> : null}
      </div>
    )
  }
  return (
    <div className="ml-msg">
      <Milli size={40} className="ml-ava" />
      <div className="ml-col">
        <div className="ml-err" role="alert">
          <PxIcon name="alert" size={12} />
          <span>{e.text}</span>
          {e.retry ? (
            <button type="button" className="btn sm secondary" data-track="milli_retry" onClick={retryMilli}>
              Повторить
            </button>
          ) : null}
        </div>
      </div>
    </div>
  )
}

/**
 * A build takes 15-40 s: the steps follow the server pipeline in its real
 * order, so the player sees work instead of a frozen placeholder. The server
 * reports no progress, hence the timing marks the usual moment of each step.
 */
const THINK_STEPS: readonly (readonly [number, string])[] = [
  [0, 'Читаю, что ты хочешь…'],
  [4_000, 'Ищу моды на Modrinth…'],
  [11_000, 'Выбираю лучшие под твой запрос…'],
  [20_000, 'Проверяю версии и зависимости…'],
  [32_000, 'Сверяю файлы модов, почти готово…'],
]

function Thinking() {
  const [elapsed, setElapsed] = useState(0)
  useEffect(() => {
    const started = Date.now()
    const id = window.setInterval(() => setElapsed(Date.now() - started), 1_000)
    return () => window.clearInterval(id)
  }, [])
  const step = [...THINK_STEPS].reverse().find(([at]) => elapsed >= at)?.[1] ?? THINK_STEPS[0]![1]
  return (
    <div className="ml-msg" aria-busy="true" aria-label="Милли думает">
      <Milli size={40} mode="think" className="ml-ava" />
      <div className="ml-col">
        <div className="ml-bubble ml-skel">
          <span aria-live="polite">{step}</span>
          <span className="skel" style={{ width: '45%' }} />
        </div>
      </div>
    </div>
  )
}

function History() {
  const history = useMilli((s) => s.history)
  const failed = useMilli((s) => s.historyFailed)
  if (failed) return <p className="ml-empty-line">История не загрузилась</p>
  if (!history) {
    return (
      <div className="ml-hist">
        {[0, 1, 2].map((i) => (
          <span key={i} className="skel" style={{ height: 44 }} />
        ))}
      </div>
    )
  }
  if (!history.length) return <p className="ml-empty-line">Чатов пока нет</p>
  return (
    <ul className="ml-hist">
      {history.map((h) => (
        <li key={h.id}>
          <button type="button" className="ml-hist-row" data-track="milli_session" onClick={() => void openMilliSession(h.id)}>
            <b>{h.title || 'Без названия'}</b>
            <i>{new Date(h.updatedAt).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })}</i>
          </button>
        </li>
      ))}
    </ul>
  )
}

function Menu({ onClose }: { onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const down = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    document.addEventListener('mousedown', down)
    return () => document.removeEventListener('mousedown', down)
  }, [onClose])
  const item = (icon: string, label: string, run: () => void, track: string) => (
    <button
      type="button"
      className="ml-menu-item"
      role="menuitem"
      data-track={track}
      onClick={() => {
        onClose()
        run()
      }}
    >
      <PxIcon name={icon} size={12} />
      {label}
    </button>
  )
  return (
    <div className="ml-menu" role="menu" ref={ref}>
      {item('plus', 'Новый чат', newMilliChat, 'milli_new')}
      {item('clock', 'История', () => void showMilliHistory(), 'milli_history')}
      {item('headset', 'Поддержка', () => openExt(SUPPORT_URL), 'support_open')}
      {item('x', 'Закрыть', closeMilli, 'close')}
    </div>
  )
}

function Panel() {
  const open = useMilli((s) => s.open)
  const view = useMilli((s) => s.view)
  const messages = useMilli((s) => s.messages)
  const pending = useMilli((s) => s.pending)
  const error = useMilli((s) => s.error)
  const status = useMilli((s) => s.status)
  const mood = useMilli((s) => s.mood)
  const signed = useHasMillida()
  const plusActive = usePlus((s) => s.active)
  const [menu, setMenu] = useState(false)
  const scroller = useRef<HTMLDivElement>(null)

  // Оплатил PLUS из «Больше с PLUS» — счётчик и «Улучшенная сборка» сразу по новому тарифу.
  useEffect(() => {
    if (signed && plusActive) void refreshMilliStatus()
  }, [signed, plusActive])

  // Вошёл в аккаунт, пока висел запрос «войди» — спрашиваем то же самое.
  useEffect(() => {
    if (!signed) return
    void refreshMilliStatus()
    const s = useMilli.getState()
    if (s.error?.kind === 'auth' && s.failedText) retryMilli()
  }, [signed])

  // Новый ответ — к его началу (текст Милли и шапка сборки), остальное — вниз.
  useLayoutEffect(() => {
    const el = scroller.current
    if (!el) return
    const last = messages[messages.length - 1]
    const node = el.querySelector<HTMLElement>('.ml-msg:last-of-type')
    if (last && last.role === 'assistant' && !pending && !error && node) el.scrollTop = Math.max(0, node.offsetTop - 12)
    else el.scrollTop = el.scrollHeight
  }, [messages, pending, error, view])

  const lastAssistant = [...messages].reverse().find((m) => m.role === 'assistant')
  const off = status && !status.enabled
  const blocked = status?.blocked
  const body = !signed ? (
    <Gate />
  ) : off || blocked ? (
    <div className="ml-state">
      <Milli size={96} mode="idle" />
      <b>{off ? 'Милли отдыхает' : 'Милли тебе недоступна'}</b>
    </div>
  ) : view === 'history' ? (
    <History />
  ) : (
    <>
      {!messages.length && !pending ? (
        <div className="ml-hello">
          <Milli size={120} mode={mood === 'idle' ? 'wave' : mood} />
          <p className="ml-bubble">Привет! Какую сборку соберём?</p>
          <Chips items={EXAMPLES} src="examples" />
        </div>
      ) : null}
      {messages.map((m) => (
        <Bubble key={m.id} m={m} last={!pending && !error && m === lastAssistant} />
      ))}
      {pending ? <Thinking /> : null}
      {error && error.kind !== 'auth' ? <ErrorCard e={error} /> : null}
    </>
  )

  return (
    <aside className={'ml-panel' + (open ? ' on' : '')} aria-label="Милли" aria-hidden={!open} data-section="milli">
      <header className="ml-head">
        <Milli size={44} mode={mood} className="ml-head-art" />
        {signed && status ? (
          <span className={'ml-count' + (milliLeft(status) === 0 ? ' out' : '')} aria-label="Запросов осталось">
            {milliCounterChip(status)}
          </span>
        ) : null}
        {signed && status && !status.plus && !off && !blocked ? <MilliPlusButton track="milli_plus_upsell" src="head" /> : null}
        <span className="ml-head-gap" />
        {view === 'history' ? (
          <button type="button" className="ml-hbtn" aria-label="Назад" onClick={() => useMilli.setState({ view: 'chat' })}>
            <PxIcon name="chev-l" size={12} />
          </button>
        ) : null}
        <span className="ml-menu-wrap">
          <button type="button" className="ml-hbtn" aria-label="Меню" aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu((v) => !v)}>
            <PxIcon name="dots" size={12} />
          </button>
          {menu ? <Menu onClose={() => setMenu(false)} /> : null}
        </span>
        <button type="button" className="ml-hbtn" aria-label="Закрыть" data-sound="close" onClick={closeMilli}>
          <PxIcon name="x" size={12} />
        </button>
      </header>
      <div className="ml-scroll" ref={scroller}>
        {body}
      </div>
      {signed && !off && !blocked && view === 'chat' ? <Composer /> : null}
    </aside>
  )
}

function Fab() {
  return (
    <button type="button" className="mlf milli-wave-hover" data-sound="open" data-track="milli_fab" aria-label="Милли" onClick={() => openMilli({ src: 'fab' })}>
      <Milli size={60} mode="idle" />
      <span className="mlf-lab">Милли</span>
    </button>
  )
}

/** Вне каталога угол — обычная поддержка: чат поддержки Millida в браузере. */
function SupportFab() {
  return (
    <button
      type="button"
      className="msf"
      data-sound="open"
      data-track="support_fab"
      aria-label="Поддержка"
      data-tip="Поддержка"
      onClick={() => openExt(SUPPORT_URL)}
    >
      <PxIcon name="headset" size={22} />
    </button>
  )
}

/**
 * Угол лаунчера: в каталоге («Ресурсы», карточки материалов) — Милли и её
 * панель, на остальных экранах — кнопка поддержки (владелец 30.09.2026).
 */
export function MilliDock() {
  const logged = useUi((s) => s.logged)
  const screen = useUi((s) => s.screen)
  const buildOpen = useUi((s) => s.modals.bsModal.open)
  const hubAll = useHubTab((s) => s.all)
  const open = useMilli((s) => s.open)
  const here = isMilliScreen(screen, hubAll, buildOpen)
  const [seen, setSeen] = useState(false)
  useEffect(() => {
    if (open) setSeen(true)
  }, [open])
  useEffect(() => {
    if (!here) closeMilli()
    else void refreshMilliPlans()
  }, [here])
  if (!logged) return null
  if (!here) return <SupportFab />
  return (
    <>
      {open ? null : <Fab />}
      {/* Панель остаётся в DOM после первого открытия: прогресс установки и
          галочки в карточке сборки не теряются при сворачивании. */}
      {seen || open ? <Panel /> : null}
    </>
  )
}
