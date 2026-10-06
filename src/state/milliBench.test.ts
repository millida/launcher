import { expect, mock, test } from 'bun:test'
import type { MilliItem, MilliOp, MilliPack } from '../lib/milli'

/*
 * Стор верстака: оптимистичная проекция кликов, очередь ops от свежей ревизии,
 * откат при ошибке, отмена (revert) и сохранение прокрутки.
 */

const realMilli = await import('../lib/milli')
const calls: { kind: 'ops' | 'revert'; buildId: string; ops?: MilliOp[]; to?: string }[] = []
const undoStack: string[] = []
let fail = false
let nextRev = 10
let server: Record<string, MilliPack> = {}
mock.module('../lib/milli', () => ({
  ...realMilli,
  milliOps: async (buildId: string, ops: MilliOp[]) => {
    calls.push({ kind: 'ops', buildId, ops })
    await Bun.sleep(2)
    if (fail) throw new Error('http 500')
    const { projectOps } = await import('./milliBench')
    const p = { ...projectOps(server[buildId]!, ops), buildId: 'b' + ++nextRev, parent: buildId, rev: nextRev }
    server[p.buildId] = p
    undoStack.push(buildId)
    return p
  },
  milliRevert: async (buildId: string, to?: string) => {
    calls.push({ kind: 'revert', buildId, ...(to ? { to } : {}) })
    await Bun.sleep(2)
    // Как сервер: без to — шаг назад по стеку, с to — «Вернуть» к ревизии.
    const target = to ? server[to] : server[undoStack.pop() ?? '']
    if (!target) throw new Error('http 409 milli_rev')
    if (to) undoStack.push(buildId)
    const p = { ...target, buildId: 'b' + ++nextRev, parent: buildId, rev: nextRev }
    server[p.buildId] = p
    return p
  },
}))
const toasts: string[] = []
const realUi = await import('./ui')
realUi.useUi.setState({ showToast: (m: string) => void toasts.push(m) } as never)

const { useBench, benchOp, projectOps, diffPacks, changeMarks, firstChange, benchHas } = await import('./milliBench')

const item = (id: string, extra: Partial<MilliItem> = {}): MilliItem => ({ projectId: id, slug: 's-' + id, title: 'T' + id, icon: null, why: '', base: false, source: 'modrinth', ...extra })

function pack(n = 300): MilliPack {
  return {
    buildId: 'b1',
    chain: 'b1',
    rev: 1,
    parent: null,
    title: 'Тест',
    mcVersion: '1.20.1',
    loader: 'forge',
    mods: Array.from({ length: n }, (_, i) => item('m' + i)),
    resourcepacks: [item('rp1')],
    shaders: [item('sh1', { level: 'medium' })],
    shaderLoader: null,
    maps: [],
    links: [],
    excluded: [],
    notes: '',
    locked: { extras: false },
    shaderLevel: 'medium',
    shaderChoices: [item('shL', { level: 'light' }), item('sh1', { level: 'medium' })],
    config: { profile: 'balanced', ramMb: 6144, jvm: 'g1', options: { renderDistance: '12' }, shaderPack: null },
  }
}

function reset() {
  calls.length = 0
  toasts.length = 0
  undoStack.length = 0
  fail = false
  const p = pack()
  server = { b1: p }
  useBench.getState().setHead(null)
  useBench.getState().setHead(p)
}

