/*
 * Действия Милли на ПК игрока (council: Pair A + Pair B, общий контракт).
 *
 * Сервер не видит компьютер: он присылает в ответе `action` — что сделать и
 * строки «было → станет». Клиент показывает одну компактную карточку, а
 * исполняет шаги ТОЛЬКО после нажатия «Применить» (кроме `auto` — только
 * чтение). Каждый шаг — runner, зарегистрированный по имени `op`
 * (registerStep): Pair B — milliSteps.ts, Pair A — milliDoctorSteps.ts.
 * Runner возвращает обратные шаги — из них собирается «Отменить». Перед
 * рискованным действием — автоснимок сборки (если ядро умеет). Всё, что
 * поменялось, пишется в дневник сборки (milliDiary.ts) с причиной.
 */
import { create } from 'zustand'
import type { MilliMessage } from './milli'

// ─── Контракт (синхронно с milli-server/src/types.ts MilliAction) ───────────

export type MilliActionKind =
  | 'graphics'
  | 'modcfg'
  | 'backup'
  | 'restore'
  | 'import'
  | 'diary'
  | 'doctor'
  | 'update'
  | 'port'
  | 'crashfix'

/** Шаги. Pair B: opt…import; Pair A: scan…crashfix. Новые — добавлять сюда же. */
export type MilliStep =
  // options.txt: значение уже проверено белым списком сервера, клиент проверит ещё раз.
  | { op: 'opt'; key: string; to: string }
  // Конфиг мода: файл, формат и путь ключа из курируемой таблицы или найденные в файле.
  | { op: 'cfg'; file: string; format: CfgFormat; path: string; to: string; type?: CfgValueType; min?: number; max?: number; values?: string[] }
  // Память сборки (МБ); 0 — вернуть автоподбор.
  | { op: 'ram'; mb: number }
  | { op: 'fpsboost'; on: boolean }
  // Включить шейдер (имя zip в shaderpacks) или выключить (null).
  | { op: 'shader'; file: string | null }
  // Поставить проект Modrinth в сборку (шейдер, мод, ресурс-пак).
  | { op: 'add'; kind: 'mod' | 'shader' | 'resourcepack'; projectId: string; versionId?: string; title: string }
  | { op: 'snapshot'; scope: 'pack' | 'world'; world?: string; label?: string }
  | { op: 'restore'; id: string }
  | { op: 'world_restore'; file: string }
  // Импорт чужой сборки новой сборкой лаунчера.
  | { op: 'import'; source: 'modrinth' | 'curseforge' | 'file' | 'code'; ref: string; name?: string }
  // Внутренний: вернуть файл как был (для «Отменить»).
  | { op: 'file_put'; path: string; text: string | null; expect?: string }
  // ── Pair A ──
  | { op: 'scan'; mode: string; target?: string }
  | { op: 'mod_update'; file: string; to: string; toNum?: string; from?: string }
  | { op: 'mod_off'; file: string }
  | { op: 'mod_on'; file: string }
  | { op: 'dep_add'; projectId: string; versionId?: string; title: string }
  | { op: 'port'; mc: string; loader: string; name: string; add: { projectId: string; title: string }[] }
  | { op: 'crashfix'; kind: string; arg: string }

export type MilliStepOp = MilliStep['op']
export type CfgFormat = 'toml' | 'json' | 'json5' | 'properties' | 'txt-kv' | 'cfg' | 'yaml'
export type CfgValueType = 'bool' | 'int' | 'float' | 'enum' | 'string'

export interface MilliActionRow {
  id: string
  /** Имя PxArt-иконки или https-адрес иконки мода. */
  icon?: string
  label: string
  from?: string
  to?: string
  /** Одна строка «Подробнее». */
  note?: string
  sev?: 'red' | 'yellow' | 'info'
  /** Игрок может снять галочку — шаги строки не выполнятся. */
  optional?: boolean
  /** Галочка по умолчанию (для optional). */
  on?: boolean
  /** Индексы `steps`, которые относятся к строке. */
  steps?: number[]
}

export interface MilliAction {
  id: string
  kind: MilliActionKind
  /** Сборка лаунчера; нет — выбранная. */
  profile?: string
  /** 1–3 слова: «Графика», «Мини-карта». */
  title: string
  /** Причина для дневника: «чтоб не лагало на ноуте». */
  reason?: string
  rows: MilliActionRow[]
  steps: MilliStep[]
  /** Перед выполнением — снимок сборки. */
  risky?: boolean
  /** Подпись главной кнопки; по умолчанию «Применить». */
  cta?: string
  /** Все шаги только читают: выполнить сразу, без нажатия. */
  auto?: boolean
  /** Нужен перезапуск игры, чтобы увидеть. */
  restart?: boolean
}

