import { gameProfile } from './gameProfile'
import { lookOwner } from '../state/accounts'

/**
 * uuid игрового профиля не меняется: профиль спрашиваем раз на аккаунт, и надетое (лобби,
 * гардероб) читается без ожидания его ответа. Пустой ответ и ошибка не запоминаются.
 */
let ask: { who: string; p: Promise<string> } | null = null

export function playerUuid(): Promise<string> {
  const who = lookOwner()
  if (ask && ask.who === who) return ask.p
  const p = gameProfile().then((x) => x.uuid || '')
  const mine = { who, p }
  ask = mine
  p.then(
    (uuid) => {
      if (!uuid && ask === mine) ask = null
    },
    () => {
      if (ask === mine) ask = null
    },
  )
  return p
}
