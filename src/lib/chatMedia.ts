import { api } from './api'
import { bytesToBase64 } from './voice'
import type { VoiceTake } from './voice'
import type { ChatAttachment } from '../state/friends'

export const MAX_CHAT_IMAGE_BYTES = 8 * 1024 * 1024

interface UploadResult {
  url: string
  kind: 'image' | 'voice'
  name?: string
  durationMs?: number | null
  peaks?: number[]
}

export async function uploadVoice(take: VoiceTake): Promise<ChatAttachment> {
  if (!take.mp3.length) throw new Error('Запись пустая — микрофон ничего не услышал')
  const r: UploadResult = await api('/friends/chat/upload', {
    method: 'POST',
    body: JSON.stringify({
      kind: 'voice',
      dataBase64: bytesToBase64(take.mp3),
      durationMs: take.durationMs,
      peaks: take.peaks,
    }),
  })
  return {
    url: r.url,
    kind: 'voice',
    name: r.name || 'Голосовое сообщение',
    durationMs: take.durationMs,
    peaks: take.peaks,
  }
}

export async function uploadChatImage(file: File | Blob): Promise<ChatAttachment> {
  if (file.size > MAX_CHAT_IMAGE_BYTES) throw new Error('Картинка больше 8 МБ')
  const bytes = new Uint8Array(await file.arrayBuffer())
  const r: UploadResult = await api('/friends/chat/upload', {
    method: 'POST',
    body: JSON.stringify({ kind: 'image', dataBase64: bytesToBase64(bytes) }),
  })
  return { url: r.url, kind: 'image', name: '' }
}
