import type { MilliCat, MilliChangeRef, MilliItem, MilliPack } from '../../../lib/milli'

/*
 * Синтетическая сборка для `?preview` и замеров (SPEC §4 «Фронт»): 300 предметов
 * (270 модов + 30 библиотек), 3 ресурс-пака, 1 шейдер + лестница шейдеров,
 * настройки и пример диффа. Детерминирована (свой ГПСЧ с фиксированным зерном),
 * без сетевых иконок (data-URI SVG или null).
 */

export type DemoCat = MilliCat
export type DemoItem = MilliItem
export type DemoPack = MilliPack
type ChangeRef = MilliChangeRef

/** mulberry32: одинаковое зерно — одинаковая сборка на любой машине. */
function rng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** [название EN, описание RU, описание EN] по категориям. */
const POOL: Record<DemoCat, [string, string, string][]> = {
  perf: [
    ['Embeddium', 'Быстрый рендер чанков, больше кадров', 'Rendering engine fork for Forge'],
    ['FerriteCore', 'Меньше памяти на те же блоки', 'Memory usage optimizations'],
    ['ModernFix', 'Быстрый запуск и меньше ОЗУ', 'All-in-one mod that improves performance'],
    ['Entity Culling', 'Не рисует невидимых существ', 'Skip rendering hidden entities'],
    ['ImmediatelyFast', 'Быстрее рисует интерфейс и текст', 'Speed up immediate mode rendering'],
    ['Canary', 'Ускоряет тики сервера и мира', 'Server tick optimizations'],
    ['Saturn', 'Чистит лишние объекты в памяти', 'Memory optimizations'],
    ['Radium Reforged', 'Быстрее физика и поиск пути', 'General-purpose optimization'],
    ['Smooth Boot', 'Плавная загрузка без зависаний', 'Optimizes thread usage on boot'],
    ['Clumps', 'Сливает шарики опыта в один', 'Groups XP orbs together'],
    ['Starlight', 'Новый движок света, без лагов', 'Rewrites the light engine'],
    ['Krypton', 'Быстрее сетевой код', 'Optimizes the networking stack'],
  ],
  ui: [
    ['JEI', 'Рецепты всех предметов в одном окне', 'Item and recipe viewing mod'],
    ['Jade', 'Подсказка, на что ты смотришь', 'Shows information about what you are looking at'],
    ['Mouse Tweaks', 'Удобное перекладывание мышью', 'Enhances inventory management'],
    ['Inventory HUD+', 'Броня и инвентарь на экране', 'Inventory display on the HUD'],
    ['AppleSkin', 'Сытость еды видна заранее', 'Food and hunger tooltips'],
    ['Xaero\'s Minimap', 'Мини-карта в углу экрана', 'Minimap with waypoints'],
    ['Xaero\'s World Map', 'Большая карта мира по кнопке M', 'Full-screen world map'],
    ['Controlling', 'Поиск по клавишам управления', 'Search keybindings'],
    ['Catalogue', 'Красивый список модов', 'Better mod list screen'],
    ['Toast Control', 'Меньше всплывашек в углу', 'Control the toast popups'],
    ['Inventory Sorter', 'Сортировка сундука одной кнопкой', 'Sort inventories with a click'],
    ['Durability Tooltip', 'Прочность предмета в подсказке', 'Shows durability in tooltips'],
  ],
  world: [
    ['Terralith', 'Сотня новых красивых биомов', 'Overworld biome overhaul'],
    ['Tectonic', 'Высокие горы и глубокие долины', 'Terrain generation overhaul'],
    ['YUNG\'s Better Caves', 'Пещеры глубже и разнообразнее', 'Cave generation overhaul'],
    ['YUNG\'s Better Mineshafts', 'Шахты с вагонетками и лестницами', 'Mineshaft overhaul'],
    ['Biomes O\' Plenty', 'Новые биомы, деревья и цветы', 'Adds new biomes'],
    ['Oh The Biomes You\'ll Go', 'Яркие биомы во всех измерениях', 'Biome expansion'],
    ['Towns and Towers', 'Деревни и башни по всему миру', 'Structure expansion'],
    ['Repurposed Structures', 'Варианты храмов и данжей', 'Structure variants'],
    ['Nature\'s Compass', 'Компас ищет нужный биом', 'Locate biomes'],
    ['Serene Seasons', 'Смена времён года', 'Adds seasons'],
    ['Geophilic', 'Ванильные биомы стали живее', 'Vanilla biome tweaks'],
    ['Incendium', 'Новый Незер с крепостями', 'Nether overhaul'],
  ],
  mobs: [
    ['Alex\'s Mobs', 'Сотня новых животных', 'Adds many new animals'],
    ['Mowzie\'s Mobs', 'Боссы с красивой анимацией', 'Animated boss mobs'],
    ['Naturalist', 'Живые звери из реального мира', 'Real-life animals'],
    ['Friends and Foes', 'Мобы из голосований Mojang', 'Mob vote mobs'],
    ['Better Animals Plus', 'Олени, медведи и киты', 'Adds animals'],
    ['Creatures and Beasts', 'Странные существа для пещер', 'Fantasy creatures'],
    ['Guard Villagers', 'Стражи охраняют деревни', 'Village guards'],
    ['Exotic Birds', 'Птицы и гнёзда', 'Adds birds'],
    ['Untamed Wilds', 'Хищники и редкие виды', 'Wild animals'],
    ['Enderman Overhaul', 'Эндермены под каждый биом', 'Biome variants of endermen'],
  ],
  tech: [
    ['Create', 'Механизмы, шестерни и конвейеры', 'Aesthetic technology mod'],
    ['Mekanism', 'Заводы, руда ×5 и энергия', 'High-tech machinery'],
    ['Applied Energistics 2', 'Цифровое хранилище предметов', 'Digital storage'],
    ['Immersive Engineering', 'Промышленность в стиле ретро', 'Retro industry'],
    ['Thermal Expansion', 'Машины и динамо', 'Machines and dynamos'],
    ['Refined Storage', 'Склад в одной сети', 'Storage network'],
    ['Industrial Foregoing', 'Автоматические фермы', 'Automation machines'],
    ['Powah', 'Простая и мощная энергия', 'Power generation'],
    ['Pipez', 'Трубы для всего', 'Item, fluid, energy pipes'],
    ['Create: Steam \'n\' Rails', 'Поезда и паровозы для Create', 'Create train addon'],
    ['Create Crafts & Additions', 'Электричество для Create', 'Create electricity addon'],
    ['Mekanism Generators', 'Солнце, ветер и реактор', 'Mekanism power generators'],
  ],
  magic: [
    ['Ars Nouveau', 'Сам собираешь заклинания', 'Spell crafting'],
    ['Botania', 'Магия цветов и маны', 'Flower magic'],
    ['Iron\'s Spells', 'Школы магии и свитки', 'Spellbooks and schools'],
    ['Occultism', 'Духи и ритуалы', 'Spirits and rituals'],
    ['Blood Magic', 'Сила из жертвы', 'Sacrifice magic'],
    ['Hexerei', 'Ведьмины котлы и зелья', 'Witchcraft'],
    ['Enchantment Descriptions', 'Понятные описания чар', 'Enchantment info'],
    ['Apotheosis', 'Новые чары и редкие вещи', 'Enchanting overhaul'],
    ['Forbidden Arcanus', 'Тёмная магия и артефакты', 'Dark magic'],
    ['Mana and Artifice', 'Ритуалы и руны', 'Mana magic'],
  ],
  adventure: [
    ['Better Combat', 'Бой как в Souls-играх', 'Combat overhaul'],
    ['When Dungeons Arise', 'Огромные данжи и замки', 'Massive dungeons'],
    ['Epic Fight', 'Анимации ударов и комбо', 'Animated combat'],
    ['Simply Swords', 'Сотня новых мечей', 'New weapons'],
    ['Artifacts', 'Редкие артефакты в сундуках', 'Adds artifacts'],
    ['Waystones', 'Камни телепорта по миру', 'Teleport waystones'],
    ['Dungeon Crawl', 'Глубокие подземелья', 'Dungeon generation'],
    ['L_Ender\'s Cataclysm', 'Боссы конца игры', 'Endgame bosses'],
    ['Twilight Forest', 'Измерение сумеречного леса', 'Twilight dimension'],
    ['The Aether', 'Небесное измерение', 'Sky dimension'],
    ['Spartan Shields', 'Щиты из любого металла', 'More shields'],
    ['Combat Roll', 'Перекат от ударов', 'Dodge roll'],
  ],
  build: [
    ['Chipped', 'Тысячи вариантов блоков', 'Block variants'],
    ['Macaw\'s Bridges', 'Мосты из любого дерева', 'Bridges'],
    ['Macaw\'s Furniture', 'Мебель для дома', 'Furniture'],
    ['Supplementaries', 'Банки, полки и флюгеры', 'Decoration blocks'],
    ['Handcrafted', 'Уютная мебель', 'Furniture'],
    ['Framed Blocks', 'Блоки с любой текстурой', 'Framed blocks'],
    ['Rechiseled', 'Резные блоки стамеской', 'Chiseled blocks'],
    ['Decorative Blocks', 'Балки, жаровни и цепи', 'Decorative blocks'],
    ['Another Furniture', 'Стулья, столы и шторы', 'Furniture'],
    ['Builders Crafts', 'Лестницы и окна', 'Builder blocks'],
    ['Quark', 'Сотня мелких улучшений', 'Small vanilla tweaks'],
    ['Farmer\'s Delight', 'Готовка и огороды', 'Cooking and farming'],
  ],
  look: [
    ['Oculus', 'Шейдеры на Forge', 'Shader support for Forge'],
    ['Sound Physics Remastered', 'Эхо и глушение звука', 'Realistic sound'],
    ['Ambient Sounds', 'Звуки леса, воды и ветра', 'Ambient sounds'],
    ['Falling Leaves', 'Листья падают с деревьев', 'Falling leaves particles'],
    ['Particular', 'Светлячки и брызги', 'Particle effects'],
    ['Not Enough Animations', 'Анимации от третьего лица', 'Third-person animations'],
    ['Visuality', 'Блики и искры', 'Visual particles'],
    ['Wakes', 'Волны от лодки', 'Boat wakes'],
    ['Distant Horizons', 'Дальность прорисовки до горизонта', 'Level of detail'],
    ['Dynamic Lights', 'Факел светит в руке', 'Dynamic lights'],
    ['Presence Footsteps', 'Звук шагов по поверхности', 'Footstep sounds'],
    ['Drippy Loading Screen', 'Красивый экран загрузки', 'Loading screen'],
  ],
  misc: [
    ['Corpse', 'Вещи остаются в могиле', 'Graves'],
    ['Comforts', 'Спальник и гамак', 'Sleeping bags'],
    ['Easy Villagers', 'Жители в предмете', 'Villager tweaks'],
    ['Carry On', 'Носи сундуки и мобов', 'Carry blocks'],
    ['FTB Chunks', 'Приват чанков и карта', 'Chunk claiming'],
    ['Simple Voice Chat', 'Голосовой чат рядом', 'Proximity voice chat'],
    ['Better Third Person', 'Свободная камера сзади', 'Third person camera'],
    ['Traveler\'s Backpack', 'Рюкзаки с баком', 'Backpacks'],
    ['Sophisticated Backpacks', 'Улучшаемые рюкзаки', 'Upgradable backpacks'],
    ['Polymorph', 'Выбор рецепта при конфликте', 'Recipe conflicts'],
    ['Packet Fixer', 'Без вылетов от больших пакетов', 'Packet fixes'],
    ['Crash Assistant', 'Понятные причины вылета', 'Crash helper'],
  ],
  lib: [
    ['Architectury API', 'Нужна модам на двух загрузчиках', 'Multiplatform API'],
    ['Cloth Config API', 'Экран настроек модов', 'Config screen API'],
    ['GeckoLib', 'Анимации существ', 'Animation library'],
    ['Curios API', 'Слоты для украшений', 'Accessory slots'],
    ['Balm', 'Общая библиотека модов', 'Abstraction layer'],
    ['Kotlin for Forge', 'Язык Kotlin для модов', 'Kotlin language provider'],
    ['Puzzles Lib', 'Общий код модов Fuzs', 'Library'],
    ['Bookshelf', 'Общий код модов Darkhax', 'Library'],
    ['Collective', 'Общий код модов Serilum', 'Library'],
    ['YUNG\'s API', 'Нужна модам YUNG', 'Library'],
    ['Citadel', 'Нужна Alex\'s Mobs', 'Library'],
    ['Patchouli', 'Книги-справочники', 'Guide book library'],
    ['playerAnimator', 'Анимации игрока', 'Player animation library'],
    ['Placebo', 'Нужна Apotheosis', 'Library'],
    ['Flywheel', 'Быстрый рендер Create', 'Rendering library'],
    ['CreativeCore', 'Общий код модов CreativeMD', 'Library'],
    ['Resourceful Lib', 'Нужна Chipped', 'Library'],
    ['AzureLib', 'Анимации моделей', 'Animation library'],
    ['Moonlight Lib', 'Нужна Supplementaries', 'Library'],
    ['Lithostitched', 'Общий код генерации мира', 'Worldgen library'],
    ['FTB Library', 'Общий код FTB', 'Library'],
    ['Caelus API', 'Нужна для элитр', 'Elytra library'],
    ['Searchables', 'Поиск в меню', 'Search library'],
    ['Prism', 'Цвета текста', 'Library'],
    ['Zeta', 'Нужна Quark', 'Library'],
    ['SmartBrainLib', 'Мозги существ', 'AI library'],
    ['Iceberg', 'Подсказки и звуки', 'Library'],
    ['Fzzy Config', 'Настройки модов', 'Config library'],
    ['Cupboard', 'Мелкие исправления', 'Library'],
    ['Ritchie\'s Projectile Library', 'Снаряды и стрелы', 'Projectile library'],
  ],
}

