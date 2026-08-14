import { api } from '../api'

export interface IceConfig {
  iceServers: RTCIceServer[]
  relayOnly: boolean
}

/// Последний рубеж, если сервер не ответил: без ретранслятора соединение
/// соберётся не у всех, но молчащий звонок хуже, чем звонок без TURN.
const FALLBACK: IceConfig = {
  iceServers: [{ urls: ['stun:stun.cloudflare.com:3478', 'stun:stun.l.google.com:19302'] }],
  relayOnly: false,
}

let cached: { config: IceConfig; until: number } | null = null

/** Доступы к ретранслятору живут час, поэтому берутся заранее и переиспользуются. */
export async function iceConfig(): Promise<IceConfig> {
  if (cached && cached.until > Date.now()) return cached.config
  try {
    const r = await api<{ iceServers?: RTCIceServer[]; ttlSeconds?: number; relayOnly?: boolean }>(
      '/friends/call/ice',
    )
    const servers = (r.iceServers || []).filter((s) => s && s.urls && s.urls.length)
    if (!servers.length) throw new Error('пустой список')
    const config: IceConfig = { iceServers: servers, relayOnly: !!r.relayOnly }
    // Обновляем за пять минут до конца: выданный впритык логин протухнет посреди дозвона.
    const ttl = Math.max(300, (r.ttlSeconds || 3600) - 300)
    cached = { config, until: Date.now() + ttl * 1000 }
    return config
  } catch {
    return FALLBACK
  }
}

export const supportsCalls = (): boolean =>
  typeof RTCPeerConnection !== 'undefined' && !!navigator.mediaDevices?.getUserMedia
