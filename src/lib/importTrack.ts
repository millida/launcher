import { trackFailure } from './telemetry'

/// Провал импорта сборки (файл, папка чужого лаунчера, перетаскивание): имя,
/// версия и путь выбирал человек — в текст ошибки они не попадают.
export function trackImportFailure(source: string, err: unknown, it?: { name?: string; version?: string; path?: string }) {
  let text = String(err && (err as Error).message ? (err as Error).message : err)
  if (/Отменено/.test(text)) return
  for (const [v, ph] of [
    [it?.path, '<path>'],
    [it?.name, '<name>'],
    [it?.version, '<version>'],
  ] as const)
    if (v && v.length >= 3) text = text.split(v).join(ph)
  trackFailure('import', text, { source: String(source || 'other').slice(0, 24) })
}
