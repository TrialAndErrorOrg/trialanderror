import { createHash } from 'node:crypto'

/*
 * Record and asset hashing as Underlay does it (https://www.underlay.org/llms.txt, "Record
 * Hashing"). The push diffs our hashes against the head's manifest, so these must match the
 * server's exactly, or every record looks changed on every push.
 */

/**
 * RFC 8785 JSON Canonicalization: object keys sorted by UTF-16 code units, everything else as
 * JSON.stringify writes it. Built as a string, since a JavaScript object lists integer-like keys
 * first whatever order they were added in. `undefined` members are left out, as JSON.stringify does.
 */
export function jcs(value: unknown): string {
  if (value === null) return 'null'
  switch (typeof value) {
    case 'string':
    case 'boolean':
      return JSON.stringify(value)
    case 'number':
      if (!Number.isFinite(value)) throw new TypeError('JCS: non-finite number')
      return JSON.stringify(value)
    case 'object': {
      if (Array.isArray(value)) return `[${value.map(jcs).join(',')}]`
      const object = value as Record<string, unknown>
      const parts: string[] = []
      for (const key of Object.keys(object).sort()) {
        if (object[key] === undefined) continue
        parts.push(`${JSON.stringify(key)}:${jcs(object[key])}`)
      }
      return `{${parts.join(',')}}`
    }
    default:
      throw new TypeError(`JCS: cannot serialize ${typeof value}`)
  }
}

export const sha256 = (input: string | Uint8Array) =>
  createHash('sha256').update(input).digest('hex')

/** A record's hash: SHA-256 of a fixed `{"id","type","data"}` envelope with `data` in JCS */
export const hashRecord = (record: { id: string; type: string; data: unknown }) =>
  sha256(
    `{"id":${JSON.stringify(record.id)},"type":${JSON.stringify(record.type)},"data":${jcs(record.data)}}`,
  )

/** A schema's hash: SHA-256 of its JCS form */
export const hashSchema = (schema: unknown) => sha256(jcs(schema))

/** Bare hex from an Underlay id (`ul:asset:<hex>`, `ul:rec:<hex>`) or a `sha256:<hex>` */
export const bareHash = (hash: string) => hash.replace(/^(?:ul:[a-z]+:|sha256:)/, '')
