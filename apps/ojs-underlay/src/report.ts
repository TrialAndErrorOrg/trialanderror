import { authorAffiliation, authorName, issueTitle, publicationTitle } from './map.ts'
import type { Matches } from './match.ts'
import { pubIssues, pubKind, publicationDoi, sectionKind } from './match.ts'
import type { OjsExport, OjsPublication, OjsSubmission } from './ojs.ts'
import { text } from './ojs.ts'
import type { PubPubAuthor, PubPubIndex } from './pubpub.ts'
import {
  normalizeDoi,
  comparable,
  comparableAffiliation,
  comparableName,
  day,
  isoDate,
  normalizeOrcid,
  titleSimilarity,
} from './text.ts'

/*
 * Where OJS and PubPub disagree about the same article. PubPub's metadata is the one editors
 * kept up, so this is the list for backfilling OJS from PubPub before OJS becomes the source.
 */

export type Field =
  | 'DOI'
  | 'title'
  | 'authors'
  | 'author name'
  | 'author order'
  | 'ORCID'
  | 'affiliation'
  | 'publication date'
  | 'type'
  | 'issue'
  | 'licence'

export interface FieldDiff {
  field: Field
  /** Which author, for the author fields */
  author?: string
  ojs: string
  pubpub: string
}

export interface ArticleDiff {
  submissionId: number
  publicationId: number
  doi?: string
  pubpubId: string
  slug: string
  title: string
  /** By DOI, or by title when OJS's DOI is another article's on PubPub */
  matchedBy: 'doi' | 'title'
  diffs: FieldDiff[]
}

export interface IssueRow {
  ojsIssueId: number
  ojsTitle: string
  volume?: string
  number?: string
  articles: number
  pubpub?: {
    id: string
    title: string
    slug: string
    kind: string
    volume?: string
    number?: string
  }
  by?: string
}

export interface DiffReport {
  generatedAt: string
  ojsCount: number
  matched: ArticleDiff[]
  ojsOnly: {
    submissionId: number
    title: string
    doi?: string
    status: number
    sameTitle?: { slug: string; doi?: string }
  }[]
  pubpubOnly: {
    id: string
    slug: string
    title: string
    doi?: string
    publishedAt?: string
    kind?: string
    issue?: string
    /** An OJS submission not exported (queued or declined) with this DOI or nearly this title */
    inOjs?: { submissionId: number; status: string; by: 'DOI' | 'title' }
  }[]
  issues: IssueRow[]
  /** Matched articles whose OJS publication has no URL path (PubPub's slug would go there) */
  missingUrlPath: number
}

const NONE = '(none)'

function compareAuthors(ojs: OjsPublication, pubpub: PubPubAuthor[], locale?: string): FieldDiff[] {
  const diffs: FieldDiff[] = []
  const ours = [...(ojs.authors ?? [])]
    .sort((a, b) => a.seq - b.seq)
    .map((a) => ({
      name: authorName(a, locale),
      orcid: normalizeOrcid(a.orcid),
      affiliation: authorAffiliation(a, locale) || undefined,
    }))
  const list = (authors: { name: string }[]) => authors.map((a) => a.name).join(', ') || NONE

  // Pair authors by ORCID, then by name, then by family name, so a reordering or a spelling
  // difference doesn't pair the wrong people
  const pairs: [number, number][] = []
  const usedTheirs = new Set<number>()
  const pairBy = (same: (a: (typeof ours)[number], b: PubPubAuthor) => boolean) => {
    ours.forEach((a, i) => {
      if (pairs.some(([x]) => x === i)) return
      const j = pubpub.findIndex((b, j) => !usedTheirs.has(j) && same(a, b))
      if (j !== -1) {
        pairs.push([i, j])
        usedTheirs.add(j)
      }
    })
  }
  const family = (name: string) => comparableName(name).split(' ').at(-1)
  pairBy((a, b) => Boolean(a.orcid && a.orcid === b.orcid))
  pairBy((a, b) => comparableName(a.name) === comparableName(b.name))
  pairBy((a, b) => family(a.name) === family(b.name))

  if (pairs.length !== ours.length || pairs.length !== pubpub.length) {
    diffs.push({ field: 'authors', ojs: list(ours), pubpub: list(pubpub) })
  } else if (pairs.some(([i, j]) => i !== j)) {
    diffs.push({ field: 'author order', ojs: list(ours), pubpub: list(pubpub) })
  }

  for (const [i, j] of pairs.sort((a, b) => a[1] - b[1])) {
    const a = ours[i]
    const b = pubpub[j]
    const author = b.name
    if (comparableName(a.name) !== comparableName(b.name)) {
      diffs.push({ field: 'author name', author, ojs: a.name, pubpub: b.name })
    }
    if (a.orcid !== b.orcid) {
      diffs.push({ field: 'ORCID', author, ojs: a.orcid ?? NONE, pubpub: b.orcid ?? NONE })
    }
    if (comparableAffiliation(a.affiliation ?? '') !== comparableAffiliation(b.affiliation ?? '')) {
      diffs.push({
        field: 'affiliation',
        author,
        ojs: a.affiliation ?? NONE,
        pubpub: b.affiliation ?? NONE,
      })
    }
  }
  return diffs
}

