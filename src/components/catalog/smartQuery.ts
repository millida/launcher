/*
 * Умный поиск каталога для 12–14 лет (владелец 10.10.2026: «человек по-тупому пишет:
 * хоррор хуйня»). Поиск сайта ищет по словам, поэтому запрос сначала разбираем здесь:
 *
 *  1. чистка: мат, «мод/сборка/скачать/майнкрафт», «хочу/дай/найди», «пж»;
 *  2. раскладка: «ghbdtn» → «привет», если по-русски выходит знакомое слово;
 *  3. раздел из слов: «шейдеры для слабого» → Шейдеры, «карта на паркур» → Карты;
 *  4. версия и ядро: «1.20.1», «фордж», «фабрик» → фильтры;
 *  5. тема → категория или «Для чего» раздела (только те, что реально есть у раздела);
 *  6. русские прочтения названий → латиница: «криэйт» → create, «жеи» → jei.
 *
 * Что осталось после разбора — текстом в поиск. Разбор показываем чипами «Понял так».
 */

export interface SmartFacets {
  categories: string[]
  uses: { value: string; label: string }[]
}

export interface SmartResult {
  q: string
  section: string | null
  category: string | null
  use: string | null
  version: string | null
  loader: string | null
  /** Что поняли — для чипов под полем. */
  chips: string[]
}

const norm = (s: string) => s.toLowerCase().replace(/ё/g, 'е').replace(/[^\p{L}\p{N}.+\s-]/gu, ' ').replace(/\s+/g, ' ').trim()

