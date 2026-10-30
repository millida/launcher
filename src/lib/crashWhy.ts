/*
 * Чья это поломка — одной строкой для ребёнка под причиной вылета. Люди
 * винят лаунчер в любом вылете; если сломался мод или драйвер, так и
 * говорим. Остальные причины ядро уже объясняет само — их не повторяем.
 */
import type { CrashInfo } from '../ipc/events'
import { t } from '../i18n'

const MOD_KINDS = ['conflict', 'mixin', 'missing_deps', 'wrong_mc', 'wrong_loader', 'api_mismatch', 'old_loader', 'missing_renderer']

/** «sodium-fabric-0.5.13+mc1.20.1.jar» → «sodium-fabric». */
export function modTitle(file: string): string {
  const base = file.replace(/\.(jar|zip)(\.disabled)?$/i, '')
  const cut = base.search(/[-_+ ](v?\d|mc\d)/i)
  return (cut > 0 ? base.slice(0, cut) : base) || base
}

export function isModCrash(kind: string | null | undefined): boolean {
  return MOD_KINDS.includes(kind ?? '')
}

export function crashWhy(info: Pick<CrashInfo, 'kind' | 'culprits'>): string | null {
  const kind = info.kind ?? ''
  const mod = info.culprits?.[0]
  if (isModCrash(kind))
    return mod
      ? t('Мод «{mod}» не работает с этой сборкой. Это проблема мода, а не лаунчера.', { mod: modTitle(mod) })
      : t('Один из модов не работает с этой сборкой. Это проблема модов, а не лаунчера.')
  if (kind === 'gpu' || kind === 'gpu_driver' || kind === 'amd_driver') return t('Сломался драйвер видеокарты, а не лаунчер. Обычно помогает обновить драйвер.')
  return null
}
