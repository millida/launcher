import type { IceConfig } from './ice'

/** Потолок показа экрана одному зрителю; на группу он делится между ними. */
export const SCREEN_MAX_BITRATE = 2_500_000

/** Ниже этого картинка перестаёт быть читаемой — лучше не показывать вовсе. */
export const SCREEN_MIN_BITRATE = 600_000

export interface PeerFlags {
  muted?: boolean
  deafened?: boolean
  screen?: boolean
}

export interface PeerQuality {
  rttMs: number | null
  lossPct: number
  kbps: number
}

export interface PeerCallbacks {
  onSignal: (kind: 'offer' | 'answer' | 'ice', data: Record<string, unknown>) => void
  onRemoteAudio: (stream: MediaStream) => void
  /** Звук показываемого экрана приходит отдельной дорожкой и играет отдельно от голоса. */
  onRemoteScreenAudio: (stream: MediaStream | null) => void
  onRemoteScreen: (stream: MediaStream | null) => void
  onFlags: (flags: PeerFlags) => void
  onConnection: (state: RTCPeerConnectionState) => void
}

export interface Peer {
  setMicTrack: (track: MediaStreamTrack) => Promise<void>
  setScreenTrack: (track: MediaStreamTrack | null, maxBitrate?: number) => Promise<void>
  setScreenAudioTrack: (track: MediaStreamTrack | null) => Promise<void>
  /** Возвращает, ушло ли состояние: закрытый канал — повод отправить его сигналингом. */
  sendFlags: (flags: PeerFlags) => boolean
  accept: (kind: 'offer' | 'answer' | 'ice', data: Record<string, unknown>) => Promise<void>
  quality: () => Promise<PeerQuality>
  close: () => void
}

/**
 * Соединение с собеседником. Вежливость раздаётся один раз и по одному правилу
 * на обеих сторонах: звонящий — невежливый, отвечающий — вежливый. Так
 * одновременные предложения (например, при добавлении экрана) разбираются без
 * гонки — вежливая сторона откатывает своё.
 */