const licenceUri = (uri: string | null | undefined) =>
  (uri ?? '').replace(/^http:/, 'https:').replace(/\/$/, '')

const STATUS_NAMES: Record<number, string> = {
  1: 'queued',
  3: 'published',
  4: 'declined',
  5: 'scheduled',
}

/** A PubPub pub among OJS submissions that weren't exported, by DOI or else by title */
function findInOjs(
  pub: { doi?: string; title?: string },
  others: OjsSubmission[],
): DiffReport['pubpubOnly'][number]['inOjs'] {
  const doi = normalizeDoi(pub.doi)
  const found = (s: OjsSubmission, by: 'DOI' | 'title') => ({
    submissionId: s.id,
    status: STATUS_NAMES[s.status] ?? String(s.status),
    by,
  })
  if (doi) {
    const same = others.find((s) =>
      s.publications.some((p) => publicationDoi(p as OjsPublication) === doi),
    )
    if (same) return found(same, 'DOI')
  }
  let best: OjsSubmission | undefined
  let score = 0
  for (const s of others) {
    for (const p of s.publications) {
      const similarity = titleSimilarity(pub.title ?? '', text((p as OjsPublication).title))
      if (similarity > score) [best, score] = [s, similarity]
    }
  }
  return best && score >= 0.5 ? found(best, 'title') : undefined
}

/**
 * Compare the exported OJS articles with PubPub's. `others` are OJS submissions that weren't
 * exported (queued, declined), to say where PubPub's unmatched articles are in OJS.
 */
