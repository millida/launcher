import { describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { UDIF_TRAILER_SIZE, assertUdif, readUdifTrailer, writeSectorCount } from './lib/udif.mjs'

const PLIST = Buffer.from('<plist><key>blkx</key></plist>')
const PLIST_OFFSET = 4096

function image(mutate = () => {}) {
  const trailer = Buffer.alloc(UDIF_TRAILER_SIZE)
  trailer.write('koly', 0, 'latin1')
  trailer.writeUInt32BE(4, 4)
  trailer.writeUInt32BE(UDIF_TRAILER_SIZE, 8)
  trailer.writeBigUInt64BE(BigInt(PLIST_OFFSET), 216)
  trailer.writeBigUInt64BE(BigInt(PLIST.length), 224)
  trailer.writeBigUInt64BE(1024n, 492)
  mutate(trailer)

  const size = PLIST_OFFSET + PLIST.length + UDIF_TRAILER_SIZE
  const read = (offset, length) => {
    if (offset === size - UDIF_TRAILER_SIZE && length === UDIF_TRAILER_SIZE) return trailer
    if (offset === PLIST_OFFSET) return PLIST.subarray(0, length)
    return Buffer.alloc(length)
  }
  return { read, size }
}

// Каждый кейс закреплён тем, что образ ровно с этим дефектом молча не открывается
// на macOS: Finder не показывает ошибку, поэтому поймать это можно только здесь.
const BROKEN = [
  ['подпись koly затёрта', (t) => t.write('CD00', 0, 'latin1'), /koly/],
  ['версия UDIF не 4', (t) => t.writeUInt32BE(3, 4), /версии 3/],
  ['размер заголовка не 512', (t) => t.writeUInt32BE(256, 8), /размером 256/],
  ['нулевой размер образа', (t) => t.writeBigUInt64BE(0n, 492), /нулевой размер/],
  ['пустой план блоков', (t) => t.writeBigUInt64BE(0n, 224), /план блоков/],
  ['план блоков за пределами файла', (t) => t.writeBigUInt64BE(1n << 40n, 216), /за пределы файла/],
]

describe('readUdifTrailer', () => {
  test('целый образ читается', () => {
    const { read, size } = image()
    expect(readUdifTrailer(read, size)).toEqual({ version: 4, sectors: 1024, xmlLength: PLIST.length })
  })

  for (const [name, mutate, message] of BROKEN) {
    test(`отвергает: ${name}`, () => {
      const { read, size } = image(mutate)
      expect(() => readUdifTrailer(read, size)).toThrow(message)
    })
  }

  test('отвергает файл короче трейлера', () => {
    expect(() => readUdifTrailer(() => Buffer.alloc(0), 128)).toThrow(/блока koly/)
  })

  test('отвергает план блоков без записей blkx', () => {
    const { read, size } = image()
    const empty = (offset, length) => (offset === PLIST_OFFSET ? Buffer.alloc(length) : read(offset, length))
    expect(() => readUdifTrailer(empty, size)).toThrow(/blkx/)
  })
})

describe('writeSectorCount', () => {
  const file = (sectors) => {
    const dir = mkdtempSync(join(tmpdir(), 'udif-'))
    const path = join(dir, 'image.dmg')
    const { read, size } = image((t) => t.writeBigUInt64BE(BigInt(sectors), 492))
    const body = Buffer.alloc(size)
    PLIST.copy(body, PLIST_OFFSET)
    read(size - UDIF_TRAILER_SIZE, UDIF_TRAILER_SIZE).copy(body, size - UDIF_TRAILER_SIZE)
    writeFileSync(path, body)
    return { path, dir }
  }

  // Образ, который dmg отдаёт без карты разделов, приезжает с нулём секторов —
  // на нём и проверяется, что число проставляется и переживает чтение обратно.
  test('проставляет размер и не трогает остальной трейлер', () => {
    const { path, dir } = file(0)
    try {
      expect(() => assertUdif(path)).toThrow(/нулевой размер/)
      writeSectorCount(path, 6592)
      expect(assertUdif(path)).toEqual({ version: 4, sectors: 6592, xmlLength: PLIST.length })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('отказывается писать бессмысленный размер', () => {
    const { path, dir } = file(0)
    try {
      for (const bad of [0, -1, 1.5]) expect(() => writeSectorCount(path, bad)).toThrow(/не размер образа/)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
