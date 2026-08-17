import {
  appVersion,
  cacheSize,
  deviceSpecs,
  gameDir,
  isFlatpak,
  listJavaRuntimes,
  listProfiles,
  readCrashes,
  skinDiagnose,
} from '../ipc/commands'
import type { CrashEntry, DeviceSpecs, JavaRuntime, Profile, SkinDiag } from '../ipc/commands'
import { hasTauri } from '../ipc/tauri'
import { detectGpu } from './gpu'
import { recentIssues } from './crash'
import { installId, telemetryEnabled } from './telemetry'
import { pendingUpdate, updateReady } from './updater'
import { storedTheme } from './theme'
import { soundMode, soundVolume } from './sound'
import { skinSource } from './gameProfile'
import { hasTray, launchWindowMode, restoreOnGameExit, trayCloseEnabled } from './window'
import { statsShared } from '../state/playStats'
import { getAccount, getMillidaAccount, useAccounts } from '../state/accounts'
import { accKindLabel } from './format'

const MAX_BUILDS = 20
const MAX_ISSUES = 8

async function safe<T>(fn: () => Promise<T>): Promise<T | null> {
  try {
    return await fn()
  } catch {
    return null
  }
}

function accentId(): string {
  try {
    const s = JSON.parse(localStorage.getItem('m-accent') || 'null')
    return s && typeof s.id === 'string' ? s.id : 'green'
  } catch {
    return 'green'
  }
}

function themeLabel(): string {
  const t = storedTheme()
  return t === 'light' ? 'светлая' : t === 'auto' ? 'авто' : 'тёмная'
}

function windowModeLabel(): string {
  const m = launchWindowMode()
  return m === 'tray' ? 'в трей' : m === 'minimize' ? 'свернуть' : 'оставить'
}

function yesNo(v: boolean): string {
  return v ? 'да' : 'нет'
}

function clock(at: number): string {
  return new Date(at).toISOString().slice(11, 19)
}

function specsLine(s: DeviceSpecs | null): string {
  if (!s) return 'ОС: ' + navigator.platform + ' (данные ядра недоступны)'
  const os = [s.os, s.os_version, s.arch].filter(Boolean).join(' ')
  return 'ОС: ' + (os || 'неизвестно')
}

function javaLine(list: JavaRuntime[] | null): string {
  if (!list || !list.length) return 'Java: не установлена'
  return (
    'Java: ' +
    list
      .map((j) => j.major + ' (' + Math.round(j.size / 1024 / 1024) + ' МБ' + (j.in_use ? ', используется' : '') + ')')
      .join(', ')
  )
}

function buildsBlock(list: Profile[] | null): string[] {
  if (!list) return ['Сборки: список недоступен']
  if (!list.length) return ['Сборки: нет']
  const shown = list.slice(0, MAX_BUILDS)
  const rows = shown.map((p) => '  - ' + p.name + ' — ' + p.version + ' · ' + (p.loader || (p.fabric ? 'fabric' : 'vanilla')))
  const rest = list.length - shown.length
  return ['Сборки (' + list.length + '):', ...rows, ...(rest > 0 ? ['  - …ещё ' + rest] : [])]
}

function issuesBlock(pending: CrashEntry[] | null): string[] {
  const recent = recentIssues().slice(-MAX_ISSUES).reverse()
  const native = (pending || []).map((c) => c.file + ': ' + c.message)
  if (!recent.length && !native.length) return ['Ошибки за сессию: нет']
  const out = ['Ошибки за сессию (' + recent.length + '):']
  recent.forEach((i) => out.push('  - ' + clock(i.at) + ' ' + (i.kind === 'crash' ? '[ядро] ' : '') + i.text))
  if (native.length) {
    out.push('Незакрытые падения ядра (' + native.length + '):')
    native.slice(0, MAX_ISSUES).forEach((n) => out.push('  - ' + n))
  }
  return out
}

function skinBlock(d: SkinDiag | null): string[] {
  if (!d) return ['Скин в игре: проверка недоступна']
  const out = ['Скин в игре: ' + d.verdict + ' — ' + d.text]
  d.builds
    .filter((b) => b.state !== 'ok' && b.state !== 'never_launched')
    .forEach((b) => out.push('  - ' + b.build + ' (' + b.mc + ' · ' + b.loader + '): ' + b.text))
  return out
}

