import { describe, expect, test } from 'bun:test'
import { catalogPackSlug, packUpdateFor } from './packUpdate'

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