// ─── Реестр шагов ───────────────────────────────────────────────────────────

export interface StepCtx {
  profile: string
  action: MilliAction
  /** Строка карточки, к которой относится шаг (для ✓/✕). */
  rowId?: string
}

export interface StepResult {
  ok: boolean
  /** Коротко для строки: «12 → 16», «нет файла». */
  detail?: string
  /** Обратные шаги (выполняются в обратном порядке при «Отменить»). */
  undo?: MilliStep[]
  /** Что записать в дневник. */
  changes?: DiaryChange[]
  /** Шаг-разведка вернул полноценное действие — карточка заменяется им. */
  replace?: MilliAction
  /** Шаг сам сделал снимок — его id попадёт в дневник. */
  snapId?: string
}

export interface DiaryChange {
  label: string
  from?: string
  to?: string
}

export interface StepRunner {
  run: (step: MilliStep, ctx: StepCtx) => Promise<StepResult>
  /** Только чтение: можно выполнять без нажатия. */
  readOnly?: boolean
  /** Меняет моды/файлы так, что откат без снимка сложен. */
  risky?: boolean
}

const runners = new Map<string, StepRunner>()

export function registerStep<O extends MilliStepOp>(op: O, runner: StepRunner) {
  runners.set(op, runner)
}

export const hasStep = (op: string) => runners.has(op)

// ─── Состояние карточек ─────────────────────────────────────────────────────

export type ActionPhase = 'ready' | 'running' | 'done' | 'failed' | 'undoing' | 'undone'

export interface RowResult {
  ok: boolean
  detail?: string
}

export interface ActionState {
  phase: ActionPhase
  /** Текущая версия действия (после replace — новая). */
  action: MilliAction
  /** Снятые игроком галочки. */
  off: string[]
  rows: Record<string, RowResult>
  undo: MilliStep[]
  diaryId?: string
  error?: string
}

interface ActionsStore {
  byId: Record<string, ActionState>
}

export const useMilliActions = create<ActionsStore>(() => ({ byId: {} }))

const aset = (id: string, patch: Partial<ActionState>) =>
  useMilliActions.setState((s) => (s.byId[id] ? { byId: { ...s.byId, [id]: { ...s.byId[id], ...patch } } } : s))

/** Состояние карточки; создаётся при первом показе. */
export function actionState(a: MilliAction): ActionState {
  const cur = useMilliActions.getState().byId[a.id]
  if (cur) return cur
  const off = a.rows.filter((r) => r.optional && r.on === false).map((r) => r.id)
  const st: ActionState = { phase: 'ready', action: a, off, rows: {}, undo: [] }
  useMilliActions.setState((s) => ({ byId: { ...s.byId, [a.id]: st } }))
  return st
}

export function toggleRow(actionId: string, rowId: string) {
  const st = useMilliActions.getState().byId[actionId]
  if (!st || st.phase !== 'ready') return
  aset(actionId, { off: st.off.includes(rowId) ? st.off.filter((x) => x !== rowId) : [...st.off, rowId] })
}

// ─── Выполнение ─────────────────────────────────────────────────────────────

/** Профиль по умолчанию — выбранная сборка лаунчера (подменяется в тестах). */
let defaultProfile: () => string | null = () => null
export const setDefaultProfileGetter = (fn: () => string | null) => {
  defaultProfile = fn
}

/** Хуки дневника и снимков: milliDiary/milliLocal подключают себя сами (без цикла импортов). */
export interface ActionHooks {
  snapshot?: (profile: string, label: string) => Promise<string | null>
  diary?: (e: { profile: string; action: MilliAction; changes: DiaryChange[]; undo: MilliStep[]; snapId?: string }) => Promise<string | null>
  diaryUndone?: (profile: string, diaryId: string) => Promise<void>
  mood?: (m: 'tuning' | 'saving' | 'rewind' | 'proud' | 'oops' | 'idle') => void
}

let hooks: ActionHooks = {}
export const setActionHooks = (h: ActionHooks) => {
  hooks = { ...hooks, ...h }
}

function moodFor(a: MilliAction): 'tuning' | 'saving' | 'rewind' {
  if (a.kind === 'backup') return 'saving'
  if (a.kind === 'restore') return 'rewind'
  return 'tuning'
}

