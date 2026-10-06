import { create } from 'zustand'
import { milliOps, milliRevert } from '../lib/milli'
import type { MilliChangeRef, MilliChangeset, MilliItem, MilliOp, MilliPack, MilliTab } from '../lib/milli'
import { useUi } from './ui'
import { PROFILE_OPTIONS } from '../components/milli/bench/benchTabs'

/*
 * Верстак Милли: одна сборка на весь лаунчер. Квитанция в ленте, верстак и
 * окно мода (Project.tsx) читают и правят одно и то же через `benchOp`.
 *
 * Клик рисуется сразу (локальная проекция ops поверх последней подтверждённой
 * ревизии), запрос уходит на сервер по очереди — каждый следующий от новой
 * ревизии. Ответ сервера — новая ревизия → голова. Ошибка → проекция без
 * упавшего клика и тост «Не получилось — вернула как было».
 */

export type BenchGroup = 'cat' | 'deps' | 'az'
export type BenchFilter = 'all' | 'changed' | 'off' | 'warn'

export interface BenchUi {
  /** Верстак показан (широко — правая колонка, узко — вместо чата). */
  open: boolean
  tab: MilliTab
  group: BenchGroup
  filter: BenchFilter
  query: string
  modder: boolean
  /** scrollTop: `chat` — лента, `mods`/`resourcepacks`/… — списки вкладок. */
  scroll: Record<string, number>
}

export interface BenchStage {
  key: string
  labelRu: string
  done: number
  total: number
  sample?: string[]
  /** seq последнего события этапа. */
  at?: number
  /** Найдено кандидатов / проверено версий к этому событию. */
  found?: number
  checked?: number
}

export interface BenchReveal {
  tab: MilliTab
  projectId: string
  /** Растёт при каждом «Показать» — список прокручивает к строке и мигает ей. */
  seq: number
}

export interface BenchState {
  head: MilliPack | null
  /** Ревизии этой сессии по порядку (подтверждённые сервером). */
  revs: MilliPack[]
  busy: boolean
  /** Этапы идущего хода из /progress (пусто — хода нет). */
  progress: BenchStage[]
  ui: BenchUi
  /** «Показать» из чипа: к какой строке прокрутить. */
  reveal: BenchReveal | null
  /** Новый дифф пришёл, пока верстак не на экране (точка на «Сборка»). */
  fresh: boolean
  /** Последнее действие — отмена: Ctrl+Shift+Z вернёт её. */
  canRedo: boolean
  /** Растёт, когда прокрутку сохранили перед уходом: панель вернёт её при показе. */
  restoreSeq: number
  setHead(p: MilliPack | null): void
  op(ops: MilliOp | MilliOp[]): Promise<boolean>
  revert(): Promise<boolean>
  /** «Вернуть» отменённое (Ctrl+Shift+Z): ревизия, от которой ушли отменой. */
  redo(): Promise<boolean>
  /** «Вернуться к ней»: новая ревизия с составом указанной (та же цепочка). */
  revertTo(buildId: string): Promise<boolean>
  setUi(p: Partial<BenchUi>): void
  openBench(tab?: MilliTab): void
  closeBench(): void
  /** Открыть вкладку и прокрутить к строке. */
  show(tab: MilliTab, projectId?: string): void
}

// ─── Чистые функции (тестируются без React) ─────────────────────────────────

export const LIST_TABS = ['mods', 'resourcepacks', 'shaders'] as const
export type ListTab = (typeof LIST_TABS)[number]
const isListTab = (t: MilliTab): t is ListTab => t !== 'config'

export const itemsOf = (p: MilliPack | null, tab: MilliTab): MilliItem[] => (p && isListTab(tab) ? (p[tab] ?? []) : [])
const matches = (m: MilliItem, ref: string) => m.projectId === ref || m.slug === ref

/** Все предметы, которые клиент видел в этой сессии: «Вернуть» и «Добавить» берут из них строку. */
const known = new Map<string, { item: MilliItem; tab: ListTab }>()

export function rememberPack(p: MilliPack | null) {
  if (!p || p.stub) return
  for (const tab of LIST_TABS) for (const m of p[tab] ?? []) known.set(m.projectId, { item: m, tab })
  for (const m of p.shaderChoices ?? []) if (!known.has(m.projectId)) known.set(m.projectId, { item: m, tab: 'shaders' })
}

export function knownItem(ref: string): MilliItem | null {
  const hit = known.get(ref)
  if (hit) return hit.item
  for (const v of known.values()) if (v.item.slug === ref) return v.item
  return null
}

