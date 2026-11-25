import { ojsId, uuidv5, JOTE_OJS_NAMESPACE } from './ids.ts'
import type { Matches } from './match.ts'
import { publicationDoi, sectionKind } from './match.ts'
import type {
  OjsAuthor,
  OjsExport,
  OjsGalley,
  OjsIssue,
  OjsPublication,
  OjsSubmission,
} from './ojs.ts'
import { localized, text } from './ojs.ts'
import type { UnderlayFile, PushRecord } from './underlay/client.ts'
import { sha256 } from './underlay/hash.ts'
import { hasHtml, isoDate, joinTitle, normalizeOrcid, slugify, stripHtml, day } from './text.ts'

/*
 * OJS → Underlay records, in the shape PubPub writes and the site reads
 * (planning: jote/_notes/underlay-article-records.md).
 *
 * Identity comes from PubPub when the article, issue or type is already there (id, slug, and
 * for issues the kind), so nothing the site links to moves. Everything else comes from OJS, with
 * two exceptions: `publishedAt`, since OJS has no publication date for articles it only
 * scheduled, and the DOI of an article matched by title because OJS gave it another article's
 * DOI (see match.ts). Crossref resolves the DOI PubPub deposited, so that one is kept.
 */

/** A galley file's bytes, by submission file id */
export type GalleyFiles = Map<number, UnderlayFile>

export interface MappedArticle {
  submissionId: number
  pubId: string
  slug: string
  title: string
  doi?: string
  publishedAt?: string
  /** Where the id and slug come from */
  identity: 'pubpub' | 'ojs'
  kind?: string
  issue?: string
  galleys: { label: string; format?: string; included: boolean }[]
}

export interface MapResult {
  records: PushRecord[]
  /** The files the records attach */
  files: UnderlayFile[]
  articles: MappedArticle[]
  warnings: string[]
}

type Data = Record<string, unknown>

/** Drop null, undefined, empty strings and empty arrays, so they never reach a record */
function compact(data: Data): Data {
  const out: Data = {}
  for (const [key, value] of Object.entries(data)) {
    if (value == null || value === '' || (Array.isArray(value) && value.length === 0)) continue
    out[key] = value
  }
  return out
}

/** A record's reference to a file (see schemas.ts for why the type is there twice) */
export const fileRef = (file: UnderlayFile, extra: Data = {}) =>
  compact({
    $asset: `ul:asset:${file.hash}`,
    fileName: file.fileName,
    mediaType: file.mediaType,
    mimeType: file.mediaType,
    ...extra,
  })

const LICENSES: { pattern: RegExp; license: string; spdx: string; uri: string }[] = [
  {
    pattern: /creativecommons\.org\/licenses\/by\/4\.0/i,
    license: 'cc-by',
    spdx: 'CC-BY-4.0',
    uri: 'https://creativecommons.org/licenses/by/4.0/',
  },
  {
    pattern: /creativecommons\.org\/licenses\/by-sa\/4\.0/i,
    license: 'cc-by-sa',
    spdx: 'CC-BY-SA-4.0',
    uri: 'https://creativecommons.org/licenses/by-sa/4.0/',
  },
  {
    pattern: /creativecommons\.org\/licenses\/by-nc\/4\.0/i,
    license: 'cc-by-nc',
    spdx: 'CC-BY-NC-4.0',
    uri: 'https://creativecommons.org/licenses/by-nc/4.0/',
  },
  {
    pattern: /creativecommons\.org\/publicdomain\/zero\/1\.0/i,
    license: 'cc-0',
    spdx: 'CC-0-1.0',
    uri: 'https://creativecommons.org/publicdomain/zero/1.0/',
  },
]

function license(url: string | null | undefined) {
  if (!url) return {}
  const known = LICENSES.find((l) => l.pattern.test(url))
  return known
    ? { license: known.license, licenseSpdx: known.spdx, licenseUri: known.uri }
    : { licenseUri: url }
}

