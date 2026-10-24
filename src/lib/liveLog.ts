/*
 * Живой лог запуска: какие строки красить и какую кнопку дать после вылета.
 * Виновный мод берётся из того же разбора, что и окно вылета (CrashInfo от
 * ядра), а не угадывается здесь по тексту.
 */
import type { CrashAction } from '../ipc/events'
import { modFixOf } from './repair'
import { modTitle } from './crashWhy'

export type LineKind = 'culprit' | 'err' | 'warn' | null

export const LIVE_LOG_MAX = 1500

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** Файлы виновных модов → выражение, которое узнаёт их в строках лога: по имени файла и по имени мода целым словом. */
export function culpritPattern(files: readonly string[]): RegExp | null {
  const names = new Set<string>()
  for (const f of files) {
    names.add(escape(f))
    const title = modTitle(f)
    if (title.length >= 3) names.add('\\b' + escape(title) + '\\b')
  }
  return names.size ? new RegExp([...names].join('|'), 'i') : null
}

const ERR = /\b(ERROR|FATAL|SEVERE)\b|Exception\b|^\s+at\s|Caused by:/
const WARN = /\bWARN(ING)?\b/

export function lineKind(line: string, culprit: RegExp | null): LineKind {
  if (culprit?.test(line)) return 'culprit'
  if (ERR.test(line)) return 'err'
  if (WARN.test(line)) return 'warn'
  return null
}

const NOT_A_FIX: readonly string[] = ['repair', 'fix-plan', 'share-log', 'open-folder']

/** Точное исправление ядра — зелёная кнопка окна вылета (выключить мод, поставить зависимость, Java, драйвер). */
export function exactCrashFix<T extends Pick<CrashAction, 'kind'>>(actions: readonly T[] | null | undefined): T | null {
  return (actions ?? []).find((a) => !NOT_A_FIX.includes(a.kind)) ?? null
}

/** Что делает «Починить» в живом логе: точное исправление, иначе план починки модов. */
export function liveLogFix<T extends Pick<CrashAction, 'kind'> & { arg?: string }>(actions: readonly T[] | null | undefined): T | null {
  return exactCrashFix(actions) ?? modFixOf(actions)
}
