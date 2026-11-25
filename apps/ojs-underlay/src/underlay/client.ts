import type { UnderlayRecord } from '../pubpub.ts'
import { bareHash, hashRecord, hashSchema } from './hash.ts'
import type { JsonSchema } from './schemas.ts'

/*
 * Reading collections from Underlay, and pushing a version with the delta protocol
 * (https://www.underlay.org/llms.txt, "Writing Data: The Push Flow"). Modelled on PubPub's
 * exporter (`kf/pubpub` `server/underlay/client.ts`), without its caching and resumption.
 */

/** Identifies this exporter in the versions it pushes, and marks collections it may push to */
export const APP_ID = 'ojs-underlay'

/**
 * Collections this tool never writes to, whatever it is told: the journals' and the blog's live
 * collections, which the site reads and PubPub (or Strapi) writes.
 */
export const PROTECTED_COLLECTIONS = new Set(['jote', 'jrn', 'blog'])

export interface UnderlayFile {
  /** Bare SHA-256 hex of the bytes */
  hash: string
  bytes: Uint8Array
  mediaType: string
  fileName?: string
}

export interface PushRecord {
  id: string
  type: string
  data: Record<string, unknown>
}

export type PushResult =
  | { status: 'noop'; reason: string }
  | {
      status: 'committed'
      semver: string
      hash: string
      recordCount: number
      assetCount?: number
      changes?: { added: number; updated: number; removed: number }
    }

export class UnderlayError extends Error {
  readonly status?: number
  readonly detail?: unknown
  constructor(message: string, status?: number, detail?: unknown) {
    super(detail ? `${message}: ${JSON.stringify(detail).slice(0, 500)}` : message)
    this.name = 'UnderlayError'
    this.status = status
    this.detail = detail
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

export class UnderlayReader {
  readonly api: string
  protected readonly token?: string

  constructor(url: string, token?: string) {
    // The apex domain redirects to www, and fetch drops the Authorization header on that redirect
    this.api = `${url.replace(/\/$/, '').replace('://underlay.org', '://www.underlay.org')}/api`
    this.token = token
  }

  /** fetch with the token, waiting and trying again on 429 and 5xx */
  protected async request(path: string, init: RequestInit = {}, auth = true): Promise<Response> {
    const url = path.startsWith('http') ? path : `${this.api}${path}`
    for (let attempt = 0; ; attempt++) {
      const headers = new Headers(init.headers)
      if (auth && this.token) headers.set('Authorization', `Bearer ${this.token}`)
      const response = await fetch(url, { ...init, headers })
      if ((response.status === 429 || response.status >= 500) && attempt < 5) {
        const retryAfter = Number(response.headers.get('retry-after'))
        await sleep(retryAfter > 0 ? retryAfter * 1000 : Math.min(30_000, 1000 * 2 ** attempt))
        continue
      }
      return response
    }
  }

  protected async json<T>(response: Response, what: string): Promise<T> {
    const text = await response.text()
    let body: unknown
    try {
      body = JSON.parse(text)
    } catch {
      body = text.slice(0, 300)
    }
    if (!response.ok)
      throw new UnderlayError(`${what} failed (HTTP ${response.status})`, response.status, body)
    return body as T
  }

  collectionPath(owner: string, slug: string) {
    return `/collections/${encodeURIComponent(owner)}/${encodeURIComponent(slug)}`
  }

  /** Every record of a version, from the bulk ndjson stream */
  async records(owner: string, slug: string, version = 'latest'): Promise<UnderlayRecord[]> {
    const response = await this.request(
      `${this.collectionPath(owner, slug)}/versions/${version}/records.ndjson`,
    )
    if (!response.ok) throw new UnderlayError(`Reading ${owner}/${slug}`, response.status)
    const records = (await response.text())
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line) as UnderlayRecord)
    const expected = Number(response.headers.get('x-underlay-record-count'))
    if (expected && records.length !== expected) {
      throw new UnderlayError(
        `The stream of ${owner}/${slug} was cut off at ${records.length} of ${expected} records`,
      )
    }
    return records
  }
}