/** An OJS article's title as one string, and as HTML when OJS has markup in it */
export function publicationTitle(p: OjsPublication, locale?: string) {
  const html = joinTitle(text(p.prefix, locale), text(p.title, locale), text(p.subtitle, locale))
  return { title: stripHtml(html), htmlTitle: hasHtml(html) ? html : undefined }
}

export function publicationKeywords(p: OjsPublication, locale?: string): string[] {
  const list = localized(p.keywords, locale) ?? []
  return list.map((k) => (typeof k === 'string' ? k : k.name).trim()).filter(Boolean)
}

/** An author's name as the journal shows it: their preferred public name, or given and family name */
export function authorName(a: OjsAuthor, locale?: string) {
  return (
    text(a.preferredPublicName, locale) ||
    [text(a.givenName, locale), text(a.familyName, locale)].filter(Boolean).join(' ')
  )
}

/** OJS 3.4+'s list of affiliations, or 3.3's free text */
export function authorAffiliation(a: OjsAuthor, locale?: string) {
  if (a.affiliations?.length) {
    return a.affiliations
      .map((aff) => text(aff.name, locale))
      .filter(Boolean)
      .join('; ')
  }
  return text(a.affiliation, locale)
}

/** Translators, editors and the like are contributors, not authors */
const isAuthor = (a: OjsAuthor) => {
  const group = text(a.userGroupName)
  return !group || /author/i.test(group)
}

/** What kind of file a galley is, from its label, type and file name */
export function galleyFormat(galley: OjsGalley): string | undefined {
  const label = galley.label.trim().toLowerCase()
  const name = text(galley.file?.name).toLowerCase()
  const mime = galley.file?.mimetype ?? ''
  const ext = name.split('.').pop() ?? ''
  if (label === 'html' || mime === 'text/html') return 'html'
  if (
    label === 'pdf' ||
    (mime === 'application/pdf' && !label.includes('/') && !/^(?:img|fig)/.test(label))
  )
    return 'pdf'
  if (label === 'tex' || label === 'latex' || ext === 'tex') return 'tex'
  if (label === 'bib' || label === 'bibliography' || ext === 'bib') return 'bib'
  if (label === 'docx' || ext === 'docx') return 'docx'
  if (label === 'epub' || ext === 'epub') return 'epub'
  if (label === 'xml' || label === 'jats' || mime.endsWith('/xml')) return 'jats'
  // Figures the LaTeX source uses: media/image1.png, img3, Figure_1.pdf
  return undefined
}

/** HTML galley images point at their dependent files by name; point them at the files' hashes */
function linkImages(html: string, dependents: { name: string; file: UnderlayFile }[]) {
  let out = html
  for (const { name, file } of dependents) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    out = out.replace(
      new RegExp(`(src|href)=(["'])(?:[^"']*/)?${escaped}\\2`, 'g'),
      `$1=$2sha256:${file.hash}$2`,
    )
  }
  return out
}

export interface MapOptions {
  ojs: OjsExport
  matches: Matches
  files: GalleyFiles
  locale?: string
}

/** Ids for type tags that PubPub doesn't have yet */
const kindId = (kind: string) => uuidv5(`kind:${kind}`, JOTE_OJS_NAMESPACE)

