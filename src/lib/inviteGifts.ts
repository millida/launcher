import { t } from '../i18n'
/// Подарки приглашённому: плитки в онбординге и на вкладке «Пригласить».
export interface InviteeGift {
  id: 'rubies' | 'chest' | 'plus'
  icon: string
  title: string
}

export const INVITEE_RUBIES = 50
export const INVITEE_PLUS_DAYS = 2

export const INVITEE_GIFTS: readonly InviteeGift[] = [
  { id: 'rubies', icon: 'i-gem', get title() { return t('{n} рубинов', { n: INVITEE_RUBIES }) } },
  { id: 'chest', icon: 'i-chest', get title() { return t('Сундук') } },
  { id: 'plus', icon: 'i-crown', get title() { return t('{n} дня PLUS', { n: INVITEE_PLUS_DAYS }) } },
]
