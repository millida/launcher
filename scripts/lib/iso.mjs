import { closeSync, fstatSync, openSync, readSync } from 'node:fs'

/**
 * The name macOS shows for a mounted image comes from the volume descriptors of
 * ISO9660, and there is more than one of them: Joliet keeps its own copy of the
 * name, cut to 16 characters, and it is the copy the system prefers. A name that
 * differs between descriptors quietly becomes a different mount point, and the
 * background reference inside .DS_Store — an alias bound to /Volumes/<name> —
 * stops resolving.
 */
const SECTOR_SIZE = 2048
const FIRST_DESCRIPTOR = 16
const MAX_DESCRIPTORS = 16
const PRIMARY = 1
const SUPPLEMENTARY = 2
const TERMINATOR = 255
const ID_START = 40
const ID_END = 72

export function readVolumeIds(path) {
  const fd = openSync(path, 'r')
  try {
    const size = fstatSync(fd).size
    const ids = []
    for (let index = 0; index < MAX_DESCRIPTORS; index += 1) {
      const offset = (FIRST_DESCRIPTOR + index) * SECTOR_SIZE
      if (offset + SECTOR_SIZE > size) break

      const sector = Buffer.alloc(SECTOR_SIZE)
      readSync(fd, sector, 0, SECTOR_SIZE, offset)
      if (sector.toString('latin1', 1, 6) !== 'CD001') break

      const type = sector[0]
      if (type === TERMINATOR) break
      const raw = sector.subarray(ID_START, ID_END)
      if (type === PRIMARY) ids.push({ descriptor: 'ISO9660', id: raw.toString('latin1').trimEnd() })
      else if (type === SUPPLEMENTARY) ids.push({ descriptor: 'Joliet', id: decodeUcs2(raw) })
    }
    return ids
  } finally {
    closeSync(fd)
  }
}

function decodeUcs2(raw) {
  const swapped = Buffer.from(raw)
  swapped.swap16()
  return swapped.toString('utf16le').replace(/\0+$/, '').trimEnd()
}

export function assertVolumeName(path, expected) {
  const ids = readVolumeIds(path)
  if (!ids.length) throw new Error(`${path}: не найдено ни одного дескриптора тома — это не образ ISO9660`)

  const wrong = ids.filter((entry) => entry.id !== expected)
  if (wrong.length) {
    const shown = wrong.map((entry) => `${entry.descriptor} «${entry.id}»`).join(', ')
    throw new Error(
      `имя тома разошлось с ожидаемым «${expected}»: ${shown}. Смонтируется под чужим именем, и фон окна пропадёт`,
    )
  }
  return ids
}
