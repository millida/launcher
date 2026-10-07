/// Подарки приглашённому: плитки в онбординге и на вкладке «Пригласить».
export interface InviteeGift {
  id: 'rubies' | 'chest' | 'plus'
  icon: string
  title: string
}

export const INVITEE_RUBIES = 50
export const INVITEE_PLUS_DAYS = 2

export const INVITEE_GIFTS: readonly InviteeGift[] = [
  { id: 'rubies', icon: 'i-gem', title: INVITEE_RUBIES + ' рубинов' },
  { id: 'chest', icon: 'i-chest', title: 'Сундук' },
  { id: 'plus', icon: 'i-crown', title: INVITEE_PLUS_DAYS + ' дня PLUS' },
]
