import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

// The core reinstalls the launcher until the frontend calls `frontend_ready`,
// so a build missing that call would reinstall itself on every start.
const MARKER = 'frontend_ready'
// The x64 bundle starts on macOS 10.13, where WKWebView can be Safari 13: a regex
// lookbehind (Safari 16.4) or a logical assignment (Safari 14) is a parse error
// there, the chunk never runs and `frontend_ready` never fires.
const OLD_WEBKIT_BREAKERS = ['(?<=', '(?<!', '??=', '||=', '&&=']
// The splash lives in index.html, which the CSS pipeline does not lower: `inset`
// (Safari 14.1) is dropped there and the logo sticks to the top-left corner.
const OLD_WEBKIT_HTML_BREAKERS = ['inset:']
const root = join(process.cwd(), 'dist')
const dir = join(root, 'assets')

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

const broken = sources
  .map((c) => ({ name: c.name, found: OLD_WEBKIT_BREAKERS.filter((p) => c.text.includes(p)) }))
  .filter((c) => c.found.length > 0)
if (broken.length > 0) {
  throw new Error(
    `в чанках ${broken.map((c) => `${c.name} (${c.found.join(' ')})`).join(', ')} синтаксис, который WebKit ` +
      'Safari 13 (macOS 10.13–10.15 без обновлений) не разбирает, и лаунчер там не открывается. ' +
      'Lookbehind перепиши захватом предыдущего символа группой; ??= / ||= / &&= означают, ' +
      'что build.target в vite.config.ts подняли выше safari13',
  )
}

const html = readFileSync(join(root, 'index.html'), 'utf8')
const htmlBroken = OLD_WEBKIT_HTML_BREAKERS.filter((p) => html.includes(p))
if (htmlBroken.length > 0) {
  throw new Error(
    `в dist/index.html есть ${htmlBroken.join(', ')} — WebKit Safari 13 его не знает, и сплэш ` +
      'рисуется в углу поверх пустого окна. Пиши top/right/bottom/left',
  )
}

console.log(`Отметка ${MARKER} на месте: ${hits.join(', ')}; синтаксиса новее Safari 13 в чанках нет`)
