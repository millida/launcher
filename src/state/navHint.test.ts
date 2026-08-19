import { expect, mock, test } from 'bun:test'
import type { HintStage, NavHint } from './navHint'

mock.module('../lib/api', () => ({ api: async () => [], hasMillidaAccount: () => false }))
mock.module('../lib/prefs', () => ({ readPref: (_k: string, f: string) => f, writePref: () => {} }))

const NOW = 1_760_000_000_000
const base: NavHint = { runs: 0, opens: 0, firstAt: 0, checkedAt: 0, owned: false, hidden: false }
const at = (p: Partial<NavHint>): NavHint => ({ ...base, ...p })

const rules = async () => await import('./navHint')

const CASES: { why: string; hint: (age: number) => NavHint; want: HintStage }[] = [
  { why: 'первый запуск — подсказка громкая, ради этого она и есть', hint: () => at({ runs: 1, firstAt: NOW }), want: 'loud' },
  { why: 'второй запуск ещё громкий: одного показа мало, чтобы заметить', hint: () => at({ runs: 2, firstAt: NOW }), want: 'loud' },
  { why: 'к третьему запуску пилюля перестаёт мигать', hint: () => at({ runs: 3, firstAt: NOW }), want: 'quiet' },
  { why: 'зашёл в хостинг — сигнал доставлен, остаётся тихая метка', hint: () => at({ runs: 1, opens: 1, firstAt: NOW }), want: 'quiet' },
  { why: 'зашёл дважды — предложение увидено, пилюля уходит', hint: () => at({ runs: 1, opens: 2, firstAt: NOW }), want: 'off' },
  { why: 'семь запусков без единого захода — не сработало, снимаем', hint: () => at({ runs: 7, firstAt: NOW }), want: 'off' },
  { why: 'у игрока уже есть сервер — продавать нечего', hint: () => at({ runs: 1, owned: true, firstAt: NOW }), want: 'off' },
  { why: 'скрыл вручную — больше не возвращаем сами', hint: () => at({ runs: 1, hidden: true, firstAt: NOW }), want: 'off' },
  { why: 'две недели с первого показа — подсказка не висит вечно', hint: (age) => at({ runs: 1, firstAt: NOW - age - 1 }), want: 'off' },
]

for (const c of CASES) {
  test(c.why, async () => {
    const { HINT_MAX_AGE_MS, hostingStage } = await rules()
    expect(hostingStage(c.hint(HINT_MAX_AGE_MS), NOW)).toBe(c.want)
  })
}
