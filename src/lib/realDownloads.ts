/**
 * Настоящие скачивания сборок Millida (владелец 24.09.2026: «только правда,
 * не 101 тысяча»). У 15 сборок в базе к настоящему числу вручную прибавили
 * круглое «стартовое» (разбор: analysis/2026-09-24_настоящие-скачивания.md).
 * Серверная правка (ветка fix/real-downloads) уберёт их в базе; до её выкатки
 * лаунчер вычитает известную прибавку сам. После выкатки число станет меньше
 * прибавки — и поправка перестанет срабатывать, двойного вычитания не будет.
 */
const FAKE: Record<string, number> = {
  arcania: 101000,
  immortal: 87000,
  freshcraft: 65000,
  'lost-souls-2': 51000,
  'wild-blood': 39000,
  endforia: 33000,
  'celestia-2': 31000,
  vortex: 23000,
  edenium: 18000,
  maledictom: 1900,
  aeronautics: 1500,
  komam: 784,
  tlou: 603,
  dotg: 365,
  nightfall: 229,
}

export function realDownloads(slug: string | null | undefined, n: number | null | undefined): number | null {
  if (typeof n !== 'number') return null
  const fake = slug ? FAKE[slug] : undefined
  return fake && n >= fake ? n - fake : n
}
