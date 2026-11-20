import { describe, expect, test } from 'bun:test'
import { afterPackUpdate, catalogPackSlug, packLaunchStep, packUpdateFor } from './packUpdate'
import type { PackCard, PackLaunchStep, PackUpdateOutcome } from './packUpdate'

type Settings = Parameters<typeof packUpdateFor>[0]
type View = Parameters<typeof packUpdateFor>[1]
type Verdict = ReturnType<typeof packUpdateFor>

const installed = { catalogPackSlug: 'arcania', catalogPackVersion: '2.3.1' }

// settings of the build, catalogue card -> what the build page offers.
const cases: Array<[string, Settings, View, Verdict]> = [
  [
    'починенную версию опубликовали — игрок со старой должен её получить',
    installed,
    { slug: 'arcania', version: '2.3.1-fix1' },
    { slug: 'arcania', from: '2.3.1', to: '2.3.1-fix1' },
  ],
  ['стоит опубликованная версия — предлагать нечего', installed, { slug: 'arcania', version: '2.3.1' }, null],
  [
    'автор заменил архив версии, не меняя номер — игрок должен получить новые файлы',
    { ...installed, catalogPackSha512: 'aa'.repeat(64) },
    { slug: 'arcania', version: '2.3.1', files: [{ side: 'client', version: '2.3.1', size: 1, sha512: 'bb'.repeat(64) }] },
    { slug: 'arcania', from: '2.3.1', to: '2.3.1' },
  ],
  [
    'тот же архив в другом регистре hex — не обновление',
    { ...installed, catalogPackSha512: 'AA'.repeat(64) },
    { slug: 'arcania', version: '2.3.1', files: [{ side: 'client', version: '2.3.1', size: 1, sha512: 'aa'.repeat(64) }] },
    null,
  ],
  [
    'сменился только серверный архив — клиенту качать нечего',
    { ...installed, catalogPackSha512: 'aa'.repeat(64) },
    {
      slug: 'arcania',
      version: '2.3.1',
      files: [
        { side: 'server', version: '2.3.1', size: 1, sha512: 'cc'.repeat(64) },
        { side: 'client', version: '2.3.1', size: 1, sha512: 'aa'.repeat(64) },
      ],
    },
    null,
  ],
  [
    'сборка поставлена до того, как лаунчер стал помнить хеш, — сравнивать не с чем, не дёргаем игрока',
    installed,
    { slug: 'arcania', version: '2.3.1', files: [{ side: 'client', version: '2.3.1', size: 1, sha512: 'bb'.repeat(64) }] },
    null,
  ],
  [
    'карточка без хеша (старый кэш) не выдаёт себя за замену',
    { ...installed, catalogPackSha512: 'aa'.repeat(64) },
    { slug: 'arcania', version: '2.3.1', files: [{ side: 'client', version: '2.3.1', size: 1 }] },
    null,
  ],
  [
    'пробелы вокруг номера не делают из одной версии две',
    { catalogPackSlug: 'arcania', catalogPackVersion: ' 2.3.1 ' },
    { slug: 'arcania', version: '2.3.1 ' },
    null,
  ],
  [
    'установленную версию сняли как сломанную — ставим ту, что каталог раздаёт сейчас, даже если номер меньше',
    { catalogPackSlug: 'arcania', catalogPackVersion: '2.4.0' },
    { slug: 'arcania', version: '2.3.1' },
    { slug: 'arcania', from: '2.4.0', to: '2.3.1' },
  ],
  [
    'у проверяющего стоит версия с проверки — откатывать её на опубликованную нельзя',
    { ...installed, catalogPackReviewFile: 'file1234567' },
    { slug: 'arcania', version: '2.3.0' },
    null,
  ],
  [
    'пустая отметка проверки — обычная сборка, обновление предлагается',
    { ...installed, catalogPackReviewFile: '' },
    { slug: 'arcania', version: '2.4.0' },
    { slug: 'arcania', from: '2.3.1', to: '2.4.0' },
  ],
  ['своя сборка без каталога отсюда не обновляется', { catalogPackVersion: '2.3.1' }, { slug: 'arcania', version: '2.4.0' }, null],
  [
    'слаг из файла на диске не той формы в адрес API не идёт',
    { catalogPackSlug: '../admin', catalogPackVersion: '1' },
    { slug: '../admin', version: '2' },
    null,
  ],
  [
    'версия не записана — неизвестно, что стоит, и два гигабайта наугад не качаем',
    { catalogPackSlug: 'arcania' },
    { slug: 'arcania', version: '2.3.1' },
    null,
  ],
  ['в карточке нет версии — сравнивать не с чем', installed, { slug: 'arcania', version: '' }, null],
  ['карточка чужой сборки — её версия к этой не относится', installed, { slug: 'lost-souls', version: '9.9' }, null],
  ['карточка не загрузилась — молчим, а не обещаем обновление', installed, null, null],
  ['настроек сборки нет — это не сборка каталога', null, { slug: 'arcania', version: '2.4.0' }, null],
]

