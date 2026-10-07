// Сохраняет рисунки из scripts/voxel-art/index.html (нужен запущенный `npx vite`).
// node scripts/voxel-art/save.mjs [папка=public] — PNG кладутся как <папка>/<имя>.png
// PAGE=icons — иконки приложения (icons.html), QUERY=?only=gold — часть рисунков.
const { chromium } = await import(process.env.PW || 'playwright-core')
import fs from 'node:fs'
import path from 'node:path'
const out = process.argv[2] || 'public'
const exe = process.env.CHROME || process.env.HOME + '/Library/Caches/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-mac-arm64/chrome-headless-shell'
const browser = await chromium.launch({ headless: true, executablePath: exe, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } })
page.on('pageerror', (e) => console.log('ERR', e.message))
await page.goto((process.env.BASE || 'http://127.0.0.1:5173') + '/scripts/voxel-art/' + (process.env.PAGE || 'index') + '.html' + (process.env.QUERY || ''))
await page.waitForFunction(() => window.__art, null, { timeout: 600000 })
const art = await page.evaluate(() => window.__art)
for (const [name, url] of Object.entries(art)) {
  const file = path.join(out, name + '.png')
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, Buffer.from(url.split(',')[1], 'base64'))
  console.log(file)
}
if (process.env.SHEET) await page.screenshot({ path: process.env.SHEET, fullPage: true })
await browser.close()