test('projectOps: remove/restore/add-призрак/shader_level/config', () => {
  const p = pack(3)
  const a = projectOps(p, [{ op: 'remove', tab: 'mods', ref: 'm1' }])
  expect(a.mods.map((m) => m.projectId)).toEqual(['m0', 'm2'])
  expect(a.userRemoved).toEqual(['m1'])
  expect(a.changes?.removed.map((r) => r.projectId)).toEqual(['m1'])
  // Исходник не тронут.
  expect(p.mods).toHaveLength(3)
  useBench.getState().setHead(p) // запомнить предметы
  const b = projectOps(a, [{ op: 'restore', tab: 'mods', ref: 'm1' }])
  expect(b.mods.map((m) => m.projectId)).toContain('m1')
  expect(b.userRemoved).toEqual([])
  const c = projectOps(p, [{ op: 'add', tab: 'mods', ref: 'new-mod' }])
  expect(c.mods[c.mods.length - 1]).toMatchObject({ projectId: 'new-mod', title: 'new-mod', by: 'user' })
  const d = projectOps(p, [{ op: 'shader_level', level: 'light' }])
  expect(d.shaders.map((s) => s.projectId)).toEqual(['shL'])
  expect(projectOps(p, [{ op: 'shader_level', level: 'off' }]).shaders).toEqual([])
  const e = projectOps(p, [{ op: 'config', key: 'ramMb', value: '8192' }, { op: 'config', key: 'renderDistance', value: '6' }])
  expect(e.config?.ramMb).toBe(8192)
  expect(e.config?.options.renderDistance).toBe('6')
  expect(e.changes?.config).toHaveLength(2)
})

test('diffPacks + changeMarks + firstChange', () => {
  const p = pack(4)
  const q = projectOps(p, [{ op: 'remove', tab: 'mods', ref: 'm2' }, { op: 'add', tab: 'resourcepacks', ref: 'rpX' }])
  const d = diffPacks(p, q)
  expect(d.removed.map((r) => r.projectId)).toEqual(['m2'])
  expect(d.added.map((r) => [r.tab, r.projectId])).toEqual([['resourcepacks', 'rpX']])
  expect(changeMarks(d).get('m2')).toBe('-')
  expect(firstChange(d)).toEqual({ tab: 'resourcepacks', projectId: 'rpX' })
})

test('клик виден за кадр (синхронно), сервер подтверждает новой ревизией', async () => {
  reset()
  const t0 = performance.now()
  const done = benchOp({ op: 'remove', tab: 'mods', ref: 'm250' })
  const ms = performance.now() - t0
  expect(ms).toBeLessThan(16)
  expect(useBench.getState().head!.mods.some((m) => m.projectId === 'm250')).toBe(false)
  expect(useBench.getState().busy).toBe(true)
  expect(benchHas('m250')).toEqual({ tab: 'mods', on: false })
  expect(await done).toBe(true)
  const st = useBench.getState()
  expect(st.busy).toBe(false)
  expect(st.head!.buildId).toBe('b' + nextRev)
  expect(st.revs.map((r) => r.buildId)).toEqual(['b1', st.head!.buildId])
})

test('два клика подряд: второй уходит от ревизии первого', async () => {
  reset()
  const a = benchOp({ op: 'remove', tab: 'mods', ref: 'm1' })
  const b = benchOp({ op: 'remove', tab: 'mods', ref: 'm2' })
  const head = useBench.getState().head!
  expect(head.mods.some((m) => m.projectId === 'm1' || m.projectId === 'm2')).toBe(false)
  await Promise.all([a, b])
  expect(calls[0]!.buildId).toBe('b1')
  expect(calls[1]!.buildId).toBe(useBench.getState().revs[1]!.buildId)
  expect(useBench.getState().head!.mods).toHaveLength(298)
})

test('ошибка сервера — откат и тост «Не получилось — вернула как было»', async () => {
  reset()
  fail = true
  const ok = await benchOp({ op: 'remove', tab: 'mods', ref: 'm5' })
  expect(ok).toBe(false)
  expect(useBench.getState().head!.buildId).toBe('b1')
  expect(useBench.getState().head!.mods.some((m) => m.projectId === 'm5')).toBe(true)
  expect(toasts).toContain('Не получилось — вернула как было')
})

