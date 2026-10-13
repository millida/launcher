import { beforeEach, expect, test } from 'bun:test'
import { AUTO_HEAL_COOLDOWN_MS, AUTO_HEAL_WINDOW_MS, autoHealPlan, crashedOnStart, takeAutoHeal } from './autoHealPlan'
import type { CrashAction } from '../ipc/events'

const store = new Map<string, string>()
;(globalThis as { localStorage?: unknown }).localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
}

beforeEach(() => store.clear())

const plan = (steps: [string, string][]): CrashAction => ({ kind: 'fix-plan', label: 'Починить сборку', arg: JSON.stringify(steps), steps: steps.map((s) => s[0]) })
const crash = (kind: string, actions: CrashAction[]) => ({ profile: 'Моя сборка', kind, actions })

test('точный план без отключения модов выполняется без человека', () => {
  const p = plan([
    ['install-dep', 'cloth-config|>=11.0.99'],
    ['set-mod-version', 'sodium.jar|0.8.14'],
    ['update-loader', 'fabricloader|>=0.17'],
  ])
  expect(autoHealPlan(crash('missing_deps', [p]))).toBe(p)
  expect(autoHealPlan(crash('old_loader', [plan([['update-loader', 'fabricloader|>=0.17']])]))).not.toBeNull()
})

test('план с отключением мода остаётся человеку', () => {
  const p = plan([
    ['install-dep', 'cloth-config|*'],
    ['disable-mod', 'voxy.jar'],
  ])
  expect(autoHealPlan(crash('missing_deps', [p]))).toBeNull()
})

test('догадка по стеку и вылет без плана автоматически не чинятся', () => {
  const p = plan([['set-mod-version', 'somemod.jar|*']])
  for (const kind of ['mixin', 'conflict', 'unknown', 'oom', 'own_mod', '']) expect(autoHealPlan(crash(kind, [p]))).toBeNull()
  expect(autoHealPlan(crash('missing_deps', []))).toBeNull()
  expect(autoHealPlan(crash('missing_deps', [{ kind: 'install-dep', label: 'x', arg: 'a|*' }]))).toBeNull()
  expect(autoHealPlan(crash('missing_deps', [{ kind: 'fix-plan', label: 'x', arg: 'не json' }]))).toBeNull()
  expect(autoHealPlan(crash('missing_deps', [{ kind: 'fix-plan', label: 'x', arg: '[]' }]))).toBeNull()
  expect(autoHealPlan(crash('missing_deps', [{ kind: 'fix-plan', label: 'x', arg: '[["rm","/"]]' }]))).toBeNull()
  expect(autoHealPlan({ profile: '', kind: 'missing_deps', actions: [p] })).toBeNull()
  expect(autoHealPlan(null)).toBeNull()
})

test('чиним только вылет на старте', () => {
  const now = 1_000_000_000
  expect(crashedOnStart(now - 20_000, now)).toBe(true)
  expect(crashedOnStart(now - AUTO_HEAL_WINDOW_MS - 1, now)).toBe(false)
  expect(crashedOnStart(0, now)).toBe(false)
})

test('одна попытка на сборку за четверть часа: починка, которая не помогла, не зацикливает запуск', () => {
  const now = 2_000_000_000
  expect(takeAutoHeal('A', now)).toBe(true)
  expect(takeAutoHeal('A', now + 60_000)).toBe(false)
  expect(takeAutoHeal('B', now + 60_000)).toBe(true)
  expect(takeAutoHeal('A', now + AUTO_HEAL_COOLDOWN_MS + 1)).toBe(true)
  expect(takeAutoHeal('', now)).toBe(false)
})
