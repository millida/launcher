import { expect, test } from 'bun:test'
import { ENCODER_RATE, bytesToBase64, createResampler, fmtVoiceTime } from './voice'

function sine(from: number, count: number, offset: number, hz = 440): Float32Array {
  const out = new Float32Array(count)
  for (let i = 0; i < count; i++) out[i] = Math.sin((2 * Math.PI * hz * (offset + i)) / from)
  return out
}

function collect(from: number, seconds: number, block = 4096): Int16Array {
  const rs = createResampler(from)
  const total = Math.round(from * seconds)
  const parts: Int16Array[] = []
  for (let off = 0; off < total; off += block) {
    parts.push(rs.push(sine(from, Math.min(block, total - off), off)))
  }
  let n = 0
  parts.forEach((p) => (n += p.length))
  const out = new Int16Array(n)
  let at = 0
  parts.forEach((p) => {
    out.set(p, at)
    at += p.length
  })
  return out
}

// Микрофон отдаёт 48000 или 44100, а энкодер по факту всегда работает на 22050
// (проверено по заголовкам его вывода). Расхождение даёт не сдвиг тона, а тишину:
// та же секунда, скормленная как 48000, декодируется на -44 дБ против -12 дБ.
test('поток приводится к частоте энкодера с сохранением длительности', () => {
  for (const from of [48000, 44100, 22050]) {
    const out = collect(from, 2)
    const seconds = out.length / ENCODER_RATE
    expect(Math.abs(seconds - 2) < 0.01, `${from} Гц → длительность ${seconds.toFixed(3)}с вместо 2с`).toBe(true)
  }
})

// Пин на само расхождение: энкодер принимает частоту в конструкторе, но пишет
// в заголовок свою. Пока ENCODER_RATE совпадает с объявленной — материал звучит.
test('энкодер объявляет ровно ту частоту, под которую мы готовим поток', async () => {
  const { Mp3Encoder } = await import('@breezystack/lamejs')
  const enc = new Mp3Encoder(1, ENCODER_RATE, 32)
  const pcm = new Int16Array(ENCODER_RATE / 2)
  for (let i = 0; i < pcm.length; i++) pcm[i] = Math.round(Math.sin((2 * Math.PI * 440 * i) / ENCODER_RATE) * 12000)
  const head = new Uint8Array(enc.encodeBuffer(pcm))
  const at = head.findIndex((b, i) => b === 0xff && ((head[i + 1] ?? 0) & 0xe0) === 0xe0)
  expect(at, 'в выводе энкодера нет ни одного кадра MPEG').toBeGreaterThanOrEqual(0)
  const version = (head[at + 1]! >> 3) & 3
  const rateIndex = (head[at + 2]! >> 2) & 3
  const table: Record<number, number[]> = { 3: [44100, 48000, 32000], 2: [22050, 24000, 16000], 0: [11025, 12000, 8000] }
  const declared = table[version]?.[rateIndex]
  expect(declared, `энкодер пишет ${declared} Гц вместо ${ENCODER_RATE} — материал раскодируется в шум`).toBe(
    ENCODER_RATE,
  )
})

test('громкость не теряется при пересчёте', () => {
  const out = collect(48000, 1)
  let peak = 0
  for (const v of out) peak = Math.max(peak, Math.abs(v))
  expect(peak > 0x7fff * 0.9, `пик ${peak} — сигнал ушёл в тишину`).toBe(true)
})

// Позиция чтения и граничный отсчёт переносятся между блоками. Если их сбросить,
// на каждом стыке появится разрыв — щелчки каждые ~85 мс.
test('на стыках блоков нет разрывов', () => {
  const out = collect(48000, 1)
  const perStep = (2 * Math.PI * 440) / ENCODER_RATE
  const limit = 0x7fff * Math.sin(perStep) * 3
  let worst = 0
  for (let i = 1; i < out.length; i++) worst = Math.max(worst, Math.abs(out[i] - out[i - 1]))
  expect(worst < limit, `скачок ${worst} при допустимых ${Math.round(limit)} — блоки склеены с разрывом`).toBe(true)
})

test('base64 переживает буфер больше одного чанка', () => {
  const bytes = new Uint8Array(0x8000 * 2 + 5)
  for (let i = 0; i < bytes.length; i++) bytes[i] = i % 256
  const back = Uint8Array.from(atob(bytesToBase64(bytes)), (c) => c.charCodeAt(0))
  expect(back.length).toBe(bytes.length)
  expect(back[bytes.length - 1]).toBe(bytes[bytes.length - 1])
})

test('длительность подписывается как минуты и секунды', () => {
  expect(fmtVoiceTime(0)).toBe('0:00')
  expect(fmtVoiceTime(9_500)).toBe('0:10')
  expect(fmtVoiceTime(125_000)).toBe('2:05')
})
