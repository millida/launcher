#!/usr/bin/env node
/*
 * Сверяет то, что реально раздаётся игрокам, с тем, что собрал GitHub.
 *
 *  1. Каждый файл из манифеста обновлений (v2/latest.json) скачивается с
 *     хранилища, и его SHA-256 сравнивается со строкой SHA256SUMS релиза этой
 *     версии в github.com/millida/launcher. Заодно сверяется сумма, записанная
 *     в самом манифесте.
 *  2. Установщики с кнопки «Скачать» (setup/) сверяются со списком
 *     installer/site-files.json; у exe дополнительно проверяется, что подпись
 *     Authenticode на месте.
 *
 * Любое расхождение — код выхода 1: прогон по расписанию краснеет у всех на виду.
 *
 *     node scripts/verify-downloads.mjs
 */
import { createHash } from 'node:crypto'
import { appendFileSync, readFileSync } from 'node:fs'

const CDN = 'https://launcher-storage.millida.net'
const REPO = 'millida/launcher'
const SHA = /^[0-9a-f]{64}$/
const UA = { 'User-Agent': 'millida-verify-downloads (+https://github.com/millida/launcher)' }

const problems = []
const rows = []

async function get(url) {
  const res = await fetch(url, { headers: UA, redirect: 'follow' })
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`)
  return res
}

/** SHA-256 файла по адресу и его первые байты (для разбора заголовка exe). */
async function digest(url) {
  const res = await get(url)
  const hash = createHash('sha256')
  const head = []
  let size = 0
  for await (const chunk of res.body) {
    hash.update(chunk)
    if (size < 4096) head.push(Buffer.from(chunk))
    size += chunk.length
  }
  return { sha256: hash.digest('hex'), size, head: Buffer.concat(head) }
}

/** Есть ли у PE-файла таблица сертификатов (подпись Authenticode). */
export function hasAuthenticode(head) {
  if (head.length < 0x40 || head.readUInt16LE(0) !== 0x5a4d) return false
  const pe = head.readUInt32LE(0x3c)
  if (pe + 24 + 240 > head.length) return false
  const magic = head.readUInt16LE(pe + 24)
  const dirs = pe + 24 + (magic === 0x10b ? 96 : 112)
  return head.readUInt32LE(dirs + 8 * 4 + 4) > 0
}

export function parseSums(text) {
  const out = new Map()
  for (const line of text.split('\n')) {
    const m = /^([0-9a-f]{64})\s+\*?(.+)$/.exec(line.trim())
    if (m) out.set(m[2], m[1])
  }
  return out
}

const fail = (what) => {
  problems.push(what)
  console.error('✗ ' + what)
}

async function verifyRelease() {
  const manifest = await (await get(`${CDN}/v2/latest.json?t=${Date.now()}`)).json()
  const version = String(manifest.version || '')
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error(`в манифесте нет версии: ${version}`)
  const sums = parseSums(await (await get(`https://github.com/${REPO}/releases/download/v${version}/SHA256SUMS`)).text())
  if (!sums.size) throw new Error(`SHA256SUMS релиза v${version} пуст`)
  console.log(`Манифест: ${version}, в SHA256SUMS релиза ${sums.size} файлов`)
  for (const [key, entry] of Object.entries(manifest.platforms || {})) {
    const asset = decodeURIComponent(new URL(entry.github).pathname.split('/').pop())
    const want = sums.get(asset)
    if (!want) {
      fail(`${key}: файла ${asset} нет в SHA256SUMS релиза v${version}`)
      continue
    }
    if (!SHA.test(entry.sha256 || '') || entry.sha256 !== want) fail(`${key}: сумма в манифесте не совпадает с SHA256SUMS (${asset})`)
    const got = await digest(entry.url)
    const ok = got.sha256 === want
    if (!ok) fail(`${key}: с хранилища пришёл другой файл — ${got.sha256}, в релизе ${want} (${entry.url})`)
    rows.push([key, asset, (got.size / 1048576).toFixed(1) + ' МБ', ok ? 'совпадает с релизом v' + version : 'НЕ СОВПАДАЕТ'])
    console.log(`${ok ? '✓' : '✗'} ${key}: ${asset}`)
  }
  return version
}

async function verifySite() {
  const list = JSON.parse(readFileSync(new URL('../installer/site-files.json', import.meta.url), 'utf8'))
  for (const file of list.files) {
    const got = await digest(list.base + file.name)
    let ok = got.sha256 === file.sha256
    if (!ok) fail(`setup/${file.name}: в хранилище ${got.sha256}, в списке ${file.sha256}`)
    if (file.signed === 'authenticode' && !hasAuthenticode(got.head)) {
      ok = false
      fail(`setup/${file.name}: подписи Authenticode нет`)
    }
    rows.push(['setup/', file.name, (got.size / 1048576).toFixed(1) + ' МБ', ok ? 'совпадает со списком · ' + file.signer : 'НЕ СОВПАДАЕТ'])
    console.log(`${ok ? '✓' : '✗'} setup/${file.name}`)
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  let version = ''
  try {
    version = await verifyRelease()
    await verifySite()
  } catch (e) {
    fail(String(e?.message || e))
  }
  if (process.env.GITHUB_STEP_SUMMARY) {
    const table = ['| Откуда | Файл | Размер | Итог |', '| --- | --- | --- | --- |', ...rows.map((r) => `| ${r.join(' | ')} |`)].join('\n')
    const head = problems.length ? `## Расхождения: ${problems.length}\n\n${problems.map((p) => '- ' + p).join('\n')}\n\n` : `## Всё, что раздаётся, совпадает с релизом ${version}\n\n`
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, head + table + '\n')
  }
  if (problems.length) process.exit(1)
  console.log(`Готово: ${rows.length} файлов, расхождений нет`)
}