interface Head {
  semver: string
  appId?: string
  /** type → schema hash */
  schemaHashes: Record<string, string>
  /** `type\0id` → record hash */
  records: Map<string, string>
}

const key = (type: string, id: string) => `${type}\u0000${id}`

export interface PushOptions {
  records: PushRecord[]
  schemas: Record<string, JsonSchema>
  files: UnderlayFile[]
  message: string
  /** Delete records of the pushed types that the head has and this push doesn't */
  prune?: boolean
  /** Push to a public collection. Off by default: a scratch collection is created private */
  allowPublic?: boolean
  log?: (line: string) => void
}

/** Pushes to one collection, which must be a scratch collection this tool owns */
export class UnderlayWriter extends UnderlayReader {
  readonly owner: string
  readonly slug: string

  constructor(url: string, token: string, target: string) {
    super(url, token)
    const [owner, slug, ...rest] = target.split('/')
    if (!owner || !slug || rest.length)
      throw new UnderlayError(`Push target must be owner/slug, got "${target}"`)
    if (PROTECTED_COLLECTIONS.has(slug)) {
      throw new UnderlayError(
        `Refusing to push to ${target}: it is one of the site's live collections`,
      )
    }
    this.owner = owner
    this.slug = slug
  }

  private get path() {
    return this.collectionPath(this.owner, this.slug)
  }