/** Строка-призрак для мода, которого клиент не знает: сервер пришлёт настоящую. */
const ghost = (ref: string): MilliItem => ({ projectId: ref, slug: ref, title: ref, icon: null, why: '', base: false, source: 'modrinth', by: 'user' })

const ref = (m: MilliItem, tab: MilliTab, by: MilliChangeRef['by'] = 'user'): MilliChangeRef => ({ projectId: m.projectId, title: m.title, tab, by })

/**
 * Локальная проекция ops: что игрок увидит до ответа сервера. Сервер правее
 * (каскады библиотек, замены версий) — его ревизия заменит проекцию.
 */
export function projectOps(pack: MilliPack, ops: MilliOp[]): MilliPack {
  const p: MilliPack = {
    ...pack,
    mods: [...pack.mods],
    resourcepacks: [...pack.resourcepacks],
    shaders: [...pack.shaders],
    userRemoved: [...(pack.userRemoved ?? [])],
    ...(pack.config ? { config: { ...pack.config, options: { ...pack.config.options } } } : {}),
  }
  const ch: MilliChangeset = { titleRu: 'Ваши правки', by: 'user', added: [], removed: [], changed: [] }
  const removeFrom = (tab: ListTab, r: string): MilliItem | null => {
    const i = p[tab].findIndex((m) => matches(m, r))
    if (i < 0) return null
    const [m] = p[tab].splice(i, 1)
    return m ?? null
  }
  const addTo = (tab: ListTab, m: MilliItem) => {
    if (p[tab].some((x) => x.projectId === m.projectId)) return
    // Активный шейдер всегда один: добавить = заменить.
    if (tab === 'shaders') for (const old of p.shaders.splice(0)) ch.removed.push(ref(old, tab))
    p[tab].push(m)
    ch.added.push(ref(m, tab))
  }
  for (const o of ops) {
    switch (o.op) {
      case 'remove': {
        if (!isListTab(o.tab)) break
        const m = removeFrom(o.tab, o.ref)
        if (!m) break
        if (!p.userRemoved!.includes(m.projectId)) p.userRemoved!.push(m.projectId)
        ch.removed.push(ref(m, o.tab))
        break
      }
      case 'restore':
      case 'add': {
        if (!isListTab(o.tab)) break
        const m = knownItem(o.ref) ?? ghost(o.ref)
        p.userRemoved = p.userRemoved!.filter((id) => id !== m.projectId && id !== o.ref)
        addTo(o.tab, o.op === 'add' ? { ...m, by: 'user' } : m)
        break
      }
      case 'replace': {
        if (!isListTab(o.tab)) break
        const old = removeFrom(o.tab, o.ref)
        if (old) ch.removed.push(ref(old, o.tab))
        addTo(o.tab, { ...(knownItem(o.to) ?? ghost(o.to)), by: 'user' })
        break
      }
      case 'pin':
        for (const tab of LIST_TABS) p[tab] = p[tab].map((m) => (matches(m, o.ref) ? { ...m, pinned: o.on } : m))
        break
      case 'shader_level': {
        ch.changed.push({ projectId: '', title: 'Шейдеры', field: 'level', from: p.shaderLevel ?? 'off', to: o.level })
        p.shaderLevel = o.level
        if (o.level === 'off') {
          for (const old of p.shaders.splice(0)) ch.removed.push(ref(old, 'shaders'))
          break
        }
        // Как сервер: активный шейдер — первый из лестницы этого уровня.
        if (p.shaders[0]?.level === o.level) break
        const pick = (p.shaderChoices ?? []).find((m) => m.level === o.level)
        if (pick) addTo('shaders', pick)
        break
      }
      case 'profile':
        if (p.config) {
          ;(ch.config ??= []).push({ key: 'profile', from: p.config.profile, to: o.profile })
          p.config.profile = o.profile
          p.config.options = { ...p.config.options, ...(PROFILE_OPTIONS[o.profile] ?? {}) }
        }
        break
      case 'config': {
        if (!p.config) break
        const c = p.config
        const from = o.key === 'ramMb' ? String(c.ramMb) : o.key === 'jvm' ? c.jvm : (c.options[o.key] ?? '')
        if (o.key === 'ramMb') c.ramMb = Number(o.value) || c.ramMb
        else if (o.key === 'jvm') c.jvm = o.value === 'zgc' ? 'zgc' : 'g1'
        else c.options[o.key] = o.value
        ;(ch.config ??= []).push({ key: o.key, from, to: o.value })
        break
      }
      case 'order': {
        // Названные — в указанном порядке, остальные — следом, как были.
        const rank = new Map(o.refs.map((r, i) => [r, i]))
        const pos = (m: MilliItem) => rank.get(m.projectId) ?? rank.get(m.slug) ?? o.refs.length
        const before = p.resourcepacks.map((m) => m.projectId).join()
        p.resourcepacks = p.resourcepacks.map((m, i) => ({ m, i })).sort((a, b) => pos(a.m) - pos(b.m) || a.i - b.i).map((x) => x.m)
        if (p.resourcepacks.map((m) => m.projectId).join() !== before) ch.titleRu = 'Порядок ресурс-паков'
        if (p.resourcepacks.map((m) => m.projectId).join() !== before) ch.changed.push({ projectId: '', title: 'Ресурс-паки', field: 'order', from: before, to: p.resourcepacks.map((m) => m.projectId).join() })
        break
      }
      // size / theme / rp_style решает сервер — локально не угадываем.
      default:
        break
    }
  }
  p.changes = ch
  return p
}

