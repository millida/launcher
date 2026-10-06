/*
 * Окно материала (мод, ресурспак, шейдер, сборка) — чистая логика без React и
 * сети: подпись лицензии человеческими словами, совместимость версии файла со
 * сборкой игрока, подписи вида материала. Под тесты (projectView.test.ts).
 */

/** Лицензия из Modrinth: SPDX-id, своё имя и ссылка на текст. */
export interface LicenseInfo {
  id: string
  name?: string
  url?: string | null
}

const SPDX: Record<string, string> = {
  MIT: 'MIT',
  'Apache-2.0': 'Apache 2.0',
  'MPL-2.0': 'MPL 2.0',
  'BSD-2-Clause': 'BSD 2',
  'BSD-3-Clause': 'BSD 3',
  ISC: 'ISC',
  Zlib: 'zlib',
  'CC0-1.0': 'CC0 — общественное достояние',
  Unlicense: 'Общественное достояние',
  'CC-BY-4.0': 'CC BY 4.0',
  'CC-BY-SA-4.0': 'CC BY-SA 4.0',
  'CC-BY-NC-4.0': 'CC BY-NC 4.0',
  'CC-BY-NC-SA-4.0': 'CC BY-NC-SA 4.0',
  'CC-BY-NC-ND-4.0': 'CC BY-NC-ND 4.0',
  'CC-BY-ND-4.0': 'CC BY-ND 4.0',
}

/// Открытые лицензии: код можно смотреть и переиспользовать.
const OPEN = /^(MIT|Apache|MPL|BSD|ISC|Zlib|CC0|Unlicense|L?GPL|AGPL|EPL|EUPL|OSL|WTFPL|0BSD|BlueOak)/i

export interface LicenseLabel {
  /** «Все права защищены», «MIT», «GPL 3.0 и новее» */
  text: string
  /** Код открыт: так и пишем рядом, это важно авторам сборок. */
  open: boolean
}

/** Лицензия словами, а не «LicenseRef-All-Rights-Reserved». Пусто — лицензии нет. */
export function licenseLabel(lic: LicenseInfo | string | null | undefined): LicenseLabel | null {
  if (!lic) return null
  const id = (typeof lic === 'string' ? lic : lic.id || '').trim()
  const name = typeof lic === 'string' ? '' : (lic.name || '').trim()
  if (!id && !name) return null
  if (/^LicenseRef-All-Rights-Reserved$/i.test(id) || /^(ARR|All Rights Reserved)$/i.test(id || name)) {
    return { text: 'Все права защищены', open: false }
  }
  if (SPDX[id]) return { text: SPDX[id], open: OPEN.test(id) }
  const gpl = id.match(/^(A|L)?GPL-(\d(?:\.\d)?)(?:-(only|or-later))?$/i)
  if (gpl) {
    const base = (gpl[1] ? gpl[1].toUpperCase() : '') + 'GPL ' + gpl[2]
    return { text: gpl[3] && gpl[3].toLowerCase() === 'or-later' ? base + ' и новее' : base, open: true }
  }
  if (/^LicenseRef-/i.test(id)) {
    if (name && !/^custom$/i.test(name)) return { text: name, open: false }
    const tail = id.replace(/^LicenseRef-/i, '').replace(/[-_]+/g, ' ').trim()
    if (!tail || /^(custom|unknown|other)$/i.test(tail)) return { text: 'Своя лицензия автора', open: false }
    return { text: tail, open: false }
  }
  // CurseForge и каталог Millida присылают имя строкой: «MIT License», «Custom».
  if (/^custom$/i.test(id)) return { text: 'Своя лицензия автора', open: false }
  return { text: name || id.replace(/-/g, ' '), open: OPEN.test(id) }
}

/** Сборка, в которую ставим: версия игры и загрузчик. */
export interface BuildTarget {
  version: string
  loader: string
}

export type Compat = 'ok' | 'game' | 'loader' | 'both' | 'unknown'

/// Загрузчик-«совместимость»: Quilt запускает моды Fabric.
const ALSO_RUNS: Record<string, string[]> = { quilt: ['fabric'] }

