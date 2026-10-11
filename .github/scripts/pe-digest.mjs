// Authenticode-отпечаток PE-файла (SHA-256): всё содержимое, кроме поля
// контрольной суммы, записи о таблице подписей и самой подписи. У exe до
// подписи и после неё он одинаковый — так видно, что подписан ровно тот файл,
// который собрал GitHub, и внутрь ничего не добавили.
// node pe-digest.mjs file.exe [file2.exe ...]
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

export function peDigest(buf) {
  if (buf.length < 0x40 || buf.readUInt16LE(0) !== 0x5a4d) throw new Error('не PE: нет MZ')
  const pe = buf.readUInt32LE(0x3c)
  if (buf.readUInt32LE(pe) !== 0x4550) throw new Error('не PE: нет подписи PE')
  const opt = pe + 24
  const magic = buf.readUInt16LE(opt)
  if (magic !== 0x10b && magic !== 0x20b) throw new Error('неизвестный опциональный заголовок')
  const checksum = opt + 64
  const secDir = opt + (magic === 0x20b ? 112 : 96) + 4 * 8
  const certOff = buf.readUInt32LE(secDir)
  const certLen = buf.readUInt32LE(secDir + 4)
  const end = certLen ? certOff : buf.length
  if (certLen && certOff + certLen > buf.length) throw new Error('таблица подписей за концом файла')
  const h = createHash('sha256')
  h.update(buf.subarray(0, checksum))
  h.update(buf.subarray(checksum + 4, secDir))
  h.update(buf.subarray(secDir + 8, end))
  if (end % 8) h.update(Buffer.alloc(8 - (end % 8)))
  return { digest: h.digest('hex'), signed: certLen > 0 }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  for (const file of process.argv.slice(2)) {
    const { digest, signed } = peDigest(readFileSync(file))
    console.log(`${digest}  ${file}${signed ? '  (подписан)' : ''}`)
  }
}
