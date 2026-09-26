import type { MoveCandidate, MoveOutcome } from '../ipc/commands'
import { LOADER_NAME, plural } from './format'

const GB = 1024 * 1024 * 1024
const MB = 1024 * 1024

export function sizeText(bytes: number): string {
  if (!bytes || bytes < 0) return '0 МБ'
  if (bytes >= GB) return (bytes / GB).toFixed(bytes < 10 * GB ? 1 : 0).replace('.', ',') + ' ГБ'
  return Math.max(1, Math.round(bytes / MB)) + ' МБ'
}

export function contentText(c: Pick<MoveCandidate, 'bytes' | 'worlds' | 'mods'>): string {
  const parts = [sizeText(c.bytes)]
  if (c.worlds) parts.push(c.worlds + ' ' + plural(c.worlds, 'мир', 'мира', 'миров'))
  if (c.mods) parts.push(c.mods + ' ' + plural(c.mods, 'мод', 'мода', 'модов'))
  return parts.join(' · ')
}

export function candidateMeta(c: Pick<MoveCandidate, 'launcher' | 'loader' | 'version'>): string {
  const loader = LOADER_NAME({ name: '', version: c.version, fabric: c.loader === 'fabric', loader: c.loader })
  return c.launcher + ' · ' + loader + ' ' + c.version
}

/** «Prism Launcher» / «Prism Launcher и Modrinth App» / «Prism Launcher, MultiMC и Modrinth App». */
export function launchersText(list: Pick<MoveCandidate, 'launcher'>[]): string {
  const names = [...new Set(list.map((x) => x.launcher))]
  if (names.length <= 1) return names[0] || ''
  return names.slice(0, -1).join(', ') + ' и ' + names[names.length - 1]
}

export function totalBytes(list: Pick<MoveCandidate, 'bytes'>[]): number {
  return list.reduce((s, x) => s + (x.bytes || 0), 0)
}

/** Вопрос перед переносом: что уедет и что станет с исходником. */
export function confirmText(list: MoveCandidate[], removeSource: boolean): string {
  const n = list.length + ' ' + plural(list.length, 'сборку', 'сборки', 'сборок')
  const where = launchersText(list)
  const head = 'Перенесём ' + n + ' (' + sizeText(totalBytes(list)) + ') из ' + where + ' в Millida: миры, моды, настройки, скриншоты и серверы.'
  if (!removeSource) return head + ' В ' + where + ' всё останется как есть.'
  return (
    head +
    ' Сначала сделаем копию и сверим её с оригиналом, и только потом уберём ' +
    plural(list.length, 'сборку', 'сборки', 'сборки') +
    ' из ' +
    where +
    '. Сам ' +
    where +
    ' не удаляется. Закрой ' +
    where +
    ' перед переносом.'
  )
}

export type RowResult = { kind: 'ok'; outcome: MoveOutcome } | { kind: 'error'; text: string }

/** Короткая отметка строки после переноса. */
export function rowVerdict(r: RowResult): string {
  if (r.kind === 'error') return 'Не перенесли'
  if (r.outcome.note) return 'В Millida, старая папка осталась'
  if (r.outcome.source_removed) return 'Перенесли'
  return 'Скопировали'
}

/** Итог пачки: сколько перенесли и что делать с остальными. */
export function batchSummary(results: RowResult[]): { text: string; kind: 'ok' | 'error' } {
  const ok = results.filter((r) => r.kind === 'ok').length
  const failed = results.length - ok
  if (!ok) return { text: 'Не получилось перенести — причина под каждой сборкой', kind: 'error' }
  const head = 'Перенесли ' + ok + ' ' + plural(ok, 'сборку', 'сборки', 'сборок') + ' — играй в «Моих сборках»'
  if (!failed) return { text: head, kind: 'ok' }
  return { text: head + '. Не вышло: ' + failed + ' — причина под сборкой', kind: 'error' }
}

/** Ядро отвечает строкой ошибки; из Error берём сообщение, остальное — как есть. */
export function errorText(err: unknown): string {
  const text = err instanceof Error ? err.message : String(err ?? '')
  return text.trim() || 'Перенос прервался. Сборка не тронута — повтори'
}