export function diffReport(
  ojs: OjsExport,
  pubpub: PubPubIndex,
  matches: Matches,
  others: OjsSubmission[] = [],
  locale?: string,
): DiffReport {
  const releases = new Set((pubpub.byType.get('Release') ?? []).map((r) => r.id))
  const sections = new Map(ojs.sections.map((s) => [s.id, s]))
  const issues = new Map(ojs.issues.map((i) => [i.id, i]))
  const matched: ArticleDiff[] = []
  const ojsOnly: DiffReport['ojsOnly'] = []
  let missingUrlPath = 0

  for (const { submission, publications } of ojs.submissions) {
    const current =
      publications.find((p) => p.id === submission.currentPublicationId) ?? publications.at(-1)
    if (!current) continue
    const { title } = publicationTitle(current, locale)
    const pub = matches.pubs.get(submission.id)
    if (!pub) {
      const same = matches.byTitleOnly.get(submission.id)
      ojsOnly.push({
        submissionId: submission.id,
        title,
        doi: publicationDoi(current),
        status: submission.status,
        sameTitle: same ? { slug: same.data.slug, doi: same.data.doi } : undefined,
      })
      continue
    }
    if (!current.urlPath) missingUrlPath++

    const d = pub.data
    const diffs: FieldDiff[] = []
    const matchedBy = matches.pubBy.get(submission.id) ?? 'doi'
    if (publicationDoi(current) !== (normalizeDoi(d.doi) || undefined)) {
      const owner = pubpub.byDoi.get(publicationDoi(current) ?? '')
      diffs.push({
        field: 'DOI',
        ojs: `${publicationDoi(current) ?? NONE}${owner ? ` (on PubPub: ${owner.data.title})` : ''}`,
        pubpub: d.doi || NONE,
      })
    }
    if (comparable(title) !== comparable(d.title ?? '')) {
      diffs.push({ field: 'title', ojs: title, pubpub: d.title ?? NONE })
    }
    diffs.push(...compareAuthors(current, pubpub.authors(pub.id), locale))

    const ojsDate = day(isoDate(current.datePublished))
    const pubDate = day(d.publishedAt)
    if (ojsDate !== pubDate)
      diffs.push({ field: 'publication date', ojs: ojsDate ?? NONE, pubpub: pubDate ?? NONE })

    const section = current.sectionId != null ? sections.get(current.sectionId) : undefined
    const ourKind = sectionKind(section)
    const theirKind = pubKind(pubpub, pub.id)
    if (ourKind !== theirKind) {
      const sectionTitle = section ? (section.title?.en ?? '') : ''
      diffs.push({
        field: 'type',
        ojs: ourKind
          ? `${ourKind} (section ${sectionTitle})`
          : `${NONE} (section ${sectionTitle || NONE})`,
        pubpub: theirKind ?? NONE,
      })
    }

    const issue = current.issueId != null ? issues.get(current.issueId) : undefined
    const ourIssue = issue ? matches.issues.get(issue.id)?.record.id : undefined
    const theirIssues = pubIssues(pubpub, pub.id)
    if (!theirIssues.some((c) => c.id === ourIssue) && (issue || theirIssues.length)) {
      diffs.push({
        field: 'issue',
        ojs: issue ? issueTitle(issue) : NONE,
        pubpub: theirIssues.map((c) => c.data.title).join(', ') || NONE,
      })
    }

    if (licenceUri(current.licenseUrl) !== licenceUri(d.licenseUri)) {
      diffs.push({
        field: 'licence',
        ojs: current.licenseUrl ?? NONE,
        pubpub: d.licenseUri ?? NONE,
      })
    }

    matched.push({
      submissionId: submission.id,
      publicationId: current.id,
      doi: publicationDoi(current),
      pubpubId: pub.id,
      slug: d.slug,
      title: d.title ?? title,
      matchedBy,
      diffs,
    })
  }

  const matchedIds = new Set([...matches.pubs.values()].map((p) => p.id))
  const pubpubOnly = [...pubpub.pubs.values()]
    .filter((p) => (p.data.kind ?? 'JournalArticle') === 'JournalArticle' && p.data.publishedAt)
    .filter((p) => !matchedIds.has(p.id))
    .filter((p) => !pubpub.collectionsOf(p.id).some((c) => NOT_ARTICLES.includes(c.data.title)))
    // As the site does: a pub without a release isn't shown, so drafts and tests drop out
    .filter((p) => releases.has(p.data.latestReleaseId))
    .map((p) => ({
      id: p.id,
      slug: p.data.slug,
      title: p.data.title,
      doi: p.data.doi || undefined,
      publishedAt: day(p.data.publishedAt),
      kind: pubKind(pubpub, p.id),
      issue:
        pubIssues(pubpub, p.id)
          .map((c) => c.data.title)
          .join(', ') || undefined,
      inOjs: findInOjs(p.data, others),
    }))
    .sort((a, b) => (a.publishedAt ?? '').localeCompare(b.publishedAt ?? ''))

  const issueRows: IssueRow[] = ojs.issues.map((issue) => {
    const found = matches.issues.get(issue.id)
    const meta = found?.record.data.metadata ?? {}
    return {
      ojsIssueId: issue.id,
      ojsTitle: issueTitle(issue),
      volume: issue.volume != null ? String(issue.volume) : undefined,
      number: issue.number ?? undefined,
      articles: ojs.submissions.filter(({ submission, publications }) => {
        const current = publications.find((p) => p.id === submission.currentPublicationId)
        return current?.issueId === issue.id
      }).length,
      pubpub: found && {
        id: found.record.id,
        title: found.record.data.title,
        slug: found.record.data.slug,
        kind: found.record.data.kind,
        volume: meta.volume,
        number: meta.issue,
      },
      by: found?.by,
    }
  })

  return {
    generatedAt: new Date().toISOString(),
    ojsCount: ojs.submissions.length,
    matched,
    ojsOnly,
    pubpubOnly,
    issues: issueRows,
    missingUrlPath,
  }
}

