/** Small text helpers for mapping and comparing OJS and PubPub metadata */

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
}

export const decodeEntities = (text: string) =>
  text.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (entity, code: string) =>
    code[0] === '#'
      ? String.fromCodePoint(
          code[1].toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : Number(code.slice(1)),
        )
      : (ENTITIES[code.toLowerCase()] ?? entity),
  )

/** Plain text of an HTML fragment, with whitespace collapsed */
export const stripHtml = (html: string) =>
  decodeEntities(html.replace(/<[^>]*>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim()

export const hasHtml = (text: string) => /<[a-z][^>]*>/i.test(text)

/**
 * One title from OJS's prefix, title and subtitle. OJS keeps the subtitle apart and its
 * `fullTitle` always adds ": ", which doubles the colon when an editor typed one into the title.
 */
export function joinTitle(prefix: string, title: string, subtitle: string) {
  let full = [prefix, title].filter(Boolean).join(' ').trim()
  if (subtitle) full = /[:?!.]$/.test(full) ? `${full} ${subtitle}` : `${full}: ${subtitle}`
  return full.trim()
}

/** For comparing titles: plain text, lower case, no punctuation or diacritics, single spaces */
export const comparable = (text: string) =>
  stripHtml(text)
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[‘’“”'"`´]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()

/** A URL slug from a title: the first words, at most `max` characters */
export function slugify(text: string, max = 60) {
  const slug = comparable(text)
    .replace(/[^a-z0-9 ]/g, '')
    .trim()
    .replace(/\s+/g, '-')
  if (slug.length <= max) return slug
  const cut = slug.slice(0, max + 1)
  return cut.slice(0, cut.lastIndexOf('-') > 20 ? cut.lastIndexOf('-') : max)
}

/** A DOI without resolver prefix, in lower case (DOIs are case-insensitive) */
export const normalizeDoi = (doi: string | null | undefined) =>
  (doi ?? '')
    .trim()
    .replace(/^(?:https?:\/\/)?(?:dx\.)?doi\.org\//i, '')
    .replace(/^doi:\s*/i, '')
    .toLowerCase()

/** An ORCID as the full URL `https://orcid.org/0000-0000-0000-0000`, or undefined if there is none */
export function normalizeOrcid(orcid: string | null | undefined) {
  const id = (orcid ?? '').trim().match(/(\d{4}-\d{4}-\d{4}-\d{3}[\dX])\s*$/i)?.[1]
  return id ? `https://orcid.org/${id.toUpperCase()}` : undefined
}

/** For comparing names: no diacritics, punctuation or case, single spaces */
export const comparableName = (name: string) => comparable(name.replace(/\./g, ' '))

/** For comparing affiliations: as names, without a leading "the" */
export const comparableAffiliation = (text: string) => comparable(text).replace(/^the /, '')

/** An OJS date ("2026-07-25 03:36:06" or "2026-07-25") as ISO 8601 in UTC */
export function isoDate(date: string | null | undefined): string | undefined {
  if (!date) return undefined
  const value = /^\d{4}-\d{2}-\d{2}$/.test(date)
    ? `${date}T00:00:00Z`
    : date.includes('T')
      ? date
      : `${date.replace(' ', 'T')}Z`
  const time = Date.parse(value)
  return Number.isNaN(time) ? undefined : new Date(time).toISOString()
}

/** The day of an ISO date or timestamp, `YYYY-MM-DD` */
export const day = (date: string | undefined) => date?.slice(0, 10)

const STOP = new Set(['a', 'an', 'and', 'the', 'of', 'in', 'on', 'for', 'to', 'with', 'is', 'it'])
const words = (text: string) =>
  new Set(
    comparable(text)
      .split(' ')
      .filter((w) => w && !STOP.has(w)),
  )

/** How alike two titles are: the share of their words they have in common, from 0 to 1 */
export function titleSimilarity(a: string, b: string) {
  const x = words(a)
  const y = words(b)
  if (!x.size || !y.size) return 0
  let common = 0
  for (const w of x) if (y.has(w)) common++
  return common / (x.size + y.size - common)
}