/** Подписи к номерам для добора до 300: «Create: дополнение» и т.п. */
const ADDON_RU: Record<DemoCat, string> = {
  perf: 'ускоряет игру', ui: 'удобнее интерфейс', world: 'новые места в мире', mobs: 'новые существа',
  tech: 'дополнение к технике', magic: 'дополнение к магии', adventure: 'больше приключений',
  build: 'новые блоки для стройки', look: 'красивее картинка и звук', misc: 'мелкие удобства', lib: 'нужна другим модам',
}
const ADDON_EN = ['Expanded', 'Plus', 'Additions', 'Reforged', 'Extra', 'Delight', 'Overhaul', 'Integration', 'Tweaks', 'Core']

const WHY: Record<DemoCat, string> = {
  perf: 'Чтобы большая сборка не тормозила',
  ui: 'Без него в сотне модов не разобраться',
  world: 'Мир интереснее исследовать',
  mobs: 'Больше жизни в лесах и пещерах',
  tech: 'Есть что строить и автоматизировать',
  magic: 'Вторая ветка развития — магия',
  adventure: 'Есть куда идти и с кем драться',
  build: 'Больше блоков для красивых баз',
  look: 'Атмосфера и картинка',
  misc: 'Мелочи, без которых неудобно',
  lib: 'Нужна другим модам этой сборки',
}