export function createPeer(
  ice: IceConfig,
  polite: boolean,
  cb: PeerCallbacks,
): Peer {
  const pc = new RTCPeerConnection({
    iceServers: ice.iceServers,
    iceTransportPolicy: ice.relayOnly ? 'relay' : 'all',
    bundlePolicy: 'max-bundle',
  })
  let makingOffer = false
  let micSender: RTCRtpSender | null = null
  let screenSender: RTCRtpSender | null = null
  let screenAudioSender: RTCRtpSender | null = null
  let lastBytes = 0
  let lastAt = 0
  const remoteAudio = new MediaStream()
  const remoteScreen = new MediaStream()

  const channel = pc.createDataChannel('state', { negotiated: true, id: 0 })
  channel.onmessage = (e) => {
    try {
      cb.onFlags(JSON.parse(String(e.data)) as PeerFlags)
    } catch {
      // Чужой формат в канале состояния молча игнорируется: на звук он не влияет.
    }
  }

  pc.onicecandidate = (e) => {
    if (e.candidate) cb.onSignal('ice', { candidate: e.candidate.toJSON() })
  }
  pc.onconnectionstatechange = () => cb.onConnection(pc.connectionState)
  pc.onnegotiationneeded = async () => {
    try {
      makingOffer = true
      // Описание собирается явно: неявная форма setLocalDescription() есть не во
      // всех движках, на которых работает лаунчер.
      await pc.setLocalDescription(await pc.createOffer())
      if (pc.localDescription) cb.onSignal('offer', { sdp: pc.localDescription.toJSON() })
    } catch {
      // Пересогласование сорвалось — состояние соединения расскажет об этом само.
    } finally {
      makingOffer = false
    }
  }
  pc.ontrack = (e) => {
    const track = e.track
    if (track.kind === 'audio') {
      // Первая звуковая дорожка — голос, следующая приходит только вместе с
      // показом экрана. Держать их в одном потоке нельзя: элемент проигрывает
      // лишь первую, и звук показа пропал бы.
      if (!remoteAudio.getAudioTracks().length) {
        remoteAudio.addTrack(track)
        cb.onRemoteAudio(remoteAudio)
        return
      }
      const extra = new MediaStream([track])
      cb.onRemoteScreenAudio(extra)
      track.onended = () => cb.onRemoteScreenAudio(null)
      track.onmute = () => cb.onRemoteScreenAudio(null)
      track.onunmute = () => cb.onRemoteScreenAudio(extra)
      return
    }
    remoteScreen.getVideoTracks().forEach((t) => remoteScreen.removeTrack(t))
    remoteScreen.addTrack(track)
    cb.onRemoteScreen(remoteScreen)
    // Собеседник выключил показ — дорожка кончается, и картинку надо убрать.
    track.onended = () => {
      remoteScreen.removeTrack(track)
      cb.onRemoteScreen(null)
    }
    track.onmute = () => cb.onRemoteScreen(null)
    track.onunmute = () => cb.onRemoteScreen(remoteScreen)
  }

  return {
    async setMicTrack(track) {
      if (micSender) await micSender.replaceTrack(track)
      else micSender = pc.addTrack(track)
    },
    async setScreenTrack(track, maxBitrate = SCREEN_MAX_BITRATE) {
      if (!track) {
        if (screenSender) {
          pc.removeTrack(screenSender)
          screenSender = null
        }
        return
      }
      if (screenSender) {
        await screenSender.replaceTrack(track)
        return
      }
      screenSender = pc.addTrack(track)
      const params = screenSender.getParameters()
      // Показ экрана не должен вытеснять голос: потолок битрейта задаётся сразу,
      // иначе движок отдаст видео весь доступный канал. В группе картинка уходит
      // каждому отдельным потоком, поэтому потолок там делится на зрителей —
      // иначе показ впятером требовал бы аплоада, которого почти ни у кого нет.
      params.encodings = [{ maxBitrate, maxFramerate: 30 }]
      await screenSender.setParameters(params).catch(() => {})
    },
    async setScreenAudioTrack(track) {
      if (!track) {
        if (screenAudioSender) {
          pc.removeTrack(screenAudioSender)
          screenAudioSender = null
        }
        return
      }
      if (screenAudioSender) await screenAudioSender.replaceTrack(track)
      else screenAudioSender = pc.addTrack(track)
    },
    sendFlags(flags) {
      if (channel.readyState !== 'open') return false
      channel.send(JSON.stringify(flags))
      return true
    },
    async accept(kind, data) {
      if (kind === 'ice') {
        const candidate = data.candidate as RTCIceCandidateInit | undefined
        if (!candidate) return
        try {
          await pc.addIceCandidate(candidate)
        } catch {
          // Кандидат, пришедший до описания или уже неактуальный, не ошибка.
        }
        return
      }
      const description = data.sdp as RTCSessionDescriptionInit | undefined
      if (!description) return
      const offerCollision = description.type === 'offer' && (makingOffer || pc.signalingState !== 'stable')
      if (!polite && offerCollision) return
      if (offerCollision) {
        // Вежливая сторона убирает своё предложение. Часть движков делает это
        // сама при приёме чужого, часть — только по явному откату.
        await pc.setLocalDescription({ type: 'rollback' }).catch(() => {})
      }
      await pc.setRemoteDescription(description)
      if (description.type !== 'offer') return
      await pc.setLocalDescription(await pc.createAnswer())
      if (pc.localDescription) cb.onSignal('answer', { sdp: pc.localDescription.toJSON() })
    },
    async quality() {
      const stats = await pc.getStats()
      let rttMs: number | null = null
      let lost = 0
      let received = 0
      let bytes = 0
      stats.forEach((report) => {
        const r = report as Record<string, number | string>
        if (r.type === 'candidate-pair' && r.state === 'succeeded' && typeof r.currentRoundTripTime === 'number') {
          rttMs = Math.round(r.currentRoundTripTime * 1000)
        }
        if (r.type === 'inbound-rtp' && r.kind === 'audio') {
          lost = Number(r.packetsLost || 0)
          received = Number(r.packetsReceived || 0)
          bytes = Number(r.bytesReceived || 0)
        }
      })
      const now = performance.now()
      const kbps = lastAt && bytes >= lastBytes ? ((bytes - lastBytes) * 8) / (now - lastAt) : 0
      lastBytes = bytes
      lastAt = now
      const total = lost + received
      return { rttMs, lossPct: total ? (lost / total) * 100 : 0, kbps }
    },
    close() {
      try {
        channel.close()
      } catch {
        // Канал уже мог закрыться вместе с соединением.
      }
      pc.getSenders().forEach((s) => s.track?.stop())
      pc.onicecandidate = null
      pc.ontrack = null
      pc.onnegotiationneeded = null
      pc.onconnectionstatechange = null
      pc.close()
    },
  }
}