/** Шаги, которые выполнятся с учётом снятых галочек. */
export function chosenSteps(a: MilliAction, off: readonly string[]): { step: MilliStep; rowId?: string }[] {
  const owner = new Map<number, string>()
  for (const r of a.rows) for (const i of r.steps ?? []) owner.set(i, r.id)
  const out: { step: MilliStep; rowId?: string }[] = []
  a.steps.forEach((step, i) => {
    const rowId = owner.get(i)
    if (rowId && off.includes(rowId)) return
    out.push({ step, rowId })
  })
  return out
}

/** «Применить». Возвращает итоговое состояние. Ошибка шага не роняет остальные. */
export async function runAction(id: string): Promise<ActionState | null> {
  const st0 = useMilliActions.getState().byId[id]
  if (!st0 || (st0.phase !== 'ready' && st0.phase !== 'failed')) return st0 ?? null
  const a = st0.action
  const profile = a.profile || defaultProfile()
  if (!profile) {
    aset(id, { phase: 'failed', error: 'Выбери сборку' })
    return useMilliActions.getState().byId[id]
  }
  const list = chosenSteps(a, st0.off)
  const missing = list.find((x) => !runners.has(x.step.op))
  if (missing) {
    aset(id, { phase: 'failed', error: 'Обнови лаунчер' })
    return useMilliActions.getState().byId[id]
  }
  aset(id, { phase: 'running', error: undefined })
  hooks.mood?.(moodFor(a))
  const risky = a.risky || list.some((x) => runners.get(x.step.op)?.risky)
  let snapId: string | undefined
  if (risky && hooks.snapshot && !list.some((x) => x.step.op === 'snapshot')) {
    try {
      snapId = (await hooks.snapshot(profile, 'Перед: ' + a.title)) ?? undefined
    } catch {
      // Снимок не вышел — продолжаем на обратных шагах, они есть у каждого runner.
    }
  }
  const rows: Record<string, RowResult> = {}
  const undo: MilliStep[] = []
  const changes: DiaryChange[] = []
  let okAll = true
  let replaced: MilliAction | null = null
  for (const { step, rowId } of list) {
    const r = runners.get(step.op)!
    let res: StepResult
    try {
      res = await r.run(step, { profile, action: a, rowId })
    } catch (e) {
      res = { ok: false, detail: errText(e) }
    }
    if (!res.ok) okAll = false
    if (rowId) {
      const prev = rows[rowId]
      rows[rowId] = { ok: (prev?.ok ?? true) && res.ok, detail: res.detail ?? prev?.detail }
    }
    if (res.undo?.length) undo.unshift(...[...res.undo].reverse())
    if (res.changes?.length) changes.push(...res.changes)
    if (res.snapId) snapId = res.snapId
    if (res.replace) replaced = res.replace
    aset(id, { rows: { ...rows } })
  }
  if (replaced) {
    // Разведка → новое действие в той же карточке.
    const off = replaced.rows.filter((r) => r.optional && r.on === false).map((r) => r.id)
    useMilliActions.setState((s) => ({ byId: { ...s.byId, [id]: { phase: 'ready', action: { ...replaced!, id }, off, rows: {}, undo: [] } } }))
    hooks.mood?.('idle')
    return useMilliActions.getState().byId[id]
  }
  let diaryId: string | undefined
  if (changes.length && hooks.diary) {
    try {
      diaryId = (await hooks.diary({ profile, action: a, changes, undo, snapId })) ?? undefined
    } catch {}
  }
  const failedAll = !okAll && !changes.length && !undo.length
  aset(id, { phase: failedAll ? 'failed' : 'done', rows, undo, diaryId, error: failedAll ? firstDetail(rows) || 'Не вышло' : undefined })
  hooks.mood?.(okAll ? 'proud' : 'oops')
  return useMilliActions.getState().byId[id]
}

/** «Отменить»: обратные шаги в обратном порядке. */
export async function undoAction(id: string): Promise<boolean> {
  const st = useMilliActions.getState().byId[id]
  if (!st || st.phase !== 'done' || !st.undo.length) return false
  const profile = st.action.profile || defaultProfile()
  if (!profile) return false
  aset(id, { phase: 'undoing' })
  hooks.mood?.('rewind')
  const ok = await runSteps(profile, st.action, st.undo)
  if (st.diaryId && hooks.diaryUndone) await hooks.diaryUndone(profile, st.diaryId).catch(() => {})
  aset(id, { phase: ok ? 'undone' : 'done', error: ok ? undefined : 'Отменить не вышло' })
  hooks.mood?.(ok ? 'idle' : 'oops')
  return ok
}

