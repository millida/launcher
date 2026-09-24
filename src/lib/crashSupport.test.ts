import { beforeEach, describe, expect, mock, test } from 'bun:test'

let files: string[] = []
let shareImpl: (profile: string, name: string) => Promise<string> = async (_p, name) =>
  'https://millida.net/l/' + name

mock.module('../ipc/commands', () => ({
  listLogs: async () => files,
  shareLog: (profile: string, name: string) => shareImpl(profile, name),
}))
mock.module('./diag', () => ({ buildDiagnostics: async () => 'ОС: тестовая' }))

const { buildCrashReport, shareCrashLog } = await import('./crashSupport')

// Поддержке нужен лог ЗАПУСКА: в нём видно, на чём оборвалась установка. Игровой
// latest.log пишет уже сама игра, и при падении на старте его может не быть
// вовсе. Порядок предпочтений проверяется таблицей, потому что это единственное,
// что отличает полезное обращение от «у меня не работает».
const PICK: Array<[string[], string, string]> = [
  [
    ['logs/latest.log', 'logs/launcher-latest.log'],
    'logs/launcher-latest.log',
    'лог лаунчера важнее игрового, даже если лежит вторым',
  ],
  [['logs/latest.log', 'logs/2026-09-20-1.log.gz'], 'logs/latest.log', 'без лога лаунчера берём игровой'],
  [['logs/2026-09-20-1.log.gz'], 'logs/2026-09-20-1.log.gz', 'остались только архивы — отдаём архив'],
  [['crash-reports/hs_err.log'], 'crash-reports/hs_err.log', 'вне logs/ тоже лучше, чем ничего'],
]

describe('shareCrashLog', () => {
  beforeEach(() => {
    files = []
    shareImpl = async (_p, name) => 'https://millida.net/l/' + name
  })

  for (const [listing, picked, why] of PICK) {
    test(why, async () => {
      files = listing
      expect(await shareCrashLog('Выживание')).toBe('https://millida.net/l/' + picked)
    })
  }

  test('логов нет — ошибка, а не пустая ссылка', async () => {
    files = []
    expect(shareCrashLog('Выживание')).rejects.toThrow('Лога от этого запуска нет')
  })
})

describe('buildCrashReport', () => {
  beforeEach(() => {
    files = ['logs/launcher-latest.log']
    shareImpl = async (_p, name) => 'https://millida.net/l/' + name
  })

  const crash = { profile: 'Выживание', reason: 'Exit code 1', tail: '…' }

  test('в отчёте есть сборка, причина, ссылка на лог и данные о системе', async () => {
    const text = await buildCrashReport(crash)
    for (const part of ['Выживание', 'Exit code 1', 'https://millida.net/l/logs/launcher-latest.log', 'ОС: тестовая']) {
      expect(text).toContain(part)
    }
  })

  // Проглоченная ошибка выгрузки выглядит как обычный отчёт без строки лога:
  // оператор не знает, что лога нет, и ждёт его от игрока.
  test('лог не выгрузился — причина написана в отчёте, а не потеряна', async () => {
    shareImpl = async () => {
      throw new Error('нет связи')
    }
    const text = await buildCrashReport(crash)
    expect(text).toContain('Лог: не выгрузился')
    expect(text).toContain('нет связи')
    expect(text).toContain('ОС: тестовая')
  })
})
