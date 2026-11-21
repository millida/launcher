import { describe, expect, test } from 'bun:test'
import { LIBRARY_PAGE, NAME_MAX, countText, draftName, libraryPath, statusText } from './wallpaperLibFormat'

describe('statusText names the moderation verdict of an own wallpaper', () => {
  const cases: Array<[string, Parameters<typeof statusText>[0], string]> = [
    ['a fresh upload waits for review', { status: 'PENDING', moderationNote: null }, 'На проверке'],
    ['a passed wallpaper is published', { status: 'ACTIVE', moderationNote: null }, 'Опубликован'],
    ['a rejection carries the reason, so the author knows what to fix', { status: 'REJECTED', moderationNote: 'Запрещённая символика' }, 'Отклонён: Запрещённая символика'],
    ['a rejection without a reason does not end in a dangling colon', { status: 'REJECTED', moderationNote: '  ' }, 'Отклонён'],
    ['a note on a published wallpaper is not shown as a rejection', { status: 'ACTIVE', moderationNote: 'old note' }, 'Опубликован'],
  ]
  for (const [why, input, want] of cases) test(why, () => expect(statusText(input), why).toBe(want))
})

describe('countText keeps counters short and never shows junk', () => {
  const cases: Array<[string, number, string]> = [
    ['small numbers stay as they are', 7, '7'],
    ['thousands are compacted so the card row does not wrap', 1500, '1.5K'],
    ['a negative value from a broken answer reads as zero', -3, '0'],
    ['NaN from a missing field reads as zero', Number.NaN, '0'],
    ['fractions are not counts', 2.9, '2'],
  ]
  for (const [why, input, want] of cases) test(why, () => expect(countText(input, 'en'), why).toBe(want))
})

describe('libraryPath builds the list request', () => {
  test('sort, page size and offset are always sent', () => {
    expect(libraryPath('popular', '', 0), 'the server pages by limit and offset').toBe(`/launcher/wallpapers?sort=popular&limit=${LIBRARY_PAGE}&offset=0`)
  })
  test('a blank search is not sent, so the server does not filter by spaces', () => {
    expect(libraryPath('new', '   ', 24), 'q must be omitted for a blank query').not.toContain('q=')
  })
  test('the query is trimmed and encoded, so it cannot add parameters of its own', () => {
    expect(libraryPath('liked', ' лес&sort=new ', 0), 'an ampersand in the query must stay inside q').toContain('q=%D0%BB%D0%B5%D1%81%26sort%3Dnew')
  })
  test('a negative offset is clamped', () => {
    expect(libraryPath('new', '', -5), 'the server rejects a negative offset').toContain('offset=0')
  })
})

describe('draftName suggests a publish name from the file', () => {
  const cases: Array<[string, string | undefined, string]> = [
    ['the picture extension is dropped', 'Закат.PNG', 'Закат'],
    ['only the last extension goes', 'forest.v2.webp', 'forest.v2'],
    ['a name without extension stays', 'Горы', 'Горы'],
    ['a missing name gives an empty field, not "undefined"', undefined, ''],
    ['a long file name is cut to the server limit', 'x'.repeat(NAME_MAX + 10) + '.jpg', 'x'.repeat(NAME_MAX)],
  ]
  for (const [why, input, want] of cases) test(why, () => expect(draftName(input), why).toBe(want))
})