/// Метки файлов, которые загрузчиком не являются: ресурспаки, шейдеры, датапаки.
const NOT_A_LOADER = new Set(['minecraft', 'iris', 'optifine', 'canvas', 'vanilla', 'datapack'])

/**
 * Подходит ли файл сборке. Для модов сверяем и версию игры, и загрузчик; для
 * ресурспаков и шейдеров — только версию игры (загрузчик у них условный).
 */
export function compatOf(
  file: { game_versions?: string[]; loaders?: string[] },
  build: BuildTarget | null,
  kind: string,
): Compat {
  if (!build || !build.version) return 'unknown'
  const games = file.game_versions || []
  const gameOk = !games.length || games.includes(build.version)
  let loaderOk = true
  if (kind === 'mod') {
    const ls = (file.loaders || []).filter((l) => !NOT_A_LOADER.has(l))
    const mine = build.loader || 'vanilla'
    const runs = [mine, ...(ALSO_RUNS[mine] || [])]
    loaderOk = !ls.length || ls.some((l) => runs.includes(l))
  }
  if (gameOk && loaderOk) return 'ok'
  if (!gameOk && !loaderOk) return 'both'
  return gameOk ? 'loader' : 'game'
}

/** Короткая подпись несовпадения для строки версии. */
export function compatText(c: Compat): string {
  switch (c) {
    case 'ok':
      return 'Подходит'
    case 'game':
      return 'Другая версия игры'
    case 'loader':
      return 'Другой загрузчик'
    case 'both':
      return 'Не для этой сборки'
    default:
      return ''
  }
}

const KIND: Record<string, string> = {
  mod: 'Мод',
  modpack: 'Сборка',
  resourcepack: 'Ресурспак',
  shader: 'Шейдер',
  datapack: 'Датапак',
  plugin: 'Плагин',
  world: 'Карта',
  map: 'Карта',
}

export const kindLabel = (kind: string): string => KIND[kind] || 'Материал'

/** «Клиент и сервер», «Только клиент» — где нужен мод (поля client_side/server_side Modrinth). */
export function sideLabel(client?: string | null, server?: string | null): string {
  const c = client === 'required' || client === 'optional'
  const s = server === 'required' || server === 'optional'
  if (client === 'required' && server === 'required') return 'Клиент и сервер'
  if (c && !s) return 'Только клиент'
  if (s && !c) return 'Только сервер'
  if (c && s) return 'Клиент или сервер'
  return ''
}

/** Галерея: сначала главная картинка автора, дальше — в его порядке. */
export function orderGallery<T extends { featured?: boolean; ordering?: number }>(list: T[]): T[] {
  return list
    .map((g, i) => ({ g, i }))
    .sort(
      (a, b) =>
        (b.g.featured ? 1 : 0) - (a.g.featured ? 1 : 0) ||
        (a.g.ordering ?? 0) - (b.g.ordering ?? 0) ||
        a.i - b.i,
    )
    .map((x) => x.g)
}

const RU_MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря']

const plural = (n: number, one: string, few: string, many: string): string => {
  const m10 = n % 10
  const m100 = n % 100
  if (m10 === 1 && m100 !== 11) return one
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few
  return many
}

/**
 * «сегодня», «вчера», «5 дней назад», «3 недели назад», «12 марта», «12 марта 2024» —
 * когда вышел файл или обновился проект. `now` — для тестов.
 */
const RU_MONTHS_SHORT = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек']

export function agoLabel(iso: string | null | undefined, now: number = Date.now(), short = false): string {
  if (!iso) return ''
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return ''
  const days = Math.floor((now - t) / 86400000)
  if (days < 1) return 'сегодня'
  if (days < 2) return 'вчера'
  if (days < 7) return days + ' ' + plural(days, 'день', 'дня', 'дней') + ' назад'
  if (days < 30) {
    const w = Math.floor(days / 7)
    return w + ' ' + plural(w, 'неделю', 'недели', 'недель') + ' назад'
  }
  const d = new Date(t)
  const same = d.getFullYear() === new Date(now).getFullYear()
  return d.getDate() + ' ' + (short ? RU_MONTHS_SHORT : RU_MONTHS)[d.getMonth()] + (same ? '' : ' ' + d.getFullYear())
}