  /**
   * Make sure the collection exists, creating it private if it doesn't, and that it is ours to
   * write: a collection whose latest version another app pushed is refused, and so is a public
   * one unless `allowPublic`.
   */
  async prepare({ allowPublic = false } = {}): Promise<{ created: boolean }> {
    const response = await this.request(this.path)
    if (response.status === 404) {
      const create = await this.request(`/accounts/${encodeURIComponent(this.owner)}/collections`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          slug: this.slug,
          name: this.slug,
          description:
            'Test export of JOTE articles from OJS (ojs-underlay). Not for use by the site.',
          public: false,
        }),
      })
      await this.json(create, `Creating ${this.owner}/${this.slug}`)
      return { created: true }
    }
    const collection = await this.json<{ public?: boolean; visibility?: string }>(
      response,
      'Reading the collection',
    )
    const isPublic = collection.public ?? collection.visibility === 'public'
    if (isPublic && !allowPublic) {
      throw new UnderlayError(
        `${this.owner}/${this.slug} is public; pass allowPublic to push to it anyway`,
      )
    }
    const head = await this.latest()
    if (head && head.appId !== APP_ID) {
      throw new UnderlayError(
        `Refusing to push to ${this.owner}/${this.slug}: its latest version was pushed by "${head.appId ?? 'unknown'}", not ${APP_ID}`,
      )
    }
    return { created: false }
  }

  private async latest(): Promise<{ semver: string; appId?: string } | null> {
    const response = await this.request(`${this.path}/versions/latest`)
    if (response.status === 404) return null
    return this.json(response, 'Reading the latest version')
  }

  private async readHead(): Promise<Head | null> {
    const latest = await this.latest()
    if (!latest) return null
    const head: Head = {
      semver: latest.semver,
      appId: latest.appId,
      schemaHashes: {},
      records: new Map(),
    }
    let cursor: string | null = null
    do {
      const params = new URLSearchParams({ limit: '25000' })
      if (cursor) params.set('cursor', cursor)
      const page: {
        schemas?: Record<string, string>
        records?: { id: string; type: string; hash: string }[]
        pagination?: { hasMore?: boolean; nextCursor?: string | null }
      } = await this.json(
        await this.request(
          `${this.path}/versions/${encodeURIComponent(latest.semver)}/manifest?${params}`,
        ),
        'Reading the manifest',
      )
      for (const [type, hash] of Object.entries(page.schemas ?? {}))
        head.schemaHashes[type] = bareHash(hash)
      for (const r of page.records ?? []) head.records.set(key(r.type, r.id), bareHash(r.hash))
      cursor = page.pagination?.hasMore ? (page.pagination.nextCursor ?? null) : null
    } while (cursor)
    return head
  }

  /** The head's schemas, so a push keeps the types it doesn't write */
  private async headSchemas(): Promise<Record<string, JsonSchema>> {
    const response = await this.request(`${this.path}/schemas`)
    if (response.status === 404) return {}
    const body = await this.json<{ schemas?: { slug: string; schema: JsonSchema }[] }>(
      response,
      'Reading the schemas',
    )
    return Object.fromEntries((body.schemas ?? []).map((s) => [s.slug, s.schema]))
  }

  private async putAsset(file: UnderlayFile) {
    const response = await this.request(`${this.path}/assets/${file.hash}`, {
      method: 'PUT',
      headers: { 'Content-Type': file.mediaType || 'application/octet-stream' },
      body: file.bytes as Uint8Array<ArrayBuffer>,
    })
    await this.json(response, `Uploading asset ${file.hash} (${file.fileName ?? ''})`)
  }

  private async sendLines(
    sessionId: string,
    kind: 'records' | 'deletes',
    lines: string[],
    limits: Limits,
  ) {
    const maxLines = limits.batch_lines ?? 10_000
    const maxBytes = limits.batch_bytes ?? 8 * 1024 * 1024
    let batch: string[] = []
    let bytes = 0
    const flush = async () => {
      if (!batch.length) return
      const response = await this.request(`${this.path}/push/${sessionId}/${kind}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-ndjson' },
        body: `${batch.join('\n')}\n`,
      })
      await this.json(response, `Uploading ${kind}`)
      batch = []
      bytes = 0
    }
    for (const line of lines) {
      const size = Buffer.byteLength(line) + 1
      if (batch.length && (batch.length >= maxLines || bytes + size > maxBytes)) await flush()
      batch.push(line)
      bytes += size
    }
    await flush()
  }

  /** Commit, in the background, and wait for the result. Uploads assets the server says it lacks */
  private async commit(sessionId: string, files: Map<string, UnderlayFile>): Promise<PushResult> {
    for (let attempt = 0; attempt < 3; attempt++) {
      const response = await this.request(`${this.path}/push/${sessionId}/commit?async=true`, {
        method: 'POST',
      })
      let outcome: { result?: any; error?: any }
      if (response.status === 202) outcome = await this.poll(sessionId)
      else if (response.ok) outcome = { result: await response.json() }
      else
        outcome = {
          error: await response.json().catch(() => ({ error: `HTTP ${response.status}` })),
        }

      if (outcome.result) return { status: 'committed', ...outcome.result }
      const error = outcome.error ?? {}
      if (error.error === 'No changes detected')
        return { status: 'noop', reason: 'Underlay found no changes' }
      const needed: string[] = error.assetsNeeded ?? []
      if (!needed.length)
        throw new UnderlayError('Commit failed', error.statusCode ?? response.status, error)
      for (const hash of needed) {
        const file = files.get(bareHash(hash))
        if (!file)
          throw new UnderlayError(`Underlay needs asset ${hash}, which this push doesn't have`)
        await this.putAsset(file)
      }
    }
    throw new UnderlayError('Commit kept asking for assets')
  }

  private async poll(sessionId: string): Promise<{ result?: any; error?: any }> {
    const deadline = Date.now() + 30 * 60 * 1000
    for (let delay = 2000; Date.now() < deadline; delay = Math.min(15_000, delay * 1.5)) {
      await sleep(delay)
      const response = await this.request(`${this.path}/push/${sessionId}`)
      if (!response.ok) continue
      const session = (await response.json()) as {
        status: string
        result?: unknown
        error?: unknown
      }
      if (session.status === 'committed') return { result: session.result }
      if (session.status === 'failed' || session.status === 'expired')
        return { error: session.error ?? { error: session.status } }
      if (session.status === 'open' && session.error) return { error: session.error }
    }
    throw new UnderlayError(
      'The commit did not finish within 30 minutes; check the collection before pushing again',
    )
  }

  /**
   * What a push of `records` would send: upserts for what the head lacks or holds with another
   * hash, deletes (with `prune`) for what the head has and `records` doesn't. The schemas are the
   * head's with ours laid over them, so no type is dropped. Reads only.
   */
  async plan(options: Pick<PushOptions, 'records' | 'schemas' | 'prune'>): Promise<PushPlan> {
    const head = await this.readHead()
    const schemas = { ...(head ? await this.headSchemas() : {}), ...options.schemas }
    const ours = new Set<string>()
    const upserts: PushRecord[] = []
    for (const record of options.records) {
      ours.add(key(record.type, record.id))
      if (head?.records.get(key(record.type, record.id)) !== hashRecord(record))
        upserts.push(record)
    }
    const deletes: { type: string; id: string }[] = []
    if (options.prune && head) {
      for (const k of head.records.keys()) {
        const [type, id] = k.split('\u0000')
        if (!ours.has(k) && type in options.schemas) deletes.push({ type, id })
      }
    }
    const schemasChanged =
      !head ||
      Object.keys(schemas).length !== Object.keys(head.schemaHashes).length ||
      Object.entries(schemas).some(
        ([type, schema]) => head.schemaHashes[type] !== hashSchema(schema),
      )
    return {
      base: head?.semver ?? null,
      appId: head?.appId,
      schemas,
      upserts,
      deletes,
      schemasChanged,
    }
  }

  /** Push `records` as the collection's next version (see `plan`) */
  async push(options: PushOptions): Promise<PushResult> {
    const log = options.log ?? (() => {})
    const { created } = await this.prepare({ allowPublic: options.allowPublic })
    if (created) log(`Created ${this.owner}/${this.slug} (private)`)

    const { base, schemas, upserts, deletes, schemasChanged } = await this.plan(options)
    log(
      `Against ${base ?? 'an empty collection'}: ${upserts.length} upserts, ${deletes.length} deletes${schemasChanged ? ', schemas changed' : ''}`,
    )
    if (base && !upserts.length && !deletes.length && !schemasChanged) {
      return { status: 'noop', reason: `${base} already matches` }
    }

    const files = new Map(options.files.map((f) => [f.hash, f]))
    const open = await this.request(`${this.path}/push`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        base,
        message: options.message,
        app_id: APP_ID,
        actor_id: `${APP_ID}:cli`,
        schemas,
        assets: { add: [...files.keys()] },
      }),
    })
    const session = await this.json<{
      session_id: string
      needed_assets?: string[]
      limits?: Limits
    }>(open, 'Opening a push session')
    try {
      const needed = (session.needed_assets ?? []).map(bareHash)
      log(`Uploading ${needed.length} of ${files.size} assets`)
      for (const hash of needed) {
        const file = files.get(hash)
        if (file) await this.putAsset(file)
      }
      await this.sendLines(
        session.session_id,
        'records',
        upserts.map((r) => JSON.stringify({ id: r.id, type: r.type, data: r.data })),
        session.limits ?? {},
      )
      await this.sendLines(
        session.session_id,
        'deletes',
        deletes.map((d) => JSON.stringify(d)),
        session.limits ?? {},
      )
      return await this.commit(session.session_id, files)
    } catch (error) {
      await this.request(`${this.path}/push/${session.session_id}`, { method: 'DELETE' }).catch(
        () => {},
      )
      throw error
    }
  }
}

export interface PushPlan {
  /** The head's semver, or null for an empty collection */
  base: string | null
  /** The app that pushed the head */
  appId?: string
  schemas: Record<string, JsonSchema>
  upserts: PushRecord[]
  deletes: { type: string; id: string }[]
  schemasChanged: boolean
}

interface Limits {
  batch_lines?: number
  batch_bytes?: number
}
