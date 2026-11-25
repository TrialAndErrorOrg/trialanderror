import type { OjsExport, OjsIssue, OjsPublication, OjsSection } from './ojs.ts'
import { text } from './ojs.ts'
import type { PubPubIndex, UnderlayRecord } from './pubpub.ts'
import { comparable, joinTitle, normalizeDoi, titleSimilarity } from './text.ts'

/*
 * Which PubPub record each OJS article, issue and section already is. A matched article keeps
 * its PubPub id and slug, so its address and links stay the same; the same goes for issues and
 * type tags.
 */

/**
 * The article type (PubPub tag, `kinds` in the site's journal.ts) each OJS section stands for.
 * `null`: the section says nothing about the type. A section not listed here becomes a type of
 * its own, under its OJS title.
 */
export const SECTION_KINDS: Record<string, string | null> = {
  'Empirical Articles': 'Empirical',
  // Inactive since 2022; its one article is empirical
  'Research Articles': 'Empirical',
  'Reflection Articles': 'Reflection',
  'Meta-research Articles': 'Meta-Research',
  'Grant Applications': 'Rejected Grant Application',
  Editorials: 'Editorial',
  Anecdotes: 'Anecdotes',
  // A catch-all: on PubPub its articles are Meta-Research, Empirical, Editorial and more
  'Other (Special Issue, Unique Contribution, etc.)': null,
}

/** The site's article types (`kinds` in apps/site/src/lib/sources/journal.ts) */
export const KINDS = [
  'Empirical',
  'Meta-Research',
  'Reflection',
  'Perspective',
  'Commentary',
  'Anecdotes',
  'Rejected Grant Application',
  'Peer Reviews',
  'Editorial',
  'Corrigenda & Errata',
]

/** PubPub tags the site shows as an issue */
export const ISSUE_TAGS = ['Rolling Articles']

export const sectionKind = (section: OjsSection | undefined) => {
  if (!section) return undefined
  const title = text(section.title)
  return title in SECTION_KINDS ? (SECTION_KINDS[title] ?? undefined) : title
}

/** The DOI of an OJS publication, from OJS 3.4+'s `doiObject` or 3.3's `pub-id::doi` */
export const publicationDoi = (p: OjsPublication) =>
  normalizeDoi(p.doiObject?.doi ?? p['pub-id::doi']) || undefined

export interface IssueMatch {
  record: UnderlayRecord
  by: 'title' | 'volume and number' | 'articles'
}

export interface Matches {
  /** OJS submission id → the PubPub pub it is */
  pubs: Map<number, UnderlayRecord>
  /**
   * How each was matched: by DOI, or by title when OJS's DOI belongs to a different article on
   * PubPub (the titles share almost no words) and another pub has the same title
   */
  pubBy: Map<number, 'doi' | 'title'>
  /** OJS submissions without a DOI match, but with a PubPub pub of the same title */
  byTitleOnly: Map<number, UnderlayRecord>
  /** OJS issue id → PubPub issue collection (or the Rolling Articles tag) */
  issues: Map<number, IssueMatch>
  /** Article type → PubPub tag collection */
  kinds: Map<string, UnderlayRecord>
}

/** The PubPub type tags of a pub */
export const pubKind = (pubpub: PubPubIndex, pubId: string) =>
  KINDS.find((kind) => pubpub.collectionsOf(pubId).some((c) => c.data.title === kind))

/** The PubPub issues (and issue-like tags) a pub is in */
export const pubIssues = (pubpub: PubPubIndex, pubId: string) =>
  pubpub
    .collectionsOf(pubId)
    .filter((c) => c.data.kind === 'issue' || ISSUE_TAGS.includes(c.data.title))

/** Volume and issue number of a PubPub issue, from its metadata or else its title */
function volumeAndNumber(record: UnderlayRecord) {
  const meta = record.data.metadata ?? {}
  const title: string = record.data.title ?? ''
  return {
    volume: String(meta.volume ?? title.match(/\bVol(?:ume|\.)\s*(\d+)/i)?.[1] ?? ''),
    number: String(meta.issue ?? title.match(/\bIssue\s*(\d+)/i)?.[1] ?? ''),
  }
}

/** An issue title without the words every issue has, for matching on what's left */
const distinctive = (title: string) =>
  comparable(title)
    .replace(/^journal of trial and error\s*/, '')
    .replace(/^special issue\s*/, '')
    .trim()

const generic = (title: string) => /^(?:volume \d+\s*)?(?:issue \d+)?$/.test(title)