describe('packUpdateFor', () => {
  for (const [why, settings, view, want] of cases) {
    test(why, () => {
      expect(packUpdateFor(settings, view)).toEqual(want)
    })
  }
})

// slug from the settings file -> slug the launcher asks the catalogue about.
const slugs: Array<[string, string | undefined, string | null]> = [
  ['обычный адрес сборки', 'lost-souls', 'lost-souls'],
  ['пробелы по краям не мешают', ' arcania ', 'arcania'],
  ['заглавные буквы — чужая форма, ядро такой слаг не примет', 'Arcania', null],
  ['путь не попадает в адрес запроса', 'a/b', null],
  ['пусто — сборка не из каталога', '', null],
  ['поля нет — сборка не из каталога', undefined, null],
  ['длиннее 80 знаков ядро не примет', 'x'.repeat(81), null],
]

describe('catalogPackSlug', () => {
  for (const [why, raw, want] of slugs) {
    test(why, () => {
      expect(catalogPackSlug({ catalogPackSlug: raw })).toBe(want)
    })
  }
})

const oneblock = { catalogPackSlug: 'oneblock-metalabs', catalogPackVersion: '1.0.4' }
const published: PackCard = { view: { slug: 'oneblock-metalabs', version: '1.0.6' } }

// settings of the build, answer of the catalogue -> what Play does before the game starts.
const steps: Array<[string, Settings, PackCard, PackLaunchStep]> = [
  [
    'партнёр выпустил 1.0.6, у игрока 1.0.4 — «Играть» сначала обновляет, иначе игрок так и сидит на старой',
    oneblock,
    published,
    { kind: 'update', update: { slug: 'oneblock-metalabs', from: '1.0.4', to: '1.0.6' }, required: false },
  ],
  [
    'стоит опубликованная версия — сразу запуск, без лишней установки',
    { ...oneblock, catalogPackVersion: '1.0.6' },
    published,
    { kind: 'launch' },
  ],
  [
    'у проверяющего стоит кандидат — запуск не должен молча откатить его на опубликованную',
    { ...oneblock, catalogPackReviewFile: 'av1clean3zqk7m2p9x4t8n6b' },
    published,
    { kind: 'launch' },
  ],
  [
    'кандидат проверяющего не сверяется вовсе — ни запроса, ни тоста «не удалось проверить» при каждом запуске',
    { ...oneblock, catalogPackReviewFile: 'av1clean3zqk7m2p9x4t8n6b' },
    { error: new Error('error sending request for url') },
    { kind: 'launch' },
  ],
  [
    'каталог не ответил — играем в установленную и говорим почему, а не молчим и не блокируем игру',
    oneblock,
    { error: new Error('error sending request for url') },
    { kind: 'launch-unchecked', reason: 'Нет связи с Millida — проверь интернет и повтори' },
  ],
  [
    'своя сборка без каталога — проверка не нужна, в сеть не идём',
    { catalogPackVersion: '1.0.4' },
    { error: new Error('не должно спрашиваться') },
    { kind: 'launch' },
  ],
  ['карточка пустая — сравнивать не с чем, просто запускаем', oneblock, { view: null }, { kind: 'launch' }],
]

describe('packLaunchStep', () => {
  for (const [why, settings, card, want] of steps) {
    test(why, () => {
      expect(packLaunchStep(settings, card, true, false), why).toEqual(want)
    })
  }
})

const arcania = { catalogPackSlug: 'arcania', catalogPackVersion: '1.4.3' }
const arcaniaCard: PackCard = { view: { slug: 'arcania', version: '1.4.4', alwaysUpdate: true } }
const arcaniaUpdate = { kind: 'update', update: { slug: 'arcania', from: '1.4.3', to: '1.4.4' }, required: true } as const

