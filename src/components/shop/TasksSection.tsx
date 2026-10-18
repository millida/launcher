import { useEffect } from 'react'
import { PxIcon } from '../PxIcon'
import { useDaily } from '../../state/daily'
import { usePlus } from '../../state/plus'
import { passCols, readyCells, seasonal, seasonOf } from '../daily/track'
import { Countdown } from './parts'
import { Icon } from '../Icon'
import { PassBody } from '../daily/DailyPassModal'
import { ChestLive } from '../daily/ChestLive'
import { playLeftText, usePlayChests } from '../../state/playChests'
import { Head } from './parts'
import { questState } from './packQuests'
import type { WeeklyPath } from './weekly'
import type { PackQuest } from '../../lib/rubies'
import { useT } from '../../i18n'

/**
 * Задания (ТЗ v3, 06.10.2026): одна большая кнопка-подарок «Забрать» и ряд
 * клеток пропуска значками; закрытые клетки PLUS — замок, клик = окно PLUS.
 * Подарок забирает то, что готово: клетки пропуска, иначе звезду недели,
 * иначе задание сборки.
 */
export function TasksSection({
  on,
  weekly,
  quests,
  busy,
  onWeekly,
  onQuest,
  onPlus,
}: {
  on: boolean
  weekly: WeeklyPath | null
  quests: PackQuest[]
  busy: string
  onWeekly: (at: number) => void
  onQuest: (q: PackQuest) => void
  onPlus: () => void
}) {
  const t = useT()
  const step = weekly?.steps.find((s) => !s.claimed && weekly.stars >= s.at)
  const quest = quests.find((q) => questState(q).kind === 'claim')
  const extra = step
    ? { busy: busy === 'weekly', onClaim: () => onWeekly(step.at) }
    : quest
      ? { busy: busy === 'quest:' + quest.code, onClaim: () => onQuest(quest) }
      : null
  return (
    <section id="shop-pass" className="sv-sec" data-section="pass">
      <Head title={t('Пропуск')} />
      <div className="card sh-block tk3-card">
        {on ? <PassBody active={on} inline mini onPlus={onPlus} extra={extra} /> : <span className="skel sh-skel" style={{ height: '200px' }} />}
      </div>
    </section>
  )
}

/** До 00:00 МСК — когда обновятся сундуки за игру. */
const mskReset = () => {
  const now = Date.now()
  const msk = now + 3 * 3_600_000
  return new Date(Math.floor(msk / 86_400_000 + 1) * 86_400_000 - 3 * 3_600_000).toISOString()
}

/**
 * «Бонусы» (владелец 06.10.2026, «понятно с одного взгляда»): три слота
 * сундуков за игру на сегодня — «Забери» (светится), «Через 34 мин игры» с
 * полосой, «Забрано ✓»; в шапке «Сундуки за игру · 2 из 3» и когда
 * обновятся. Рядом — подписанные плитки «Подарок дня» и «Пропуск».
 */
export function BonusesSection({ on }: { on: boolean }) {
  const t = useT()
  const view = usePlayChests((s) => s.view)
  const at = usePlayChests((s) => s.at)
  const busy = usePlayChests((s) => s.busy)
  const status = useDaily((s) => s.status)
  const dailyBusy = useDaily((s) => s.busy)
  const plusActive = usePlus((s) => s.active)
  useEffect(() => {
    if (on) void usePlayChests.getState().load()
  }, [on])
  if (!view) return null
  const left = view.nextInS === null ? null : Math.max(0, view.nextInS - Math.floor((Date.now() - at) / 1000))
  const giftReady = readyCells(passCols(status, !!status?.plus || plusActive)).length
  const day = status ? seasonOf(status).day : 0
  return (
    <section id="shop-tasks" className="sv-sec" data-section="tasks">
      <div className="sh-head">
        <h2>{t('Бонусы')}</h2>
      </div>
      <div className="bn">
        <div className="card bn-play">
          <div className="bn-head">
            <b>
              {t('Сундуки за игру · {n} из {limit}', { n: view.claimed, limit: view.limit })}
            </b>
            <span className="bn-reset">
              <Icon id="i-clock" />
              {t('Обновится через')} <Countdown to={mskReset()} />
            </span>
          </div>
          <div className="bn-slots">
            {Array.from({ length: view.limit }, (_, i) => {
              const state = i < view.claimed ? 'got' : i < view.earned ? 'ready' : i === view.earned ? 'next' : 'locked'
              const k = state === 'next' && left !== null ? Math.max(0, Math.min(1, 1 - left / 3600)) : 0
              return (
                <div key={i} className={'bn-slot is-' + state}>
                  <span className="bn-slot-art">
                    <ChestLive ready={state === 'ready'} tier="COMMON" size={72} />
                  </span>
                  {state === 'got' ? (
                    <b className="bn-slot-got">
                      <Icon id="i-check" />
                      {t('Забрано')}
                    </b>
                  ) : state === 'ready' ? (
                    <button className="btn md primary bn-claim" disabled={busy} data-track="play_chest_claim" onClick={() => void usePlayChests.getState().claim()}>
                      {t('Забери')}
                    </button>
                  ) : (
                    <span className="bn-slot-wait">
                      <b>{state === 'next' && left !== null ? t('Через {time} игры', { time: playLeftText(left) }) : t('Ещё {n} ч игры', { n: i + 1 - view.earned })}</b>
                      <span className="bn-bar">
                        <i style={{ transform: 'scaleX(' + k + ')' }} />
                      </span>
                    </span>
                  )}
                </div>
              )
            })}
          </div>
        </div>
        <div className="bn-side">
          <button className={'card bn-tile' + (giftReady ? ' is-ready' : '')} disabled={!giftReady || !!dailyBusy} data-track="bonus_gift" onClick={() => void useDaily.getState().claim(seasonal(status) ? 'all' : undefined)}>
            <PxIcon name="gift" size={48} />
            <span className="bn-tile-body">
              <b>{t('Подарок дня')}</b>
              <small>{giftReady ? t('Забери {n}', { n: giftReady }) : t('Завтра новый')}</small>
            </span>
          </button>
          <button className="card bn-tile" data-track="bonus_pass" onClick={() => document.getElementById('shop-pass')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}>
            <PxIcon name="star" size={48} />
            <span className="bn-tile-body">
              <b>{t('Пропуск')}</b>
              <small>{t('День {day} из 28', { day })}</small>
              <span className="bn-bar">
                <i style={{ transform: 'scaleX(' + Math.min(1, day / 28) + ')' }} />
              </span>
            </span>
          </button>
        </div>
      </div>
    </section>
  )
}
