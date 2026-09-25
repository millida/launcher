import { classifyError, earlyExitSummary } from './errorKind'
import { maskValues } from './errorReport'
import { errorCode, scrubText } from './telemetryPrivacy'

/// Поля провала запуска: code — как раньше (дашборды), kind — класс, stage —
/// последний этап прогресса, detail — выжимка раннего выхода JVM без шума
/// authlib-injector. Имя сборки и ник вырезаны.
export function launchFailure(
  err: unknown,
  stage: string,
  masks: Array<[string | null | undefined, string]>,
): { code: string; kind: string; stage: string; detail?: string; text: string } {
  const raw = String(err && (err as Error).message ? (err as Error).message : err).replace(/^Error:\s*/, '')
  let text = maskValues(raw, masks)
  // maskValues не трогает имена короче 4 символов, а «Версия про не найдена»
  // выдаёт сборку игрока и так: короткие имена меняем целым словом.
  for (const [v, ph] of masks) {
    const t = (v || '').trim()
    if (!t || t.length >= 4) continue
    const esc = t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    text = text.replace(new RegExp('(^|[\\s«"\'(])' + esc + '(?=$|[\\s»"\'),.:])', 'g'), '$1' + ph)
  }
  const kind = classifyError(text)
  const out: { code: string; kind: string; stage: string; detail?: string; text: string } = {
    code: errorCode(text),
    kind,
    stage: stage || 'prepare',
    text,
  }
  if (kind === 'jvm_early_exit') out.detail = earlyExitSummary(scrubText(text))
  return out
}
