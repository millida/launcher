import { useEffect, useState } from 'react'
import { api, hasMillidaAccount } from '../lib/api'
import { FEEDBACK_WEEK_MS, rewardOpensAt, rewardReady } from '../lib/feedbackReward'
import { getMillidaAccount } from '../state/accounts'
// Значок «+50» (.lb-fb-gift) рисуется в боковой панели, поэтому стили отзыва остаются в стартовом бандле.
import '../styles/pixel/feedback.css'

// Статус награды за отзыв и значок «+50» в боковой панели. Само окно отзыва (Feedback.tsx)
// открывается редко и грузится отдельным чанком; этот файл остаётся в стартовом бандле.

/** Награда за отзыв — раз в неделю, чтобы отзывы не писали ради осколков. */
export const FEEDBACK_SHARDS = 50
const LAST_KEY = 'm-feedback-at'
const WEEK = FEEDBACK_WEEK_MS
const RETRY_AFTER_FAILURE = 5 * 60_000

type FeedbackStatus = { ready: boolean; nextAt?: string }

/** Когда награда снова доступна по ответу сервера; null — ручки ещё нет, решает localStorage. */
let serverOpensAt: number | null = null
let askedFor = ''
let failedAt = 0
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

export function markFeedback(at = Date.now()) {
  try {
    localStorage.setItem(LAST_KEY, String(at))
  } catch (e) {
    console.warn('[feedback] the time of the last reward was not saved', e)
  }
}

/** Сервер знает правду — подтягиваем под неё и localStorage-фолбэк. */
export function applyStatus(ready: boolean, nextAt?: string) {
  serverOpensAt = rewardOpensAt(ready, nextAt, Date.now())
  if (ready) {
    try {
      localStorage.removeItem(LAST_KEY)
    } catch (e) {
      console.warn('[feedback] the time of the last reward was not cleared', e)
    }
  } else {
    const next = nextAt ? Date.parse(nextAt) : NaN
    markFeedback(Number.isFinite(next) ? next - WEEK : Date.now())
  }
}

/// The answer names when the reward opens, so after the first answer for an
/// account readiness is a clock comparison, not another request per render.
export function loadStatus(force = false): Promise<void> {
  if (!hasMillidaAccount()) return Promise.resolve()
  if (inflight) return inflight
  const who = getMillidaAccount()?.id || 'millida'
  const known = askedFor === who && (!failedAt || Date.now() - failedAt < RETRY_AFTER_FAILURE)
  if (!force && known) return Promise.resolve()
  if (askedFor !== who) serverOpensAt = null
  askedFor = who
  inflight = api<FeedbackStatus>('/launcher/feedback')
    .then((s) => {
      failedAt = 0
      applyStatus(!!s?.ready, s?.nextAt)
    })
    .catch((e) => {
      failedAt = Date.now()
      if (isMissing(e)) serverOpensAt = null
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
  return serverOpensAt === null ? localReady() : rewardReady(serverOpensAt, Date.now())
}

export function useRewardReady(): boolean {
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