export async function buildDiagnostics(): Promise<string> {
  const tauri = hasTauri()
  const [ver, specs, javas, dir, cache, profiles, crashes, flatpak] = await Promise.all([
    tauri ? safe(appVersion) : Promise.resolve(null),
    tauri ? safe(deviceSpecs) : Promise.resolve(null),
    tauri ? safe(listJavaRuntimes) : Promise.resolve(null),
    tauri ? safe(gameDir) : Promise.resolve(null),
    tauri ? safe(cacheSize) : Promise.resolve(null),
    tauri ? safe(listProfiles) : Promise.resolve(null),
    tauri ? safe(readCrashes) : Promise.resolve(null),
    tauri ? safe(isFlatpak) : Promise.resolve(null),
  ])

  const upd = pendingUpdate()
  const accounts = useAccounts.getState().list
  const acc = getAccount()
  const millida = getMillidaAccount()
  const skin = tauri && acc ? await safe(() => skinDiagnose(acc.nick, !!millida)) : null

  const lines: (string | null)[] = [
    '=== Millida Launcher · диагностика ===',
    'Снято: ' + new Date().toISOString(),
    'Версия: ' + (ver || 'неизвестна') + (tauri ? '' : ' (веб-режим, без ядра)'),
    upd ? 'Обновление: доступна ' + upd.version + (updateReady() ? ' (готова к установке)' : ' (качается)') : 'Обновление: нет',
    'Install ID: ' + installId(),
    flatpak ? 'Упаковка: flatpak' : null,
    '',
    '--- Система ---',
    specsLine(specs),
    'CPU: ' + (specs?.cpu || 'неизвестно') + (specs?.cpu_cores ? ' · ' + specs.cpu_cores + 'C/' + specs.cpu_threads + 'T' : ''),
    'RAM: ' + (specs?.ram_mb ? specs.ram_mb + ' МБ' : 'неизвестно'),
    'GPU: ' + (detectGpu() || 'неизвестно'),
    'Экран: ' + (window.screen?.width || 0) + 'x' + (window.screen?.height || 0) + ' @' + (window.devicePixelRatio || 1),
    'Окно: ' + window.innerWidth + 'x' + window.innerHeight,
    'Локаль: ' + (navigator.language || '—') + ' · ' + (Intl.DateTimeFormat().resolvedOptions().timeZone || '—'),
    'Сеть: ' + (navigator.onLine ? 'онлайн' : 'офлайн'),
    'WebView: ' + navigator.userAgent,
    '',
    '--- Игра ---',
    'Папка игры: ' + (dir || 'неизвестно'),
    'Кэш: ' + (cache === null ? 'неизвестно' : Math.round(cache / 1024 / 1024) + ' МБ'),
    javaLine(javas),
    ...buildsBlock(profiles),
    '',
    '--- Аккаунты ---',
    'Всего: ' + accounts.length,
    'Активный: ' + (acc ? acc.nick + ' · ' + accKindLabel(acc.kind) : 'не выбран'),
    'Millida: ' + (millida ? 'вход выполнен' : 'не выполнен вход'),
    'Скины: ' + (skinSource() === 'millida' ? 'Millida' : 'Mojang'),
    ...skinBlock(skin),
    '',
    '--- Настройки ---',
    'Тема: ' + themeLabel() + ' · акцент: ' + accentId(),
    'Звук: ' + soundMode() + ' · громкость ' + soundVolume() + '%',
    'При запуске игры: ' + windowModeLabel() + ' · возврат после игры: ' + yesNo(restoreOnGameExit()),
    'Трей: ' + (hasTray() ? 'доступен' : 'недоступен') + ' · закрывать в трей: ' + yesNo(trayCloseEnabled()),
    'Телеметрия: ' + yesNo(telemetryEnabled()) + ' · статистика друзьям: ' + yesNo(statsShared()),
    '',
    '--- Диагностика ---',
    'Сессия: ' + Math.round(performance.now() / 1000) + ' с',
    ...issuesBlock(crashes),
  ]

  return lines.filter((l): l is string => l !== null).join('\n')
}