test('отмена шагает назад по стеку, «Вернуть» — revert {to}', async () => {
  reset()
  await benchOp({ op: 'remove', tab: 'mods', ref: 'm7' })
  await benchOp({ op: 'remove', tab: 'mods', ref: 'm8' })
  const has = (id: string) => useBench.getState().head!.mods.some((m) => m.projectId === id)
  expect(await useBench.getState().revert()).toBe(true)
  expect([has('m7'), has('m8')]).toEqual([false, true])
  expect(useBench.getState().canRedo).toBe(true)
  // Вторая отмена — ещё шаг назад, к исходной сборке.
  const p = useBench.getState().revert()
  expect([has('m7'), has('m8')]).toEqual([true, true]) // проекция за кадр
  expect(await p).toBe(true)
  expect([has('m7'), has('m8')]).toEqual([true, true])
  // «Вернуть» — к ревизии, от которой ушли последней отменой.
  expect(await useBench.getState().redo()).toBe(true)
  expect(calls[calls.length - 1]!.to).toBeTruthy()
  expect([has('m7'), has('m8')]).toEqual([false, true])
  // Новый клик обнуляет «Вернуть».
  await benchOp({ op: 'remove', tab: 'mods', ref: 'm9' })
  expect(useBench.getState().canRedo).toBe(false)
})

test('revert без родителя — ничего не шлём', async () => {
  reset()
  expect(await useBench.getState().revert()).toBe(false)
  expect(calls).toHaveLength(0)
})

test('новая голова извне (ход Милли) отбрасывает опоздавший ответ клика', async () => {
  reset()
  const a = benchOp({ op: 'remove', tab: 'mods', ref: 'm9' })
  const fresh = { ...pack(10), buildId: 'other', chain: 'other' }
  useBench.getState().setHead(fresh)
  expect(await a).toBe(false)
  expect(useBench.getState().head!.buildId).toBe('other')
  expect(useBench.getState().revs.map((r) => r.buildId)).toEqual(['other'])
})

test('ui: show() открывает вкладку и растит reveal.seq; fresh гаснет', () => {
  reset()
  useBench.getState().closeBench()
  useBench.getState().setHead({ ...pack(5), buildId: 'n2', chain: 'n2' })
  expect(useBench.getState().fresh).toBe(true)
  const before = useBench.getState().reveal?.seq ?? 0
  useBench.getState().show('shaders', 'sh1')
  const st = useBench.getState()
  expect(st.ui.open).toBe(true)
  expect(st.ui.tab).toBe('shaders')
  expect(st.reveal).toMatchObject({ tab: 'shaders', projectId: 'sh1' })
  expect(st.reveal!.seq).toBeGreaterThan(before)
  expect(st.fresh).toBe(false)
})

test('revertTo: новая ревизия с составом указанной, «Вернуть» гаснет', async () => {
  reset()
  await benchOp({ op: 'remove', tab: 'mods', ref: 'm1' })
  await benchOp({ op: 'remove', tab: 'mods', ref: 'm2' })
  const has = (id: string) => useBench.getState().head!.mods.some((m) => m.projectId === id)
  const p = useBench.getState().revertTo('b1')
  expect([has('m1'), has('m2')]).toEqual([true, true])
  expect(await p).toBe(true)
  expect(calls[calls.length - 1]).toMatchObject({ kind: 'revert', to: 'b1' })
  expect(useBench.getState().canRedo).toBe(false)
  expect(await useBench.getState().revertTo(useBench.getState().head!.buildId)).toBe(false)
})

test('projectOps order: названные ресурс-паки первыми, остальные следом', () => {
  const p = { ...pack(1), resourcepacks: [item('a'), item('b'), item('c')] }
  const q = projectOps(p, [{ op: 'order', tab: 'resourcepacks', refs: ['c', 's-a'] }])
  expect(q.resourcepacks.map((m) => m.projectId)).toEqual(['c', 'a', 'b'])
  expect(q.changes?.changed[0]?.field).toBe('order')
  expect(projectOps(p, [{ op: 'order', tab: 'resourcepacks', refs: ['a', 'b', 'c'] }]).changes?.changed).toEqual([])
})