/** PubPub tags for pubs that are calls and notices, not articles (`notArticles` in the site) */
const NOT_ARTICLES = [
  'Call for Papers',
  'Call for Proposals',
  'Call for Abstracts',
  'Open Calls',
  'Current Calls',
  'Submission',
]

const cell = (value: string | number | undefined) =>
  String(value ?? '')
    .replace(/\|/g, '\\|')
    .replace(/\n/g, ' ') || ' '

const row = (...cells: (string | number | undefined)[]) => `| ${cells.map(cell).join(' | ')} |`

const FIELDS: Field[] = [
  'DOI',
  'title',
  'authors',
  'author order',
  'author name',
  'ORCID',
  'affiliation',
  'publication date',
  'type',
  'issue',
  'licence',
]

/** The report as Markdown */
export function reportMarkdown(report: DiffReport): string {
  const lines: string[] = []
  const push = (...l: string[]) => lines.push(...l)
  const withDiff = (field: Field) =>
    report.matched.filter((a) => a.diffs.some((d) => d.field === field))

  push(
    '# OJS and PubPub, article by article',
    '',
    `Generated ${report.generatedAt.slice(0, 16).replace('T', ' ')} UTC by \`apps/ojs-underlay\`.`,
    'OJS is the local copy of the live database, PubPub is its export on Underlay (`centeroftrialanderror/jote`).',
    'Articles are matched by DOI. PubPub is the side editors kept up to date, so where they differ the PubPub value is usually the one to copy into OJS.',
    '',
    '## Summary',
    '',
    row('', 'Count'),
    row('---', '---:'),
    row('OJS articles exported (published or scheduled)', report.ojsCount),
    row(
      'Matched to a PubPub pub by DOI',
      report.matched.filter((a) => a.matchedBy === 'doi').length,
    ),
    row(
      'Matched by title, OJS DOI belongs to another article',
      report.matched.filter((a) => a.matchedBy === 'title').length,
    ),
    row('In OJS only', report.ojsOnly.length),
    row('On PubPub only (articles the site shows, calls left out)', report.pubpubOnly.length),
    row(
      'Matched articles with no differences',
      report.matched.filter((a) => !a.diffs.length).length,
    ),
    row('Matched articles without a URL path in OJS', report.missingUrlPath),
    '',
    '### Differences by field',
    '',
    'Articles with at least one difference in the field, and the number of differences (an article can have several, one per author).',
    '',
    row('Field', 'Articles', 'Differences'),
    row('---', '---:', '---:'),
  )
  for (const field of FIELDS) {
    const count = report.matched.reduce(
      (n, a) => n + a.diffs.filter((d) => d.field === field).length,
      0,
    )
    push(row(field, withDiff(field).length, count))
  }

  const orcids = report.matched.flatMap((a) => a.diffs.filter((d) => d.field === 'ORCID'))
  const affiliations = report.matched.flatMap((a) =>
    a.diffs.filter((d) => d.field === 'affiliation'),
  )
  const contains = (d: FieldDiff) => {
    if (d.ojs === NONE || d.pubpub === NONE) return false
    const [a, b] = [comparableAffiliation(d.ojs), comparableAffiliation(d.pubpub)]
    return a.includes(b) || b.includes(a)
  }
  push(
    '',
    'ORCID differences in detail:',
    '',
    `- missing in OJS, present on PubPub: ${orcids.filter((d) => d.ojs === NONE).length}`,
    `- missing on PubPub, present in OJS: ${orcids.filter((d) => d.pubpub === NONE).length}`,
    `- different iDs: ${orcids.filter((d) => d.ojs !== NONE && d.pubpub !== NONE).length}`,
    '',
    'Affiliation differences in detail:',
    '',
    `- missing in OJS, present on PubPub: ${affiliations.filter((d) => d.ojs === NONE).length}`,
    `- missing on PubPub, present in OJS: ${affiliations.filter((d) => d.pubpub === NONE).length}`,
    `- one names the other and more (usually OJS has the department and address, PubPub the university): ${affiliations.filter(contains).length}`,
    `- different: ${affiliations.filter((d) => d.ojs !== NONE && d.pubpub !== NONE && !contains(d)).length}`,
    '',
    '## Issues',
    '',
    row(
      'OJS issue',
      'Vol.',
      'No.',
      'Articles',
      'PubPub collection',
      'PubPub vol.',
      'PubPub no.',
      'Matched by',
    ),
    row('---', '---', '---', '---:', '---', '---', '---', '---'),
  )
  for (const i of report.issues) {
    push(
      row(
        `${i.ojsTitle} (${i.ojsIssueId})`,
        i.volume,
        i.number,
        i.articles,
        i.pubpub ? `${i.pubpub.title} (\`${i.pubpub.slug}\`, ${i.pubpub.kind})` : NONE,
        i.pubpub?.volume,
        i.pubpub?.number,
        i.by,
      ),
    )
  }

  push('', '## In OJS only', '')
  if (!report.ojsOnly.length) push('None.')
  else {
    push(
      row('Submission', 'Title', 'DOI', 'Status', 'PubPub pub with the same title'),
      row('---:', '---', '---', '---', '---'),
    )
    for (const a of report.ojsOnly) {
      push(
        row(
          a.submissionId,
          a.title,
          a.doi,
          a.status,
          a.sameTitle ? `\`${a.sameTitle.slug}\` (${a.sameTitle.doi ?? 'no DOI'})` : '',
        ),
      )
    }
  }

  push(
    '',
    '## On PubPub only',
    '',
    'Journal articles the site shows (published, with a release) that match no exported OJS submission. The last column is an OJS submission in another status (queued or declined) with the same DOI or nearly the same title, if there is one.',
    '',
  )
  if (!report.pubpubOnly.length) push('None.')
  else {
    push(
      row('Published', 'Title', 'Slug', 'DOI', 'Type', 'Issue', 'In OJS'),
      row('---', '---', '---', '---', '---', '---', '---'),
    )
    for (const p of report.pubpubOnly) {
      const inOjs =
        p.inOjs && `submission ${p.inOjs.submissionId}, ${p.inOjs.status} (same ${p.inOjs.by})`
      push(row(p.publishedAt, p.title, `\`${p.slug}\``, p.doi, p.kind, p.issue, inOjs))
    }
  }

  push(
    '',
    '## Differences per article',
    '',
    'Matched articles only, in OJS submission order. Articles with no differences are left out.',
    '',
  )
  for (const a of report.matched) {
    if (!a.diffs.length) continue
    push(
      `### ${a.title}`,
      '',
      `OJS submission ${a.submissionId}, publication ${a.publicationId}. DOI ${a.doi ?? NONE}. PubPub \`${a.slug}\`.`,
      '',
      row('Field', 'Author', 'OJS', 'PubPub'),
      row('---', '---', '---', '---'),
      ...a.diffs.map((d) => row(d.field, d.author, d.ojs, d.pubpub)),
      '',
    )
  }
  return `${lines.join('\n').trimEnd()}\n`
}
