import { spawn } from 'node:child_process'

const PATTERNS = ['src/**/*.test.ts', 'src/**/*.test.tsx', 'scripts/**/*.test.mjs']
const CONCURRENCY = Math.max(1, Math.min(4, navigator.hardwareConcurrency ?? 4))

const filters = process.argv.slice(2)

const collect = async () => {
  const found = new Set()
  for (const pattern of PATTERNS) {
    for await (const file of new Bun.Glob(pattern).scan('.')) found.add(file.replaceAll('\\', '/'))
  }
  const all = [...found].sort()
  return filters.length ? all.filter((f) => filters.some((needle) => f.includes(needle))) : all
}

const runFile = (file) =>
  new Promise((resolve) => {
    const child = spawn(process.execPath, ['test', file], { stdio: ['ignore', 'pipe', 'pipe'] })
    let out = ''
    child.stdout.on('data', (d) => void (out += d))
    child.stderr.on('data', (d) => void (out += d))
    child.on('error', (err) => resolve({ file, code: 1, out: out + String(err) }))
    child.on('close', (code) => resolve({ file, code: code ?? 1, out }))
  })

const countOf = (out, word) => {
  let total = 0
  for (const m of out.matchAll(new RegExp(`^\\s*(\\d+) ${word}$`, 'gm'))) total += Number(m[1])
  return total
}

const files = await collect()
if (!files.length) {
  console.error(filters.length ? `no test files match ${filters.join(' ')}` : 'no test files found')
  process.exit(1)
}

const results = []
let next = 0
const worker = async () => {
  while (next < files.length) {
    const file = files[next++]
    const result = await runFile(file)
    results.push(result)
    process.stdout.write(`\n--- ${file}\n${result.out.trim()}\n`)
  }
}
await Promise.all(Array.from({ length: Math.min(CONCURRENCY, files.length) }, worker))

const failedFiles = results.filter((r) => r.code !== 0)
const pass = results.reduce((n, r) => n + countOf(r.out, 'pass'), 0)
const fail = results.reduce((n, r) => n + countOf(r.out, 'fail'), 0)

process.stdout.write(`\n${pass} pass, ${fail} fail across ${files.length} files\n`)
if (failedFiles.length) {
  process.stdout.write(`failed files:\n${failedFiles.map((r) => `  ${r.file}`).join('\n')}\n`)
  process.exit(1)
}