/** Выполнить шаги подряд (отмена из дневника тоже идёт сюда). */
export async function runSteps(profile: string, action: MilliAction, steps: MilliStep[]): Promise<boolean> {
  let ok = true
  for (const step of steps) {
    const r = runners.get(step.op)
    if (!r) {
      ok = false
      continue
    }
    try {
      const res = await r.run(step, { profile, action })
      if (!res.ok) ok = false
    } catch {
      ok = false
    }
  }
  return ok
}

const readOnlySteps = (steps: MilliStep[]) => steps.length > 0 && steps.every((s) => runners.get(s.op)?.readOnly)

/** Авто-действия (только чтение) запускаются при показе карточки. */
export function maybeAutoRun(a: MilliAction) {
  const st = actionState(a)
  if (st.phase !== 'ready') return
  // The action comes from a model's reply: anything that changes the PC waits for the player's click.
  if (readOnlySteps(a.steps)) void runAction(a.id)
}

const firstDetail = (rows: Record<string, RowResult>) => Object.values(rows).find((r) => !r.ok && r.detail)?.detail

export function errText(e: unknown): string {
  const s = String((e as { message?: string } | null)?.message ?? e ?? '').replace(/^Error:\s*/, '').trim()
  if (/not found|unknown command|command .* not/i.test(s)) return 'Обнови лаунчер'
  return s.slice(0, 80) || 'Не вышло'
}

// ─── Карточка не из ответа сервера ──────────────────────────────────────────

let pushSeq = 0

/**
 * Вставить в ленту Милли сообщение с карточкой, которое не пришло с сервера
 * (результат скана, вылет, проактивное предложение). Живёт до перезагрузки
 * разговора; изменения всё равно остаются в дневнике.
 */
export async function pushMilliAction(text: string, action: MilliAction, suggestions: string[] = []): Promise<void> {
  const { useMilli } = await import('../state/milli')
  const msg: MilliMessage & { action: MilliAction } = {
    id: 'act-' + Date.now().toString(36) + '-' + ++pushSeq,
    role: 'assistant',
    text,
    createdAt: new Date().toISOString(),
    pack: null,
    suggestions,
    action,
  }
  useMilli.setState((s) => ({ messages: [...s.messages, msg] }))
}

/** Действие из сообщения (сервер шлёт поле `action`), с проверкой формы. */
export function messageAction(m: Pick<MilliMessage, 'role'> & { action?: unknown }): MilliAction | null {
  if (m.role !== 'assistant') return null
  return parseAction(m.action)
}

export function parseAction(raw: unknown): MilliAction | null {
  const a = raw as Partial<MilliAction> | null
  if (!a || typeof a !== 'object') return null
  if (typeof a.id !== 'string' || !a.id || typeof a.kind !== 'string' || typeof a.title !== 'string') return null
  if (!Array.isArray(a.steps) || !Array.isArray(a.rows)) return null
  const steps = a.steps.filter((s): s is MilliStep => !!s && typeof s === 'object' && typeof (s as { op?: unknown }).op === 'string').slice(0, 80)
  const rows = a.rows
    .filter((r): r is MilliActionRow => !!r && typeof r === 'object' && typeof (r as MilliActionRow).label === 'string')
    .slice(0, 40)
    .map((r, i) => ({
      ...r,
      id: typeof r.id === 'string' && r.id ? r.id : 'r' + i,
      label: r.label.slice(0, 60),
      ...(r.from != null ? { from: String(r.from).slice(0, 40) } : {}),
      ...(r.to != null ? { to: String(r.to).slice(0, 40) } : {}),
      ...(Array.isArray(r.steps) ? { steps: r.steps.filter((n) => Number.isInteger(n) && n >= 0 && n < steps.length) } : {}),
    }))
  return {
    id: a.id,
    kind: a.kind as MilliActionKind,
    title: a.title.slice(0, 40),
    rows,
    steps,
    ...(typeof a.profile === 'string' && a.profile ? { profile: a.profile } : {}),
    ...(typeof a.reason === 'string' ? { reason: a.reason.slice(0, 120) } : {}),
    ...(a.risky ? { risky: true } : {}),
    ...(a.auto && readOnlySteps(steps) ? { auto: true } : {}),
    ...(a.restart ? { restart: true } : {}),
    ...(typeof a.cta === 'string' && a.cta ? { cta: a.cta.slice(0, 24) } : {}),
  }
}
