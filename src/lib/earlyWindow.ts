// The window for a build with several loading-screen mods. Forge/NeoForge open only the one named in
// config/fml.toml; a single such mod is named by the core before the start, several are the
// player's choice. Loaded with import() on the core's event, never at startup.
import { t } from '../i18n'
import { hasTauri } from '../ipc/tauri'
import { openProfileFolder } from '../ipc/commands'
import type { EarlyWindowNotice } from '../ipc/events'
import { uiChoice } from '../state/confirm'

/// One answer per build and set of mods: a new loading-screen mod in the build asks again.
export const earlyWindowKey = (n: EarlyWindowNotice) => `early-window:${n.profile}:${[...n.mods].sort().join('|')}`

export async function explainEarlyWindow(n: EarlyWindowNotice): Promise<void> {
  if (!n.mods.length) return
  const choice = await uiChoice(
    t(
      'В сборке «{build}» есть моды со своим экраном загрузки игры: {mods}. Игра открывает только один такой экран, а какой — лаунчер за тебя не выбирает. Если игра зависнет на старте и окно так и не появится, оставь в сборке один из этих модов или впиши имя нужного экрана в строку earlyWindowProvider файла config/fml.toml в папке сборки.',
      { build: n.profile, mods: n.mods.join(', ') },
    ),
    {
      title: t('Несколько экранов загрузки'),
      // «Больше не спрашивать» sticks only with the confirm, so the confirm is the plain «got it».
      confirmLabel: t('Хорошо'),
      cancelLabel: t('Открыть папку сборки'),
      danger: false,
      rememberKey: earlyWindowKey(n),
    },
  )
  if (choice === 'no' && hasTauri()) await openProfileFolder(n.profile).catch(() => {})
}
