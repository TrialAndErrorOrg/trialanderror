/*
 * A small read-only client for the OJS REST API (`/api/v1`), and the parts of its responses the
 * exporter reads. Written against OJS 3.5 and tolerant of 3.3, where a few fields differ
 * (plain-text `affiliation` instead of `affiliations`, `pub-id::doi` instead of `doiObject`,
 * keywords as strings instead of `{name}` objects, `en_US` instead of `en`).
 */

/** A value per locale, e.g. `{ en: "Title" }` */
export type Localized<T = string> = Record<string, T | null> | null | undefined

export interface OjsSubmissionFile {
  id: number
  mimetype?: string
  name?: Localized
  genreName?: Localized
  genreIsDependent?: boolean
  genreIsSupplementary?: boolean
  dependentFiles?: OjsSubmissionFile[]
}

export interface OjsGalley {
  id: number
  label: string
  locale?: string
  seq?: number
  submissionFileId?: number | null
  file?: OjsSubmissionFile | null
  urlRemote?: string | null
}

export interface OjsAuthor {
  id: number
  seq: number
  givenName?: Localized
  familyName?: Localized
  preferredPublicName?: Localized
  orcid?: string | null
  /** OJS 3.3: free text */
  affiliation?: Localized
  /** OJS 3.4 and later: a list, each with a ROR id when the author picked one */
  affiliations?: { name?: Localized; ror?: string | null }[]
  userGroupName?: Localized
  includeInBrowse?: boolean
}

export interface OjsPublication {
  id: number
  submissionId: number
  status: number
  version?: number
  locale?: string
  prefix?: Localized
  title?: Localized
  subtitle?: Localized
  abstract?: Localized
  /** Strings in OJS 3.3, `{name}` objects in 3.5 */
  keywords?: Localized<(string | { name: string })[]>
  authors?: OjsAuthor[]
  galleys?: OjsGalley[]
  datePublished?: string | null
  lastModified?: string | null
  sectionId?: number | null
  issueId?: number | null
  seq?: number
  urlPath?: string | null
  licenseUrl?: string | null
  /** OJS 3.4 and later */
  doiObject?: { doi?: string | null } | null
  /** OJS 3.3 */
  'pub-id::doi'?: string | null
  coverImage?: Localized<{ uploadName?: string; altText?: string } | null>
}

export interface OjsSubmission {
  id: number
  status: number
  locale?: string
  currentPublicationId: number
  dateSubmitted?: string | null
  /** Summaries; the full publication comes from `publication()` */
  publications: { id: number; status: number; version?: number }[]
}

export interface OjsIssue {
  id: number
  volume?: number | null
  number?: string | null
  year?: number | null
  title?: Localized
  description?: Localized
  datePublished?: string | null
  published?: boolean
  urlPath?: string | null
  identification?: string
}

export interface OjsSection {
  id: number
  title?: Localized
  sequence?: number
  isInactive?: boolean
}

/** OJS's submission and publication statuses */
export const STATUS = { queued: 1, published: 3, declined: 4, scheduled: 5 } as const

/** The value for a locale, falling back to English and then to any value there is */
export function text(value: Localized, locale = 'en'): string {
  if (!value) return ''
  const pick = value[locale] ?? value.en ?? value.en_US
  if (typeof pick === 'string' && pick.trim()) return pick.trim()
  for (const v of Object.values(value)) if (typeof v === 'string' && v.trim()) return v.trim()
  return ''
}

/** Like `text`, for values that aren't strings */
export function localized<T>(value: Localized<T>, locale = 'en'): T | undefined {
  if (!value) return undefined
  return (
    value[locale] ??
    value.en ??
    value.en_US ??
    Object.values(value).find((v) => v != null) ??
    undefined
  )
}

export class OjsError extends Error {
  readonly status?: number
  constructor(message: string, status?: number) {
    super(message)
    this.name = 'OjsError'
    this.status = status
  }
}

export interface OjsClientOptions {
  /** The journal's address, e.g. `http://localhost:8090/index.php/jote` */
  url: string
  /** An API token (User profile, API key) of an editor or manager */
  token?: string
}

export class OjsClient {
  readonly url: string
  private readonly token?: string

  constructor({ url, token }: OjsClientOptions) {
    this.url = url.replace(/\/$/, '')
    this.token = token
  }

