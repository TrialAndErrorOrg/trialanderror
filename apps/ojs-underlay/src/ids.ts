import { createHash } from 'node:crypto'

/** RFC 4122 name-based UUID, version 5 (SHA-1) */
export function uuidv5(name: string, namespace: string): string {
  const ns = Buffer.from(namespace.replace(/-/g, ''), 'hex')
  if (ns.length !== 16) throw new TypeError(`Not a UUID: ${namespace}`)
  const bytes = createHash('sha1').update(ns).update(name, 'utf8').digest().subarray(0, 16)
  bytes[6] = (bytes[6] & 0x0f) | 0x50
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = bytes.toString('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

/** RFC 4122's namespace for names that are URLs */
const URL_NAMESPACE = '6ba7b811-9dad-11d1-80b4-00c04fd430c8'

/**
 * The namespace of every id this exporter makes: the journal's OJS address. Records made from
 * the same OJS object get the same id on every run, so a rerun updates instead of duplicating.
 * Never change it, or every record gets a new id.
 */
export const JOTE_OJS_NAMESPACE = uuidv5(
  'https://submit.trialanderror.org/index.php/jote',
  URL_NAMESPACE,
)

export type OjsObject = 'submission' | 'publication' | 'author' | 'issue' | 'section'

/** The record id for an OJS object, e.g. `ojsId('submission', 162)` for the Pub of submission 162 */
export const ojsId = (kind: OjsObject, id: number | string) =>
  uuidv5(`${kind}:${id}`, JOTE_OJS_NAMESPACE)
