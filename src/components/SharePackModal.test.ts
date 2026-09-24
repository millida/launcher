import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'

const source = () => readFileSync(new URL('./SharePackModal.tsx', import.meta.url), 'utf8')

// Regression: the modal used to pick the first remote code by profile name and
// never submit the current manifest. Adding a mod therefore left the user with
// a code for an older snapshot.
test('окно не принимает старый код за актуальный только по имени сборки', () => {
  const src = source()
  expect(src).not.toContain('myPacks')
  expect(src).not.toMatch(/\.find\(\(x\) => x\.name === profile\)/)
})

test('получение кода всегда публикует текущее состояние сборки', () => {
  const src = source()
  expect(src).toContain('shareProfile(profile, summary.trim() || undefined)')
  expect(src).toContain('onClick={publish}')
})