// settings, card, the build's switch, the core's stored «latest only» -> what Play does before the game starts.
const forcedSteps: Array<[string, Settings, PackCard, boolean, boolean, PackLaunchStep]> = [
  ['автообновление выключено — обычная сборка запускается как стоит', oneblock, published, false, false, { kind: 'launch' }],
  ['автор требует последнюю версию — выключенный тумблер не оставляет игрока на старой', arcania, arcaniaCard, false, false, arcaniaUpdate],
  [
    'ядро уже помнит требование автора, а карточка без поля — всё равно обновляем',
    arcania,
    { view: { slug: 'arcania', version: '1.4.4' } },
    false,
    true,
    arcaniaUpdate,
  ],
  ['последняя версия уже стоит — сразу запуск', { ...arcania, catalogPackVersion: '1.4.4' }, arcaniaCard, false, true, { kind: 'launch' }],
  [
    'кандидат проверяющего не трогается и у сборки «только последняя»',
    { ...arcania, catalogPackReviewFile: 'av1clean3zqk7m2p9x4t8n6b' },
    arcaniaCard,
    false,
    true,
    { kind: 'launch' },
  ],
  [
    'каталог не ответил при требовании автора — говорим почему, ключ запуска старой версии откажет сервер',
    arcania,
    { error: new Error('error sending request for url') },
    false,
    true,
    { kind: 'launch-unchecked', reason: 'Нет связи с Millida — проверь интернет и повтори' },
  ],
]

describe('packLaunchStep with the author requiring the latest version', () => {
  for (const [why, settings, card, autoUpdate, forced, want] of forcedSteps) {
    test(why, () => {
      expect(packLaunchStep(settings, card, autoUpdate, forced), why).toEqual(want)
    })
  }
})

const u = { slug: 'oneblock-metalabs', from: '1.0.4', to: '1.0.6' }

// how the update before the launch ended -> is the game started, what the player is told.
const afters: Array<[string, PackUpdateOutcome, { launch: boolean; toast: string | null }]> = [
  ['обновилось — запускаем уже новую версию', { kind: 'done' }, { launch: true, toast: null }],
  [
    'сеть оборвалась — ядро оставило старую версию целой, запускаем её и называем причину',
    { kind: 'failed', error: 'Error: Нет связи с сервером сборок, старая версия на месте' },
    {
      launch: true,
      toast:
        'Сборку не удалось обновить до 1.0.6: Нет связи с сервером сборок, старая версия на месте. Запускаем установленную версию 1.0.4',
    },
  ],
  [
    'служба отказала в доступе — игроку видна причина без служебной метки ядра',
    { kind: 'failed', error: 'pack-access: Подписка закончилась' },
    {
      launch: true,
      toast: 'Сборку не удалось обновить до 1.0.6: Подписка закончилась. Запускаем установленную версию 1.0.4',
    },
  ],
  [
    'ошибка без текста — тост всё равно честный, а не пустое двоеточие',
    { kind: 'failed', error: '' },
    { launch: true, toast: 'Сборку не удалось обновить до 1.0.6: причина неизвестна. Запускаем установленную версию 1.0.4' },
  ],
  ['игрок отменил — игра не стартует, он просил остановиться', { kind: 'cancelled' }, { launch: false, toast: null }],
]

describe('afterPackUpdate', () => {
  for (const [why, outcome, want] of afters) {
    test(why, () => {
      expect(afterPackUpdate(u, outcome), why).toEqual(want)
    })
  }
})

describe('afterPackUpdate for a build that starts only on its published version', () => {
  test('сбой обновления не запускает старую версию: её ключ запуска сервер всё равно не выдаст', () => {
    expect(afterPackUpdate(u, { kind: 'failed', error: 'Error: Нет связи с сервером сборок' }, true)).toEqual({
      launch: false,
      toast: 'Сборку не удалось обновить до 1.0.6: Нет связи с сервером сборок. Старая версия не запускается — попробуй ещё раз',
    })
  })
  test('успешное обновление запускает новую версию', () => {
    expect(afterPackUpdate(u, { kind: 'done' }, true)).toEqual({ launch: true, toast: null })
  })
  test('отмена по-прежнему просто останавливает запуск', () => {
    expect(afterPackUpdate(u, { kind: 'cancelled' }, true)).toEqual({ launch: false, toast: null })
  })
})
