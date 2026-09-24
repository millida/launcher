import { describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { assertVolumeName, readVolumeIds } from './lib/iso.mjs'

const SECTOR_SIZE = 2048
const FIRST_DESCRIPTOR = 16

function descriptor(type, name) {
  const sector = Buffer.alloc(SECTOR_SIZE, 0)
  sector[0] = type
  sector.write('CD001', 1, 'latin1')
  if (type === 1) {
    sector.fill(0x20, 40, 72)
    sector.write(name, 40, 'latin1')
  } else if (type === 2) {
    const ucs2 = Buffer.from(name, 'utf16le')
    ucs2.swap16()
    sector.fill(0x20, 40, 72)
    ucs2.copy(sector, 40, 0, Math.min(ucs2.length, 32))
  }
  return sector
}

function image(descriptors) {
  const dir = mkdtempSync(join(tmpdir(), 'iso-'))
  const path = join(dir, 'image.img')
  const head = Buffer.alloc(FIRST_DESCRIPTOR * SECTOR_SIZE, 0)
  const body = Buffer.concat([...descriptors, descriptor(255, '')])
  writeFileSync(path, Buffer.concat([head, body]))
  return { path, dir }
}

// Каждая строка закреплена тем, что образ с таким именем монтируется не туда,
// куда указывает ссылка на фон внутри .DS_Store, и окно теряет оформление.
describe('assertVolumeName', () => {
  test('имя во всех дескрипторах совпадает — пропускает', () => {
    const { path, dir } = image([descriptor(1, 'Millida Launcher 1.0.97 ARM')])
    try {
      expect(readVolumeIds(path)).toEqual([{ descriptor: 'ISO9660', id: 'Millida Launcher 1.0.97 ARM' }])
      expect(() => assertVolumeName(path, 'Millida Launcher 1.0.97 ARM')).not.toThrow()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('Joliet обрезал имя до 16 символов — валит сборку', () => {
    const { path, dir } = image([
      descriptor(1, 'Millida Launcher 1.0.97 ARM'),
      descriptor(2, 'Millida Launcher'),
    ])
    try {
      expect(() => assertVolumeName(path, 'Millida Launcher 1.0.97 ARM')).toThrow(/Joliet «Millida Launcher»/)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('файл без дескрипторов тома — не образ', () => {
    const dir = mkdtempSync(join(tmpdir(), 'iso-'))
    const path = join(dir, 'empty.img')
    try {
      writeFileSync(path, Buffer.alloc(FIRST_DESCRIPTOR * SECTOR_SIZE + SECTOR_SIZE, 0))
      expect(() => assertVolumeName(path, 'что угодно')).toThrow(/не образ ISO9660/)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