/** Дифф двух ревизий (для отмены): что добавилось и ушло по вкладкам. */
export function diffPacks(from: MilliPack, to: MilliPack, titleRu = 'Отмена', by: 'milli' | 'user' = 'user'): MilliChangeset {
  const ch: MilliChangeset = { titleRu, by, added: [], removed: [], changed: [] }
  for (const tab of LIST_TABS) {
    const a = new Map((from[tab] ?? []).map((m) => [m.projectId, m]))
    const b = new Map((to[tab] ?? []).map((m) => [m.projectId, m]))
    for (const [id, m] of b) if (!a.has(id)) ch.added.push(ref(m, tab, m.by ?? 'user'))
    for (const [id, m] of a) {
      const n = b.get(id)
      if (!n) ch.removed.push(ref(m, tab, m.by ?? 'user'))
      else if ((m.versionId ?? '') !== (n.versionId ?? '')) ch.changed.push({ projectId: id, title: n.title, field: 'version', from: m.version ?? '', to: n.version ?? '' })
    }
  }
  if (from.config && to.config) {
    const keys = new Set([...Object.keys(from.config.options ?? {}), ...Object.keys(to.config.options ?? {})])
    const cfg: NonNullable<MilliChangeset['config']> = []
    for (const k of ['profile', 'ramMb', 'jvm'] as const) if (String(from.config[k]) !== String(to.config[k])) cfg.push({ key: k, from: String(from.config[k]), to: String(to.config[k]) })
    for (const k of keys) if ((from.config.options[k] ?? '') !== (to.config.options[k] ?? '')) cfg.push({ key: k, from: from.config.options[k] ?? '', to: to.config.options[k] ?? '' })
    if (cfg.length) ch.config = cfg
  }
  return ch
}

/** Сколько всего правок в дифе — для «+1 −1 ~1». */
export const changeCount = (c: MilliChangeset | null | undefined) =>
  c ? c.added.length + c.removed.length + c.changed.length + (c.config?.length ?? 0) : 0

/** projectId → '+' | '−' | '~' по дифу головы: подсветка строк верстака. */
export function changeMarks(c: MilliChangeset | null | undefined): Map<string, '+' | '-' | '~'> {
  const out = new Map<string, '+' | '-' | '~'>()
  if (!c) return out
  for (const r of c.added) out.set(r.projectId, '+')
  for (const r of c.removed) out.set(r.projectId, '-')
  for (const r of c.changed) if (r.projectId) out.set(r.projectId, '~')
  return out
}

/** Первая изменённая строка дифа: куда прокрутить «Показать». */
export function firstChange(c: MilliChangeset | null | undefined): { tab: MilliTab; projectId: string } | null {
  if (!c) return null
  const r = c.added[0] ?? c.removed[0]
  if (r) return { tab: r.tab, projectId: r.projectId }
  const ch = c.changed.find((x) => x.projectId)
  if (ch) return { tab: 'mods', projectId: ch.projectId }
  if (c.config?.length) return { tab: 'config', projectId: '' }
  return null
}

// ─── Стор ───────────────────────────────────────────────────────────────────

const UI_KEY = 'milli-bench-ui'

function readUi(): Pick<BenchUi, 'modder' | 'group'> {
  try {
    const r = JSON.parse(localStorage.getItem(UI_KEY) || '{}') as Partial<BenchUi>
    return { modder: r.modder === true, group: r.group === 'deps' || r.group === 'az' ? r.group : 'cat' }
  } catch {
    return { modder: false, group: 'cat' }
  }
}