  private async request(path: string, params: Record<string, string | number> = {}) {
    const url = new URL(`${this.url}/api/v1/${path}`)
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, String(value))
    const headers: Record<string, string> = { Accept: 'application/json' }
    if (this.token) headers.Authorization = `Bearer ${this.token}`
    for (let attempt = 0; ; attempt++) {
      const response = await fetch(url, { headers })
      if (response.ok) return response
      if (response.status >= 500 && attempt < 2) {
        await new Promise((resolve) => setTimeout(resolve, 1000 * 2 ** attempt))
        continue
      }
      const body = await response.text().catch(() => '')
      throw new OjsError(
        `OJS ${response.status} for ${url.pathname}: ${body.slice(0, 200)}`,
        response.status,
      )
    }
  }

  async get<T>(path: string, params?: Record<string, string | number>): Promise<T> {
    return (await this.request(path, params)).json() as Promise<T>
  }

  /** Every item of a list endpoint, 100 at a time */
  async all<T>(path: string, params: Record<string, string | number> = {}): Promise<T[]> {
    const items: T[] = []
    for (let offset = 0; ; offset += 100) {
      const page = await this.get<{ items: T[]; itemsMax: number }>(path, {
        ...params,
        count: 100,
        offset,
      })
      items.push(...page.items)
      if (page.items.length === 0 || items.length >= page.itemsMax) return items
    }
  }

  /** Submissions with one of these statuses */
  async submissions(statuses: number[]): Promise<OjsSubmission[]> {
    const lists = await Promise.all(
      statuses.map((status) => this.all<OjsSubmission>('submissions', { status })),
    )
    return lists.flat().sort((a, b) => a.id - b.id)
  }

  /** A publication with its authors and galleys */
  publication(submissionId: number, publicationId: number) {
    return this.get<OjsPublication>(`submissions/${submissionId}/publications/${publicationId}`)
  }

  issues() {
    return this.all<OjsIssue>('issues')
  }

  /** The journal's sections. OJS 3.5 has this endpoint, 3.3 doesn't */
  async sections(): Promise<OjsSection[]> {
    try {
      return await this.all<OjsSection>('sections')
    } catch (error) {
      if (error instanceof OjsError && error.status === 404) return []
      throw error
    }
  }

  /**
   * A submission file's bytes. Core OJS has no API route that returns them, so this goes through
   * the `easyFileApi` plugin's `GET /api/v1/_files/{submissionFileId}` (installed on JOTE's OJS).
   */
  async file(submissionFileId: number): Promise<Uint8Array> {
    const response = await this.request(`_files/${submissionFileId}`)
    return new Uint8Array(await response.arrayBuffer())
  }
}

/** Run `task` over `items`, at most `limit` at a time, keeping their order */
export async function mapLimit<T, R>(items: T[], limit: number, task: (item: T) => Promise<R>) {
  const results = Array.from<R>({ length: items.length })
  let next = 0
  const worker = async () => {
    while (next < items.length) {
      const index = next++
      results[index] = await task(items[index])
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return results
}

export interface OjsExport {
  submissions: { submission: OjsSubmission; publications: OjsPublication[] }[]
  issues: OjsIssue[]
  sections: OjsSection[]
}

/**
 * Everything the mapping needs from OJS: the submissions with these statuses, each with its
 * full publications of these statuses (oldest version first), plus every issue and section.
 */
export async function loadOjs(client: OjsClient, statuses: number[]): Promise<OjsExport> {
  const [submissions, issues, sections] = await Promise.all([
    client.submissions(statuses),
    client.issues(),
    client.sections(),
  ])
  const withPublications = await mapLimit(submissions, 6, async (submission) => {
    const summaries = submission.publications
      .filter((p) => statuses.includes(p.status) || p.id === submission.currentPublicationId)
      .sort((a, b) => (a.version ?? 0) - (b.version ?? 0) || a.id - b.id)
    const publications = await Promise.all(
      summaries.map((p) => client.publication(submission.id, p.id)),
    )
    return { submission, publications }
  })
  return { submissions: withPublications, issues, sections }
}

/** OJS issues for trying things out, whose articles are never exported */
export const isTestIssue = (issue: OjsIssue) => /^test\b/i.test(text(issue.title))

/** The export without test issues and the submissions scheduled in them */
export function withoutTestIssues(ojs: OjsExport) {
  const test = new Set(ojs.issues.filter(isTestIssue).map((i) => i.id))
  const skipped = ojs.submissions.filter(({ publications }) =>
    publications.some((p) => p.issueId != null && test.has(p.issueId)),
  )
  return {
    ojs: {
      ...ojs,
      issues: ojs.issues.filter((i) => !test.has(i.id)),
      submissions: ojs.submissions.filter((s) => !skipped.includes(s)),
    },
    skipped: skipped.map((s) => s.submission.id),
  }
}