const CAT_ORDER: DemoCat[] = ['perf', 'ui', 'world', 'mobs', 'tech', 'magic', 'adventure', 'build', 'look', 'misc']
/** Сколько модов каждой категории в сборке на 300 (без библиотек — их 30). */
const CAT_QUOTA: Record<DemoCat, number> = { perf: 18, ui: 26, world: 30, mobs: 26, tech: 38, magic: 30, adventure: 34, build: 30, look: 18, misc: 20, lib: 30 }

const slugOf = (s: string) => s.toLowerCase().replace(/['’]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
const pid = (i: number) => 'DM' + i.toString(36).toUpperCase().padStart(6, '0')

/** Пиксельная иконка-заглушка: 2×2 клетки цвета категории, data-URI SVG, без сети. */
const CAT_COLOR: Record<DemoCat, string> = {
  perf: '#5bd06a', ui: '#6aa8ff', world: '#3e9b4f', mobs: '#c98a4b', tech: '#c2a23a', magic: '#a46bff',
  adventure: '#e0524a', build: '#b08a5a', look: '#4fd3d3', misc: '#9a9a9a', lib: '#6c6c7a',
}
function icon(cat: DemoCat, n: number): string {
  const c = CAT_COLOR[cat]
  const d = ['#00000033', '#ffffff33', '#00000055', '#ffffff22'][n % 4]
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 4 4" shape-rendering="crispEdges"><rect width="4" height="4" fill="${c}"/><rect x="${n % 3}" y="${(n >> 2) % 3}" width="2" height="2" fill="${d}"/></svg>`
  return 'data:image/svg+xml,' + encodeURIComponent(svg)
}

/**
 * Синтетическая сборка: `n` модов (по умолчанию 300, из них ~10% библиотек),
 * 3 ресурс-пака, 1 активный шейдер. Одинаковые аргументы — одинаковый результат.
 */
export function demoPack(n = 300, seed = 20261004): DemoPack {
  const r = rng(seed)
  const scale = n / 300
  const mods: DemoItem[] = []
  let idx = 0
  const used = new Set<string>()

  // Библиотеки первыми: на них ссылаются requires.
  const libCount = Math.max(1, Math.round(CAT_QUOTA.lib * scale))
  const libs: DemoItem[] = []
  for (let i = 0; i < libCount; i++) libs.push(make('lib', i))

  for (const cat of CAT_ORDER) {
    const q = Math.max(1, Math.round(CAT_QUOTA[cat] * scale))
    for (let i = 0; i < q && mods.length + libs.length < n; i++) mods.push(make(cat, i))
  }
  while (mods.length + libs.length < n) mods.push(make(CAT_ORDER[mods.length % CAT_ORDER.length], 100 + mods.length))

  function make(cat: DemoCat, i: number): DemoItem {
    const pool = POOL[cat]
    const base = pool[i % pool.length]
    const round = Math.floor(i / pool.length)
    let title = round === 0 ? base[0] : `${base[0]} ${ADDON_EN[(round - 1 + i) % ADDON_EN.length]}`
    while (used.has(title)) title += ' II'
    used.add(title)
    const k = idx++
    const ru = round === 0 ? base[1] : `${base[1].split(' ')[0]}: ${ADDON_RU[cat]}`
    const major = 1 + Math.floor(r() * 6)
    const sideRoll = r()
    const side: DemoItem['side'] = cat === 'lib' ? 'both' : cat === 'perf' || cat === 'look' || cat === 'ui' ? (sideRoll < 0.7 ? 'client' : 'both') : sideRoll < 0.08 ? 'server' : 'both'
    const item: DemoItem = {
      projectId: pid(k),
      slug: slugOf(title),
      title,
      icon: r() < 0.15 ? null : icon(cat, k),
      why: WHY[cat],
      base: cat === 'lib',
      source: 'modrinth',
      author: ['Fuzs', 'Darkhax', 'TeamLodestar', 'YUNGNICKYOUNG', 'simibubi', 'jaredlll08', 'Serilum'][k % 7],
      description: `${base[2]}.`.slice(0, 100),
      descriptionRu: ru.slice(0, 90),
      downloads: Math.floor(1000 + r() * 80_000_000),
      version: `${major}.${Math.floor(r() * 20)}.${Math.floor(r() * 10)}+mc1.20.1`,
      versionId: 'v' + pid(k).slice(2) + Math.floor(r() * 1e6).toString(36),
      cat,
      side,
      by: cat === 'lib' ? 'auto' : cat === 'perf' && i < 3 ? 'base' : 'milli',
      ruInGame: r() < 0.3,
      heavy: (cat === 'look' && i === 8) || (cat === 'look' && i === 0) ? true : undefined,
    }
    if (r() < 0.12) item.risk = 'proven'
    return item
  }

  // Зависимости: ~60% модов требуют 1–2 библиотеки; аддоны Create — Create.
  const create = mods.find((m) => m.title === 'Create')
  for (const m of mods) {
    const req = new Set<string>()
    if (r() < 0.6) req.add(libs[Math.floor(r() * libs.length)].projectId)
    if (r() < 0.25) req.add(libs[Math.floor(r() * libs.length)].projectId)
    if (create && m !== create && m.title.startsWith('Create')) req.add(create.projectId)
    if (req.size) m.requires = [...req]
  }
  // Пара библиотек тянет другую (Moonlight → Architectury и т.п.).
  if (libs.length > 3) libs[18 % libs.length].requires = [libs[0].projectId]

  // Особые состояния для фильтра ⚠ и мод-панели.
  const pick = (i: number) => mods[(i * 37) % mods.length]
  pick(3).unchecked = true
  pick(11).unchecked = true
  const risky = pick(7)
  risky.risk = 'risky'
  risky.riskNote = 'Версия 2.1.0 вылетает вместе с Embeddium — взяли 2.0.4'
  pick(13).pinned = true
  pick(17).by = 'user'

  const all = [...mods, ...libs]
  // Сироты-библиотеки: две библиотеки, которые никому не нужны (для «2 библиотеки больше не нужны»).
  const needed = new Set(all.flatMap((m) => m.requires ?? []))
  const orphans = libs.filter((l) => !needed.has(l.projectId)).slice(0, 2)
  if (orphans.length < 2) {
    // Гарантируем двух сирот: снимаем ссылки на две последние библиотеки.
    for (const l of libs.slice(-2)) for (const m of all) if (m.requires) m.requires = m.requires.filter((x) => x !== l.projectId)
  }
  for (const m of all) if (m.requires && !m.requires.length) delete m.requires

  const rp = (i: number, title: string, ru: string, en: string): DemoItem => ({
    projectId: pid(900 + i), slug: slugOf(title), title, icon: icon('look', 900 + i), why: 'Под стиль сборки', base: false,
    source: 'modrinth', descriptionRu: ru, description: en, version: `${1 + i}.0`, versionId: 'rp' + i, cat: 'look', by: 'milli', side: 'client',
  })
  const resourcepacks = [
    rp(0, 'Fresh Animations', 'Живые анимации мобов без модов', 'Animations for vanilla mobs'),
    rp(1, 'Stay True', 'Ванильные текстуры, но разнообразнее', 'Vanilla-style textures'),
    rp(2, 'Better Leaves', 'Пышная листва', 'Bushy leaves'),
  ]
  const shader = (i: number, title: string, ru: string, level: 'light' | 'medium' | 'heavy', dh = false): DemoItem => ({
    projectId: pid(950 + i), slug: slugOf(title), title, icon: icon('look', 950 + i), why: 'Красивый свет и вода', base: false,
    source: 'modrinth', descriptionRu: ru, description: `${title} shader pack.`, version: '1.0', versionId: 'sh' + i, cat: 'look', by: 'milli', side: 'client', level, dh,
  })
  const shaderChoices = [
    shader(0, 'Sildur\'s Vibrant Lite', 'Лёгкие: тени и мягкий свет', 'light'),
    shader(1, 'Complementary Reimagined', 'Средние: красиво и не тяжело', 'medium'),
    shader(2, 'BSL Shaders', 'Средние: яркие закаты', 'medium'),
    shader(3, 'Solas Shader', 'Тяжёлые: объёмный свет', 'heavy'),
    shader(4, 'Bliss', 'Тяжёлые: дальний горизонт', 'heavy', true),
  ]
  const active = shaderChoices[1]

  const ts = (m: DemoItem): ChangeRef => ({ projectId: m.projectId, title: m.title, tab: 'mods', by: m.by ?? 'milli' })
  const addedA = mods[mods.length - 1]
  const addedB = mods[mods.length - 2]
  const changedM = mods[Math.min(40, mods.length - 1)]
  const pack: DemoPack = {
    buildId: 'demo-300-r3',
    chain: 'demo-300-r1',
    rev: 3,
    parent: 'demo-300-r2',
    title: 'Тёмное средневековье: магия и техника',
    mcVersion: '1.20.1',
    loader: 'forge',
    mods: all,
    resourcepacks,
    shaders: [active],
    shaderLoader: null,
    maps: [],
    links: [],
    excluded: [
      { slug: 'sodium', title: 'Sodium', reason: 'loader', detail: 'Только для Fabric — взяли Embeddium' },
      { slug: 'iris', title: 'Iris Shaders', reason: 'loader', detail: 'Только для Fabric — взяли Oculus' },
    ],
    notes: 'Сборка на вечер с друзьями: магия, техника Create и данжи.',
    locked: { extras: false },
    size: n,
    shaderLevel: 'medium',
    config: { profile: 'balanced', ramMb: 9728, jvm: 'g1', options: { renderDistance: '12', simulationDistance: '8', graphicsMode: '1', maxFps: '120', lang: 'ru_ru' }, shaderPack: active.slug },
    changes: {
      titleRu: 'Шейдеры полегче',
      by: 'milli',
      added: [ts(addedA), ts(addedB)],
      removed: [{ projectId: 'DMGONE01', title: 'Sound Physics Remastered II', tab: 'mods', by: 'milli' }],
      changed: [{ projectId: changedM.projectId, title: changedM.title, field: 'version', from: '5.0.1+mc1.20.1', to: changedM.version ?? '' }],
      config: [{ key: 'ramMb', from: '8192', to: '9728' }],
      skipped: [{ what: 'Distant Horizons', reasonRu: 'Слишком тяжёлый для этого ПК' }],
    },
    userRemoved: ['DMGONE01'],
    themes: [
      { id: 'magic', ru: 'Магия', w: 0.35 },
      { id: 'tech', ru: 'Техника', w: 0.3 },
      { id: 'adventure', ru: 'Данжи и бой', w: 0.35 },
    ],
    shaderChoices,
    rpStyles: [
      { id: 'medieval', ru: 'Средневековье' },
      { id: 'faithful', ru: 'Как ваниль' },
    ],
    counts: { mods: all.length, resourcepacks: resourcepacks.length, shaders: 1 },
    verified: false,
  }
  return pack
}

/** Убранный игроком мод из примера диффа — для строки-призрака «Вернуть». */
export const DEMO_REMOVED: DemoItem = {
  projectId: 'DMGONE01', slug: 'sound-physics-remastered-ii', title: 'Sound Physics Remastered II', icon: null,
  why: 'Эхо в пещерах', base: false, source: 'modrinth', descriptionRu: 'Эхо и глушение звука', cat: 'look', by: 'milli', heavy: true, side: 'client',
}

/** Квитанция из истории (stub): только шапка и счётчики. */
export function demoStub(): DemoPack {
  const p = demoPack()
  return { ...p, buildId: 'demo-300-r2', rev: 2, stub: true, mods: [], resourcepacks: [], shaders: [], shaderChoices: [], changes: null }
}
