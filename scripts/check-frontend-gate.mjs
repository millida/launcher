import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

// The core reinstalls the launcher until the frontend calls `frontend_ready`,
// so a build missing that call would reinstall itself on every start.
const MARKER = 'frontend_ready'
// A regex lookbehind is a parse error in WebKit before Safari 16.4 (macOS
// Catalina and older): the chunk never runs, `frontend_ready` never fires.
const OLD_WEBKIT_BREAKERS = ['(?<=', '(?<!']
const dir = join(process.cwd(), 'dist', 'assets')

const chunks = readdirSync(dir).filter((name) => name.endsWith('.js'))
if (chunks.length === 0) throw new Error(`в ${dir} нет js-чанков — фронтенд собран неправильно`)

const sources = chunks.map((name) => ({ name, text: readFileSync(join(dir, name), 'utf8') }))

const hits = sources.filter((c) => c.text.includes(MARKER)).map((c) => c.name)
if (hits.length === 0) {
  throw new Error(
    `в собранном фронтенде нет вызова ${MARKER} — ядро сочтёт вебвью мёртвым и будет ` +
      'переустанавливать лаунчер на каждом запуске (см. engine/core/selfheal.rs)',
  )
}

const broken = sources.filter((c) => OLD_WEBKIT_BREAKERS.some((p) => c.text.includes(p))).map((c) => c.name)
if (broken.length > 0) {
  throw new Error(
    `в чанках ${broken.join(', ')} есть regex lookbehind (?<= / (?<! — WebKit до Safari 16.4 ` +
      '(macOS Catalina и старше) не разбирает такой модуль, и лаунчер там не открывается. ' +
      'Перепиши выражение без lookbehind: захват предыдущего символа группой',
  )
}

console.log(`Отметка ${MARKER} на месте: ${hits.join(', ')}; lookbehind в чанках нет`)
