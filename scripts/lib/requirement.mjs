/**
 * Compiled code requirements in the binary form `csreq -b` emits — the only
 * form rcodesign accepts, and csreq itself exists on macOS alone.
 */
const REQUIREMENT_MAGIC = 0xfade0c00
const EXPRESSION_FORM = 1
const OP_IDENT = 2
const HEADER_SIZE = 20
const WORD_SIZE = 4

/** The requirement `identifier "<identifier>"`. */
export function identifierRequirement(identifier) {
  if (typeof identifier !== 'string' || identifier.length === 0) {
    throw new Error('требование подписи строится по идентификатору приложения, а он пуст')
  }
  const text = Buffer.from(identifier, 'utf8')
  const padded = Buffer.alloc(Math.ceil(text.length / WORD_SIZE) * WORD_SIZE)
  text.copy(padded)

  const header = Buffer.alloc(HEADER_SIZE)
  header.writeUInt32BE(REQUIREMENT_MAGIC, 0)
  header.writeUInt32BE(HEADER_SIZE + padded.length, 4)
  header.writeUInt32BE(EXPRESSION_FORM, 8)
  header.writeUInt32BE(OP_IDENT, 12)
  header.writeUInt32BE(text.length, 16)
  return Buffer.concat([header, padded])
}
