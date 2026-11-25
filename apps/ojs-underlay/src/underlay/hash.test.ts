import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { bareHash, hashRecord, jcs } from './hash.ts'

describe('jcs', () => {
  it('sorts keys, integer-like ones included, and drops undefined', () => {
    expect(jcs({ b: 1, a: [true, null, 'x'], 10: 'ten', 9: 'nine', u: undefined })).toBe(
      '{"10":"ten","9":"nine","a":[true,null,"x"],"b":1}',
    )
  })

  it('refuses numbers JSON cannot hold', () => {
    expect(() => jcs({ n: Number.NaN })).toThrow('non-finite')
  })
})

describe('hashRecord', () => {
  it('hashes the fixed envelope with data canonicalized, as in the Underlay docs', () => {
    const canonical = '{"id":"article-1","type":"Article","data":{"body":"World","title":"Hello"}}'
    const expected = createHash('sha256').update(canonical).digest('hex')
    expect(
      hashRecord({ id: 'article-1', type: 'Article', data: { title: 'Hello', body: 'World' } }),
    ).toBe(expected)
  })

  it('matches the hash Underlay gives a record of the jote collection', () => {
    // A PubEdge of centeroftrialanderror/jote v2.2.0, with the hash Underlay serves for it
    const record = {
      id: '07d5a68a-90fb-440c-a4b4-3301bf508d4b',
      type: 'PubEdge',
      data: {
        targetPubId: '154c0d0e-2a79-4c38-ae0f-9d14b206cb6d',
        relationType: 'review',
        pubIsParent: false,
        sourcePubId: '5ad3065b-5962-4e1f-a685-d7b303f50898',
      },
    }
    expect(hashRecord(record)).toBe(
      '2af47929ed4b262ed4ae98683ae2c9ddc48f6841be62d69cd364aa49e9bb6f65',
    )
  })
})

describe('bareHash', () => {
  it('strips Underlay and sha256 prefixes', () => {
    expect(bareHash('ul:asset:abc')).toBe('abc')
    expect(bareHash('ul:rec:abc')).toBe('abc')
    expect(bareHash('sha256:abc')).toBe('abc')
    expect(bareHash('abc')).toBe('abc')
  })
})
