import { playRemote, type RemoteAudio } from './audio'
import { iceConfig } from './ice'
import { createPeer, type Peer, type PeerFlags } from './peer'
import { peerFlagsPatch, screenEncodingFor, type PeerState } from './mesh-rules'

export { peerFlagsPatch, politeToward, screenBitrateFor, screenEncodingFor } from './mesh-rules'
export type { PeerState } from './mesh-rules'

export type SignalKind = 'offer' | 'answer' | 'ice'

export interface SessionCallbacks {
  onSignal: (peerId: string, kind: SignalKind, data: Record<string, unknown>) => void
  /** Изменилось что-то у одного собеседника — панель перерисует только его. */
  onPeer: (peerId: string, patch: Partial<PeerState>) => void
  /** Соединение с этим собеседником окончательно развалилось. */
  onLost: (peerId: string) => void
}

interface Slot {
  peer: Peer
  voice: RemoteAudio | null
  screenAudio: RemoteAudio | null
}

/**
 * Разговор как набор соединений. Один на один — это его частный случай с одним
 * собеседником, поэтому личка и группа идут через один и тот же код: разойдись
 * они, мут, показ экрана или разрыв связи вели бы себя в группе иначе, чем в
 * личке, и чинить это пришлось бы дважды.
 *
 * Звук каждого играет своим элементом, а не микшируется: громкость и «приглушить
 * этого» нужны на каждого отдельно, а общий микс такого не позволяет.
 */
export class CallSession {
  private readonly slots = new Map<string, Slot>()
  private mic: MediaStreamTrack | null = null
  private screenVideo: MediaStreamTrack | null = null
  private screenAudio: MediaStreamTrack | null = null
  private screenFps = 30
  private volume = 100
  private deafened = false

  constructor(private readonly cb: SessionCallbacks) {}

  ids(): string[] {
    return [...this.slots.keys()]
  }

  has(peerId: string): boolean {
    return this.slots.has(peerId)
  }

  /**
   * Соединение с собеседником. Вежливость раздаётся вызывающим и одинаково на
   * обеих сторонах — только так одновременные предложения разбираются без гонки.
   */
  async connect(peerId: string, polite: boolean): Promise<void> {
    if (this.slots.has(peerId)) return
    const ice = await iceConfig()
    // Пока ходили за доступами, собеседник мог уйти или соединение уже собраться
    // встречным вызовом — второй RTCPeerConnection на того же человека означал бы
    // два голоса и утечку первого.
    if (this.slots.has(peerId)) return
    const slot: Slot = { peer: null as unknown as Peer, voice: null, screenAudio: null }
    slot.peer = createPeer(ice, polite, {
      onSignal: (kind, data) => this.cb.onSignal(peerId, kind, data),
      onRemoteAudio: (stream) => {
        if (slot.voice) slot.voice.close()
        slot.voice = playRemote(stream, this.volume, (l) =>
          this.cb.onPeer(peerId, { level: l.level, speaking: l.open }),
        )
        slot.voice.setDeafened(this.deafened)
      },
      onRemoteScreenAudio: (stream) => {
        if (slot.screenAudio) slot.screenAudio.close()
        slot.screenAudio = null
        if (!stream) return
        slot.screenAudio = playRemote(stream, this.volume)
        slot.screenAudio.setDeafened(this.deafened)
      },
      onRemoteScreen: (stream) => this.cb.onPeer(peerId, { screen: stream, sharing: !!stream }),
      onFlags: (flags: PeerFlags) => this.cb.onPeer(peerId, peerFlagsPatch(flags)),
      onConnection: (state) => {
        this.cb.onPeer(peerId, { connection: state })
        if (state === 'failed') this.cb.onLost(peerId)
      },
    })
    this.slots.set(peerId, slot)
    if (this.mic) await slot.peer.setMicTrack(this.mic)
    if (this.screenVideo) await slot.peer.setScreenTrack(this.screenVideo, this.screenEncoding())
    if (this.screenAudio) await slot.peer.setScreenAudioTrack(this.screenAudio)
  }

  drop(peerId: string): void {
    const slot = this.slots.get(peerId)
    if (!slot) return
    this.slots.delete(peerId)
    if (slot.voice) slot.voice.close()
    if (slot.screenAudio) slot.screenAudio.close()
    slot.peer.close()
  }

  /** Пересобрать соединение с тем же собеседником — обрыв чаще всего лечится этим. */
  async reconnect(peerId: string, polite: boolean): Promise<void> {
    this.drop(peerId)
    await this.connect(peerId, polite)
  }

  async accept(peerId: string, kind: SignalKind, data: Record<string, unknown>): Promise<void> {
    const slot = this.slots.get(peerId)
    if (!slot) return
    await slot.peer.accept(kind, data)
  }

  async setMic(track: MediaStreamTrack | null): Promise<void> {
    this.mic = track
    if (!track) return
    await Promise.all([...this.slots.values()].map((s) => s.peer.setMicTrack(track)))
  }

  async setScreen(video: MediaStreamTrack | null, audio: MediaStreamTrack | null, fps = this.screenFps): Promise<void> {
    this.screenVideo = video
    this.screenAudio = audio
    this.screenFps = fps
    const encoding = this.screenEncoding()
    for (const slot of this.slots.values()) {
      await slot.peer.setScreenTrack(video, encoding)
      await slot.peer.setScreenAudioTrack(audio)
    }
  }

  private screenEncoding(): RTCRtpEncodingParameters {
    return screenEncodingFor(this.slots.size, this.screenFps)
  }


  /** Флаги уходят каналом данных, а закрытому каналу — сигналингом вызывающего. */
  sendFlags(flags: PeerFlags): string[] {
    const missed: string[] = []
    for (const [peerId, slot] of this.slots) {
      if (!slot.peer.sendFlags(flags)) missed.push(peerId)
    }
    return missed
  }

  setVolume(pct: number): void {
    this.volume = pct
    for (const slot of this.slots.values()) {
      if (slot.voice) slot.voice.setVolume(pct)
      if (slot.screenAudio) slot.screenAudio.setVolume(pct)
    }
  }

  setDeafened(v: boolean): void {
    this.deafened = v
    for (const slot of this.slots.values()) {
      if (slot.voice) slot.voice.setDeafened(v)
      if (slot.screenAudio) slot.screenAudio.setDeafened(v)
    }
  }

  async pollQuality(): Promise<void> {
    await Promise.all(
      [...this.slots.entries()].map(([peerId, slot]) =>
        slot.peer
          .quality()
          .then((quality) => this.cb.onPeer(peerId, { quality }))
          .catch(() => {}),
      ),
    )
  }

  close(): void {
    for (const peerId of this.ids()) this.drop(peerId)
    this.mic = null
    this.screenVideo = null
    this.screenAudio = null
  }
}
