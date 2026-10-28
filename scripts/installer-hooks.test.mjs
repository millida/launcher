import { afterAll, expect, test } from 'bun:test'
import { spawn, spawnSync } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// Вход → вердикт. Закреплено обращением 24.08.2026: установщик падал с «Error
// opening file for writing … millida-launcher.exe», а «Повтор» открывал тот же
// занятый файл и падал снова. Хук обязан отдать файл установщику сам — и в
// случае запущенного лаунчера, и в случае снятого атрибута «только чтение».
const NSIS_DIR = join(process.env.LOCALAPPDATA ?? '', 'tauri', 'NSIS')
const MAKENSIS = join(NSIS_DIR, 'Bin', 'makensis.exe')
const HOOKS = join(import.meta.dir, '..', 'src-tauri', 'installer-hooks.nsh')
const READY = process.platform === 'win32' && existsSync(MAKENSIS)

const EXE = 'millida-hooktest.exe'

const HARNESS = `Unicode true
OutFile "\${OUT}"
SilentInstall silent
RequestExecutionLevel user
!include "\${HOOKS}"
Section
  StrCpy $INSTDIR "\${TESTDIR}"
  !insertmacro NSIS_HOOK_PREINSTALL
  ClearErrors
  FileOpen $0 "$INSTDIR\\\${MILLIDA_MAIN_EXE}" w
  \${IfNot} \${Errors}
    FileWrite $0 "NEW-PAYLOAD"
    FileClose $0
  \${EndIf}
SectionEnd
`

const root = READY ? mkdtempSync(join(tmpdir(), 'millida-hooks-')) : ''

afterAll(() => {
  if (root) rmSync(root, { recursive: true, force: true })
})

const buildInstaller = (name) => {
  const dir = join(root, name)
  const script = join(root, `${name}.nsi`)
  const out = join(root, `${name}.exe`)
  rmSync(dir, { recursive: true, force: true })
  mkdirSync(dir, { recursive: true })
  writeFileSync(script, HARNESS)
  const built = spawnSync(
    MAKENSIS,
    [
      '/V2',
      `/DOUT=${out}`,
      `/DHOOKS=${HOOKS}`,
      `/DTESTDIR=${dir}`,
      '/DMAINBINARYNAME=millida-hooktest',
      script,
    ],
    { encoding: 'utf8', env: { ...process.env, NSISDIR: NSIS_DIR } },
  )
  expect(built.stderr + built.stdout, 'хук не компилируется — установщик не соберётся').not.toContain('Error')
  expect(built.status, 'makensis завершился с ошибкой').toBe(0)
  return { installer: out, target: join(dir, EXE) }
}

const install = (installer) => spawnSync(installer, [], { encoding: 'utf8' })

const holdOpenLikeRunningExe = async (file) => {
  const child = spawn(
    'powershell',
    [
      '-NoProfile',
      '-Command',
      `$fs=[IO.File]::Open('${file}','Open','Read','Read,Delete'); 'locked'; Start-Sleep -Seconds 60; $fs.Close()`,
    ],
    { stdio: ['ignore', 'pipe', 'ignore'] },
  )
  await new Promise((resolve, reject) => {
    child.stdout.on('data', (chunk) => String(chunk).includes('locked') && resolve())
    child.on('exit', () => reject(new Error('держатель блокировки не запустился')))
  })
  return () => child.kill()
}

test.skipIf(!READY)('занятый файл лаунчера всё равно перезаписывается', async () => {
  const { installer, target } = buildInstaller('locked')
  writeFileSync(target, 'OLD-PAYLOAD')
  const release = await holdOpenLikeRunningExe(target)
  try {
    install(installer)
    expect(readFileSync(target, 'utf8'), 'файл остался старым — установка снова упадёт у клиента').toBe('NEW-PAYLOAD')
  } finally {
    release()
  }
}, 120_000)

test.skipIf(!READY)('атрибут «только чтение» снимается перед записью', () => {
  const { installer, target } = buildInstaller('readonly')
  writeFileSync(target, 'OLD-PAYLOAD')
  chmodSync(target, 0o444)
  install(installer)
  chmodSync(target, 0o666)
  expect(readFileSync(target, 'utf8'), 'защищённый от записи файл не обновился').toBe('NEW-PAYLOAD')
}, 120_000)