/// Значки README (shields.io и родня): «Mod Loader: Fabric», «Discord», «downloads».
/// В окне они дублируют шапку и ссылки, а рядом с текстом кричат громче него.
const BADGE_HOSTS =
  '(?:img\\.shields\\.io|shields\\.io|badgen\\.net|cf\\.way2muchnoise\\.eu|modrinth\\.com/badge|' +
  'cdn\\.jsdelivr\\.net/npm/@intergrav/devins-badges|raw\\.githubusercontent\\.com/intergrav/devins-badges|' +
  'img\\.buymeacoffee\\.com|ko-fi\\.com/img|storage\\.ko-fi\\.com|github\\.com/[^/]+/[^/]+/(?:actions/)?workflows/[^)"\']*badge|' +
  'discordapp\\.com/api/guilds|discord\\.com/api/guilds|bstats\\.org/signatures|wakatime\\.com/badge|' +
  'cdn\\.modrinth\\.com/[^)"\']*badge|modrinth\\.com/[^)"\']*badge)'
const MD_LINKED_BADGE = new RegExp('\\[\\s*!\\[[^\\]]*\\]\\(\\s*<?https?://' + BADGE_HOSTS + '[^)]*\\)\\s*\\]\\([^)]*\\)', 'gi')
const MD_BADGE = new RegExp('!\\[[^\\]]*\\]\\(\\s*<?https?://' + BADGE_HOSTS + '[^)]*\\)', 'gi')
const HTML_LINKED_BADGE = new RegExp('<a\\b[^>]*>\\s*<img\\b[^>]*src=["\']https?://' + BADGE_HOSTS + '[^>]*>\\s*</a>', 'gi')
const HTML_BADGE = new RegExp('<img\\b[^>]*src=["\']https?://' + BADGE_HOSTS + '[^>]*>', 'gi')

/**
 * Описание автора перед показом: значки README убраны, пустые строки и
 * пустые абзацы схлопнуты (отрисовщик делает из каждой пустой строки перенос,
 * и описания расползались дырами), заголовки #### — в ###.
 */
export function tidyBody(body: string): string {
  let s = body.replace(/\r\n?/g, '\n')
  s = s.replace(MD_LINKED_BADGE, '').replace(MD_BADGE, '')
  s = s.replace(HTML_LINKED_BADGE, '').replace(HTML_BADGE, '')
  // Абзацы и ссылки, от которых после значков ничего не осталось.
  for (let i = 0; i < 3; i++) {
    s = s
      .replace(/<a\b[^>]*>\s*<\/a>/gi, '')
      .replace(/<(p|div|center|span)\b[^>]*>(?:\s|&nbsp;|<br\s*\/?>)*<\/\1>/gi, '')
  }
  s = s.replace(/(?:<br\s*\/?>\s*){2,}/gi, '<br>')
  // «абзац\n\n<br>\n\nабзац» — частый приём в README: строка из одного <br> — та же пустая строка.
  s = s.replace(/^[ \t]*(?:<br\s*\/?>[ \t]*)+$/gim, '')
  s = s.replace(/^[ \t]*(?:&nbsp;|\|)?[ \t]*$/gm, '')
  s = s.replace(/^#{4,6}[ \t]+/gm, '### ')
  // Заголовок — блок: пустая строка после него давала лишний разрыв.
  s = s.replace(/^(#{1,3}[ \t].*)\n(?:[ \t]*\n)+/gm, '$1\n')
  // И перед заголовком: у него свой отступ сверху.
  s = s.replace(/\n(?:[ \t]*\n)+(#{1,3}[ \t])/g, '\n$1')
  s = s.replace(/\n{3,}/g, '\n\n')
  return s.trim()
}

/** Описание написано латиницей — подписываем «англ.», чтобы не казалось недоделкой перевода. */
export function isForeign(text: string): boolean {
  const plain = text.replace(/<[^>]+>|\]\([^)]*\)|https?:\S+/g, ' ')
  const cyr = (plain.match(/[а-яё]/gi) || []).length
  const lat = (plain.match(/[a-z]/gi) || []).length
  return lat > 40 && cyr < lat * 0.15
}
