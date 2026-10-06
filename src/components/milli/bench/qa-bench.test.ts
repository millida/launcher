import { describe, expect, test } from 'bun:test'

/*
 * QA (SPEC §4 «Фронт», чистая часть): 300 модов из demoPack — строки, окно
 * виртуализатора ≤60, мод №250 достижим прокруткой, оптимистичная проекция
 * клика ≤16 мс и «убрать → вернуть» без потерь. Браузерные fps/long task —
 * отдельным headless-прогоном.
 */


const { demoPack } = await import('./demoPack')
const { benchRows, offsetsOf, rowsInView, rowIndexOf, scrollFor, ROW_H } = await import('./benchRows')
const { projectOps, diffPacks, rememberPack, changeMarks } = await import('../../../state/milliBench')

const med = (xs: number[]) => [...xs].sort((a, b) => a - b)[xs.length >> 1]!
const timed = (n: number, fn: () => void) => {
  const out: number[] = []
  for (let i = 0; i < n; i++) {
    const t = performance.now()
    fn()
    out.push(performance.now() - t)
  }
  return med(out)
}

const pack = demoPack(300)
const base = { removed: [], marks: new Map(), filter: 'all' as const, query: '', toggled: undefined }

describe('QA: demoPack(300)', () => {
  test('детерминирован и честного размера', () => {
    expect(JSON.stringify(demoPack(300))).toBe(JSON.stringify(pack))
    expect(pack.mods.length).toBeGreaterThanOrEqual(250)
    const ids = pack.mods.map((m) => m.projectId)
    expect(new Set(ids).size).toBe(ids.length)
    // requires указывают внутрь сборки
    const own = new Set(ids)
    expect(pack.mods.flatMap((m) => (m.requires ?? []).filter((r) => !own.has(r)))).toEqual([])
  })
})

describe('QA: строки и окно виртуализатора на 300', () => {
  for (const group of ['cat', 'deps', 'az'] as const) {
    for (const modder of [false, true]) {
      test(`${group}${modder ? ' (моддер)' : ''}: benchRows ≤20 мс, окно ≤60 строк на любой прокрутке`, () => {
        const ms = timed(7, () => benchRows({ ...base, mods: pack.mods, group, modder }))
        const { rows } = benchRows({ ...base, mods: pack.mods, group, modder })
        expect(ms).toBeLessThanOrEqual(20)
        const offs = offsetsOf(rows.map((r) => ROW_H[r.kind]))
        const total = offs[rows.length]!
        for (const viewH of [600, 900, 1400]) {
          for (let top = 0; top <= total; top += 37) {
            const [s, e] = rowsInView(offs, top, viewH)
            expect(e - s).toBeLessThanOrEqual(60)
            // Всё, что пересекает видимую область, отрисовано.
            const first = rows.findIndex((_, i) => offs[i + 1]! > top)
            if (first >= 0) expect(s).toBeLessThanOrEqual(first)
            let lastVis = first
            while (lastVis + 1 < rows.length && offs[lastVis + 1]! < top + viewH) lastVis++
            if (first >= 0) expect(e).toBeGreaterThan(Math.min(lastVis, s + 59))
          }
        }
      })
    }
  }

  test('мод №250 находится и попадает в окно после scrollFor (А–Я, моддер — всё раскрыто)', () => {
    const { rows } = benchRows({ ...base, mods: pack.mods, group: 'az', modder: true })
    const target = pack.mods[249]!
    const i = rowIndexOf(rows, target.projectId)
    expect(i).toBeGreaterThanOrEqual(0)
    const offs = offsetsOf(rows.map((r) => ROW_H[r.kind]))
    for (const align of ['nearest', 'center'] as const) {
      const top = scrollFor(offs, i, 0, 700, align)
      const [s, e] = rowsInView(offs, top, 700)
      expect(i).toBeGreaterThanOrEqual(s)
      expect(i).toBeLessThan(e)
      expect(offs[i]!).toBeGreaterThanOrEqual(top)
      expect(offs[i + 1]!).toBeLessThanOrEqual(top + 700)
    }
  })
})

describe('QA: оптимистичный клик на 300', () => {
  test('убрать: проекция ≤16 мс (медиана), строка-призрак и метка «−»; вернуть → тот же состав', () => {
    rememberPack(pack)
    const victim = pack.mods.find((m) => !m.base && !(m.requiredBy ?? []).length)!
    const ms = timed(9, () => projectOps(pack, [{ op: 'remove', tab: 'mods', ref: victim.projectId }]))
    expect(ms).toBeLessThanOrEqual(16)
    const off = projectOps(pack, [{ op: 'remove', tab: 'mods', ref: victim.projectId }])
    expect(off.mods.some((m) => m.projectId === victim.projectId)).toBe(false)
    expect(off.userRemoved).toContain(victim.projectId)
    expect(changeMarks(off.changes).get(victim.projectId)).toBe('-')
    // Клик + перерисовка строк укладываются в кадр.
    const frame = timed(5, () => {
      const p = projectOps(pack, [{ op: 'remove', tab: 'mods', ref: victim.projectId }])
      benchRows({ ...base, mods: p.mods, removed: [victim], marks: changeMarks(p.changes), group: 'cat', modder: false })
    })
    expect(frame).toBeLessThanOrEqual(16)
    const back = projectOps(off, [{ op: 'restore', tab: 'mods', ref: victim.projectId }])
    const ids = (p: typeof pack) => p.mods.map((m) => m.projectId).sort().join(',')
    expect(ids(back)).toBe(ids(pack))
    expect(back.userRemoved ?? []).not.toContain(victim.projectId)
    const d = diffPacks(pack, back)
    expect(d.added.length + d.removed.length + d.changed.length).toBe(0)
  })
})
