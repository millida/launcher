import type { SnapshotServer } from '../lib/snapshot'
import { cleanServerName, stripMotdEmoji } from '../lib/serverName'
import { t } from '../i18n'
import { catName, toCard, type RatingServer } from './servers'

const featureName = (): Record<string, string> => ({
  PVP: 'PvP',
  CASES: t('Кейсы'),
  CLANS: t('Кланы'),
  ECONOMY: t('Экономика'),
  QUESTS: t('Квесты'),
  PRIVATES: t('Приваты'),
  EVENTS: t('Ивенты'),
  CUSTOM_ITEMS: t('Кастомные предметы'),
  CUSTOM_MOBS: t('Кастомные мобы'),
  MAGIC: t('Магия'),
  TECH: t('Техника'),
  PETS: t('Питомцы'),
  AUCTION: t('Аукцион'),
  JOBS: t('Профессии'),
  BATTLE_PASS: 'Battle Pass',
  CROSSPLAY: t('Кроссплей'),
  NO_DONATE_WIN: t('Донат не решает'),
  NEW_PLAYER_FRIENDLY: t('Для новичков'),
  MODS: t('Моды'),
})

/** До трёх тегов строки: сначала режимы сервера, потом особенности из справочника рейтинга. */
const serverTags = (sv: RatingServer): string[] => {
  const cats = catName()
  const feats = featureName()
  const out: string[] = []
  const add = (x: string | undefined) => {
    if (x && !out.includes(x) && out.length < 3) out.push(x)
  }
  for (const c of (sv.categories || []).filter((c) => c !== 'OTHER').slice(0, 2)) add(cats[c])
  for (const f of sv.features || []) add(feats[f])
  return out
}

/**
 * Карточка рейтинга с тем, что рисуют его строки: имя как на сайте, теги, первая строка MOTD, ракета и голоса.
 * Отдельно от state/servers: тот стоит в стартовом наборе, а строки рейтинга — на ленивых экранах.
 */
export const toRatingCard = (sv: RatingServer, rank: number): SnapshotServer => ({
  ...toCard(sv, rank),
  name: cleanServerName(sv.name, sv.ip),
  votes: sv.votes30d ?? 0,
  tags: serverTags(sv),
  createdAt: sv.createdAt,
  boost: sv.boostPoints ?? 0,
  motdLine: stripMotdEmoji((sv.motd || '').split('\n')[0] || '').slice(0, 400),
})
