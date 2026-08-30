import { pickBuildForServer, versionFits } from './mcVersion'

/**
 * Решение «какой сборкой заходить» отделено от диалогов: раньше неизвестная
 * версия сервера молча означала «запускай что выбрано», и вход к другу, по
 * ссылке с сайта и из чата стартовал любую сборку без единого вопроса.
 */
export type JoinPlan =
  | { kind: 'create'; version: string }
  | { kind: 'unknown'; build: string; version: string }
  | { kind: 'launch'; build: string }
  | { kind: 'switch'; build: string; version: string }
  | { kind: 'mismatch'; build: string; version: string }

export function joinPlan<T extends { name: string; version: string }>(
  builds: T[],
  selected: string,
  wanted: string[],
): JoinPlan {
  if (!builds.length) return { kind: 'create', version: wanted[0] || '' }
  const current = builds.find((b) => b.name === selected) || builds[0]
  if (!wanted.length) return { kind: 'unknown', build: current.name, version: current.version }
  if (versionFits(current.version, wanted)) return { kind: 'launch', build: current.name }
  const fit = pickBuildForServer(builds, wanted)
  if (fit) return { kind: 'switch', build: fit.name, version: fit.version }
  return { kind: 'mismatch', build: current.name, version: current.version }
}