function saveUi(ui: BenchUi) {
  try {
    localStorage.setItem(UI_KEY, JSON.stringify({ modder: ui.modder, group: ui.group }))
  } catch {}
}

type Job = { kind: 'ops'; ops: MilliOp[] } | { kind: 'revert'; target: string | null; to?: string }

/** Последняя ревизия, которую подтвердил сервер. */
let confirmed: MilliPack | null = null
/** Ещё не подтверждённые клики — проекция поверх `confirmed`. */
let queue: Job[] = []
let chain: Promise<unknown> = Promise.resolve()
/** Сдвигается при смене головы извне: опоздавшие ответы старой сборки отбрасываются. */
let epoch = 0
let revealSeq = 0
/**
 * Зеркало стека отмены сервера: `past` — куда вернёт «Отменить» (верх — ближайшее),
 * `future` — куда вернёт «Вернуть». Чат из истории: past пуст, тогда цель — parent.
 */
let past: string[] = []
let future: string[] = []

const byId = (id: string | null | undefined) => (id ? useBench.getState().revs.find((r) => r.buildId === id) ?? null : null)

function project(base: MilliPack | null, jobs: Job[]): MilliPack | null {
  let p = base
  for (const j of jobs) {
    if (!p) break
    if (j.kind === 'ops') p = projectOps(p, j.ops)
    else {
      const target = byId(j.to ?? j.target)
      if (target) p = { ...target, buildId: p.buildId, rev: (p.rev ?? 1) + 1, parent: p.buildId, changes: diffPacks(p, target, j.to ? 'Вернула' : 'Отмена') }
    }
  }
  return p
}

function pushRev(revs: MilliPack[], p: MilliPack): MilliPack[] {
  if (p.stub) return revs
  const i = revs.findIndex((r) => r.buildId === p.buildId)
  if (i >= 0) return revs.map((r, k) => (k === i ? p : r))
  return [...revs, p]
}

function settle(next: MilliPack | null, failed: string | null) {
  useBench.setState((s) => ({
    head: project(confirmed, queue),
    revs: next ? pushRev(s.revs, next) : s.revs,
    busy: queue.length > 0,
    canRedo: future.length > 0,
  }))
  if (failed) useUi.getState().showToast(failed, failed === NOTHING ? 'ok' : 'error', failed === NOTHING ? false : undefined)
}

const NOTHING = 'Отменять нечего'

function run(job: Job): Promise<boolean> {
  if (!confirmed) return Promise.resolve(false)
  const my = epoch
  queue.push(job)
  useBench.setState({ head: project(confirmed, queue), busy: true })
  const p = chain.then(async () => {
    if (my !== epoch || !confirmed) return false
    try {
      const from = confirmed.buildId
      const next = job.kind === 'ops' ? await milliOps(from, job.ops) : await milliRevert(from, job.to)
      if (my !== epoch) return false
      if (job.kind === 'ops') {
        past.push(from)
        future = []
      } else if (job.to) {
        if (future[future.length - 1] === job.to) future.pop()
        past.push(from)
      } else {
        past.pop()
        future.push(from)
      }
      confirmed = next
      rememberPack(next)
      queue = queue.filter((j) => j !== job)
      settle(next, null)
      return true
    } catch (e) {
      if (my !== epoch) return false
      queue = queue.filter((j) => j !== job)
      const nothing = job.kind === 'revert' && !job.to && /milli_rev|\b409\b/.test(String((e as Error)?.message ?? e))
      if (nothing) past = []
      settle(null, nothing ? NOTHING : 'Не получилось — вернула как было')
      return false
    }
  })
  chain = p.catch(() => false)
  return p
}

/** Дождаться, пока сервер примет все клики: ход в чат уходит от свежей ревизии. */
export const benchSettled = (): Promise<void> => chain.then(() => undefined)

/** buildId, который видит игрок, — для `milliSend`. */
export const benchBuildId = (): string | null => confirmed?.buildId ?? null

