import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { PxIcon } from '../PxIcon'
import { Milli } from './Milli'
import { MilliPackCard } from './MilliPack'
import { MilliActionCard } from './MilliAction'
import { MilliPicker } from './MilliPicker'
import { messageAction } from '../../lib/milliActions'
import { MilliPlusSheet, openPlusSheet } from './MilliPlusSheet'
import { MilliSizePick, saveMilliSize } from './MilliSizePick'
import { MilliSetup } from './MilliSetup'
import { MilliProgress, MilliSendGlobe, milliThinkStep, type MilliSendGlobeHandle } from './MilliGlobe'
import { BenchChanges } from './bench/BenchChanges'
import { useBench } from '../../state/milliBench'
import { MilliAva, MilliHead, MilliSafe, MilliScene } from './MilliStage'
import { PxArt, type PxName } from './px'
import { SUPPORT_URL, openExt } from '../../lib/api'
import { LOADER_LABEL, MILLI_TEXT_MAX, isMilliSizeAsk, milliLeft, milliLook, milliPlanNumbers, milliPreviewOn, milliPreviewTier, milliResetText, setMilliPreviewTier } from '../../lib/milli'
import type { MilliError, MilliGreeting, MilliGreetingChip, MilliMessage } from '../../lib/milli'
import { milliCue, type MilliMode } from './Milli'
import { useHasMillida } from '../../state/auth'
import {
  cancelMilli,
  closeMilli,
  loadMilliGreeting,
  newMilliChat,
  openMilli,
  openMilliSession,
  pickMilliGreeting,
  refreshMilliPlans,
  refreshMilliStatus,
  retryMilli,
  sendMilli,
  showMilliHistory,
  useMilli,
} from '../../state/milli'
import { openModal, useUi } from '../../state/ui'
import { useHubTab } from '../playhub/hubTab'
import { usePlus } from '../../state/plus'
import { isMilliScreen } from '../../lib/milliScreens'
import { MilliPlan } from './MilliPlan'
import '../../styles/pixel/milli.css'

// Анимации ленты и карточки (моушн-дизайнер): подключаются, как только файл появится.
import.meta.glob('../../styles/pixel/milli-motion.css', { eager: true })

/** Правило 11: игроку не больше двух подсказок; «Отмени» не дублирует кнопку «Отменить» события. */
function replyChips(m: MilliMessage): string[] {
  const undoable = !!m.pack?.changes && !!useBench.getState().head?.parent
  return (m.suggestions ?? []).filter((x) => !(undoable && /^отмени/i.test(x.trim()))).slice(0, 3)
}

/** Ответ на «Сколько модов взять?»: запомнить и отправить размер. */
function pickSize(n: number) {
  saveMilliSize(n)
  void sendMilli('≈' + n + ' модов', { size: n })
}

/*
 * Милли в лаунчере (30.09.2026): только в каталоге — кнопка-Милли в правом
 * нижнем углу, чат панелью справа. На остальных экранах в том же углу кнопка
 * поддержки. Поддержка есть и в меню панели Милли.
 */

/*
 * Примеры в пустом чате (исследование рынка, milli-server/research/MARKET-2026-10.md):
 * восемь ниш в порядке спроса. На кнопке — короткое имя, Милли уходит полный
 * запрос. Значок — рисунок художника из px/.
 */
