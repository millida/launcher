import { useEffect, useRef, useState } from 'react'
import { Icon } from '../Icon'
import { PxIcon } from '../PxIcon'
import { Ruby } from '../Ruby'
import { openExt } from '../../lib/api'
import { discordLinkUrl, type DiscordReward, type TelegramReward } from '../../lib/rubies'
import { intlTag, useT } from '../../i18n'
import { Head } from './parts'
import {
  discordInvite,
  noneOpened,
  parseOpened,
  SEGMENTS,
  serializeOpened,
  STEP_FILL,
  taskStep,
  telegramLink,
  totalReward,
  type ShownStep,
  type TaskFailure,
  type TaskKind,
  type TaskOpened,
  type TaskView,
} from './taskRules'
import '../../styles/pixel/shop-tasks.css'

/**
 * Задания «подпишись на Telegram» и «вступи в Discord» (переделка 26.10.2026:
 * «не видно, что происходит, выполнено ли задание; выполненное должно
 * пропадать»). Одна плитка на задание: знак сервиса, награда числом, полоса из
 * трёх делений (привязка → подписка → проверка), одна строка о том, что делать
 * сейчас, и одна главная кнопка. Награда пришла — плитка показывает «Начислено»
 * и сворачивается; нет заданий — блока нет вовсе.
 */

const KINDS: TaskKind[] = ['telegram', 'discord']
/** Сколько плитка держит «Начислено» и сколько сворачивается. */
const DONE_MS = 1700
const LEAVE_MS = 340

type Phase = 'idle' | 'done' | 'leaving' | 'gone'
/** Сбой запомнен вместе с шагом, на котором случился: сменился шаг — сообщение устарело. */
interface Fail {
  why: TaskFailure
  at: ShownStep
}

/** Что человек открыл: переживает уход с экрана магазина и пересоздание окна (на полчаса). */
const OPENED_KEY = 'm-social-opened'
const OPENED: Record<TaskKind, TaskOpened> = (() => {
  try {
    return parseOpened(localStorage.getItem(OPENED_KEY), Date.now())
  } catch {
    return noneOpened()
  }
})()
const saveOpened = () => {
  try {
    localStorage.setItem(OPENED_KEY, serializeOpened(OPENED, Date.now()))
  } catch (e) {
    console.warn('[social-tasks] the opened links were not saved', e)
  }
}

export type ClaimOutcome = { granted: boolean; amount: number } | { failure: TaskFailure }

