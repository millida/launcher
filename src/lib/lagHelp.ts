/*
 * Помощник лагов. Мод раз в 5 с присылает кадры и память (событие
 * game-perf), LagWindow отличает устойчивые лаги от просадок, lagPlan
 * находит причину. Игрок узнаёт об этом дважды: сразу — строкой на острове
 * в игре, и после выхода — карточкой «Почему лагало» в лаунчере, с кнопкой,
 * которая исправляет и запускает игру снова. Карточка ждёт и следующего
 * открытия лаунчера, если игру закрыли вместе с ним.
 */
import { create } from 'zustand'
import { fpsBoostState, gameNotice, listContent, ramCheck } from '../ipc/commands'
import { listenGameExit, listenGamePerf, type GamePerf } from '../ipc/events'
import { hasTauri } from '../ipc/tauri'
import { useGame } from '../state/game'
import { showToast } from '../state/ui'
import { t } from '../i18n'
import { LagWindow, type LagVerdict } from './lagWindow'
import { hasRendererJar, lagPlan, lagText, readVideo, shadersEnabled, type LagCause, type LagFix, type LagFacts } from './lagPlan'
import { readPref, writePref } from './prefs'
import { track } from './telemetry'
import type { MilliAction, MilliActionRow, MilliStep } from './milliActions'

export interface LagReport {
  profile: string
  fps: number
  cause: LagCause
  fixes: LagFix[]
  at: number
}

const OFF_KEY = 'm-lag-off'
const PENDING_KEY = 'm-lag-pending'
const COOLDOWN_MS = 30 * 60_000
const PENDING_TTL_MS = 3 * 86_400_000
const STARTUP_DELAY_MS = 4000

interface LagState {
  report: LagReport | null
  show: (r: LagReport) => void
  close: () => void
}

export const useLag = create<LagState>((set) => ({
  report: null,
  show: (report) => set({ report }),
  close: () => set({ report: null }),
}))

export const lagHelpOff = () => readPref(OFF_KEY, '0') === '1'

function pending(): LagReport | null {
  try {
    const r = JSON.parse(readPref(PENDING_KEY, '') || 'null') as LagReport | null
    return r && typeof r.profile === 'string' && Array.isArray(r.fixes) && Date.now() - r.at < PENDING_TTL_MS ? r : null
  } catch (e) {
    console.warn('[lag] the saved report is unreadable', e)
    return null
  }
}

const savePending = (r: LagReport | null) => writePref(PENDING_KEY, r ? JSON.stringify(r) : '')

/** Карточка закрыта или исправление применено: второй раз о тех же лагах не напоминаем. */
export function dismissLag() {
  savePending(null)
  useLag.getState().close()
}

export function muteLagHelp() {
  writePref(OFF_KEY, '1')
  dismissLag()
}

/** Разбор лагов не падает из-за недоступной подробности, но причину оставляет в журнале. */
const soft =
  <T>(what: string, fallback: T) =>
  (e: unknown): T => {
    console.warn('[lag] ' + what + ' is unavailable', e)
    return fallback
  }

async function lagFacts(profile: string): Promise<LagFacts> {
  const { ramMbFor } = await import('./launch')
  const { filesRead } = await import('./milliLocal')
  const [check, boost, mods, files] = await Promise.all([
    ramCheck(profile, ramMbFor(profile)).catch(soft('memory check', null)),
    fpsBoostState(profile).catch(soft('boost state', null)),
    listContent(profile, 'mod').catch(soft('mod list', [])),
    filesRead(profile, ['options.txt', 'config/iris.properties', 'config/oculus.properties']).catch(soft('build files', [])),
  ])
  const text = (path: string) => files.find((f) => f.path === path && f.exists)?.text ?? null
  const video = readVideo(text('options.txt'))
  return {
    heapMb: check?.heapMb ?? 0,
    fitMb: check?.manual ? check.fitMb : (check?.heapMb ?? 0),
    boostOffered: !!boost && boost.applicable !== false && !boost.enabled && !boost.vanilla,
    hasRenderer: hasRendererJar(mods.filter((m) => m.enabled).map((m) => m.name)),
    shadersOn: shadersEnabled(text('config/iris.properties')) || shadersEnabled(text('config/oculus.properties')),
    ...video,
  }
}

const windows = new Map<string, LagWindow>()
const notified = new Map<string, number>()

/** Разборы, что ещё идут: выход игры ждёт их, иначе карточка «Почему лагало» не успеет появиться. */
const judging = new Set<Promise<void>>()