export function mapOjs({ ojs, matches, files, locale }: MapOptions): MapResult {
  const records: PushRecord[] = []
  const used = new Map<string, UnderlayFile>()
  const warnings: string[] = []
  const articles: MappedArticle[] = []
  const attach = (file: UnderlayFile, extra: Data = {}) => {
    used.set(file.hash, file)
    return fileRef(file, extra)
  }

  const sections = new Map(ojs.sections.map((s) => [s.id, s]))
  const issues = new Map(ojs.issues.map((i) => [i.id, i]))
  const slugs = new Set<string>()
  for (const record of matches.pubs.values()) slugs.add(record.data.slug)

  /** Article type → pubs, and issue → pubs with their place in the issue */
  const byKind = new Map<string, { pubId: string; date: string }[]>()
  const byIssue = new Map<number, { pubId: string; section: number; seq: number }[]>()

  for (const { submission, publications } of ojs.submissions) {
    const current =
      publications.find((p) => p.id === submission.currentPublicationId) ?? publications.at(-1)
    if (!current) {
      warnings.push(`Submission ${submission.id} has no publication to export`)
      continue
    }
    const match = matches.pubs.get(submission.id)
    const { title, htmlTitle } = publicationTitle(current, locale)
    const pubId = match?.id ?? ojsId('submission', submission.id)

    let slug: string = match?.data.slug ?? current.urlPath ?? slugify(title)
    if (!match && slugs.has(slug)) slug = `${slug}-${submission.id}`
    slugs.add(slug)

    const publishedAt =
      isoDate(current.datePublished) ?? (match?.data.publishedAt as string | undefined)
    let doi = publicationDoi(current)
    if (match && matches.pubBy.get(submission.id) === 'title' && match.data.doi) {
      warnings.push(
        `Submission ${submission.id}: OJS has DOI ${doi ?? '(none)'}, which PubPub gives to another article. Using PubPub's ${match.data.doi}`,
      )
      doi = match.data.doi
    }
    const section = current.sectionId != null ? sections.get(current.sectionId) : undefined
    const kind = sectionKind(section)
    const issue = current.issueId != null ? issues.get(current.issueId) : undefined

    const collectionIds: string[] = []
    if (kind) {
      collectionIds.push(matches.kinds.get(kind)?.id ?? kindId(kind))
      const list = byKind.get(kind) ?? []
      list.push({ pubId, date: publishedAt ?? '' })
      byKind.set(kind, list)
    }
    if (issue) {
      collectionIds.push(matches.issues.get(issue.id)?.record.id ?? ojsId('issue', issue.id))
      const list = byIssue.get(issue.id) ?? []
      list.push({ pubId, section: section?.sequence ?? 0, seq: current.seq ?? 0 })
      byIssue.set(issue.id, list)
    }

    const releaseIds: string[] = []
    const galleys: MappedArticle['galleys'] = []
    for (const p of publications) {
      const releaseId = ojsId('publication', p.id)
      releaseIds.push(releaseId)
      const release = mapRelease(p, {
        pubId,
        fallbackDate: publishedAt,
        files,
        attach,
        warnings,
        locale,
      })
      if (p.id === current.id) galleys.push(...release.galleys)
      records.push({ id: releaseId, type: 'Release', data: release.data })
    }

    records.push({
      id: pubId,
      type: 'Pub',
      data: compact({
        kind: 'JournalArticle',
        title,
        htmlTitle,
        slug,
        doi,
        publishedAt,
        createdAt: isoDate(submission.dateSubmitted),
        ...license(current.licenseUrl),
        collectionIds,
        latestReleaseId: ojsId('publication', current.id),
        metadata: compact({
          ojsSubmissionId: submission.id,
          ojsPublicationId: current.id,
          ojsStatus: statusName(submission),
        }),
      }),
    })

    for (const author of [...(current.authors ?? [])].sort((a, b) => a.seq - b.seq)) {
      const name = authorName(author, locale)
      if (!name) {
        warnings.push(`Submission ${submission.id}: author ${author.id} has no name`)
        continue
      }
      records.push({
        id: ojsId('author', author.id),
        type: 'PubAttribution',
        data: compact({
          pubId,
          name,
          orcid: normalizeOrcid(author.orcid),
          affiliation: authorAffiliation(author, locale),
          isAuthor: isAuthor(author),
          order: author.seq,
        }),
      })
    }

    articles.push({
      submissionId: submission.id,
      pubId,
      slug,
      title,
      doi,
      publishedAt,
      identity: match ? 'pubpub' : 'ojs',
      kind,
      issue: issue ? issueTitle(issue) : undefined,
      galleys,
    })
  }

  for (const [kind, pubs] of byKind) {
    const pubpub = matches.kinds.get(kind)
    records.push({
      id: pubpub?.id ?? kindId(kind),
      type: 'Collection',
      data: compact({
        kind: 'tag',
        title: kind,
        slug: pubpub?.data.slug ?? slugify(kind),
        isPublic: true,
        pubIds: pubs.sort((a, b) => a.date.localeCompare(b.date)).map((p) => p.pubId),
      }),
    })
  }

  for (const [issueId, pubs] of byIssue) {
    const issue = issues.get(issueId)!
    const pubpub = matches.issues.get(issueId)?.record
    const description = text(issue.description, locale)
    records.push({
      id: pubpub?.id ?? ojsId('issue', issueId),
      type: 'Collection',
      data: compact({
        kind: pubpub?.data.kind ?? 'issue',
        title: issueTitle(issue),
        slug: pubpub?.data.slug ?? issue.urlPath ?? slugify(issueTitle(issue)),
        isPublic: true,
        metadata: compact({
          volume: issue.volume != null ? String(issue.volume) : undefined,
          issue: issue.number ? String(issue.number) : undefined,
          publicationDate: day(isoDate(issue.datePublished)),
          ojsIssueId: issueId,
        }),
        pubIds: pubs.sort((a, b) => a.section - b.section || a.seq - b.seq).map((p) => p.pubId),
        layoutHtml: stripHtml(description) ? description : undefined,
      }),
    })
  }

  return { records, files: [...used.values()], articles, warnings }
}