export function SocialTasks({
  telegram,
  discord,
  busy,
  onClaim,
}: {
  telegram: TelegramReward | null
  discord: DiscordReward | null
  busy: string
  onClaim: (kind: TaskKind) => Promise<ClaimOutcome>
}) {
  const t = useT()
  const [opened, setOpened] = useState<Record<TaskKind, TaskOpened>>(() => ({ telegram: { ...OPENED.telegram }, discord: { ...OPENED.discord } }))
  const [phase, setPhase] = useState<Record<TaskKind, Phase>>({ telegram: 'idle', discord: 'idle' })
  const [fail, setFail] = useState<Record<TaskKind, Fail | null>>({ telegram: null, discord: null })
  const [opening, setOpening] = useState<TaskKind | ''>('')
  const [paid, setPaid] = useState<Record<TaskKind, number>>({ telegram: 0, discord: 0 })
  const timers = useRef<number[]>([])
  useEffect(() => () => timers.current.forEach((id) => window.clearTimeout(id)), [])

  const views: Record<TaskKind, TaskView | null> = { telegram, discord }
  const step = (k: TaskKind) => taskStep(views[k], opened[k])
  const shown = KINDS.filter((k) => phase[k] !== 'gone' && (phase[k] !== 'idle' || step(k) !== 'hidden'))
  if (!shown.length) return null

  const later = (ms: number, fn: () => void) => timers.current.push(window.setTimeout(fn, ms))
  const to = (k: TaskKind, p: Phase) => setPhase((was) => ({ ...was, [k]: p }))
  const failed = (k: TaskKind, why: TaskFailure, at: ShownStep) => setFail((was) => ({ ...was, [k]: { why, at } }))
  const mark = (k: TaskKind, what: keyof TaskOpened) => {
    OPENED[k][what] = true
    saveOpened()
    setOpened((was) => ({ ...was, [k]: { ...was[k], [what]: true } }))
  }
  const leave = (k: TaskKind, after: number) => {
    later(after, () => to(k, 'leaving'))
    later(after + LEAVE_MS, () => to(k, 'gone'))
  }

  const go = async (k: TaskKind) => {
    const at = step(k)
    if (at === 'hidden' || busy || opening) return
    setFail((was) => ({ ...was, [k]: null }))
    if (at === 'check') {
      const res = await onClaim(k)
      if ('failure' in res) return failed(k, res.failure, at)
      if (res.granted) {
        setPaid((was) => ({ ...was, [k]: res.amount }))
        to(k, 'done')
        leave(k, DONE_MS)
      } else leave(k, 0)
      return
    }
    if (at === 'link' || at === 'link-wait') {
      if (k === 'telegram') {
        const url = telegramLink(telegram?.botUrl)
        if (!url) return failed(k, 'net', at)
        openExt(url)
        return mark(k, 'link')
      }
      setOpening(k)
      try {
        const { url } = await discordLinkUrl()
        if (!url || !url.startsWith('https://discord.com/')) throw new Error('bad url')
        openExt(url)
        mark(k, 'link')
      } catch {
        failed(k, 'link', at)
      } finally {
        setOpening('')
      }
      return
    }
    // join: канал/сервер открыт, дальше только «Проверить».
    const url = k === 'telegram' ? telegramLink(telegram?.channelUrl) : discordInvite(discord?.inviteUrl)
    if (!url) return failed(k, 'net', at)
    openExt(url)
    mark(k, 'join')
  }

  const open = (k: TaskKind) => {
    const url = k === 'telegram' ? telegramLink(telegram?.channelUrl) : discordInvite(discord?.inviteUrl)
    if (url) openExt(url)
  }

  const folded = shown.every((k) => phase[k] === 'leaving')
  const total = totalReward(shown.filter((k) => phase[k] === 'idle').map((k) => views[k]))
  return (
    <section id="shop-social" className={'sv-sec sq-sec' + (folded ? ' is-fold' : '')} data-section="social_tasks">
      <div className="sq-fold">
        <div className="sq-fold-in">
          <Head title={t('Задания')}>
            {total > 0 ? (
              <span className="sq-total">
                <Ruby size={20} />+{total.toLocaleString(intlTag())}
              </span>
            ) : null}
          </Head>
          <div className="sq-grid">
            {shown.map((k) => {
              const s = step(k)
              const view = views[k]
              const p = phase[k]
              const f = fail[k] && fail[k]!.at === s ? fail[k]!.why : null
              return (
                <div key={k} className={'sq-cell' + (p === 'leaving' ? ' is-leaving' : '')}>
                  <Task
                    kind={k}
                    step={s === 'hidden' ? 'check' : s}
                    amount={p === 'idle' ? view?.amount ?? 0 : paid[k] || view?.amount || 0}
                    phase={p}
                    failure={f}
                    checking={busy === k}
                    linking={opening === k}
                    onGo={() => void go(k)}
                    onOpen={() => open(k)}
                  />
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </section>
  )
}

function Task({
  kind,
  step,
  amount,
  phase,
  failure,
  checking,
  linking,
  onGo,
  onOpen,
}: {
  kind: TaskKind
  step: ShownStep
  amount: number
  phase: Phase
  failure: TaskFailure | null
  checking: boolean
  linking: boolean
  onGo: () => void
  onOpen: () => void
}) {
  const t = useT()
  const tg = kind === 'telegram'
  const done = phase !== 'idle'
  const fill = done ? SEGMENTS : STEP_FILL[step]
  const waiting = !done && (checking || step === 'link-wait')
  const state = done ? 'done' : failure ? (failure === 'miss' ? 'warn' : 'bad') : checking ? 'check' : step
  const line = done
    ? t('Готово')
    : failure
      ? failureLine(kind, failure)
      : step === 'link'
        ? tg
          ? t('Сначала привяжи Telegram к аккаунту')
          : t('Сначала привяжи Discord к аккаунту')
        : step === 'link-wait'
          ? tg
            ? t('В боте нажми «Запустить» и вернись сюда')
            : t('В браузере разреши доступ и вернись сюда')
          : step === 'join'
            ? tg
              ? t('Подпишись на канал Millida')
              : t('Вступи в Discord Millida')
            : tg
              ? t('Подпишись на канал и нажми «Проверить»')
              : t('Зайди на сервер и нажми «Проверить»')
  const joinLabel = tg ? t('Подписаться') : t('Вступить')

  function failureLine(k: TaskKind, why: TaskFailure): string {
    if (why === 'miss') return k === 'telegram' ? t('Не нашли подписку — подпишись и проверь ещё раз') : t('Тебя нет на сервере — вступи и проверь ещё раз')
    if (why === 'taken') return t('Этот аккаунт уже получил награду на другом профиле')
    if (why === 'link') return t('Не получилось открыть привязку Discord, попробуй ещё раз')
    if (why === 'auth') return t('Сессия истекла — войди заново')
    return t('Нет ответа — попробуй ещё раз')
  }

  return (
    <div
      id={'shop-' + kind}
      className={'card sq-task is-' + kind + ' is-' + state}
      data-section={kind + '_reward'}
      data-step={done ? 'done' : step}
    >
      <span className="sq-logo" aria-hidden="true">
        <PxIcon name={kind} size={48} />
      </span>
      <span className="sq-text">
        <b className="sq-title">{tg ? 'Telegram' : 'Discord'}</b>
        {checking ? (
          <span className="sq-wait" role="status" aria-label={t('Проверить')}>
            {Array.from({ length: 6 }, (_, i) => (
              <i key={i} style={{ ['--i' as string]: i }} />
            ))}
          </span>
        ) : (
          <span className="sq-line" aria-live="polite">
            {failure || done ? <Icon id={done ? 'i-check' : 'i-alert'} /> : null}
            {line}
          </span>
        )}
      </span>
      <span className="sq-prize">
        <Ruby size={30} />
        <b>+{amount.toLocaleString(intlTag())}</b>
      </span>
      <span className="sq-foot">
        <span className="sq-bar" aria-hidden="true">
          {Array.from({ length: SEGMENTS }, (_, i) => (
            <i key={i} className={(i < fill ? 'on' : '') + (waiting && i === fill ? ' now' : '')} />
          ))}
        </span>
        <span className="sq-act">
          {done ? (
            <span className="sq-got">
              <Icon id="i-check" />
              {t('Начислено')}
            </span>
          ) : step === 'check' ? (
            <>
              <button className="btn md secondary" data-track={tg ? 'tg_reward_channel' : 'dc_reward_join'} disabled={checking} onClick={onOpen}>
                {joinLabel}
              </button>
              <button className="btn md primary" data-track={tg ? 'tg_reward_claim' : 'dc_reward_claim'} disabled={checking || failure === 'taken'} onClick={onGo}>
                {t('Проверить')}
              </button>
            </>
          ) : step === 'join' ? (
            <button className="btn md primary" data-track={tg ? 'tg_reward_channel' : 'dc_reward_join'} onClick={onGo}>
              {joinLabel}
            </button>
          ) : (
            <button className={'btn md ' + (step === 'link' ? 'primary' : 'secondary')} data-track={tg ? 'tg_reward_link' : 'dc_reward_link'} disabled={linking} onClick={onGo}>
              {t('Привязать')}
            </button>
          )}
        </span>
      </span>
    </div>
  )
}
