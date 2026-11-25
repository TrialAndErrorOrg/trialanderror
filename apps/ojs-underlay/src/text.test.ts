import { describe, expect, it } from 'vitest'
import { uuidv5, ojsId } from './ids.ts'
import {
  isoDate,
  joinTitle,
  normalizeDoi,
  normalizeOrcid,
  slugify,
  titleSimilarity,
} from './text.ts'

describe('uuidv5', () => {
  it('gives the RFC 4122 result for a known name', () => {
    // www.example.com in the DNS namespace
    expect(uuidv5('www.example.com', '6ba7b810-9dad-11d1-80b4-00c04fd430c8')).toBe(
      '2ed6657d-e927-568b-95e1-2665a8aea6a2',
    )
  })

  it('gives every OJS object a stable id of its own', () => {
    expect(ojsId('submission', 162)).toBe(ojsId('submission', 162))
    expect(ojsId('submission', 162)).not.toBe(ojsId('publication', 162))
    expect(ojsId('submission', 162)).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    )
  })
})

describe('joinTitle', () => {
  it('adds a colon before the subtitle, unless the title ends in one', () => {
    expect(joinTitle('', 'Persuasion in Articles', 'Authors and Readers')).toBe(
      'Persuasion in Articles: Authors and Readers',
    )
    expect(joinTitle('', 'Persuasion in Articles:', 'Authors and Readers')).toBe(
      'Persuasion in Articles: Authors and Readers',
    )
    expect(joinTitle('The', 'Title', '')).toBe('The Title')
  })
})

describe('normalizers', () => {
  it('writes ORCIDs as the full URL', () => {
    expect(normalizeOrcid('0000-0002-9274-5477')).toBe('https://orcid.org/0000-0002-9274-5477')
    expect(normalizeOrcid('http://orcid.org/0000-0002-9274-547x')).toBe(
      'https://orcid.org/0000-0002-9274-547X',
    )
    expect(normalizeOrcid('')).toBeUndefined()
    expect(normalizeOrcid('none')).toBeUndefined()
  })

  it('writes DOIs bare and in lower case', () => {
    expect(normalizeDoi('https://doi.org/10.36850/I4.2')).toBe('10.36850/i4.2')
    expect(normalizeDoi('doi: 10.36850/e1')).toBe('10.36850/e1')
    expect(normalizeDoi(null)).toBe('')
  })

  it('reads OJS dates as UTC', () => {
    expect(isoDate('2026-07-25 03:36:06')).toBe('2026-07-25T03:36:06.000Z')
    expect(isoDate('2026-07-25')).toBe('2026-07-25T00:00:00.000Z')
    expect(isoDate(null)).toBeUndefined()
  })
})

describe('slugify', () => {
  it('keeps letters and digits, drops diacritics and cuts at a word', () => {
    expect(slugify('Prenatal Sildenafil & Fetal–Placental “Programming”')).toBe(
      'prenatal-sildenafil-fetal-placental-programming',
    )
    expect(slugify('Ça ne marche pas')).toBe('ca-ne-marche-pas')
    expect(slugify('word '.repeat(30)).length).toBeLessThanOrEqual(60)
  })
})

describe('titleSimilarity', () => {
  it('scores the same title in other case and spelling high, another article low', () => {
    expect(
      titleSimilarity(
        'The GLORIA adherence subproject: problems and randomization mistakes',
        'The Gloria Adherence Subproject: Problems and Randomization Mistakes',
      ),
    ).toBe(1)
    expect(
      titleSimilarity(
        'Rewilding cognition: Complex dynamics in open experimental systems',
        'The Complexity of Joint Regeneration',
      ),
    ).toBeLessThan(0.3)
  })
})
