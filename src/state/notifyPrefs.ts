import { readPref, writePref } from '../lib/prefs'
import type { PrefKey } from '../lib/prefs'

export type NotifyKind = 'msg' | 'play' | 'online' | 'request' | 'room'
export type NotifyLevel = 'sound' | 'silent' | 'off'

const KEYS: Record<NotifyKind, PrefKey> = {
  msg: 'm-notify-msg',
  play: 'm-notify-play',
  online: 'm-notify-online',
  request: 'm-notify-request',
  room: 'm-notify-room',
}

const DEFAULTS: Record<NotifyKind, NotifyLevel> = {
  msg: 'sound',
  play: 'silent',
  online: 'silent',
  request: 'sound',
  room: 'sound',
}

export function parseLevel(kind: NotifyKind, raw: string | null): NotifyLevel {
  return raw === 'sound' || raw === 'silent' || raw === 'off' ? raw : DEFAULTS[kind]
}

export function notifyLevel(kind: NotifyKind): NotifyLevel {
  return parseLevel(kind, readPref(KEYS[kind], DEFAULTS[kind]))
}

export function setNotifyLevel(kind: NotifyKind, level: NotifyLevel) {
  writePref(KEYS[kind], level)
}

export const notifyShown = (kind: NotifyKind) => notifyLevel(kind) !== 'off'
export const notifyAudible = (kind: NotifyKind) => notifyLevel(kind) === 'sound'