const EN = 'qwertyuiop[]asdfghjkl;\'zxcvbnm,.`'
const RU = 'йцукенгшщзхъфывапролджэячсмитьбюё'
const fromLayout = (s: string) => s.replace(/[a-z[\];',.`]/g, (c) => RU[EN.indexOf(c)] ?? c)

const JUNK = new Set(
  (
    'хуйня хуйню хуйни херня херню фигня фигню блять бля блин нахуй пиздец пиздатый пиздатая пиздатое ахуенный ахуенная охуенный охуенная заебись ' +
    'мод моды мода модов модик модики сборка сборку сборки сборок модпак модпаки скачать скачай скачивать установить поставить ' +
    'майнкрафт майн майна майнкрафта minecraft mc mod mods modpack хочу дай дайте найди найти покажи нужен нужна нужно нужны ' +
    'пж пожалуйста плиз плз please какой какая какое какие какойнибудь нибудь что то чтото чтонибудь типа короче ну вот самый самая самые ' +
    'крутой крутая крутые нормальный нормальная нормальные лучший лучшая лучшие топ топовый топовая прикольный прикольная прикольные интересный ' +
    'новый новая новые для в на с со и или а по про где мне меня мой моя чтобы чтоб был была было'
  ).split(' '),
)

/** Раздел по словам. Порядок важен: «мини-карта» — мод, а не раздел «Карты». */
const SECTION_WORDS: [RegExp, string, string][] = [
  [/\bшейдер|\bshader|\bграфик[аиу]\b|\bкрасив(ая|ую|ое) графи/, 'shaders', 'Шейдеры'],
  [/\bтекстур|\bресурс ?пак|\bрп\b|\bresource ?pack|\btexture/, 'texture-packs', 'Ресурс-паки'],
  [/\bскин|\bskin/, 'skins', 'Скины'],
  [/\bплащ|\bcape/, 'capes', 'Плащи'],
  [/\bсид\b|\bсиды\b|\bseed/, 'seeds', 'Сиды'],
  [/\bплагин|\bplugin/, 'plugins', 'Плагины'],
  [/\bдата ?пак|\bdata ?pack|\bдатапак/, 'data-packs', 'Дата-паки'],
  [/(^|\s)(карт[ау]|карты|карт)(\s|$)(?!.*мини)|\bmap\b|\bпаркур|\bнайди кнопку|\bприключенческ(ая|ую) карт/, 'maps', 'Карты'],
  [/\bсборк|\bмодпак|\bmodpack/, 'modpacks', 'Сборки'],
]

const LOADERS: [RegExp, string, string][] = [
  [/\bнео ?фордж|\bneo ?forge/, 'neoforge', 'NeoForge'],
  [/\bфордж|\bфорж|\bforge\b/, 'forge', 'Forge'],
  [/\bфабрик|\bfabric\b/, 'fabric', 'Fabric'],
  [/\bквилт|\bquilt\b/, 'quilt', 'Quilt'],
]

/**
 * Темы: корень слова → значения категорий/«Для чего» во всех разделах сайта.
 * Берётся первое, что есть у текущего раздела.
 */
const THEMES: [RegExp, string, string[]][] = [
  [/\bхоррор|\bужас|\bстрашн|\bжутк|\bкрип|\bhorror|\bscary/, 'Хоррор', ['хоррор', 'horror']],
  [/\bзомби|\bзомбак|\bапокалипс|\bzombie/, 'Зомби', ['хоррор', 'выживание', 'horror']],
  [/\bфпс|\bfps|\bлаг|\bтормоз|\bоптимиз|\bслаб(ый|ого|ом|ые|ых) (пк|комп|ноут)|\bбуст|\bпотянет/, 'Для слабого ПК', ['для слабых пк', 'lowpc', 'оптимизация', 'для очень слабых пк']],
  [/\bс друг|\bвдвоем|\bвместе|\bкооп|\bс братом|\bс другом|\bсетев|\bмультиплеер/, 'С другом', ['friends', 'для игры с друзьями', 'вдвоём', 'кооп']],
  [/\bодин\b|\bодному|\bсоло\b|\bодиночн/, 'Одному', ['solo', 'одиночная']],
  [/\bмаги|\bволшеб|\bзаклин|\bmagic/, 'Магия', ['магия']],
  [/\bтехник|\bмеханизм|\bзавод|\bавтомати|\bindustr|\btech/, 'Техника', ['техника', 'механика', 'create']],
  [/\bприключ|\bквест|\bсюжет|\brpg\b|\bрпг|\badventure/, 'Приключения', ['приключения', 'с квестами', 'прохождение']],
  [/\bоруж|\bмеч|\bпушк|\bган\b|\bguns?\b|\bweapon/, 'Оружие', ['оружие']],
  [/\bмоб|\bмонстр|\bживотн|\bсущест|\bmobs?\b/, 'Мобы', ['мобы', 'существа']],
  [/\bдекор|\bмебел|\bстроит|\bдом[аы]?\b|\bdecor/, 'Декор', ['декор', 'творчество']],
  [/\bеда|\bеду\b|\bферм|\bготов|\bкухн|\bfood/, 'Еда', ['еда']],
  [/\bрюкзак|\bсундук|\bхранил|\bинвентар|\bstorage/, 'Хранилище', ['хранилища']],
  [/\bбиом|\bмир[аы]?\b|\bгенерац|\bпещер|\bworldgen/, 'Новые миры', ['генерация мира']],
  [/\bтранспорт|\bмашин|\bсамолет|\bкорабл|\bпоезд/, 'Транспорт', ['транспорт']],
  [/\bхардкор|\bсложн|\bhardcore/, 'Хардкор', ['хардкор']],
  [/\bвыжив|\bsurvival/, 'Выживание', ['выживание']],
  [/\bпокемон|\bpokemon|\bпиксельмон|\bкоблемон/, 'Покемоны', ['pokemon']],
  [/\bскайблок|\bskyblock|\bодин блок|\boneblock/, 'Скайблок', ['skyblock']],
  [/\b100 дней|\bсто дней|\b100 days/, '100 дней', ['100-days']],
  [/\bновичк|\bпервый раз|\bпросто(й|е)\b/, 'Для новичков', ['beginners']],
  [/\bванил|\bкак обычн|\bvanilla/, 'Ваниль+', ['vanilla-plus', 'ванильные']],
  [/\bпвп|\bpvp\b/, 'PvP', ['pvp']],
  [/\bмини ?игр|\bminigame/, 'Мини-игры', ['мини-игры', 'minigames']],
  [/\bреалист|\bреализм|\breal/, 'Реализм', ['реализм', 'полуреализм']],
  [/\bмульт|\bcartoon/, 'Мультяшные', ['мультяшные']],
  [/\bкосмос|\bspace/, 'Космос', ['космос']],
  [/\bпаркур|\bparkour/, 'Паркур', ['паркур']],
  [/\bутилит|\bудобн|\butility/, 'Удобство', ['утилиты']],
  [/\bмини ?карт|\bминикарт|\bminimap/, 'Мини-карта', []],
]

/** Как дети пишут названия по-русски → как их ищет сайт. */
const NAMES: [RegExp, string][] = [
  [/\bкри(э|е)йт|\bкреат|\bкреэйт|\bкриейт/, 'create'],
  [/\bж(е|э)и\b|\bджеи\b|\bджей\b|\bнеи\b|\bjei\b/, 'jei'],
  [/\bоптифа(й|и)н/, 'optifine'],
  [/\bсоди(у|ю)м/, 'sodium'],
  [/\bирис\b|\bайрис\b/, 'iris'],
  [/\bпиксельмон/, 'pixelmon'],
  [/\bкоблемон|\bкобблемон/, 'cobblemon'],
  [/\bтвайлайт|\bсумеречн(ый|ого) лес/, 'twilight forest'],
  [/\bтинкерс|\bтинкер/, "tinkers' construct"],
  [/\bаппл ?скин|\bэппл ?скин/, 'appleskin'],
  [/\bксаеро|\bзаеро|\bксеро/, "xaero's minimap"],
  [/\bджорни ?мап|\bжурни ?мап/, 'journeymap'],
  [/\bботани/, 'botania'],
  [/\bмайн ?колони/, 'minecolonies'],
  [/\bмекан(изм|измы)/, 'mekanism'],
  [/\bэпик ?файт|\bепик ?файт/, 'epic fight'],
  [/\bвейстоун|\bвэйстоун/, 'waystones'],
  [/\bрл ?крафт|\bрлкрафт/, 'rlcraft'],
  [/\bатм\b|\bол зе модс|\ball the mods/, 'all the mods'],
  [/\bбеттер ?майн|\bбетер ?майн/, 'better mc'],
  [/\bвоксел ?мап/, 'voxelmap'],
  [/\bдистант ?хоризонс|\bдистант ?хорайзонс/, 'distant horizons'],
  [/\bкомплементари|\bкомплиментари/, 'complementary'],
  [/\bбсл\b/, 'bsl'],
  [/\bфреш ?анимейшн|\bфреш ?анимац/, 'fresh animations'],
  [/\bгеко ?либ/, 'geckolib'],
  [/\bальекс|\bалекс ?мобс/, "alex's mobs"],
  [/\bлаки ?блок/, 'lucky block'],
  [/\bвампир/, 'vampirism'],
  [/\bдраконы|\bдракон/, 'dragon'],
]

const VERSION = /(?<![\p{L}\p{N}.])(1\.\d{1,2}(?:\.\d{1,2})?|2\d\.\d(?:\.\d)?)(?![\p{N}.])/u

/**
 * `\b` в JS понимает только латиницу — для «хоррор» границы слова нет. Переписываем
 * границы на юникодные: перед буквой — «слева не буква», в конце — «справа не буква».
 */
function uni(rx: RegExp): RegExp {
  const src = rx.source.replace(/\\b/g, (_m, i: number, all: string) => {
    const next = all[i + 2]
    return next === undefined || next === ')' || next === '|' ? '(?![\\p{L}\\p{N}])' : '(?<![\\p{L}\\p{N}])'
  })
  return new RegExp(src, 'u')
}

/** Убрать из текста совпадение вместе с окончанием слова («страшн» → «страшную»). */
function cut(text: string, rx: RegExp): string {
  return text.replace(new RegExp('(?:' + rx.source + ')[\\p{L}\\p{N}]*', 'gu'), ' ')
}

const SECTION_RX = SECTION_WORDS.map(([rx, id, label]) => [uni(rx), id, label] as const)
const LOADER_RX = LOADERS.map(([rx, id, label]) => [uni(rx), id, label] as const)
const THEME_RX = THEMES.map(([rx, label, values]) => [uni(rx), label, values] as const)
const NAME_RX = NAMES.map(([rx, name]) => [uni(rx), name] as const)

export function smartQuery(raw: string, section: string, facets: SmartFacets | null): SmartResult {
  const out: SmartResult = { q: '', section: null, category: null, use: null, version: null, loader: null, chips: [] }
  let text = norm(raw)
  if (!text) return out
  if (!/[а-я]/.test(text) && /[a-z]/.test(text)) {
    const ru = norm(fromLayout(raw.toLowerCase()))
    if (THEME_RX.some(([rx]) => rx.test(ru)) || SECTION_RX.some(([rx]) => rx.test(ru)) || NAME_RX.some(([rx]) => rx.test(ru))) text = ru
  }

  const v = VERSION.exec(text)
  if (v) {
    out.version = v[1]!
    out.chips.push(v[1]!)
    text = text.replace(v[0], ' ')
  }
  for (const [rx, id, label] of LOADER_RX)
    if (rx.test(text)) {
      out.loader = id
      out.chips.push(label)
      text = cut(text, rx)
      break
    }

  let sec = section
  for (const [rx, id, label] of SECTION_RX)
    if (rx.test(text) && !(id === 'maps' && /мини ?карт|миникарт/.test(text))) {
      if (id !== section) {
        out.section = id
        out.chips.push(label)
      }
      sec = id
      text = cut(text, rx)
      break
    }

  const cats = new Set((facets?.categories || []).map(norm))
  const uses = facets?.uses || []
  for (const [rx, label, values] of THEME_RX) {
    if (!rx.test(text)) continue
    let hit = false
    // «Для чего» (подборки сайта) точнее категории — сначала она.
    const u = out.use ? null : uses.find((x) => values.includes(x.value))
    if (u) {
      out.use = u.value
      hit = true
    } else if (!out.category) {
      const c = values.find((val) => cats.has(norm(val)))
      if (c) {
        out.category = c
        hit = true
      }
    }
    if (hit) {
      out.chips.push(label)
      text = cut(text, rx)
    }
    if (out.category && out.use) break
  }
  void sec

  for (const [rx, name] of NAME_RX)
    if (rx.test(text)) {
      text = text.replace(new RegExp('(?:' + rx.source + ')[\\p{L}]*', 'gu'), ' ' + name + ' ')
    }

  const words = text.split(' ').filter((w) => w && !JUNK.has(w) && !/^\d$/.test(w) && w.length > 1)
  out.q = words.join(' ').trim()
  return out
}
