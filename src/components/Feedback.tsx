import { useState } from 'react'
import { createPortal } from 'react-dom'
import { Icon } from './Icon'
import { api, hasMillidaAccount } from '../lib/api'
import { apiErrorText } from '../lib/apiError'
import { showToast } from '../state/ui'
import { showReward } from './reward/rewardBus'
import { track } from '../lib/telemetry'
import { hasTauri } from '../ipc/tauri'
import { openUrl } from '../ipc/commands'
import { PxIcon } from './PxIcon'
import '../styles/pixel/feedback.css'
import { t, useT } from '../i18n'
import { replyText, type BugAck } from '../lib/bugReplies'
import { checkForUpdate } from '../lib/updater'
import { BugPx } from './BugPx'
import { FEEDBACK_SHARDS, applyStatus, useRewardReady } from './feedbackStatus'

type FeedbackAnswer = { granted: boolean; shards: number; nextAt?: string }
export { FEEDBACK_SHARDS }

/**
 * Отзыв о лаунчере (владелец 24.09.2026, 16:41): зелёный «жучок» в верхней
 * полосе лобби — оценить лаунчер звёздами или сообщить о баге.
 * Отзыв идёт в POST /launcher/feedback: сервер кладёт его в оценки сервисов,
 * а не в баг-репорты, и сам решает, давать ли осколки (раз в неделю).
 * Показываем ровно то, что ответил сервер. Отзыв привязан к аккаунту Millida:
 * без входа его некуда положить. Баг-репорт — всегда POST /bug-reports.
 */

type Mode = 'pick' | 'rate' | 'bug'

const GITHUB_REPO_URL = 'https://github.com/millida/launcher'

const openGithub = () => (hasTauri() ? openUrl(GITHUB_REPO_URL) : window.open(GITHUB_REPO_URL, '_blank'))

const BUG_KINDS: [string, string][] = [
  ['crash', 'Вылет'],
  ['game_launch', 'Игра не запускается'],
  ['download', 'Не качается'],
  ['auth', 'Не пускает в аккаунт'],
  ['visual', 'Что-то съехало'],
  ['other', 'Другое'],
]

const starWords = () => ['', t('Плохо'), t('Так себе'), t('Нормально'), t('Хорошо'), t('Отлично')]

async function send(body: Record<string, unknown>): Promise<BugAck | null> {
  const r = await api<{ ack?: BugAck | null }>('/bug-reports', { method: 'POST', body: JSON.stringify({ service: 'launcher', ...body }) })
  return r?.ack ?? null
}

async function sendFeedback(text: string, stars: number): Promise<FeedbackAnswer> {
  if (!hasMillidaAccount()) throw new Error(t('Отзыв привязывается к аккаунту Millida — войди в него и отправь ещё раз'))
  return api<FeedbackAnswer>('/launcher/feedback', {
    method: 'POST',
    body: JSON.stringify(stars ? { text, stars } : { text }),
  })
}

/**
 * `about` — открыть сразу баг-репорт про конкретную вещь (страница сборки:
 * «Сообщить о проблеме»). Строка уходит в заголовок и описание, чтобы
 * поддержка видела, о какой сборке речь, без вопросов игроку.
 */
