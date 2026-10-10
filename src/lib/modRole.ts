import type { ModFile } from '../ipc/commands'

/*
 * «Деталь» сборки — библиотека или API, которую ставят ради других модов:
 * игрок её не выбирает и не ищет (Fabric API, Cloth Config, Architectury…).
 * На странице сборки такие уходят в свёрнутую строку «Детали для работы модов».
 * Узнаём по известным slug/названиям и по тому, как автор описывает мод.
 */

const KNOWN = [
  'fabric-api', 'fabric api', 'quilted fabric api', 'qsl', 'cloth config', 'cloth-config', 'architectury', 'geckolib',
  'forge config api', 'kotlin for forge', 'fabric language kotlin', 'balm', 'puzzles lib', 'placebo', 'bookshelf',
  'collective', 'moonlight', 'yacl', 'yet another config lib', 'owo', 'oωo', 'framework', 'resourceful lib',
  'resourceful config', 'curios', 'trinkets', 'creativecore', 'cupboard', 'coroutil', 'supermartijn642',
  'citadel', 'terrablender', 'lithostitched', 'kotlinforforge', 'mixinextras', 'midnightlib', 'iceberg',
  'prism lib', 'konkrete', 'searchables', 'zeta', 'autoreglib', 'blueprint', 'ftb library', 'ftb teams',
  'architectury api', 'forgified fabric api',
  'connector extras', 'fzzy config', 'libipn', 'tcdcommons', 'playeranimator', 'player animator', 'lionfish',
  'glitchcore', 'corgilib', 'jamlib', 'fabric-language-kotlin', 'cristel lib', 'azurelib', 'smartbrainlib',
]

const TITLE_RX = /\b(api|lib|library|libraries)\b|lib$|config(uration)? (api|lib)/i
const DESC_RX =
  /^(a |an |the )?(simple |small |lightweight |common |shared )?(library|api|dependency|core library|configuration library)\b|\blibrary (mod|for)\b|\b(required|needed) by\b|\bshared code\b|\bcommon code\b|\bdependency for\b|\bused by (my|other|several|many) mods\b|^code library/i

export function isLibraryMod(m: Pick<ModFile, 'title' | 'name' | 'description'>): boolean {
  const title = (m.title || m.name.replace(/\.(jar|zip)$/i, '')).toLowerCase().trim()
  if (KNOWN.some((k) => title === k || title.startsWith(k + ' ') || title.startsWith(k + '-') || title.startsWith(k + ' ('))) return true
  if (TITLE_RX.test(title)) return true
  return DESC_RX.test((m.description || '').trim())
}
