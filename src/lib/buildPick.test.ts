import { expect, test } from 'bun:test'
import { pickGoneWith } from './buildPick'

const CASES: { why: string; picked: Parameters<typeof pickGoneWith>[0]; name: string; want: boolean }[] = [
  { why: 'удалили выбранную сборку — выбор снимается', picked: { kind: 'build', name: 'Мои моды' }, name: 'Мои моды', want: true },
  { why: 'удалили другую сборку — выбор остаётся', picked: { kind: 'build', name: 'Мои моды' }, name: 'Другая', want: false },
  { why: 'удалили «Minecraft 1.21.11» — выбор версии снимается', picked: { kind: 'version', version: '1.21.11' }, name: 'Minecraft 1.21.11', want: true },
  { why: 'копия «Minecraft 1.21.11 (2)» — тоже сборка этой версии', picked: { kind: 'version', version: '1.21.11' }, name: 'Minecraft 1.21.11 (2)', want: true },
  { why: 'версия-префикс не путается: 1.21 ≠ 1.21.11', picked: { kind: 'version', version: '1.21' }, name: 'Minecraft 1.21.11', want: false },
  { why: 'сервер в выборе от удаления сборок не зависит', picked: { kind: 'server', slug: 's', name: 'S', ip: 'x', logo: null, banner: null, versions: [], licensed: false }, name: 'Minecraft 1.21.11', want: false },
  { why: 'пустой выбор', picked: null, name: 'Minecraft 1.21.11', want: false },
]

for (const c of CASES) test(c.why, () => expect(pickGoneWith(c.picked, c.name)).toBe(c.want))