async function onVerdict(profile: string, v: LagVerdict, at: number) {
  if (lagHelpOff() || at - (notified.get(profile) ?? 0) < COOLDOWN_MS) return
  notified.set(profile, at)
  const plan = lagPlan(v, await lagFacts(profile))
  const report: LagReport = { profile, fps: v.fps, cause: plan.cause, fixes: plan.fixes, at }
  savePending(report)
  track('lag_detected', { cause: plan.cause, fps: v.fps, memory: v.memory, fixes: plan.fixes.map((f) => f.id).join(',') })
  const { title } = lagText(plan.cause)
  await gameNotice(profile, t('Игра тормозит: {fps} FPS', { fps: v.fps }), t('{reason}. Исправить — в лаунчере', { reason: title }))
    .catch((e) => {
      console.warn('[lag] the in-game notice was not shown', e)
      return false
    })
}

/** Кадры, что ядро копило без окна, приходят со своим временем `at`: судим по нему, а не по часам разбора. */
export function onPerf(p: GamePerf) {
  let w = windows.get(p.profile)
  if (!w) windows.set(p.profile, (w = new LagWindow()))
  const at = p.at ?? Date.now()
  const v = w.push(p, at)
  if (!v) return
  const job: Promise<void> = onVerdict(p.profile, v, at)
    .catch((e) => console.error('[lag]', e))
    .finally(() => judging.delete(job))
  judging.add(job)
}

async function onExit(profile: string) {
  windows.delete(profile)
  if (judging.size) await Promise.allSettled([...judging])
  const r = pending()
  if (r && r.profile === profile && !lagHelpOff()) useLag.getState().show(r)
}

/** Применить исправление и запустить игру снова — одна кнопка. */
export async function applyLagFix(r: LagReport, fix: LagFix): Promise<boolean> {
  await import('./milliSteps')
  const { actionState, runAction } = await import('./milliActions')
  const action: MilliAction = {
    id: 'lag-' + Date.now().toString(36),
    kind: 'graphics',
    profile: r.profile,
    title: t('Лаги'),
    reason: lagText(r.cause).title,
    rows: [{ id: fix.id, label: fix.label, steps: fix.steps.map((_, i) => i) }],
    steps: fix.steps,
    restart: true,
  }
  actionState(action)
  const done = await runAction(action.id)
  if (done?.phase !== 'done') {
    showToast(done?.error || t('Не вышло: {what}', { what: fix.label }), 'error')
    return false
  }
  dismissLag()
  track('lag_fixed', { cause: r.cause, fix: fix.id, fps: r.fps })
  const { relaunchAfterFix } = await import('./autoHeal')
  await relaunchAfterFix(r.profile)
  return true
}

/** «Спросить Милли»: карточка с теми же исправлениями и осмотром сборки — в чате, с контекстом сборки. */
export async function askMilliAboutLag(r: LagReport): Promise<void> {
  const [doctor, milli] = await Promise.all([import('./milliDoctor'), import('../state/milli'), import('./milliSteps')])
  doctor.startMilliDoctor()
  const steps: MilliStep[] = []
  const rows: MilliActionRow[] = r.fixes.map((f, i) => {
    const idx = f.steps.map((s) => steps.push(s) - 1)
    return { id: f.id, label: f.label, sev: i === 0 ? 'red' : 'yellow', optional: true, on: i === 0, steps: idx }
  })
  rows.push({ id: 'scan', label: t('Осмотреть всю сборку'), note: t('Найду конфликты и старые моды'), sev: 'info', optional: true, on: !r.fixes.length, steps: [steps.length] })
  steps.push({ op: 'scan', mode: 'scan' })
  const { title, why } = lagText(r.cause)
  const action: MilliAction = {
    id: 'lag-' + Date.now().toString(36),
    kind: 'graphics',
    profile: r.profile,
    title: t('Лаги'),
    reason: title,
    rows,
    steps,
    risky: true,
    cta: t('Исправить'),
    restart: true,
  }
  milli.openMilli({ src: 'lag' })
  await doctor.pushMilliAction(t('«{name}» тормозила: {fps} FPS. {title}. {why}', { name: r.profile, fps: r.fps, title, why }), action, [t('Почему так?'), t('Осмотри сборку')])
  dismissLag()
}

let started = false

export function startLagHelp() {
  if (started || !hasTauri()) return
  started = true
  void listenGamePerf(onPerf)
  void listenGameExit((profile) => void onExit(profile))
  setTimeout(() => {
    const r = pending()
    if (r && !lagHelpOff() && !useGame.getState().list.includes(r.profile)) useLag.getState().show(r)
  }, STARTUP_DELAY_MS)
}
