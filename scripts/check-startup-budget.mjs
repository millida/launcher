import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { gzipSync } from 'node:zlib'

// Бюджет стартового набора (26.10.2026). Стартовый набор — всё, что index.html подтягивает до
// первого кадра: входной index-*.js и его modulepreload-зависимости плюс CSS. Было: index 765 КБ
// (в июле 291), весь набор 1895 КБ JS / 910 КБ CSS; всё, кроме лобби и оболочки, живёт в ленивых
// чанках. Растёт набор — проверка падает: вынеси новое в import() или подними лимит осознанно
// (в одном коммите с причиной). Цель владельца — index ≤300 КБ; пока он выше, это «долг»,
// лимит ниже его не опускается без работы над кодом. 27.10.2026: окно живого лога ушло в ленивый чанк
// (liveLogStore.ts остался в старте), набор 829 → 825 КБ, лимит опущен вслед за ним.
//
// Запуск: после `vite build` из корня репозитория: `bun scripts/check-startup-budget.mjs`.

const LIMITS = {
  /** Входной index-*.js, байт. Цель 300 000 (react-dom ≈183 КБ из них). */
  entryJs: 350_000,
  /** Весь стартовый JS (index + modulepreload), байт. */
  startJs: 828_000,
  /** Весь стартовый CSS, байт. */
  startCss: 415_000,
  /** Стартовый JS в gzip, байт. */
  startJsGzip: 313_000,
}
const TARGET_ENTRY_JS = 300_000

// Тяжёлое, чему в стартовом наборе не место: три-D, кодек, сцена сундука, все экраны, окна и подвалы.
const FORBIDDEN = [
  /^three[.-]/,
  /^mine3d-/,
  /^lamejs-/,
  /^chestScene-/,
  /^LobbyCharacter-/,
  /^outfitSnapshot-/,
  /^(Play|PlayHub|Rubies|Skins|Friends|Settings|Messages|Hosting|Top|Servers|Mods|Builds|Pvp|Plus|Premium|ShopKit|SiteCatalog|InstancePage|MilliDock|Milli|CallPanel|Overlay|centrifuge)-/,
]

const root = join(process.cwd(), 'dist')
const html = readFileSync(join(root, 'index.html'), 'utf8')
const files = [...html.matchAll(/(?:src|href)="\/(assets\/[^"]+\.(?:js|css))"/g)].map((m) => m[1])
if (!files.length) throw new Error('в dist/index.html нет ссылок на assets: сначала vite build')

const entry = files.find((f) => /\/index-[^/]+\.js$/.test(f))
if (!entry) throw new Error('в dist/index.html нет входного index-*.js')

let startJs = 0
let startJsGzip = 0
let startCss = 0
let entryJs = 0
const bad = []
for (const f of files) {
  const buf = readFileSync(join(root, f))
  const name = f.replace('assets/', '')
  if (f.endsWith('.css')) {
    startCss += buf.length
    continue
  }
  startJs += buf.length
  startJsGzip += gzipSync(buf).length
  if (f === entry) entryJs = buf.length
  if (FORBIDDEN.some((re) => re.test(name))) bad.push(name)
}

const kb = (n) => (n / 1000).toFixed(0) + ' КБ'
const rows = [
  ['index-*.js', entryJs, LIMITS.entryJs],
  ['стартовый JS', startJs, LIMITS.startJs],
  ['стартовый JS (gzip)', startJsGzip, LIMITS.startJsGzip],
  ['стартовый CSS', startCss, LIMITS.startCss],
]
const over = []
for (const [label, value, limit] of rows) {
  console.log(`${label.padEnd(22)} ${kb(value).padStart(8)} из ${kb(limit)}`)
  if (value > limit) over.push(`${label}: ${kb(value)} > ${kb(limit)}`)
}
if (entryJs > TARGET_ENTRY_JS) console.log(`цель владельца: index ≤ ${kb(TARGET_ENTRY_JS)} (сейчас ${kb(entryJs)})`)

if (bad.length) over.push('в стартовом наборе тяжёлые чанки: ' + bad.join(', '))
if (over.length) {
  throw new Error(
    'бюджет стартового набора превышен — ' +
      over.join('; ') +
      '. Вынеси новое из стартового кода в import() / lazyHost (src/lib/lateMount.tsx) или подними лимит в scripts/check-startup-budget.mjs с причиной в коммите',
  )
}
console.log('Бюджет стартового набора соблюдён')
