import { beforeEach, describe, expect, it } from 'bun:test'
import {
  CONSOLE_KEEP,
  beginConsoleReplay,
  clearConsole,
  consoleLines,
  endConsoleReplay,
  keepTail,
  pushConsoleLine,
  useHostConsole,
} from './hostConsole'

// Вход → вердикт. Консоль сервера отдаётся потоком без истории: всё, что ушло
// из буфера, вернуть неоткуда — поэтому буфер переживает уход с вкладки.
describe('буфер консоли сервера', () => {
  beforeEach(() => useHostConsole.setState({ id: '', lines: [], replay: [], replaying: false }))

  it('строки остаются после ухода с вкладки: экран размонтирован, стор жив', () => {
    pushConsoleLine('srv-1', 'первая')
    pushConsoleLine('srv-1', 'вторая')
    expect(consoleLines(useHostConsole.getState(), 'srv-1')).toEqual(['первая', 'вторая'])
  })

  it('чужой сервер не видит чужих строк: иначе консоль показала бы вывод другого', () => {
    pushConsoleLine('srv-1', 'первая')
    expect(consoleLines(useHostConsole.getState(), 'srv-2')).toEqual([])
  })

  it('переключение сервера заменяет ленту, а не дописывает в неё', () => {
    pushConsoleLine('srv-1', 'первая')
    pushConsoleLine('srv-2', 'чужая')
    expect(useHostConsole.getState().id).toBe('srv-2')
    expect(useHostConsole.getState().lines).toEqual(['чужая'])
  })

  it('пустая лента — один и тот же массив: новый на каждый вызов перерисовывал бы экран', () => {
    const s = useHostConsole.getState()
    expect(consoleLines(s, 'srv-1')).toBe(consoleLines(s, 'srv-2'))
  })

  it('очистка оставляет сервер, но забирает строки', () => {
    pushConsoleLine('srv-1', 'первая')
    clearConsole('srv-1')
    expect(consoleLines(useHostConsole.getState(), 'srv-1')).toEqual([])
  })

  const cases: Array<[string, string[], number, string[]]> = [
    ['до потолка строка просто дописывается', ['a', 'b'], 4, ['a', 'b', 'x']],
    ['на потолке уходит самая старая', ['a', 'b', 'c'], 3, ['b', 'c', 'x']],
    ['буфер выше потолка ужимается до него', ['a', 'b', 'c', 'd', 'e'], 3, ['d', 'e', 'x']],
  ]

  for (const [why, lines, limit, want] of cases) {
    it(why, () => {
      expect(keepTail(lines, 'x', limit)).toEqual(want)
    })
  }

  it('поток не съедает память: длина упирается в потолок', () => {
    for (let i = 0; i < CONSOLE_KEEP + 50; i++) pushConsoleLine('srv-1', 'строка ' + i)
    const kept = consoleLines(useHostConsole.getState(), 'srv-1')
    expect(kept.length).toBe(CONSOLE_KEEP)
    expect(kept[kept.length - 1]).toBe('строка ' + (CONSOLE_KEEP + 49))
  })
})

// Нода при каждом подключении заново отдаёт хвост лога и закрывает его
// маркером. Сохранённый буфер + этот хвост = те же строки дважды.
describe('история при переподключении', () => {
  beforeEach(() => useHostConsole.setState({ id: '', lines: [], replay: [], replaying: false }))

  it('история заменяет буфер, а не дописывается к нему', () => {
    pushConsoleLine('srv-1', 'старая')
    pushConsoleLine('srv-1', 'общая')
    beginConsoleReplay('srv-1')
    pushConsoleLine('srv-1', 'общая')
    pushConsoleLine('srv-1', 'пропущенная')
    endConsoleReplay('srv-1', true)
    expect(consoleLines(useHostConsole.getState(), 'srv-1')).toEqual(['общая', 'пропущенная'])
  })

  it('пока история идёт, на экране остаётся то, что игрок уже читал', () => {
    pushConsoleLine('srv-1', 'старая')
    beginConsoleReplay('srv-1')
    pushConsoleLine('srv-1', 'история')
    expect(consoleLines(useHostConsole.getState(), 'srv-1')).toEqual(['старая'])
  })

  it('живые строки после маркера дописываются как обычно', () => {
    beginConsoleReplay('srv-1')
    pushConsoleLine('srv-1', 'история')
    endConsoleReplay('srv-1', true)
    pushConsoleLine('srv-1', 'живая')
    expect(consoleLines(useHostConsole.getState(), 'srv-1')).toEqual(['история', 'живая'])
  })

  it('нода без маркера: история всё равно показывается, иначе консоль пуста', () => {
    pushConsoleLine('srv-1', 'старая')
    beginConsoleReplay('srv-1')
    pushConsoleLine('srv-1', 'история')
    endConsoleReplay('srv-1', false)
    expect(consoleLines(useHostConsole.getState(), 'srv-1')).toEqual(['старая', 'история'])
  })

  it('поток без истории ничего не стирает: маркер пришёл, а перед ним пусто', () => {
    pushConsoleLine('srv-1', 'старая')
    beginConsoleReplay('srv-1')
    endConsoleReplay('srv-1', true)
    expect(consoleLines(useHostConsole.getState(), 'srv-1')).toEqual(['старая'])
  })

  it('второй маркер подряд не трогает ленту: режим истории уже закрыт', () => {
    beginConsoleReplay('srv-1')
    pushConsoleLine('srv-1', 'история')
    endConsoleReplay('srv-1', true)
    pushConsoleLine('srv-1', 'живая')
    endConsoleReplay('srv-1', true)
    expect(consoleLines(useHostConsole.getState(), 'srv-1')).toEqual(['история', 'живая'])
  })
})
