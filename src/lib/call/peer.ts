import type { IceConfig } from './ice'

/** Потолок показа экрана одному зрителю; на группу он делится между ними. */
export const SCREEN_MAX_BITRATE = 2_500_000

/** Ниже этого картинка перестаёт быть читаемой — лучше не показывать вовсе. */
export const SCREEN_MIN_BITRATE = 600_000

/// Показ экрана без явного разрешения: движок сам решает, чем жертвовать при
/// нехватке канала, и для дорожки с подсказкой «движение» жертвует именно
/// разрешением — картинка у зрителя схлопывается до нечитаемой и обратно уже не
/// растёт. Кадры терять можно, буквы — нет.
const SCREEN_DEGRADATION: RTCDegradationPreference = 'maintain-resolution'

/** Потолок камеры одному зрителю; на группу он делится между ними. */
export const CAM_MAX_BITRATE = 900_000

/** Ниже этого лицо превращается в набор квадратов — показывать нечего. */
export const CAM_MIN_BITRATE = 150_000

/// В отличие от экрана, камере разрешение уступать можно: мелкое лицо остаётся
/// узнаваемым, а рывки в разговоре замечают все.
const CAM_DEGRADATION: RTCDegradationPreference = 'balanced'

export interface PeerFlags {
  muted?: boolean
  deafened?: boolean
  screen?: boolean
  cam?: boolean
}

/** Что именно уходит видеодорожкой: одного её вида для этого недостаточно. */
export type VideoRole = 'screen' | 'cam'

/**
 * Карта «m-секция → роль». Экран и камера — две одинаковые с виду видеодорожки,
 * и различить их у получателя нечем: движок не передаёт назначение. Роль едет
 * рядом с описанием, в том же конверте — так она заведомо приходит до дорожки,
 * которую объясняет, и старая сторона без карты трактует видео как экран, то
 * есть ровно так, как делала до камеры.
 */
export type VideoRoles = Record<string, VideoRole>

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
  onRemoteCam: (stream: MediaStream | null) => void
  onFlags: (flags: PeerFlags) => void
  onConnection: (state: RTCPeerConnectionState) => void
}

export interface Peer {
  setMicTrack: (track: MediaStreamTrack) => Promise<void>
  setScreenTrack: (track: MediaStreamTrack | null, encoding?: RTCRtpEncodingParameters) => Promise<void>
  setCamTrack: (track: MediaStreamTrack | null, encoding?: RTCRtpEncodingParameters) => Promise<void>
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
  let camSender: RTCRtpSender | null = null
  let screenAudioSender: RTCRtpSender | null = null
  let lastBytes = 0
  let lastAt = 0
  const remoteAudio = new MediaStream()
  const remoteScreen = new MediaStream()
  const remoteCam = new MediaStream()
  const remoteRoles = new Map<string, VideoRole>()

  /// Карта считается по живым отправителям, а не запоминается при включении:
  /// секцию, освободившуюся после выключенного показа, движок вправе отдать
  /// камере, и запомненная роль тогда указывала бы на чужую дорожку.
  const videoRoles = (): VideoRoles => {
    const roles: VideoRoles = {}
    for (const t of pc.getTransceivers()) {
      if (!t.mid) continue
      if (screenSender && t.sender === screenSender) roles[t.mid] = 'screen'
      else if (camSender && t.sender === camSender) roles[t.mid] = 'cam'
    }
    return roles
  }

  const takeRoles = (data: Record<string, unknown>) => {
    const roles = data.video as VideoRoles | undefined
    if (!roles || typeof roles !== 'object') return
    remoteRoles.clear()
    for (const [mid, role] of Object.entries(roles)) {
      if (role === 'screen' || role === 'cam') remoteRoles.set(mid, role)
    }
  }

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
      if (pc.localDescription) cb.onSignal('offer', { sdp: pc.localDescription.toJSON(), video: videoRoles() })
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
    const cam = remoteRoles.get(e.transceiver.mid || '') === 'cam'
    const stream = cam ? remoteCam : remoteScreen
    const emit = cam ? cb.onRemoteCam : cb.onRemoteScreen
    stream.getVideoTracks().forEach((t) => stream.removeTrack(t))
    stream.addTrack(track)
    emit(stream)
    // Собеседник выключил картинку — дорожка кончается, и убрать её надо сразу.
    track.onended = () => {
      stream.removeTrack(track)
      emit(null)
    }
    track.onmute = () => emit(null)
    track.onunmute = () => emit(stream)
  }

  return {
    async setMicTrack(track) {
      if (micSender) await micSender.replaceTrack(track)
      else micSender = pc.addTrack(track)
    },
    async setScreenTrack(track, encoding = { maxBitrate: SCREEN_MAX_BITRATE, maxFramerate: 30 }) {
      if (!track) {
        if (screenSender) {
          pc.removeTrack(screenSender)
          screenSender = null
        }
        return
      }
      if (!screenSender) screenSender = pc.addTrack(track)
      else await screenSender.replaceTrack(track)
      const params = screenSender.getParameters()
      // Показ экрана не должен вытеснять голос: потолок битрейта задаётся сразу,
      // иначе движок отдаст видео весь доступный канал. В группе картинка уходит
      // каждому отдельным потоком, поэтому потолок там делится на зрителей —
      // иначе показ впятером требовал бы аплоада, которого почти ни у кого нет.
      params.degradationPreference = SCREEN_DEGRADATION
      params.encodings = [encoding]
      await screenSender.setParameters(params).catch(() => {})
    },
    async setCamTrack(track, encoding = { maxBitrate: CAM_MAX_BITRATE, maxFramerate: 24 }) {
      // Камеру за разговор включают и выключают много раз, поэтому дорожка
      // снимается заменой на пустую: снятие отправителя каждый раз добавляло бы
      // в описание новую секцию, а оно ограничено по размеру. Картинка у
      // собеседника гаснет сразу — по флагу, не дожидаясь тишины в дорожке.
      if (!track) {
        if (camSender) await camSender.replaceTrack(null)
        return
      }
      if (!camSender) camSender = pc.addTrack(track)
      else await camSender.replaceTrack(track)
      const params = camSender.getParameters()
      params.degradationPreference = CAM_DEGRADATION
      params.encodings = [encoding]
      await camSender.setParameters(params).catch(() => {})
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
      // Роли встают до описания: дорожки приезжают внутри setRemoteDescription,
      // и к этому моменту уже должно быть известно, кто из них камера.
      takeRoles(data)
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
      if (pc.localDescription) cb.onSignal('answer', { sdp: pc.localDescription.toJSON(), video: videoRoles() })
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
