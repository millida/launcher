/*
 * Лог запущенной игры для любого окна, открытого когда угодно: снимок из
 * ядра (всё с начала запуска) плюс пачки с номерами. Пачка, которая уже
 * есть в снимке, не повторяется; пачка, пришедшая пока снимок в пути, не
 * теряется.
 */
import { gameLogSnapshot, type LiveLogSnapshot } from '../ipc/commands'
import { listenGameLogSeq, listenGameLogStart, type GameLogBatch } from '../ipc/events'
import { hasTauri } from '../ipc/tauri'

export class LogFeed {
  lines: string[] = []
  profile = ''
  /** Номер следующей ожидаемой строки; -1 — принимать всё, что придёт. */
  private next = -1
  private waiting: GameLogBatch[] | null = null

  constructor(private readonly max: number) {}

  start(profile: string) {
    this.profile = profile
    this.lines = []
    this.next = -1
  }

  /** Снимок запрошен: пачки до его прихода копятся. */
  syncing() {
    this.waiting ??= []
  }

  snapshot(s: LiveLogSnapshot | null) {
    const held = this.waiting ?? []
    this.waiting = null
    if (s) {
      this.profile = s.profile
      this.lines = s.lines.slice(-this.max)
      this.next = s.seq + s.lines.length
    }
    for (const b of held) this.batch(b)
  }

  /** false — пачка целиком уже показана или ждёт снимка. */
  batch(b: GameLogBatch): boolean {
    if (this.waiting) {
      this.waiting.push(b)
      return false
    }
    const skip = this.next < 0 ? 0 : Math.max(0, this.next - b.seq)
    if (skip >= b.lines.length) return false
    this.lines = this.lines.concat(skip ? b.lines.slice(skip) : b.lines).slice(-this.max)
    this.next = b.seq + b.lines.length
    return true
  }
}

/** Следить за логом игры: сразу всё накопленное, дальше новые строки. Возвращает отписку. */
export function followGameLog(max: number, onChange: (lines: string[], profile: string) => void): () => void {
  if (!hasTauri()) return () => {}
  const feed = new LogFeed(max)
  let alive = true
  const uns: Array<(() => void) | null> = []
  const emit = () => alive && onChange(feed.lines, feed.profile)
  feed.syncing()
  // The snapshot is asked for only once both listeners are live: a batch announced in between would be lost.
  void Promise.all([
    listenGameLogSeq((b) => feed.batch(b) && emit()),
    listenGameLogStart((p) => {
      feed.start(p)
      emit()
    }),
  ]).then((list) => {
    if (!alive) return list.forEach((u) => u?.())
    uns.push(...list)
    gameLogSnapshot()
      .then((s) => feed.snapshot(s))
      .catch(() => feed.snapshot(null))
      .finally(emit)
  })
  return () => {
    alive = false
    uns.forEach((u) => u?.())
  }
}
