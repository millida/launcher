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

// Хук удаления собирается вместе с шаблоном Tauri, где есть $UpdateMode; здесь
// он только компилируется (не запускается: он чистит реестр текущего пользователя).
const UNINSTALL_HARNESS = `Unicode true
OutFile "\${OUT}"
SilentInstall silent
RequestExecutionLevel user
Var UpdateMode
Var DeleteAppDataCheckboxState
!include "\${HOOKS}"
Section
  StrCpy $UpdateMode 1
  StrCpy $INSTDIR "\${TESTDIR}"
  !insertmacro NSIS_HOOK_PREUNINSTALL
  !insertmacro NSIS_HOOK_POSTUNINSTALL
SectionEnd
`

test.skipIf(!READY)('хук удаления (следы: кэш WebView2, автозапуск, видеокарта, ссылка) компилируется', () => {
  const dir = join(root, 'uninstall')
  mkdirSync(dir, { recursive: true })
  const script = join(root, 'uninstall.nsi')
  writeFileSync(script, UNINSTALL_HARNESS)
  const built = spawnSync(
    MAKENSIS,
    ['/V2', `/DOUT=${join(root, 'uninstall.exe')}`, `/DHOOKS=${HOOKS}`, `/DTESTDIR=${dir}`, '/DMAINBINARYNAME=millida-hooktest', script],
    { encoding: 'utf8', env: { ...process.env, NSISDIR: NSIS_DIR } },
  )
  expect(built.stderr + built.stdout, 'хук удаления не компилируется — релизный установщик не соберётся').not.toContain('Error')
  expect(built.status, 'makensis завершился с ошибкой').toBe(0)
}, 120_000)

const compileAndRun = (name, harness, prepare = () => {}) => {
  const dir = join(root, name)
  rmSync(dir, { recursive: true, force: true })
  mkdirSync(dir, { recursive: true })
  prepare(dir)
  const script = join(root, `${name}.nsi`)
  const out = join(root, `${name}.exe`)
  writeFileSync(script, harness)
  const built = spawnSync(
    MAKENSIS,
    ['/V2', `/DOUT=${out}`, `/DHOOKS=${HOOKS}`, `/DTESTDIR=${dir}`, '/DMAINBINARYNAME=millida-hooktest', script],
    { encoding: 'utf8', env: { ...process.env, NSISDIR: NSIS_DIR } },
  )
  expect(built.stderr + built.stdout, 'хук не компилируется — установщик не соберётся').not.toContain('Error')
  expect(built.status, 'makensis завершился с ошибкой').toBe(0)
  spawnSync(out, [], { encoding: 'utf8' })
  return dir
}

// Обращение 28.10.2026: игрок переустановил лаунчер с галкой «удалить данные
// приложения», и Tauri снёс всю папку данных вместе со сборкой на 50 часов.
// Галка остаётся про аккаунты, настройки и кэш; сборки и миры не трогает никогда.
const WIPE_HARNESS = `Unicode true
OutFile "\${OUT}"
SilentInstall silent
RequestExecutionLevel user
!include "\${HOOKS}"
Section
  !insertmacro MillidaWipeKeepingBuilds "\${TESTDIR}\\roaming" "\${TESTDIR}\\local"
SectionEnd
`

test.skipIf(!READY)('галка «удалить данные» чистит данные, но сборки и миры остаются', () => {
  const seedAll = (dir) => {
    const seed = (rel, body = 'x') => {
      const file = join(dir, rel)
      mkdirSync(join(file, '..'), { recursive: true })
      writeFileSync(file, body)
    }
    seed('roaming/minecraft/profiles/MyBuild/saves/world/level.dat')
    seed('roaming/minecraft/profiles/MyBuild/mods/a.jar')
    seed('roaming/profiles.json', '[]')
    seed('roaming/game-root.txt', 'D:\\Games')
    seed('roaming/device.key')
    seed('roaming/secrets.bin')
    seed('roaming/tmp/part.zip')
    seed('roaming/minecraft/versions/1.20.1/1.20.1.jar')
    seed('roaming/minecraft/runtime/java/bin/java.exe')
    seed('local/EBWebView/Default/Local Storage/leveldb/1.ldb')
  }

  const cases = [
    ['roaming/minecraft/profiles/MyBuild/saves/world/level.dat', true, 'мир игрока — ради него и правка'],
    ['roaming/minecraft/profiles/MyBuild/mods/a.jar', true, 'моды собранной вручную сборки не восстановить'],
    ['roaming/profiles.json', true, 'список сборок с обложками и названиями'],
    ['roaming/game-root.txt', true, 'без него не найдутся сборки в своей папке игры'],
    ['roaming/device.key', false, 'галка обещает выйти из аккаунтов'],
    ['roaming/secrets.bin', false, 'токены входа должны уйти'],
    ['roaming/tmp', false, 'временные файлы'],
    ['roaming/minecraft/versions', false, 'версии игры скачиваются заново'],
    ['roaming/minecraft/runtime', false, 'java скачивается заново'],
    ['local', false, 'хранилище страницы (аккаунты, настройки) уходит по галке'],
  ]
  const dir = compileAndRun('wipe', WIPE_HARNESS, seedAll)
  for (const [rel, kept, why] of cases) {
    expect(existsSync(join(dir, rel)), `${rel}: ${kept ? 'удалено' : 'осталось'} — ${why}`).toBe(kept)
  }
}, 120_000)

// Если хук не перехватит галку, Tauri сам удалит папку данных целиком ещё до
// пост-хука, и сохранять сборки будет уже нечего.
const TAKEOVER_HARNESS = `Unicode true
OutFile "\${OUT}"
SilentInstall silent
RequestExecutionLevel user
Var UpdateMode
Var DeleteAppDataCheckboxState
!include "\${HOOKS}"
Section
  StrCpy $UpdateMode 0
  StrCpy $DeleteAppDataCheckboxState 1
  StrCpy $INSTDIR "\${TESTDIR}"
  !insertmacro NSIS_HOOK_PREUNINSTALL
  FileOpen $0 "\${TESTDIR}\\verdict.txt" w
  FileWrite $0 "$DeleteAppDataCheckboxState/$MillidaWipe"
  FileClose $0
SectionEnd
`

test.skipIf(!READY)('галка «удалить данные» перехватывается до того, как её увидит Tauri', () => {
  const dir = compileAndRun('takeover', TAKEOVER_HARNESS)
  expect(
    readFileSync(join(dir, 'verdict.txt'), 'utf8'),
    'Tauri получил галку — RmDir /r снесёт сборки и миры вместе с папкой данных',
  ).toBe('0/1')
}, 120_000)
