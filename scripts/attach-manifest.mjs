#!/usr/bin/env node
/*
 * Прикладывает к свежему релизу на GitHub список версий latest.json — тот же,
 * по которому ставится и обновляется лаунчер. После этого установщик берёт с
 * GitHub всё: список версий, сам файл и его сумму; хранилище Millida остаётся
 * зеркалом.
 *
 * Список приходит с хранилища (подпись обновления ставится нашим ключом уже
 * после сборки), но на GitHub попадает только после сверки: версия равна
 * версии релиза, каждый адрес ведёт на файл этого же релиза, каждая сумма
 * равна строке SHA256SUMS, у каждого файла есть подпись.
 *
 *     GH_TOKEN=… node scripts/attach-manifest.mjs [vX.Y.Z]
 */
import { execFileSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

const REPO = process.env.GITHUB_REPOSITORY || 'millida/launcher'
const SOURCE = 'https://launcher-storage.millida.net/v2/gh/latest.json'
const WAIT_MS = Number(process.env.MANIFEST_WAIT_MS || 45 * 60_000)
const STEP_MS = 30_000
const UA = { 'User-Agent': 'millida-attach-manifest (+https://github.com/millida/launcher)' }

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const gh = (...args) => execFileSync('gh', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] }).trim()

export function parseSums(text) {
  const out = new Map()
  for (const line of text.split('\n')) {
    const m = /^([0-9a-f]{64})\s+\*?(.+)$/.exec(line.trim())
    if (m) out.set(m[2], m[1])
  }
  return out
}

/** Что в списке не сходится с релизом; пустой массив — список можно прикладывать. */
export function manifestProblems(manifest, version, sums, repo = REPO) {
  const problems = []
  if (manifest?.version !== version) problems.push(`версия списка ${manifest?.version}, релиз ${version}`)
  const platforms = Object.entries(manifest?.platforms || {})
  if (!platforms.length) problems.push('в списке нет ни одной платформы')
  const base = `https://github.com/${repo}/releases/download/v${version}/`
  for (const [key, entry] of platforms) {
    const url = String(entry?.url || '')
    if (!url.startsWith(base)) {
      problems.push(`${key}: адрес не из релиза v${version} — ${url}`)
      continue
    }
    const asset = decodeURIComponent(url.slice(base.length))
    const want = sums.get(asset)
    if (!want) problems.push(`${key}: файла ${asset} нет в SHA256SUMS`)
    else if (entry.sha256 !== want) problems.push(`${key}: сумма ${entry.sha256} не равна SHA256SUMS ${want}`)
    if (typeof entry.signature !== 'string' || entry.signature.length < 40) problems.push(`${key}: нет подписи обновления`)
  }
  return problems
}

async function main() {
  const tag = process.argv[2] || gh('release', 'view', '--repo', REPO, '--json', 'tagName', '--jq', '.tagName')
  const version = tag.replace(/^v/, '')
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error(`«${tag}» — не релиз лаунчера`)
  const sumsRes = await fetch(`https://github.com/${REPO}/releases/download/v${version}/SHA256SUMS`, { headers: UA })
  if (!sumsRes.ok) throw new Error(`SHA256SUMS релиза v${version}: HTTP ${sumsRes.status}`)
  const sums = parseSums(await sumsRes.text())

  const until = Date.now() + WAIT_MS
  let text = ''
  let problems = ['список ещё не запрошен']
  for (;;) {
    const res = await fetch(`${SOURCE}?t=${Date.now()}`, { headers: UA }).catch(() => null)
    if (res?.ok) {
      text = await res.text()
      try {
        problems = manifestProblems(JSON.parse(text), version, sums)
      } catch (e) {
        problems = [`список не разобран: ${e.message}`]
      }
      if (!problems.length) break
    } else problems = [`список не отдан: HTTP ${res?.status ?? 'нет связи'}`]
    // Файлы ещё подписываются и заливаются: версия в списке сменится через несколько минут.
    if (Date.now() > until) throw new Error(`список не сошёлся с релизом v${version}: ${problems.join('; ')}`)
    console.log(`ждём список v${version}: ${problems[0]}`)
    await sleep(STEP_MS)
  }
  writeFileSync('latest.json', text)
  gh('release', 'upload', `v${version}`, 'latest.json', '--repo', REPO, '--clobber')
  console.log(`latest.json приложен к релизу v${version}: ${Object.keys(JSON.parse(text).platforms).join(', ')}`)
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  await main()
}
