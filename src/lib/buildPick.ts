import type { LobbyMode } from '../state/lobbyMode'

/**
 * Имя сборки под версию — копия versionBuildName из lib/versionBuild.ts: импорт оттуда
 * выносил бы этот модуль отдельным стартовым чанком (бюджет стартового JS).
 */
export const versionBuildName = (version: string) => 'Minecraft ' + version

/**
 * Указывает ли выбор главной на удалённую сборку. Выбор версии ведёт в
 * «Minecraft X» или её копию «Minecraft X (2)»: удалил её — «Играть» не должна
 * молча заводить сборку заново (обращение 14.11.2026: удалил 1.21.11, а кнопка
 * запустила её вместо сыгранной 26.2).
 */
export function pickGoneWith(picked: LobbyMode | null, name: string): boolean {
  if (!picked) return false
  if (picked.kind === 'build') return picked.name === name
  if (picked.kind === 'version') {
    const base = versionBuildName(picked.version)
    return name === base || name.startsWith(base + ' (')
  }
  return false
}
