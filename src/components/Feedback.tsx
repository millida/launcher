import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { Icon } from './Icon'
import { api, hasMillidaAccount } from '../lib/api'
import { apiErrorText } from '../lib/apiError'
import { showToast } from '../state/ui'
import { showReward } from './reward/rewardBus'
import { track } from '../lib/telemetry'
import '../styles/pixel/feedback.css'

/**
 * Отзыв о лаунчере (владелец 24.09.2026, 16:41): зелёный «жучок» в верхней
 * полосе лобби — оценить лаунчер звёздами или сообщить о баге.
 * Отзыв со входом идёт в POST /launcher/feedback: сервер кладёт его в
 * баг-репорты и сам решает, давать ли осколки (раз в неделю). Показываем
 * ровно то, что ответил сервер. Пока ручки нет на проде (404) или игрок без
 * аккаунта Millida — отзыв уходит в POST /bug-reports, как раньше, без награды.
 * Баг-репорт — всегда POST /bug-reports.
 */

type Mode = 'pick' | 'rate' | 'bug'

const BUG_KINDS: [string, string][] = [
  ['crash', 'Вылет'],
  ['game_launch', 'Игра не запускается'],
  ['download', 'Не качается'],
  ['auth', 'Не пускает в аккаунт'],
  ['visual', 'Что-то съехало'],
  ['other', 'Другое'],
]

const STAR_WORDS = ['', 'Плохо', 'Так себе', 'Нормально', 'Хорошо', 'Отлично']

/** Награда за отзыв — раз в неделю, чтобы отзывы не писали ради осколков. */
export const FEEDBACK_SHARDS = 50
const LAST_KEY = 'm-feedback-at'
const WEEK = 7 * 86400_000
const STATUS_TTL = 5 * 60_000

type FeedbackStatus = { ready: boolean; nextAt?: string }
type FeedbackAnswer = { granted: boolean; shards: number; nextAt?: string }

/** Ответ сервера о награде; null — ручки ещё нет, решает localStorage. */
let serverReady: boolean | null = null
let askedAt = 0
let inflight: Promise<void> | null = null

/** Ручка ещё не выкачена: «http 404» из браузера или «Cannot GET …» от Nest через Tauri. */
function isMissing(e: unknown): boolean {
  const raw = String((e as { message?: string } | null)?.message ?? e ?? '').trim()
  return /\bhttp 404\b/i.test(raw) || /^cannot (get|post) /i.test(raw) || /^not found$/i.test(raw)
}

function localReady(): boolean {
  try {
    return Date.now() - Number(localStorage.getItem(LAST_KEY) || 0) > WEEK
  } catch {
    return false
  }
}

function markFeedback(at = Date.now()) {
  try {
    localStorage.setItem(LAST_KEY, String(at))
  } catch {}
}

/** Сервер знает правду — подтягиваем под неё и localStorage-фолбэк. */
function applyStatus(ready: boolean, nextAt?: string) {
  serverReady = ready
  if (ready) {
    try {
      localStorage.removeItem(LAST_KEY)
    } catch {}
  } else {
    const next = nextAt ? Date.parse(nextAt) : NaN
    markFeedback(Number.isFinite(next) ? next - WEEK : Date.now())
  }
}

function loadStatus(force = false): Promise<void> {
  if (!hasMillidaAccount()) return Promise.resolve()
  if (inflight) return inflight
  if (!force && Date.now() - askedAt < STATUS_TTL) return Promise.resolve()
  askedAt = Date.now()
  inflight = api<FeedbackStatus>('/launcher/feedback')
    .then((s) => applyStatus(!!s?.ready, s?.nextAt))
    .catch((e) => {
      if (isMissing(e)) serverReady = null
    })
    .finally(() => {
      inflight = null
    })
  return inflight
}

/** Значок «+50»: без аккаунта награды нет; со входом — ответ сервера, иначе localStorage. */
export function feedbackRewardReady(): boolean {
  if (!hasMillidaAccount()) return false
  void loadStatus()
  return serverReady ?? localReady()
}

