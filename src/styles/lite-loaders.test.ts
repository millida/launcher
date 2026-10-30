import { describe, expect, it } from 'bun:test'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

// 13-lite.css гасит бесконечные анимации всех, кроме загрузчиков. Если загрузчик переименуют,
// его анимация молча остановится после одного круга и интерфейс «зависнет»: тест держит список живым.

const css = readFileSync(join(import.meta.dir, '13-lite.css'), 'utf8')
const lists = [...css.matchAll(/:is\(([\s\S]*?)\n\s*\) \{/g)].map((m) =>
  m[1]!
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean),
)

const all: string[] = []
const walk = (dir: string) => {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p)
    else if (p.endsWith('.css') && !p.endsWith('13-lite.css')) all.push(readFileSync(p, 'utf8'))
  }
}
walk(join(import.meta.dir, '..'))
const corpus = all.join('\n')

describe('13-lite.css: загрузчики', () => {
  it('в лёгком режиме и в «меньше движения» список один и тот же', () => {
    expect(lists.length).toBe(2)
    expect(lists[0]).toEqual(lists[1]!)
    expect(lists[0]!.length).toBeGreaterThan(15)
  })

  it('каждый класс из списка ещё существует в стилях', () => {
    const missing: string[] = []
    for (const sel of lists[0]!) {
      for (const cls of sel.matchAll(/\.([A-Za-z][\w-]*)/g)) {
        if (!new RegExp('\\.' + cls[1]!.replace(/[-]/g, '\\-') + '(?![\\w-])').test(corpus)) missing.push(sel + ' → .' + cls[1])
      }
    }
    expect(missing).toEqual([])
  })
})