export function FeedbackModal({ onClose, about, kind: startKind }: { onClose: () => void; about?: string; kind?: string }) {
  const t = useT()
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
        const trimmed = text.trim()
        const answer = await sendFeedback(trimmed, stars)
        applyStatus(false, answer.nextAt)
        showReward({
          level: 'mid',
          kicker: t('Спасибо за отзыв'),
          title: answer.granted ? t('+{n} осколков', { n: answer.shards }) : t('Отзыв принят'),
          sub: answer.granted ? t('Мы читаем каждый') : t('Награда раз в неделю'),
        })
      } else {
        const trimmed = text.trim()
        const ack = await send({
          category: kind,
          severity: kind === 'crash' || kind === 'game_launch' || kind === 'auth' ? 'high' : 'medium',
          title: (BUG_KINDS.find((k) => k[0] === kind)?.[1] || 'Баг') + ': ' + (about ? about + ' — ' : '') + trimmed.slice(0, 60),
          description: about ? about + '\n\n' + trimmed : trimmed,
        })
        // Known problem: answer at once instead of "we will look" — with the advice, or "update" when it is already fixed.
        if (ack) {
          showToast(
            replyText(ack, t),
            'ok',
            undefined,
            ack.kind === 'fixed' ? { label: t('Обновиться'), run: () => void checkForUpdate(true) } : undefined,
          )
        } else {
          showToast(t('Баг отправлен — спасибо, разберёмся'), 'ok')
        }
      }
      track('feedback_send', { ...sent, ok: true })
      onClose()
    } catch (e) {
      track('feedback_send', { ...sent, ok: false }, { ok: false })
      showToast(apiErrorText(e, t('Не отправилось, попробуй ещё раз')), 'error')
    } finally {
      setBusy(false)
    }
  }

  const canSend = text.trim().length >= 10
  const reward = useRewardReady()

  return createPortal(
    <div className="fb-bg" onClick={onClose} role="presentation">
      <div className="fb-box" role="dialog" aria-label={t('Отзыв о лаунчере')} data-section="feedback" onClick={(e) => e.stopPropagation()}>
        <button className="fb-x" aria-label={t('Закрыть')} data-track="close" onClick={onClose}>
          <Icon id="i-x" />
        </button>
        {mode === 'pick' ? (
          <>
            <b className="fb-title">{t('Что думаешь о лаунчере?')}</b>
            {reward ? <span className="fb-gift">{t('+{n} осколков за отзыв', { n: FEEDBACK_SHARDS })}</span> : null}
            <div className="fb-pick">
              <button className="fb-opt rate" data-sound="open" data-track="feedback_review" onClick={() => setMode('rate')}>
                <span className="fb-stars-ic">★★★★★</span>
                <b>{t('Написать отзыв')}</b>
              </button>
              <button className="fb-opt bug" data-sound="open" data-track="feedback_bug" onClick={() => setMode('bug')}>
                <BugPx size={40} />
                <b>{t('Нашёл баг')}</b>
              </button>
              <button className="fb-opt gh" data-track="feedback_github" onClick={openGithub}>
                <PxIcon name="star" size={40} />
                <b>{t('Звезда на GitHub')}</b>
              </button>
            </div>
          </>
        ) : mode === 'rate' ? (
          <>
            <b className="fb-title">{t('Что думаешь о лаунчере?')}</b>
            {reward ? <span className="fb-gift">{t('+{n} осколков', { n: FEEDBACK_SHARDS })}</span> : null}
            <textarea
              className="fb-text"
              autoFocus
              placeholder={t('Что нравится, что бесит, чего не хватает')}
              maxLength={2000}
              value={text}
              onChange={(e) => setText(e.target.value)}
            />
            <div className="fb-stars" onMouseLeave={() => setHover(0)}>
              {[1, 2, 3, 4, 5].map((n) => (
                <button
                  key={n}
                  className={'fb-star' + ((hover || stars) >= n ? ' on' : '')}
                  aria-label={t('{n} из 5', { n })}
                  data-track="feedback_star"
                  data-pos={n}
                  onMouseEnter={() => setHover(n)}
                  onClick={() => setStars(n)}
                >
                  ★
                </button>
              ))}
            </div>
            <span className="fb-word">{starWords()[hover || stars] || t('Оценка — по желанию')}</span>
          </>
        ) : (
          <>
            <b className="fb-title">{t('Что сломалось?')}</b>
            <div className="fb-kinds">
              {BUG_KINDS.map(([k, label]) => (
                <button key={k} className={'fb-kind' + (kind === k ? ' on' : '')} data-track="feedback_bug_kind" data-id={k} onClick={() => setKind(k)}>
                  {t(label)}
                </button>
              ))}
            </div>
            <textarea
              className="fb-text"
              autoFocus
              placeholder={t('Что делал и что случилось')}
              maxLength={4000}
              value={text}
              onChange={(e) => setText(e.target.value)}
            />
          </>
        )}
        {mode !== 'pick' ? (
          <div className="fb-foot">
            <button className="btn md secondary" data-track="back" onClick={() => setMode('pick')}>
              {t('Назад')}
            </button>
            <button className="btn md primary" disabled={!canSend || busy} data-track="feedback_send" onClick={() => void submit()}>
              {busy ? t('Отправляем…') : t('Отправить')}
            </button>
          </div>
        ) : null}
      </div>
    </div>,
    document.body,
  )
}