function matchIssue(
  issue: OjsIssue,
  candidates: UnderlayRecord[],
  votes: Map<string, number>,
  articleCount: number,
): IssueMatch | undefined {
  const title = distinctive(text(issue.title))
  if (title) {
    const same = candidates.find((c) => distinctive(c.data.title ?? '') === title)
    if (same) return { record: same, by: 'title' }
    if (!generic(title)) {
      const contains = candidates.find((c) => {
        const other = distinctive(c.data.title ?? '')
        return other && !generic(other) && (other.includes(title) || title.includes(other))
      })
      if (contains) return { record: contains, by: 'title' }
    }
  }
  if (issue.volume != null && issue.number) {
    const same = candidates.find((c) => {
      const { volume, number } = volumeAndNumber(c)
      return volume === String(issue.volume) && number === String(issue.number)
    })
    if (same) return { record: same, by: 'volume and number' }
  }
  const [best, count] = [...votes.entries()].sort((a, b) => b[1] - a[1])[0] ?? []
  if (best && count > articleCount / 2) {
    const record = candidates.find((c) => c.id === best)
    if (record) return { record, by: 'articles' }
  }
  return undefined
}

/** Below this, a DOI match's titles disagree enough to doubt the DOI */
const TITLE_CONFLICT = 0.3
/** At or above this, two titles are the same article's */
const SAME_TITLE = 0.8

function bestByTitle(title: string, pubs: UnderlayRecord[]): [UnderlayRecord | undefined, number] {
  let best: UnderlayRecord | undefined
  let score = 0
  for (const pub of pubs) {
    const similarity = titleSimilarity(title, pub.data.title ?? '')
    if (similarity > score) [best, score] = [pub, similarity]
  }
  return [best, score]
}

export function match(ojs: OjsExport, pubpub: PubPubIndex | undefined): Matches {
  const matches: Matches = {
    pubs: new Map(),
    pubBy: new Map(),
    byTitleOnly: new Map(),
    issues: new Map(),
    kinds: new Map(),
  }
  if (!pubpub) return matches

  const articles = [...pubpub.pubs.values()].filter(
    (p) => (p.data.kind ?? 'JournalArticle') === 'JournalArticle',
  )
  const titleOf = (publications: OjsPublication[]) => {
    const current = publications.at(-1)
    return current
      ? joinTitle(text(current.prefix), text(current.title), text(current.subtitle))
      : ''
  }

  // First the DOI. A DOI whose PubPub pub has a title with almost no words in common, while
  // another pub has nearly the same title, was given to the wrong submission in OJS: those are
  // matched by title instead, and the report lists the DOI as a difference.
  const claims: {
    submission: number
    record: UnderlayRecord
    by: 'doi' | 'title'
    similarity: number
  }[] = []
  for (const { submission, publications } of ojs.submissions) {
    const title = titleOf(publications)
    const doi = publications.map(publicationDoi).find((d) => d && pubpub.byDoi.has(d))
    const byDoi = doi ? pubpub.byDoi.get(doi) : undefined
    const doiSimilarity = byDoi ? titleSimilarity(title, byDoi.data.title ?? '') : 0
    if (byDoi && doiSimilarity >= TITLE_CONFLICT) {
      claims.push({
        submission: submission.id,
        record: byDoi,
        by: 'doi',
        similarity: doiSimilarity,
      })
      continue
    }
    const [best, similarity] = bestByTitle(title, articles)
    if (best && similarity >= SAME_TITLE && best.id !== byDoi?.id) {
      claims.push({ submission: submission.id, record: best, by: 'title', similarity })
    } else if (byDoi) {
      claims.push({
        submission: submission.id,
        record: byDoi,
        by: 'doi',
        similarity: doiSimilarity,
      })
    }
  }
  // One OJS submission per pub: the most alike title wins
  const winner = new Map<string, (typeof claims)[number]>()
  for (const claim of claims) {
    const other = winner.get(claim.record.id)
    if (!other || claim.similarity > other.similarity) winner.set(claim.record.id, claim)
  }
  for (const claim of winner.values()) {
    matches.pubs.set(claim.submission, claim.record)
    matches.pubBy.set(claim.submission, claim.by)
  }

  // A title match without a DOI to back it is only reported, never used
  const matched = new Set([...matches.pubs.values()].map((p) => p.id))
  for (const { submission, publications } of ojs.submissions) {
    if (matches.pubs.has(submission.id)) continue
    const [best, similarity] = bestByTitle(
      titleOf(publications),
      articles.filter((p) => !matched.has(p.id)),
    )
    if (best && similarity >= 0.5) matches.byTitleOnly.set(submission.id, best)
  }

  const candidates = [...pubpub.collections.values()].filter(
    (c) => c.data.kind === 'issue' || ISSUE_TAGS.includes(c.data.title),
  )
  for (const issue of ojs.issues) {
    const votes = new Map<string, number>()
    let count = 0
    for (const { submission, publications } of ojs.submissions) {
      if (publications.at(-1)?.issueId !== issue.id) continue
      count++
      const pub = matches.pubs.get(submission.id)
      for (const c of pub ? pubIssues(pubpub, pub.id) : [])
        votes.set(c.id, (votes.get(c.id) ?? 0) + 1)
    }
    const found = matchIssue(issue, candidates, votes, count)
    if (found) matches.issues.set(issue.id, found)
  }

  for (const c of pubpub.collections.values()) {
    if (c.data.kind === 'tag' && c.data.title && !matches.kinds.has(c.data.title)) {
      matches.kinds.set(c.data.title, c)
    }
  }
  return matches
}
