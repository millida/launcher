import { expect, test } from 'bun:test'
import type { LoaderBuild, McVersion } from '../ipc/commands'
import { newerLoaderBuild, newerPatch } from './coreUpdate'

const LIST: McVersion[] = [
  { id: '26.4', kind: 'release' },
  { id: '26.3.2', kind: 'release' },
  { id: '26.3.1', kind: 'release' },
  { id: '26.3.3-rc1', kind: 'snapshot' },
  { id: '26w40a', kind: 'snapshot' },
  { id: '26.3', kind: 'release' },
  { id: '1.21.11', kind: 'release' },
  { id: '1.21.1', kind: 'release' },
]

// Input → verdict. Only patches of the build's own line are offered: the next
// line breaks mods just like a brand new build would.
const patches: Array<[string, string, string | null]> = [
  ['с базовой версии предлагается самый свежий патч', '26.3', '26.3.2'],
  ['с патча — следующий патч', '26.3.1', '26.3.2'],
  ['свежий патч ничего не предлагает', '26.3.2', null],
  ['следующая линия 26.4 — не патч, её не предлагаем', '26.4', null],
  ['старая схема 1.x не предлагается: третье число там — контентный дроп', '1.21.1', null],
  ['снапшот не предлагает обновление', '26w40a', null],
]

for (const [name, current, want] of patches) {
  test(name, () => {
    expect(newerPatch(current, LIST), 'патч для ' + current + ' выбран не тот: игроку предложат не ту игру').toBe(want)
  })
}

const builds: LoaderBuild[] = [
  { version: '0.18.4-beta', stable: false, recommended: false },
  { version: '0.18.3', stable: true, recommended: true },
  { version: '0.18.1', stable: true, recommended: false },
]

const loaders: Array<[string, string | null, LoaderBuild[], string | null]> = [
  ['закреплённая старая сборка получает рекомендуемую', '0.18.1', builds, '0.18.3'],
  ['рекомендуемая без закрепления ставится сама — кнопка не нужна', null, builds, null],
  ['уже рекомендуемая — нечего обновлять', '0.18.3', builds, null],
  ['закреплённую бету новее рекомендуемой не откатываем', '0.18.4-beta', builds, null],
  ['без рекомендуемой берём первую стабильную', '0.18.1', builds.map((b) => ({ ...b, recommended: false })), '0.18.3'],
  ['нумерация NeoForge сравнивается по числам, а не строкой', '21.1.99', [{ version: '21.1.233', stable: true, recommended: true }], '21.1.233'],
  ['пустой список (нет сети) ничего не предлагает', '0.18.1', [], null],
]

for (const [name, pinned, list, want] of loaders) {
  test(name, () => {
    expect(newerLoaderBuild(pinned, list), 'сборка загрузчика выбрана не та для ' + pinned).toBe(want)
  })
}