interface Example {
  label: string
  ask: string
  /** Главный мод ниши — в подписи над хотбаром. */
  mod: string
  /** Значок ниши — рисунок художника (px/), один стиль на все восемь. */
  icon: PxName
}
const EXAMPLES: readonly Example[] = [
  {
    label: 'Хоррор на выживание',
    ask: 'Собери страшную хоррор-сборку на выживание: The Broken Script 2.0, преследующие сущности, тёмные ночи и жуткий звук. Должно быть страшно, но играбельно, можно с другом.',
    mod: 'The Broken Script',
    icon: 'steve_glow',
  },
  {
    label: 'Зомби-апокалипсис',
    ask: 'Сделай сборку зомби-апокалипсиса в духе The Last of Us: орды умных зомби, разрушенные города, огнестрел, жажда и выживание.',
    mod: 'Zombie Awareness',
    icon: 'zombie_bandage',
  },
  {
    label: 'Техно с Create',
    ask: 'Собери техно-сборку вокруг Create 6: механизмы, поезда, автоматизация заводов и дирижабли из Create Aeronautics, с прогрессией от андезита к латуни.',
    mod: 'Create',
    icon: 'create_cog',
  },
  {
    label: 'RPG с классами',
    ask: 'Хочу RPG-сборку с классами (маг, паладин, лучник, разбойник), красивым боем, данжами и боссами.',
    mod: 'Better Combat',
    icon: 'rpg_sword_shield',
  },
  {
    label: 'Оптимизация до 300 FPS',
    ask: 'Сделай максимально лёгкую сборку на последнюю версию для слабого ПК: как ванилла, но FPS в 2–3 раза выше и без фризов.',
    mod: 'Sodium',
    icon: 'fps_torch',
  },
  {
    label: 'Улучшенная ванилла',
    ask: 'Собери ваниль+: тот же Майнкрафт, но красивее и удобнее: шейдеры, живые анимации мобов, мини-карта, звуки шагов, без новых предметов.',
    mod: 'Fresh Animations',
    icon: 'grass_dandelion',
  },
  {
    label: 'Магия и заклинания',
    ask: 'Хочу магическую сборку: заклинания, книги и посохи, магические боссы и подземелья, прокачка мага.',
    mod: 'Iron\'s Spells \'n Spellbooks',
    icon: 'spellbook',
  },
  {
    label: 'Выживание с друзьями',
    ask: 'Собери кооп-сборку для игры с друзьями на сервере: голосовой чат, общие приваты, телепорты, ферма и немного Create. Не тяжёлая, чтобы тянули все.',
    mod: 'Simple Voice Chat',
    icon: 'friends_heads',
  },
]

/**
 * Примеры — хотбар Minecraft: восемь ячеек с предметами, над ними имя
 * выбранного, как в игре при прокрутке колёсиком. Выбор сам переходит по
 * ячейкам, пока мышь не над хотбаром; наведение и фокус выбирают ячейку,
 * нажатие отправляет полный запрос.
 */
function Hotbar() {
  const pending = useMilli((s) => s.pending)
  const open = useMilli((s) => s.open)
  const [sel, setSel] = useState(0)
  const [hold, setHold] = useState(false)
  const [press, setPress] = useState(-1)
  useEffect(() => {
    if (!open || hold) return
    const id = window.setInterval(() => setSel((v) => (v + 1) % EXAMPLES.length), 2_600)
    return () => window.clearInterval(id)
  }, [open, hold])
  const pick = (i: number) => setSel(i)
  const cur = EXAMPLES[sel]!
  return (
    <div
      className="ml-hb-wrap"
      onMouseEnter={() => setHold(true)}
      onMouseLeave={() => setHold(false)}
    >
      <span key={sel} className="ml-hb-name" aria-hidden="true">
        <b>{cur.label}</b>
      </span>
      <div className="ml-chips ml-hb" role="group" aria-label="Подсказки">
        {EXAMPLES.map((x, i) => (
          <button
            key={x.label}
            type="button"
            className={'ml-hb-slot' + (i === sel ? ' on' : '') + (i === press ? ' used' : '')}
            data-track="milli_chip"
            data-src="examples"
            data-pos={i}
            data-milli-lean=""
            disabled={pending}
            onMouseEnter={() => pick(i)}
            onFocus={() => {
              setHold(true)
              pick(i)
            }}
            onBlur={() => setHold(false)}
            onClick={() => {
              setPress(i)
              void sendMilli(x.ask)
            }}
          >
            <span className="ml-hb-ic">
              <PxArt name={x.icon} size={32} />
            </span>
            <span className="ml-hb-t">{x.label}</span>
          </button>
        ))}
        <span className="ml-hb-sel" aria-hidden="true" style={{ transform: 'translateX(' + sel * 46 + 'px)' }} />
      </div>
    </div>
  )
}

