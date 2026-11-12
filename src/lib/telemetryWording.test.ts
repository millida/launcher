import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const SWITCHES = ['src/components/OnboardingSurvey.tsx', 'src/modals/Settings.tsx']

function rendered(file: string): string[] {
  const source = readFileSync(join(import.meta.dir, '..', '..', file), 'utf8')
  return [...source.matchAll(/\bt\('([^']+)'\)/g)].map((m) => m[1] ?? '')
}

// A signed-in player's statistics are tied to the account (TELEMETRY.md), so a switch that
// calls them anonymous promises something the launcher does not do.
test.each(SWITCHES)('the statistics switch in %s never calls the data anonymous', (file) => {
  const texts = rendered(file)
  expect(texts).toContain('Статистика использования')
  const anonymous = texts.filter((s) => /анонимн/i.test(s))
  expect(anonymous, `${file} shows "${anonymous.join('", "')}" to the player, but the data is tied to the account`).toEqual([])
})
