/**
 * Один контекст WebGL на все снимки (06.10.2026, «лаунчер открылся криво»):
 * фигурки скинов (skinBody) и снимки наборов магазина (outfitSnapshot) держали
 * каждый свой невидимый движок, а с лобби, сундуками и вкладками браузер
 * упирался в предел контекстов — лобби не получало свой и оставалось пустым.
 *
 * Теперь движок снимков один на всё: работа идёт по очереди через
 * `withSnapshotGl`, и перед работой другого хозяина прежний движок
 * освобождается (dispose + forceContextLoss). `releaseSnapshotGl` отдаёт
 * контекст сразу — так делает лобби, когда браузер не дал ему свой.
 */
export interface GlHolder {
  /** Освободить свой движок (вызывается только между работами). */
  release(): void
}

let tail: Promise<unknown> = Promise.resolve()
let owner: GlHolder | null = null
let running = 0

export function withSnapshotGl<T>(holder: GlHolder, job: () => Promise<T>): Promise<T> {
  const run = tail.then(() => {
    if (owner && owner !== holder) owner.release()
    owner = holder
    running++
    return job().finally(() => running--)
  })
  tail = run.catch(() => undefined)
  return run
}

/** Отдать контекст снимков. Посреди снимка не рвём — освободится после него. */
export function releaseSnapshotGl(): void {
  if (!owner) return
  if (running) {
    const h = owner
    tail = tail.then(() => {
      if (owner === h && !running) {
        h.release()
        owner = null
      }
    })
    return
  }
  owner.release()
  owner = null
}

/** Для тестов и замеров: чей движок сейчас жив. */
export const snapshotGlOwner = () => owner