function Composer() {
  const [text, setText] = useState('')
  const pending = useMilli((s) => s.pending)
  // Счётчик на нуле — отправка ждёт сброса (карточка лимита уже сказала когда).
  const out = useMilli((s) => !!s.status && (s.status.day.remaining <= 0 || s.status.month.remaining <= 0))
  const focusSeq = useMilli((s) => s.focusSeq)
  const preset = useMilli((s) => s.preset)
  const hasMessages = useMilli((s) => s.messages.length > 0)
  const ref = useRef<HTMLTextAreaElement>(null)
  const globe = useRef<MilliSendGlobeHandle>(null)
  const restore = useMilli((s) => s.restore)
  useEffect(() => {
    if (focusSeq) ref.current?.focus()
  }, [focusSeq])
  // «Стоп»: отменённый вопрос возвращается в поле.
  useEffect(() => {
    if (!restore.seq) return
    setText(restore.text)
    ref.current?.focus()
    // Префилл «Ещё хочу »: каретка в конец, чтобы сразу дописывать.
    requestAnimationFrame(() => ref.current?.setSelectionRange(restore.text.length, restore.text.length))
  }, [restore])
  const submit = () => {
    const t = text.trim()
    if (!t || pending || out) return
    globe.current?.launch()
    setText('')
    void sendMilli(t)
  }
  return (
    <>
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
          <MilliSafe
            fallback={
              pending ? (
                <button type="button" className="btn md danger mlc-send" aria-label="Остановить" data-track="milli_cancel" onClick={cancelMilli}>
                  <PxIcon name="x" size={18} />
                </button>
              ) : (
                <button type="submit" className="btn md primary mlc-send" aria-label="Отправить" data-track="milli_send" disabled={!text.trim() || out}>
                  <PxIcon name="send" size={18} />
                </button>
              )
            }
          >
            <MilliSendGlobe
              ref={globe}
              pending={pending}
              disabled={!text.trim() || out}
              onStop={cancelMilli}
              onLanded={() => milliCue('hop', document.querySelector('.ml-panel .mlh') ?? undefined)}
            />
          </MilliSafe>
        </span>
      </form>
    </>
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

/** Без PLUS: когда показать золотую карточку под ответом (шейдеры/паки/карты — по просьбе; после сборки — раз в день). */
const GATE_RX = /шейдер|ресурс-? ?пак|ресурспак|текстур|карт[уаы]|сервер|хостинг/i
const GATE_DAY_KEY = 'milli-plus-gate-day'
function gateAfterBuild(): boolean {
  try {
    const d = new Date().toISOString().slice(0, 10)
    if (localStorage.getItem(GATE_DAY_KEY) === d) return false
    localStorage.setItem(GATE_DAY_KEY, d)
    return true
  } catch {
    return false
  }
}
const gateSeen = new Set<string>()

function PlusNudges({ m, asked }: { m: MilliMessage; asked: string }) {
  const status = useMilli((s) => s.status)
  const plans = useMilli((s) => s.plans)
  if (!status || status.plus) return null
  const left = milliLeft(status)
  // После сборки — один раз в день (запоминаем, на каком сообщении показали, чтобы не мигало при перерисовке).
  const afterBuild = !!m.pack && !m.pack.stub && (gateSeen.has(m.id) || (gateAfterBuild() && (gateSeen.add(m.id), true)))
  const asks = GATE_RX.test(asked)
  return (
    <>
      {asks || afterBuild ? (
        <button type="button" className="ml-gate" data-track="milli_plus_upsell" data-src={asks ? 'gate' : 'build'} onClick={() => openPlusSheet(asks ? 'gate' : 'build')}>
          <PxArt name="glowstone" size={28} className="mci" />
          <span>
            {asks ? 'Шейдеры, паки и карты — с PLUS' : 'С PLUS добавлю шейдеры и карту'}
            <small>Милли поставит их в сборку сама</small>
          </span>
          <em>PLUS</em>
        </button>
      ) : null}
      {left !== null && left > 0 && left <= 3 ? (
        <button type="button" className="ml-low" data-track="milli_plus_upsell" data-src="low" onClick={() => openPlusSheet('low')}>
          Осталось {left} на сегодня · <b>с PLUS {milliPlanNumbers(plans).plus} в день</b>
        </button>
      ) : null}
    </>
  )
}

function Bubble({ m, last, cheer, asked = '' }: { m: MilliMessage; last: boolean; cheer?: boolean; asked?: string }) {
  if (m.role === 'user') {
    return (
      <div className="ml-msg me">
        <p className="ml-bubble">{m.text}</p>
      </div>
    )
  }
  const askSize = isMilliSizeAsk(m)
  const setup = m.pack && !m.pack.stub && m.pack.setup?.lines?.length ? m.pack : null
  return (
    <div className="ml-msg">
      <MilliAva cheer={cheer} />
      <div className="ml-col">
        {m.text ? <p className="ml-bubble">{m.text}</p> : null}
        {askSize && last ? (
          <MilliSafe>
            <MilliSizePick onPick={pickSize} />
          </MilliSafe>
        ) : null}
        {m.plan && !m.pack ? <MilliPlan plan={m.plan} active={last} /> : null}
        {m.pack ? <MilliPackCard pack={m.pack} /> : null}
        {m.pack ? <BenchChanges pack={m.pack} /> : null}
        {m.looks ? (
          <MilliSafe>
            <MilliPicker msgId={m.id} looks={m.looks} active={last} />
          </MilliSafe>
        ) : null}
        {(() => {
          const a = messageAction(m as never)
          return a ? (
            <MilliSafe>
              <MilliActionCard action={a} />
            </MilliSafe>
          ) : null
        })()}
        {setup ? (
          <MilliSafe>
            <MilliSetup pack={setup} onEdit={() => useBench.getState().show('config')} compact />
          </MilliSafe>
        ) : null}
        {last && !askSize ? <Chips items={replyChips(m)} src="reply" /> : null}
        {last ? <PlusNudges m={m} asked={asked} /> : null}
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
        {!status?.plus ? (
          <button type="button" className="btn sm primary ml-plus" data-track="milli_plus_upsell" data-src="limit" onClick={() => openPlusSheet('limit')}>
            <PxIcon name="crown" size={12} />
            Больше с PLUS
          </button>
        ) : null}
      </div>
    )
  }
  return (
    <div className="ml-msg">
      <MilliAva />
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


function Thinking() {
  const [elapsed, setElapsed] = useState(0)
  const stages = useBench((s) => s.progress)
  const editing = useBench((s) => !!s.head)
  useEffect(() => {
    const started = Date.now()
    const id = window.setInterval(() => setElapsed(Date.now() - started), 1_000)
    return () => window.clearInterval(id)
  }, [])
  // «Понимаю запрос» сервер шлёт на любой ход; сборка — только когда пошли следующие этапы.
  const live = stages.some((st) => st.key !== 'plan')
  const step = milliThinkStep(elapsed)
  return (
    <div className="ml-msg ml-think" aria-busy="true" aria-label="Милли думает">
      <MilliAva mode="think" spin />
      <div className="ml-col">
        <div className={'ml-bubble ' + (live ? 'ml-think' : 'ml-typing-b')}>
          <MilliSafe fallback={<span aria-live="polite">{step}</span>}>
            {live ? (
              <MilliProgress stages={stages} title={editing ? 'Правлю сборку…' : 'Собираю сборку…'} onStop={cancelMilli} />
            ) : (
              // Этапов сборки нет — это обычный ответ в разговоре: просто «печатает».
              <span className="ml-typing" aria-label="Милли печатает">
                <i />
                <i />
                <i />
              </span>
            )}
          </MilliSafe>
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
            <span className="mcs ml-hist-ic" aria-hidden="true">
              <PxArt name="book_quill" size={32} className="mci" />
            </span>
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
  const item = (icon: PxName, label: string, run: () => void, track: string) => (
    <button
      key={track}
      type="button"
      className="ml-menu-item"
      role="menuitem"
      data-track={track}
      onClick={() => {
        onClose()
        run()
      }}
    >
      <PxArt name={icon} size={16} className="mci" />
      {label}
    </button>
  )
  return (
    <div className="ml-menu" role="menu" ref={ref}>
      {item('book_quill', 'Новый чат', newMilliChat, 'milli_new')}
      {item('clock', 'История', () => void showMilliHistory(), 'milli_history')}
      {item('bell', 'Поддержка', () => openExt(SUPPORT_URL), 'support_open')}
      {item('barrier', 'Закрыть', closeMilli, 'close')}
      {milliPreviewOn()
        ? (['free', 'plus', 'diamond'] as const).map((t) =>
            item(t === 'free' ? 'iron_ingot' : t === 'plus' ? 'gold_ingot' : 'diamond', (milliPreviewTier() === t ? '✓ ' : '') + 'Стенд: как ' + (t === 'free' ? 'без PLUS' : t === 'plus' ? 'PLUS' : 'Diamond'), () => {
              setMilliPreviewTier(milliPreviewTier() === t ? null : t)
              void refreshMilliStatus()
            }, 'milli_preview_' + t),
          )
        : null}
    </div>
  )
}

const HELLO_FALLBACK = 'Привет! Какую сборку соберём?'

/**
 * Пустой чат: сцена, приветствие и примеры; Милли тянется к примеру под мышью.
 * Приветствие — с сервера по памяти игрока (без модели, мгновенно); пока ждём —
 * пузырь невидим (место занято), сбой или >1,5 с — запасная фраза.
 */
function Hello({ mood }: { mood: MilliMode }) {
  // Без PLUS Милли то и дело «примеряет» золотую корону (владелец: пусть засматривается на PLUS) — 2,4 с из каждых 9.
  const free = useMilli((st) => !!st.status && !st.status.plus)
  const [tryOn, setTryOn] = useState(false)
  useEffect(() => {
    if (!free || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return
    let off: number | undefined
    const tick = window.setInterval(() => {
      setTryOn(true)
      off = window.setTimeout(() => setTryOn(false), 2400)
    }, 9000)
    const first = window.setTimeout(() => {
      setTryOn(true)
      off = window.setTimeout(() => setTryOn(false), 2400)
    }, 2500)
    return () => {
      window.clearInterval(tick)
      window.clearTimeout(first)
      window.clearTimeout(off)
    }
  }, [free])
  const pending = useMilli((s) => s.pending)
  const [g, setG] = useState<MilliGreeting | null | undefined>(undefined)
  useEffect(() => {
    let live = true
    const slow = window.setTimeout(() => live && setG((v) => (v === undefined ? null : v)), 1_500)
    void loadMilliGreeting().then((r) => {
      if (live) setG((v) => (v === undefined ? r : v))
    })
    return () => {
      live = false
      window.clearTimeout(slow)
    }
  }, [])
  const chips: MilliGreetingChip[] = g ? (g.chips?.length ? g.chips : g.suggestions.map((label) => ({ label }))).slice(0, 4) : []
  return (
    <div className="ml-hello">
      <MilliSafe>
        <MilliScene mode={tryOn ? 'happy' : mood === 'idle' ? 'wave' : mood} crown={tryOn ? 'gold' : null} />
      </MilliSafe>
      {free ? (
        <button type="button" className={'ml-tryon' + (tryOn ? ' on' : '')} data-track="milli_plus_upsell" data-src="tryon" onClick={() => openPlusSheet('tryon')} tabIndex={tryOn ? 0 : -1} aria-hidden={!tryOn}>
          <PxIcon name="crown" size={12} />
          Милли с PLUS
        </button>
      ) : null}
      <div className="ml-say" style={g === undefined ? { visibility: 'hidden' } : undefined}>
        <p className="ml-bubble">{g?.text ?? HELLO_FALLBACK}</p>
      </div>
      {chips.length > 0 && (
        <div className="ml-chips" role="group" aria-label="С чего начать" style={{ justifyContent: 'center', marginTop: 10 }}>
          {chips.map((c, i) => (
            <button
              key={c.label}
              type="button"
              className="seg ml-chip"
              data-track="milli_chip"
              data-src="greeting"
              data-pos={i}
              disabled={pending}
              onClick={() => void pickMilliGreeting(c)}
            >
              {c.label}
            </button>
          ))}
        </div>
      )}
      <Hotbar />
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
  const plans = useMilli((s) => s.plans)
  const plusActive = usePlus((s) => s.active)
  const [menu, setMenu] = useState(false)
  const scroller = useRef<HTMLDivElement>(null)
  const panel = useRef<HTMLElement>(null)
  const restoreSeq = useBench((s) => s.restoreSeq)
  // Сборка пришла (настроение «радуется») — Милли делает праздничный оборот.
  useEffect(() => {
    if (mood === 'happy') milliCue('spin')
  }, [mood])
  // Закрытие — короткая «разборка» на блоки, потом display: none.
  const [shown, setShown] = useState(open)
  useEffect(() => {
    if (open) {
      setShown(true)
      return
    }
    const t = window.setTimeout(() => setShown(false), 200)
    return () => window.clearTimeout(t)
  }, [open])

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

  // Пока панель открыта, тосты встают слева от неё, а не на поле ввода.
  useEffect(() => {
    const root = document.documentElement
    if (open) root.setAttribute('data-milli-open', '')
    else root.removeAttribute('data-milli-open')
    return () => root.removeAttribute('data-milli-open')
  }, [open])

  // Вернулись из окна мода: панель была display:none (WebKit теряет scrollTop) —
  // ставим прокрутку ленты и списков верстака из стора до первого кадра.
  const restored = useRef(0)
  useLayoutEffect(() => {
    if (!open || !restoreSeq || restored.current === restoreSeq) return
    restored.current = restoreSeq
    const sc = useBench.getState().ui.scroll
    const el = scroller.current
    if (el && sc.chat !== undefined) el.scrollTop = sc.chat
    panel.current?.querySelectorAll<HTMLElement>('[data-bench-scroll]').forEach((node) => {
      const k = node.dataset.benchScroll
      if (k && sc[k] !== undefined) node.scrollTop = sc[k]!
    })
  }, [open, restoreSeq])

  // Новый ответ — к его началу (текст Милли и шапка сборки), остальное — вниз.
  // Позицию ставим в следующем кадре: чтение offsetTop сразу после коммита
  // заставляло синхронно раскладывать всю ленту с новой карточкой на 300 модов
  // (long task ~100 мс, замер QA). В кадре лейаут и так считается один раз.
  useEffect(() => {
    const el = scroller.current
    if (!el) return
    const last = messages[messages.length - 1]
    const toReply = !!last && last.role === 'assistant' && !pending && !error
    const id = requestAnimationFrame(() => {
      const node = toReply ? el.querySelector<HTMLElement>('.ml-msg:last-of-type') : null
      if (node) el.scrollTop = Math.max(0, node.offsetTop - 12)
      else el.scrollTop = el.scrollHeight
    })
    return () => cancelAnimationFrame(id)
  }, [messages, pending, error, view])

  // Пока Милли думает и собирает (этапы растут), лента сама держится внизу;
  // прокрутил вверх руками — не мешаем.
  useEffect(() => {
    if (!pending) return
    const el = scroller.current
    if (!el) return
    let away = false
    const onScroll = () => {
      away = el.scrollHeight - el.scrollTop - el.clientHeight > 80
    }
    el.addEventListener('scroll', onScroll, { passive: true })
    const id = window.setInterval(() => {
      if (!away && el.scrollHeight - el.scrollTop - el.clientHeight > 1) el.scrollTop = el.scrollHeight
    }, 200)
    return () => {
      window.clearInterval(id)
      el.removeEventListener('scroll', onScroll)
    }
  }, [pending])

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
        <Hello mood={mood} />
      ) : null}
      {messages.map((m, i) => (
        <Bubble key={m.id} m={m} last={!pending && !error && m === lastAssistant} cheer={mood === 'happy' && m === lastAssistant} asked={messages[i - 1]?.role === 'user' ? messages[i - 1]!.text : ''} />
      ))}
      {pending ? <Thinking /> : null}
      {error && error.kind !== 'auth' ? <ErrorCard e={error} /> : null}
    </>
  )

  return (
    <aside
      ref={panel}
      className={
        'ml-panel' + (open || shown ? ' on' : '') + (!open && shown ? ' is-closing' : '') + (pending ? ' is-busy' : '') + (mood === 'happy' ? ' is-happy' : '') + ' tier-' + milliLook(status)
      }
      aria-label="Милли"
      aria-hidden={!open}
      data-section="milli"
    >
      <span className="ml-build" aria-hidden="true" />
      <span className="ml-bg" aria-hidden="true">
        <i />
        <i />
        <i />
        <i />
        <i />
        <i />
      </span>
      <header className="ml-head">
        <MilliHead mode={mood} />
        {/* С PLUS/Diamond — плашка тарифа с остатком: игрок видит, что он «на максималках». */}
        {signed && status && status.plus ? (
          <span className={'ml-tierchip is-' + milliLook(status) + (milliLeft(status) === 0 ? ' out' : '')} aria-label={'Осталось ' + milliLeft(status)}>
            {milliLook(status) === 'diamond' ? <PxArt name="diamond" size={14} className="mci" /> : <PxIcon name="crown" size={12} />}
            {milliLook(status) === 'diamond' ? 'DIAMOND' : 'PLUS'}
            <span className="ml-tierchip-n">{milliLeft(status)}</span>
          </span>
        ) : null}
        {/* С PLUS — следующая ступень: Diamond (вдвое больше сообщений и все награды пропуска сразу). */}
        {signed && status && status.plus && milliLook(status) !== 'diamond' && !off && !blocked ? (
          <button type="button" className="ml-up is-dia" data-track="milli_plus_upsell" data-src="head_diamond" aria-label="Больше с Diamond" onClick={() => openPlusSheet('head_diamond')}>
            <PxArt name="diamond" size={14} className="mci" />×{Math.max(2, Math.round(milliPlanNumbers(plans).diamond / Math.max(1, milliPlanNumbers(plans).plus)))} с Diamond
          </button>
        ) : null}
        {/* Без PLUS: «осталось» и выгода одной золотой плашкой — видно сразу, клик открывает «Милли на максималках». */}
        {signed && status && !status.plus && !off && !blocked ? (
          <button type="button" className={'ml-up' + (milliLeft(status) === 0 ? ' out' : '')} data-track="milli_plus_upsell" data-src="head" aria-label={'Осталось ' + milliLeft(status) + '. Больше с PLUS'} onClick={() => openPlusSheet('head')}>
            <span className="ml-up-n">{milliLeft(status)}</span>
            <PxIcon name="crown" size={12} />×{milliPlanNumbers(plans).x} с PLUS
          </button>
        ) : null}
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
      <MilliPlusSheet />
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
