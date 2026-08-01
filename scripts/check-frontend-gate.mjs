import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

// The core reinstalls the launcher until the frontend calls `frontend_ready`,
// so a build missing that call would reinstall itself on every start.
const MARKER = 'frontend_ready'
const dir = join(process.cwd(), 'dist', 'assets')

const chunks = readdirSync(dir).filter((name) => name.endsWith('.js'))
if (chunks.length === 0) throw new Error(`в ${dir} нет js-чанков — фронтенд собран неправильно`)

const hits = chunks.filter((name) => readFileSync(join(dir, name), 'utf8').includes(MARKER))
if (hits.length === 0) {
  throw new Error(
    `в собранном фронтенде нет вызова ${MARKER} — ядро сочтёт вебвью мёртвым и будет ` +
      'переустанавливать лаунчер на каждом запуске (см. engine/core/selfheal.rs)',
  )
}

console.log(`Отметка ${MARKER} на месте: ${hits.join(', ')}`)