function useRewardReady(): boolean {
  const [ready, setReady] = useState(feedbackRewardReady)
  useEffect(() => {
    let live = true
    void loadStatus(true).then(() => {
      if (live) setReady(feedbackRewardReady())
    })
    return () => {
      live = false
    }
  }, [])
  return ready
}

async function send(body: Record<string, unknown>) {
  await api('/bug-reports', { method: 'POST', body: JSON.stringify({ service: 'launcher', ...body }) })
}

/** Отзыв с наградой; null — ручки нет или нет входа, отзыв надо слать по-старому. */
async function sendFeedback(text: string, stars: number): Promise<FeedbackAnswer | null> {
  if (!hasMillidaAccount()) return null
  try {
    return await api<FeedbackAnswer>('/launcher/feedback', {
      method: 'POST',
      body: JSON.stringify(stars ? { text, stars } : { text }),
    })
  } catch (e) {
    if (isMissing(e)) return null
    throw e
  }
}

/**
 * `about` — открыть сразу баг-репорт про конкретную вещь (страница сборки:
 * «Сообщить о проблеме»). Строка уходит в заголовок и описание, чтобы
 * поддержка видела, о какой сборке речь, без вопросов игроку.
 */
export function FeedbackModal({ onClose, about, kind: startKind }: { onClose: () => void; about?: string; kind?: string }) {
  const [mode, setMode] = useState<Mode>(about ? 'bug' : 'pick')
  const [stars, setStars] = useState(0)
  const [hover, setHover] = useState(0)
  const [text, setText] = useState('')
  const [kind, setKind] = useState(startKind || 'crash')
  const [busy, setBusy] = useState(false)

  const submit = async () => {
    if (busy) return
    setBusy(true)
    // Аналитика: оценка, длина и тип — сам текст отзыва не уходит никогда.
    const sent: Record<string, string | number | boolean> = { kind: mode === 'rate' ? 'review' : kind, len: text.trim().length }
    if (mode === 'rate' && stars) sent.rating = stars
    try {
      if (mode === 'rate') {
        const t = text.trim()
        const answer = await sendFeedback(t, stars)
        if (answer) {
          applyStatus(false, answer.nextAt)
          showReward({
            level: 'mid',
            kicker: 'Спасибо за отзыв',
            title: answer.granted ? '+' + answer.shards + ' осколков' : 'Отзыв принят',
            sub: answer.granted ? 'Мы читаем каждый' : 'Награда раз в неделю',
          })
        } else {
          await send({
            category: 'other',
            severity: 'low',
            title: 'Отзыв о лаунчере' + (stars ? ' · ' + stars + '/5' : ''),
            description: (stars ? 'Оценка: ' + stars + ' из 5. ' : '') + t,
          })
          markFeedback()
          showReward({ level: 'mid', kicker: 'Спасибо за отзыв', title: 'Отзыв принят', sub: 'Мы читаем каждый' })
        }
      } else {
        const t = text.trim()
        await send({
          category: kind,
          severity: kind === 'crash' || kind === 'game_launch' || kind === 'auth' ? 'high' : 'medium',
          title: (BUG_KINDS.find((k) => k[0] === kind)?.[1] || 'Баг') + ': ' + (about ? about + ' — ' : '') + t.slice(0, 60),
          description: about ? about + '\n\n' + t : t,
        })
        showToast('Баг отправлен — спасибо, разберёмся', 'ok')
      }
      track('feedback_send', { ...sent, ok: true })
      onClose()
    } catch (e) {
      track('feedback_send', { ...sent, ok: false }, { ok: false })
      showToast(apiErrorText(e, 'Не отправилось, попробуй ещё раз'), 'error')
    } finally {
      setBusy(false)
    }
  }

  const canSend = text.trim().length >= 10
  const reward = useRewardReady()

  return createPortal(
    <div className="fb-bg" onClick={onClose} role="presentation">
      <div className="fb-box" role="dialog" aria-label="Отзыв о лаунчере" data-section="feedback" onClick={(e) => e.stopPropagation()}>
        <button className="fb-x" aria-label="Закрыть" data-track="close" onClick={onClose}>
          <Icon id="i-x" />
        </button>
        {mode === 'pick' ? (
          <>
            <b className="fb-title">Что думаешь о лаунчере?</b>
            {reward ? <span className="fb-gift">+{FEEDBACK_SHARDS} осколков за отзыв</span> : null}
            <div className="fb-pick">
              <button className="fb-opt rate" data-sound="open" data-track="feedback_review" onClick={() => setMode('rate')}>
                <span className="fb-stars-ic">★★★★★</span>
                <b>Написать отзыв</b>
              </button>
              <button className="fb-opt bug" data-sound="open" data-track="feedback_bug" onClick={() => setMode('bug')}>
                <BugPx size={40} />
                <b>Нашёл баг</b>
              </button>
            </div>
          </>
        ) : mode === 'rate' ? (
          <>
            <b className="fb-title">Что думаешь о лаунчере?</b>
            {reward ? <span className="fb-gift">+{FEEDBACK_SHARDS} осколков</span> : null}
            <textarea
              className="fb-text"
              autoFocus
              placeholder="Что нравится, что бесит, чего не хватает"
              maxLength={2000}
              value={text}
              onChange={(e) => setText(e.target.value)}
            />
            <div className="fb-stars" onMouseLeave={() => setHover(0)}>
              {[1, 2, 3, 4, 5].map((n) => (
                <button
                  key={n}
                  className={'fb-star' + ((hover || stars) >= n ? ' on' : '')}
                  aria-label={n + ' из 5'}
                  data-track="feedback_star"
                  data-pos={n}
                  onMouseEnter={() => setHover(n)}
                  onClick={() => setStars(n)}
                >
                  ★
                </button>
              ))}
            </div>
            <span className="fb-word">{STAR_WORDS[hover || stars] || 'Оценка — по желанию'}</span>
          </>
        ) : (
          <>
            <b className="fb-title">Что сломалось?</b>
            <div className="fb-kinds">
              {BUG_KINDS.map(([k, label]) => (
                <button key={k} className={'fb-kind' + (kind === k ? ' on' : '')} data-track="feedback_bug_kind" data-id={k} onClick={() => setKind(k)}>
                  {label}
                </button>
              ))}
            </div>
            <textarea
              className="fb-text"
              autoFocus
              placeholder="Что делал и что случилось"
              maxLength={4000}
              value={text}
              onChange={(e) => setText(e.target.value)}
            />
          </>
        )}
        {mode !== 'pick' ? (
          <div className="fb-foot">
            <button className="btn md secondary" data-track="back" onClick={() => setMode('pick')}>
              Назад
            </button>
            <button className="btn md primary" disabled={!canSend || busy} data-track="feedback_send" onClick={() => void submit()}>
              {busy ? 'Отправляем…' : 'Отправить'}
            </button>
          </div>
        ) : null}
      </div>
    </div>,
    document.body,
  )
}

/** Пиксельный жучок 12×12. */
export function BugPx({ size = 22, light }: { size?: number; light?: boolean }) {
  const px = [
    '..k......k..',
    '...k....k...',
    '....kkkk....',
    '...kggggk...',
    'k.kgwggwgk.k',
    '.kkggggggkk.',
    '..kgGggGgk..',
    'kkkggggggkkk',
    '..kgGggGgk..',
    '.kkggggggkk.',
    'k..kggggk..k',
    '....kkkk....',
  ]
  // На зелёной кнопке жучок светлый, иначе сливается.
  const color: Record<string, string> = light
    ? { k: '#0b2410', g: '#ffffff', G: '#cfe9cf', w: '#0b2410' }
    : { k: '#10240f', g: '#6fdc5a', G: '#3b9a2c', w: '#ffffff' }
  return (
    <svg width={size} height={size} viewBox="0 0 12 12" shapeRendering="crispEdges" aria-hidden="true">
      {px.flatMap((row, y) =>
        [...row].map((ch, x) => (ch !== '.' ? <rect key={x + '-' + y} x={x} y={y} width="1" height="1" fill={color[ch]} /> : null)),
      )}
    </svg>
  )
}
