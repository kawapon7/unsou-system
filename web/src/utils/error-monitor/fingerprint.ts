import { createHash } from 'node:crypto'
import type { Source } from './types'

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi
const NUM  = /\d+/g

/** 同一原因を同一指紋にまとめるための正規化。spec §5 */
export function normalizeMessage(message: string): string {
  return message.replace(UUID, '<uuid>').replace(NUM, '<n>').replace(/\s+/g, ' ').trim()
}

/** sha256(source|actionName|正規化message) の先頭16桁 */
export function fingerprint(source: Source, actionName: string, message: string): string {
  return createHash('sha256')
    .update(`${source}|${actionName}|${normalizeMessage(message)}`)
    .digest('hex')
    .slice(0, 16)
}