export const useBench = create<BenchState>((set, get) => ({
  head: null,
  revs: [],
  busy: false,
  progress: [],
  ui: { open: false, tab: 'mods', filter: 'all', query: '', scroll: {}, ...readUi() },
  reveal: null,
  fresh: false,
  canRedo: false,
  restoreSeq: 0,

  setHead(p) {
    epoch++
    queue = []
    chain = Promise.resolve()
    if (!p) {
      confirmed = null
      past = []
      future = []
      known.clear()
      set({ head: null, revs: [], busy: false, reveal: null, fresh: false, canRedo: false })
      return
    }
    if (p.stub) return
    const same = confirmed?.buildId === p.buildId
    // Другая цепочка ревизий (новая сборка) — история начинается заново.
    const sameChain = !!confirmed && (confirmed.chain ?? confirmed.buildId) === (p.chain ?? p.buildId)
    // Ход Милли в той же цепочке — тоже шаг, который отменяется.
    if (sameChain && !same && confirmed) past.push(confirmed.buildId)
    if (!sameChain && !same) past = []
    if (!same) future = []
    confirmed = p
    rememberPack(p)
    set((s) => ({
      head: p,
      revs: sameChain || same ? pushRev(s.revs, p) : [p],
      busy: false,
      canRedo: future.length > 0,
      fresh: same ? s.fresh : s.fresh || !s.ui.open,
      // Новая сборка открывается сразу на «Модах»: школьник не догадается, что вкладки раскрываются.
      ...(!sameChain && !same ? { ui: { ...s.ui, open: true, tab: 'mods' as MilliTab } } : {}),
    }))
  },

  op(o) {
    const ops = Array.isArray(o) ? o : [o]
    if (!ops.length) return Promise.resolve(false)
    return run({ kind: 'ops', ops })
  },

  revert() {
    const cur = get().head
    // Цель отмены: верх стека клиента; чат из истории — parent (сервер знает точнее).
    const target = past[past.length - 1] ?? cur?.parent ?? null
    if (!cur || !target) {
      useUi.getState().showToast(NOTHING, 'ok', false)
      return Promise.resolve(false)
    }
    return run({ kind: 'revert', target })
  },

  redo() {
    const to = future[future.length - 1]
    if (!get().head || !to) return Promise.resolve(false)
    return run({ kind: 'revert', target: null, to })
  },

  revertTo(buildId) {
    const cur = get().head
    if (!cur || cur.buildId === buildId) return Promise.resolve(false)
    // Прыжок к старой ревизии — новый шаг: «Вернуть» после него не к чему.
    future = []
    return run({ kind: 'revert', target: null, to: buildId })
  },

  setUi(p) {
    const ui = { ...get().ui, ...p }
    set({ ui })
    if ('modder' in p || 'group' in p) saveUi(ui)
  },

  openBench(tab) {
    set((s) => ({ ui: { ...s.ui, open: true, ...(tab ? { tab } : {}) }, fresh: false }))
  },

  closeBench() {
    set((s) => ({ ui: { ...s.ui, open: false } }))
  },

  show(tab, projectId) {
    set((s) => ({
      ui: { ...s.ui, open: true, tab, filter: 'all', query: '' },
      fresh: false,
      reveal: projectId ? { tab, projectId, seq: ++revealSeq } : s.reveal,
    }))
    try {
      window.dispatchEvent(new CustomEvent('milli-bench-reveal', { detail: { tab, projectId } }))
    } catch {}
  },
}))

export const benchOp = (o: MilliOp | MilliOp[]) => useBench.getState().op(o)
export const benchRevert = () => useBench.getState().revert()
export const benchRedo = () => useBench.getState().redo()

/** Мод в сборке сейчас (по голове, с учётом неподтверждённых кликов). */
export function benchHas(projectId: string): { tab: ListTab; on: boolean } | null {
  const head = useBench.getState().head
  if (!head) return null
  for (const tab of LIST_TABS) if (head[tab].some((m) => m.projectId === projectId)) return { tab, on: true }
  if (head.userRemoved?.includes(projectId)) return { tab: known.get(projectId)?.tab ?? 'mods', on: false }
  const k = known.get(projectId)
  return k ? { tab: k.tab, on: false } : null
}

/** Ход идёт: этапы из /progress (вызывает state/milli.ts). */
export const setBenchProgress = (progress: BenchStage[]) => useBench.setState({ progress })

/**
 * Перед уходом из панели (окно мода): scrollTop ленты и списков верстака —
 * в ui.scroll. Панель прячется через display:none, а WebKit при этом теряет
 * прокрутку; MilliDock вернёт её в useLayoutEffect после показа.
 */
export function benchSaveScroll() {
  try {
    const scroll: Record<string, number> = { ...useBench.getState().ui.scroll }
    const chat = document.querySelector<HTMLElement>('.ml-panel .ml-scroll')
    if (chat) scroll.chat = chat.scrollTop
    document.querySelectorAll<HTMLElement>('.ml-panel [data-bench-scroll]').forEach((el) => {
      const k = el.dataset.benchScroll
      if (k) scroll[k] = el.scrollTop
    })
    useBench.setState((s) => ({ ui: { ...s.ui, scroll }, restoreSeq: s.restoreSeq + 1 }))
  } catch {}
}
