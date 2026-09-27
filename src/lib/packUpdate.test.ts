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
    { kind: 'update', update: { slug: 'oneblock-metalabs', from: '1.0.4', to: '1.0.6' } },
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
      expect(packLaunchStep(settings, card), why).toEqual(want)
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
