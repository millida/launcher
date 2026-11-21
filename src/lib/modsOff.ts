import { toggleContent, type ModDependents } from '../ipc/commands'
import { keepModsOff, modDependents } from '../ipc/modTools'
import { hasTauri } from '../ipc/tauri'
import { t } from '../i18n'
import { uiChoice } from '../state/confirm'

/** Сколько названий показать в вопросе: дальше «и ещё N». */
const NAMES_SHOWN = 6
/** Цепочка «A нужен B, B нужен C» глубже не бывает в живых сборках; предел — от зацикливания. */
const CHAIN_MAX = 6

export function namesText(titles: string[]): string {
  const uniq = [...new Set(titles)]
  const shown = uniq
    .slice(0, NAMES_SHOWN)
    .map((x) => '«' + x + '»')
    .join(', ')
  return uniq.length > NAMES_SHOWN ? t('{list} и ещё {n}', { list: shown, n: uniq.length - NAMES_SHOWN }) : shown
}

/** Текст вопроса: кого выключают и кому они нужны. */
export function dependentsQuestion(deps: ModDependents[]): string {
  const users = namesText(deps.flatMap((d) => d.by.map((b) => b.title)))
  return deps.length === 1
    ? t('От «{mod}» зависят: {list}. Без него они не запустятся.', {
        mod: deps[0].title,
        list: users,
      })
    : t('Выключаемые моды нужны другим: {list}. Без них они не запустятся.', {
        list: users,
      })
}

/** Всё, что придётся выключить вместе с `names`, чтобы ничего включённое не осталось без зависимости. */
async function withDependents(profile: string, names: string[], first: ModDependents[]): Promise<string[]> {
  const all = new Set(names)
  let deps = first
  for (let i = 0; i < CHAIN_MAX && deps.length; i++) {
    const before = all.size
    for (const d of deps) for (const b of d.by) all.add(b.name)
    if (all.size === before) break
    deps = await modDependents(profile, [...all]).catch(() => [])
  }
  return [...all]
}

/**
 * Выключение модов с проверкой: если включённым модам нужен выключаемый, игрок решает —
 * выключить вместе с ними, только этот (авто-починка при запуске его не вернёт) или ничего.
 * `false` — игрок передумал, ничего не изменилось.
 */
export async function disableMods(profile: string, names: string[]): Promise<boolean> {
  if (!names.length) return false
  const deps = hasTauri() ? await modDependents(profile, names).catch(() => [] as ModDependents[]) : []
  let off = names
  let keep: string[] = []
  if (deps.length) {
    const answer = await uiChoice(dependentsQuestion(deps), {
      title: t('Этот мод нужен другим'),
      confirmLabel: t('Выключить вместе с ними'),
      altLabel: names.length === 1 ? t('Выключить только этот') : t('Только выбранные'),
      cancelLabel: t('Отмена'),
      danger: false,
    })
    if (answer === 'no' || answer === 'dismiss') return false
    if (answer === 'yes') off = await withDependents(profile, names, deps)
    else keep = deps.map((d) => d.name)
  }
  await Promise.all(off.map((n) => toggleContent(profile, 'mod', n, false)))
  if (keep.length) await keepModsOff(profile, keep).catch((e) => console.warn('[mods] keep off', e))
  return true
}
