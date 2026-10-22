import { hasTauri } from '../ipc/tauri'
import { setUiTexts, uiTextKeys } from '../ipc/commands'
import { t, useI18n } from '../i18n'

let keys: Promise<string[]> | null = null
let sent = ''

async function push(): Promise<void> {
  const { locale, revision } = useI18n.getState()
  const stamp = locale + ':' + revision
  if (stamp === sent) return
  keys ??= uiTextKeys().catch((e: unknown) => {
    keys = null
    throw e
  })
  const list = await keys
  const texts: Record<string, string> = {}
  for (const key of list) texts[key] = t(key)
  await setUiTexts(texts)
  sent = stamp
}

export function syncNativeTexts(): void {
  if (!hasTauri()) return
  const run = () =>
    void push().catch((e: unknown) => {
      console.warn('[i18n] native texts were not updated', e)
    })
  run()
  useI18n.subscribe(run)
}
