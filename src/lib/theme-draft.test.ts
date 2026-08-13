import { describe, expect, test } from 'bun:test'
import { draftFingerprint, emptyDraft } from './theme-draft'
import type { ThemeDraft } from './theme-draft'

function base(): ThemeDraft {
  return {
    ...emptyDraft(),
    id: 'aura',
    name: 'aura farm',
    author: 'BIASTOH',
    tokens: { '--m-bg': '#101010', '--m-accent': '#5EC64D' },
    css: '.card{border-width:2px}',
  }
}

describe('draftFingerprint', () => {
  /// Слепок решает, спрашивать ли про несохранённые изменения при закрытии
  /// редактора. Ложное «изменилось» вернёт лишний вопрос, ложное «не менялось» —
  /// молча выбросит работу автора.
  const cases: { why: string; mutate: (d: ThemeDraft) => void; same: boolean }[] = [
    { why: 'ничего не трогали', mutate: () => {}, same: true },
    {
      why: 'токены те же, но записаны в другом порядке',
      mutate: (d) => {
        d.tokens = { '--m-accent': '#5EC64D', '--m-bg': '#101010' }
      },
      same: true,
    },
    {
      why: 'пустой токен в файл темы не попадает',
      mutate: (d) => {
        d.tokens['--m-fg'] = '   '
      },
      same: true,
    },
    {
      why: 'пробелы по краям CSS обрезаются при сборке',
      mutate: (d) => {
        d.css = '\n' + d.css + '  \n'
      },
      same: true,
    },
    {
      why: 'цвет изменён',
      mutate: (d) => {
        d.tokens['--m-bg'] = '#202020'
      },
      same: false,
    },
    {
      why: 'токен удалён',
      mutate: (d) => {
        d.tokens['--m-bg'] = ''
      },
      same: false,
    },
    {
      why: 'дописан ручной CSS',
      mutate: (d) => {
        d.css += '\n.btn{color:red}'
      },
      same: false,
    },
    {
      why: 'переименована тема',
      mutate: (d) => {
        d.name = 'aura farm 2'
      },
      same: false,
    },
  ]

  for (const c of cases) {
    test(c.why, () => {
      const before = draftFingerprint(base())
      const draft = base()
      c.mutate(draft)
      const after = draftFingerprint(draft)
      if (c.same) {
        expect(after, `«${c.why}» не меняет файл темы — вопрос о сохранении лишний`).toBe(before)
      } else {
        expect(after, `«${c.why}» меняет файл темы — без вопроса работа пропадёт`).not.toBe(before)
      }
    })
  }
})