const statusName = (s: OjsSubmission) =>
  ({ 1: 'queued', 3: 'published', 4: 'declined', 5: 'scheduled' })[s.status] ?? String(s.status)

/** An issue's title, or "Volume 3 Issue 1" when it has none */
export function issueTitle(issue: OjsIssue) {
  const title = text(issue.title)
  if (title) return title
  return [issue.volume != null && `Volume ${issue.volume}`, issue.number && `Issue ${issue.number}`]
    .filter(Boolean)
    .join(' ')
}

interface ReleaseContext {
  pubId: string
  fallbackDate?: string
  files: GalleyFiles
  attach: (file: UnderlayFile, extra?: Data) => Data
  warnings: string[]
  locale?: string
}

function mapRelease(p: OjsPublication, ctx: ReleaseContext) {
  const exports: Data[] = []
  const assets: Data[] = []
  const galleys: MappedArticle['galleys'] = []
  let contentFile: Data | undefined

  for (const galley of [...(p.galleys ?? [])].sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0))) {
    const format = galleyFormat(galley)
    const file =
      galley.submissionFileId != null ? ctx.files.get(galley.submissionFileId) : undefined
    galleys.push({ label: galley.label, format, included: Boolean(file) })
    if (!file) continue
    if (format === 'html') {
      const dependents = (galley.file?.dependentFiles ?? [])
        .map((d) => ({ name: text(d.name), file: ctx.files.get(d.id) }))
        .filter((d): d is { name: string; file: UnderlayFile } => Boolean(d.file && d.name))
      const html = linkImages(new TextDecoder().decode(file.bytes), dependents)
      const linked = html === new TextDecoder().decode(file.bytes) ? file : htmlFile(file, html)
      contentFile = ctx.attach(linked)
      for (const d of dependents) assets.push(ctx.attach(d.file))
    } else if (format) {
      exports.push(ctx.attach(file, { format }))
    } else {
      assets.push(ctx.attach(file))
    }
  }

  const abstract = text(p.abstract, ctx.locale)
  return {
    galleys,
    data: compact({
      pubId: ctx.pubId,
      historyKey: p.version,
      createdAt: isoDate(p.datePublished) ?? ctx.fallbackDate ?? isoDate(p.lastModified),
      contentFile,
      assets,
      exports,
      abstractHtml: stripHtml(abstract) ? abstract : undefined,
      keywords: publicationKeywords(p, ctx.locale),
    }),
  }
}

/** The HTML galley with its image links rewritten, as a file of its own */
function htmlFile(original: UnderlayFile, html: string): UnderlayFile {
  const bytes = new TextEncoder().encode(html)
  return { ...original, bytes, hash: sha256(bytes) }
}
