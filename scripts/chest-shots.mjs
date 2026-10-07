// Снимки 3D-сундуков в PNG (06.10.2026): то же 3D, что в ChestLive, для мест,
// где живой WebGL-холст не нужен или недоступен (клетки пропуска, плитки, лёгкая
// графика). Модели — свои (components/daily/chests/*.bbmodel).
// Запуск при работающем `npx vite`: node scripts/chest-shots.mjs [порт] [playwright]
// Пишет public/chests/<tier>[-<tint>].png, 256×256, прозрачный фон.
import { writeFileSync, mkdirSync } from 'node:fs'
const port = process.argv[2] || '5173'
const pw = process.argv[3] || process.env.PLAYWRIGHT || 'playwright'
const { chromium } = await import(pw)
export const SHOTS = [
  ['COMMON'], ['RARE'], ['EPIC'], ['LEGEND'],
  ['RARE', '#ff6a1a'], ['COMMON', '#e9eeff'], ['RARE', '#ffc93d'], ['EPIC', '#ff5fa8'], ['RARE', '#ff2d55'],
]
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })
const page = await browser.newPage({ deviceScaleFactor: 1 })
await page.goto(`http://127.0.0.1:${port}/`)
await page.waitForTimeout(3000)
mkdirSync('public/chests', { recursive: true })
for (const [tier, tint] of SHOTS) {
  const url = await page.evaluate(async ([tier, tint]) => {
    const m = await import('/src/components/daily/chestScene.ts')
    const c = document.createElement('canvas')
    c.width = 256
    c.height = 256
    c.style.cssText = 'position:fixed;left:0;top:0;width:256px;height:256px'
    document.body.appendChild(c)
    const s = m.createChestScene(c, { tier, tint, mode: 'closed', reduced: true, look: 'model', framing: 'hero', preserve: true })
    s.resize(256, 256)
    await new Promise((r) => setTimeout(r, 1500))
    const out = c.toDataURL('image/png')
    s.dispose()
    c.remove()
    return out
  }, [tier, tint])
  const name = tier.toLowerCase() + (tint ? '-' + tint.replace('#', '') : '')
  writeFileSync('public/chests/' + name + '.png', Buffer.from(url.split(',')[1], 'base64'))
  console.log(name)
}
await browser.close()
