import { afterEach, describe, expect, it, vi } from 'vitest'
import { UnderlayWriter } from './client.ts'
import { hashRecord, sha256 } from './hash.ts'

/** A fake Underlay that records what the client sends, for one collection */
function fakeUnderlay(state: {
  exists: boolean
  public?: boolean
  head?: { semver: string; appId: string; records: { id: string; type: string; data: unknown }[] }
}) {
  const calls: { method: string; path: string; body?: string }[] = []
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
  const fetch = vi.fn<(input: string | URL, init?: RequestInit) => Promise<Response>>(
    async (input, init = {}) => {
      const url = new URL(String(input))
      const path = url.pathname.replace('/api/collections/org/scratch', '')
      const method = init.method ?? 'GET'
      calls.push({ method, path, body: typeof init.body === 'string' ? init.body : undefined })
      if (method === 'GET' && path === '') {
        return state.exists
          ? json({ public: state.public ?? false })
          : json({ error: 'Not found' }, 404)
      }
      if (method === 'POST' && url.pathname === '/api/accounts/org/collections')
        return json({ slug: 'scratch' }, 201)
      if (path === '/versions/latest') {
        return state.head
          ? json({ semver: state.head.semver, appId: state.head.appId })
          : json({}, 404)
      }
      if (path.endsWith('/manifest')) {
        return json({
          schemas: {},
          records: state.head!.records.map((r) => ({
            id: r.id,
            type: r.type,
            hash: `ul:rec:${hashRecord(r)}`,
          })),
          pagination: { hasMore: false },
        })
      }
      if (path === '/schemas') return json({ schemas: [] })
      if (method === 'POST' && path === '/push')
        return json({ session_id: 's1', needed_assets: [sha256('pdf')], limits: {} })
      if (method === 'PUT' && path.startsWith('/assets/')) return json({ status: 'stored' }, 201)
      if (path.startsWith('/push/s1/records') || path.startsWith('/push/s1/deletes'))
        return json({ received: 1 })
      if (path === '/push/s1/commit') return json({ session_id: 's1', status: 'committing' }, 202)
      if (method === 'GET' && path === '/push/s1') {
        return json({
          status: 'committed',
          result: { semver: 'v1.0.0', hash: 'ul:ver:x', recordCount: 2 },
        })
      }
      return json({ error: `unexpected ${method} ${path}` }, 500)
    },
  )
  vi.stubGlobal('fetch', fetch)
  return calls
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

const pdf = new TextEncoder().encode('pdf')
const records = [
  { id: 'p1', type: 'Pub', data: { title: 'One' } },
  { id: 'p2', type: 'Pub', data: { title: 'Two' } },
]
const options = {
  records,
  schemas: { Pub: { type: 'object', properties: { title: { type: 'string' } } } },
  files: [{ hash: sha256(pdf), bytes: pdf, mediaType: 'application/pdf', fileName: 'one.pdf' }],
  message: 'test',
}

describe('UnderlayWriter', () => {
  it('refuses the site’s collections whatever the owner', () => {
    expect(() => new UnderlayWriter('https://www.underlay.org', 'key', 'anyone/jote')).toThrow(
      'live collections',
    )
    expect(
      () => new UnderlayWriter('https://www.underlay.org', 'key', 'centeroftrialanderror/jrn'),
    ).toThrow('live collections')
  })

  it('creates a missing collection private, uploads what is needed and commits', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true, advanceTimeDelta: 1000 })
    const calls = fakeUnderlay({ exists: false })
    const result = await new UnderlayWriter('https://underlay.org', 'key', 'org/scratch').push(
      options,
    )
    expect(result).toMatchObject({ status: 'committed', semver: 'v1.0.0' })

    const create = calls.find(
      (c) => c.method === 'POST' && c.path === '/api/accounts/org/collections',
    )
    expect(JSON.parse(create!.body!)).toMatchObject({ slug: 'scratch', public: false })
    const open = JSON.parse(calls.find((c) => c.path === '/push')!.body!)
    expect(open).toMatchObject({
      base: null,
      app_id: 'ojs-underlay',
      assets: { add: [sha256(pdf)] },
    })
    expect(calls.some((c) => c.method === 'PUT' && c.path === `/assets/${sha256(pdf)}`)).toBe(true)
    const lines = calls
      .find((c) => c.path === '/push/s1/records')!
      .body!.trim()
      .split('\n')
    expect(lines.map((l) => JSON.parse(l).id)).toEqual(['p1', 'p2'])
  })

  it('sends only changed records, and deletes only with prune', async () => {
    fakeUnderlay({
      exists: true,
      head: {
        semver: 'v1.0.0',
        appId: 'ojs-underlay',
        records: [records[0], { id: 'gone', type: 'Pub', data: { title: 'Gone' } }],
      },
    })
    const writer = new UnderlayWriter('https://www.underlay.org', 'key', 'org/scratch')
    const plan = await writer.plan(options)
    expect(plan.upserts.map((r) => r.id)).toEqual(['p2'])
    expect(plan.deletes).toEqual([])
    expect((await writer.plan({ ...options, prune: true })).deletes).toEqual([
      { type: 'Pub', id: 'gone' },
    ])
  })

  it('refuses a collection another app pushed to, and a public one', async () => {
    fakeUnderlay({ exists: true, head: { semver: 'v3.0.0', appId: 'pubpub', records: [] } })
    await expect(
      new UnderlayWriter('https://www.underlay.org', 'key', 'org/scratch').push(options),
    ).rejects.toThrow('pushed by "pubpub"')
    fakeUnderlay({ exists: true, public: true })
    await expect(
      new UnderlayWriter('https://www.underlay.org', 'key', 'org/scratch').push(options),
    ).rejects.toThrow('is public')
  })
})
