import { randomBytes } from 'node:crypto'

/** PRIVATE. A UUIDv7 (RFC 9562) at the given time: documents and events sort by creation. */
export function uuidv7(at: Date): string {
  const bytes = randomBytes(16)
  const time = BigInt(Math.max(0, at.getTime()))
  for (let index = 0; index < 6; index++) bytes[index] = Number((time >> BigInt(8 * (5 - index))) & 0xFFn)
  bytes[6] = (bytes[6]! & 0x0F) | 0x70
  bytes[8] = (bytes[8]! & 0x3F) | 0x80
  const hex = bytes.toString('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}
