import type { Friend, FoundUser } from '../state/friends'
import { useServers } from '../state/servers'
import { canonAddr } from './serverAddr'
import { formatRelative, getLocale, t } from '../i18n'

export const friendServer = (f: Friend): string | undefined =>
  f.serverIp ||
  (f as { server?: string }).server ||
  (f as { serverAddress?: string }).serverAddress

export function shownServerName(name: string | null | undefined, addr: string | null | undefined): string {
  const key = getLocale() === 'ru' ? '' : canonAddr(addr || '')
  const rated = key ? useServers.getState().list.find((s) => canonAddr(s.ip) === key)?.name : ''
  return rated || name || addr || ''
}

export const seenAgo = (lastSeen?: number | null, now?: number): string =>
  lastSeen ? formatRelative(lastSeen > 1e12 ? lastSeen : lastSeen * 1000, undefined, now) : ''

export function statusText(f: Friend, now?: number): string {
  if (f.playing) {
    const where = shownServerName(f.serverName, friendServer(f))
    if (where) return t('В игре · {where}', { where })
    return f.build ? t('Играет · {where}', { where: f.build }) : t('В игре')
  }
  if (f.online) return f.place === 'launcher' ? t('В лаунчере') : f.place === 'web' ? t('На сайте') : t('В сети')
  const ago = seenAgo(f.lastSeen, now)
  return ago ? t('Не в сети · {ago}', { ago }) : t('Не в сети')
}

export function foundStatusText(u: FoundUser, now?: number): string {
  if (u.rank === 0) return u.playingOn ? t('В игре · {where}', { where: shownServerName(u.playingOn, null) }) : t('В игре')
  if (u.rank === 1 || u.online) return t('В сети')
  if (u.rank === 2) {
    const ago = seenAgo(u.lastSeen, now)
    return ago ? t('Не в сети · {ago}', { ago }) : t('Не в сети')
  }
  return t('Игрок Millida')
}
