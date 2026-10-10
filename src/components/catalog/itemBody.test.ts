import { describe, expect, test } from 'bun:test'
import { planMedia, readsRussian, russianText, tagLabels } from './itemBody'

const EN = 'A modpack specially designed to bring an incredibly hardcore and semi-realism challenge.'
const RU = 'Сборка для хардкорного выживания с элементами RPG.'
const SEO = 'RLCraft — сборка для хардкорного выживания.\n\nИгроков ждут новые механики боя и магии.'

describe('russian text for the catalog item page', () => {
  const cases: Array<[string, string | null, string | null, string, string]> = [
    [RU, SEO, RU, RU, 'an AI-written Russian article is the best text and wins over everything else'],
    [EN, SEO, RU, SEO, 'an English Modrinth blurb is replaced by the Russian retelling: players must not read English'],
    [EN, null, RU, RU, 'without a retelling the Russian summary still beats the English blurb'],
    [EN, 'English seo', 'English summary', '', 'with no Russian anywhere the page falls back to the author text behind its own label'],
    ['', null, '', '', 'nothing at all gives no Russian text'],
  ]
  for (const [desc, seo, summary, want, why] of cases) test(why, () => expect(russianText(desc, seo, summary), why).toBe(want))

  test('brand names inside Russian text do not make it foreign', () => {
    expect(readsRussian('Мод Sodium для Fabric и NeoForge ускоряет рендер мира'), 'an AI text full of mod names would be thrown away').toBe(true)
  })
  test('a short English line without letters of the alphabet is not Russian', () => {
    expect(readsRussian('View Items and Recipes'), 'short English seeds would slip through a length threshold').toBe(false)
  })
})

describe('media plan follows the site rule', () => {
  const body = 'p1\n\np2\n\np3\n\np4\n\np5'
  const shots = ['s1', 's2', 's3', 's4', 's5']
  const cases: Array<[string, string[], string[], string[], string]> = [
    [body, shots, ['s1', 's2', 's3'], ['s4', 's5'], 'five shots: the strip keeps three, the tail goes into the text'],
    [body, ['s1', 's2', 's3', 's4'], ['s1', 's2'], ['s3', 's4'], 'four shots: two stay in the strip, two illustrate the text'],
    [body, ['s1'], ['s1'], [], 'one shot stays in the strip: the text would otherwise lose the only preview'],
    ['p1', ['s1', 's2', 's3'], ['s1', 's2', 's3'], [], 'a one-paragraph text has no room, every shot goes back to the strip'],
    ['p1\n\n![](own)\n\np2\n\np3', shots, shots, [], 'the author illustrated the text himself, our shots stay in the strip'],
  ]
  for (const [text, list, strip, inline, why] of cases)
    test(why, () => {
      const got = planMedia(text, list)
      expect(got.strip, why).toEqual(strip)
      for (const u of inline) expect(got.body.includes('](' + u + ')'), why).toBe(true)
      for (const u of got.strip) expect(got.body.includes('](' + u + ')'), 'a shot must appear on the page once').toBe(false)
    })
})

describe('tag labels', () => {
  const cases: Array<[string[], string[], string]> = [
    [['exploration', 'combat-pvp', 'adventure-and-rpg'], ['Исследование', 'Бой и PvP', 'Приключения и RPG'], 'Modrinth slugs are shown in Russian'],
    [['утилиты', 'приключения'], ['Утилиты', 'Приключения'], 'Russian tags only get a capital letter'],
    [['1.12.2', 'forge'], ['1.12.2', 'Forge'], 'versions and loader names are not English text and stay'],
    [['minecraft', 'some-unknown-slug'], [], 'an untranslated English slug is hidden rather than shown raw'],
    [['bedrock', 'pe', 'adventure', 'приключения'], ['Bedrock', 'Приключения'], 'synonyms collapse into one chip'],
  ]
  for (const [tags, want, why] of cases) test(why, () => expect(tagLabels(tags, 8), why).toEqual(want))
})
