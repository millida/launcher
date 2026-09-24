import { closeSync, fstatSync, openSync, readSync, writeSync } from 'node:fs'

/**
 * A .dmg is not just a filesystem with the right extension: Finder hands the
 * file to DiskImageMounter, which looks for the trailing UDIF `koly` block and
 * does nothing at all — no error, no "damaged" — when it is missing.
 *
 * Offsets come from UDIFResourceFile: the struct is packed and big-endian on
 * disk, so they are literal byte positions inside the last 512 bytes.
 */
export const UDIF_TRAILER_SIZE = 512

const XML_OFFSET = 216
const XML_LENGTH = 224
const SECTOR_COUNT = 492

export function readUdifTrailer(read, size) {
  if (size <= UDIF_TRAILER_SIZE) throw new Error(`образ размером ${size} байт — в нём нет даже блока koly`)

  const trailer = read(size - UDIF_TRAILER_SIZE, UDIF_TRAILER_SIZE)
  const signature = trailer.toString('latin1', 0, 4)
  if (signature !== 'koly') {
    throw new Error(
      `в конце образа нет блока koly (там ${JSON.stringify(signature)}) — Finder не смонтирует такой файл, двойной клик по нему не сделает ничего`,
    )
  }

  const version = trailer.readUInt32BE(4)
  const headerSize = trailer.readUInt32BE(8)
  if (version !== 4 || headerSize !== UDIF_TRAILER_SIZE) {
    throw new Error(`блок koly версии ${version} размером ${headerSize} — ожидались 4 и ${UDIF_TRAILER_SIZE}`)
  }

  const xmlOffset = Number(trailer.readBigUInt64BE(XML_OFFSET))
  const xmlLength = Number(trailer.readBigUInt64BE(XML_LENGTH))
  const sectors = Number(trailer.readBigUInt64BE(SECTOR_COUNT))
  if (!sectors) throw new Error('в блоке koly нулевой размер образа')
  if (!xmlLength || xmlOffset + xmlLength > size) {
    throw new Error(`план блоков в koly указывает за пределы файла: смещение ${xmlOffset}, длина ${xmlLength}, файл ${size}`)
  }

  const plist = read(xmlOffset, xmlLength)
  if (!plist.includes('blkx')) throw new Error('в плане блоков образа нет ни одной записи blkx — монтировать нечего')

  return { version, sectors, xmlLength }
}

/**
 * `dmg` fills the sector count only for images that carry an Apple partition
 * map, and leaves it zero for a plain filesystem — a field macOS reads to size
 * the device. The trailer is not covered by any checksum in the image (those
 * live per block in the plan), so the correct value is written in afterwards.
 */
export function writeSectorCount(path, sectors) {
  if (!Number.isInteger(sectors) || sectors <= 0) throw new Error(`число секторов ${sectors} — не размер образа`)
  const fd = openSync(path, 'r+')
  try {
    const size = fstatSync(fd).size
    const value = Buffer.alloc(8)
    value.writeBigUInt64BE(BigInt(sectors))
    writeSync(fd, value, 0, 8, size - UDIF_TRAILER_SIZE + SECTOR_COUNT)
  } finally {
    closeSync(fd)
  }
}

export function assertUdif(path) {
  const fd = openSync(path, 'r')
  try {
    const read = (offset, length) => {
      const buffer = Buffer.alloc(length)
      readSync(fd, buffer, 0, length, offset)
      return buffer
    }
    return readUdifTrailer(read, fstatSync(fd).size)
  } catch (error) {
    throw new Error(`${path}: ${error.message}`)
  } finally {
    closeSync(fd)
  }
}
