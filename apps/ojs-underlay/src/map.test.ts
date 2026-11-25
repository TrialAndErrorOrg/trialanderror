import { describe, expect, it } from 'vitest'
import { ojsId } from './ids.ts'
import type { GalleyFiles } from './map.ts'
import { mapOjs } from './map.ts'
import { match } from './match.ts'
import type { OjsExport, OjsPublication } from './ojs.ts'
import { withoutTestIssues } from './ojs.ts'
import type { UnderlayRecord } from './pubpub.ts'
import { indexPubPub } from './pubpub.ts'
import { diffReport, reportMarkdown } from './report.ts'
import { sha256 } from './underlay/hash.ts'

/*
 * A made-up journal: three scheduled articles in OJS, two of them on PubPub already. Article 2
 * has the DOI PubPub gives article 3 (the kind of mix-up the real data has), so it must be
 * matched by its title.
 */

const publication = (id: number, extra: Partial<OjsPublication>): OjsPublication => ({
  id,
  submissionId: id,
  status: 5,
  version: 1,
  title: { en: `Title ${id}` },
  abstract: { en: '<p>An abstract.</p>' },
  keywords: { en: [{ name: 'failure' }, { name: 'replication' }] },
  authors: [],
  galleys: [],
  datePublished: null,
  sectionId: 5,
  issueId: 2,
  seq: id,
  licenseUrl: 'https://creativecommons.org/licenses/by/4.0',
  ...extra,
})

const author = (id: number, seq: number, given: string, family: string, more = {}) => ({
  id,
  seq,
  givenName: { en: given },
  familyName: { en: family },
  userGroupName: { en: 'Author' },
  ...more,
})

const pdf = new TextEncoder().encode('%PDF-1.7 made up')
const html = new TextEncoder().encode('<h1>Intro</h1><p><img src="figure1.png"></p>')
const png = new TextEncoder().encode('not really a png')

const ojs: OjsExport = {
  sections: [
    { id: 5, title: { en: 'Empirical Articles' }, sequence: 3 },
    { id: 9, title: { en: 'Other (Special Issue, Unique Contribution, etc.)' }, sequence: 9 },
  ],
  issues: [
    {
      id: 2,
      volume: 2,
      number: '1',
      year: 2022,
      title: { en: 'Journal of Trial and Error Issue 2' },
      description: { en: '' },
    },
    { id: 6, volume: 99, number: '99', title: { en: 'TEST ISSUE' } },
  ],
  submissions: [
    {
      submission: {
        id: 1,
        status: 5,
        currentPublicationId: 1,
        dateSubmitted: '2021-01-02 10:00:00',
        publications: [],
      },
      publications: [
        publication(1, {
          title: { en: 'Failing to replicate:' },
          subtitle: { en: 'a story' },
          doiObject: { doi: '10.1234/one' },
          authors: [
            author(11, 0, 'Ada', 'Lovelace', {
              orcid: '0000-0001-2345-6789',
              affiliations: [{ name: { en: 'Analytical Society' } }],
            }),
            author(12, 1, 'Charles', 'Babbage'),
          ],
          galleys: [
            {
              id: 1,
              label: 'PDF',
              submissionFileId: 101,
              file: { id: 101, mimetype: 'application/pdf', name: { en: 'one.pdf' } },
            },
            {
              id: 2,
              label: 'HTML',
              submissionFileId: 102,
              file: {
                id: 102,
                mimetype: 'text/html',
                name: { en: 'one.html' },
                dependentFiles: [{ id: 103, mimetype: 'image/png', name: { en: 'figure1.png' } }],
              },
            },
            {
              id: 3,
              label: 'media/image1.png',
              submissionFileId: 104,
              file: { id: 104, mimetype: 'image/png', name: { en: 'image1.png' } },
            },
          ],
        }),
      ],
    },
    {
      submission: { id: 2, status: 5, currentPublicationId: 2, publications: [] },
      publications: [
        publication(2, {
          title: { en: 'Rewilding the laboratory' },
          doiObject: { doi: '10.1234/three' },
          sectionId: 9,
          authors: [author(21, 0, 'Grace', 'Hopper')],
        }),
      ],
    },
    {
      submission: { id: 3, status: 5, currentPublicationId: 3, publications: [] },
      publications: [
        publication(3, { title: { en: 'Brand new' }, doiObject: { doi: '10.1234/new' } }),
      ],
    },
    {
      submission: { id: 4, status: 5, currentPublicationId: 4, publications: [] },
      publications: [publication(4, { title: { en: 'A trial' }, issueId: 6 })],
    },
  ],
}

const pubpubRecords: UnderlayRecord[] = [
  {
    id: 'tag-empirical',
    type: 'Collection',
    data: { kind: 'tag', title: 'Empirical', slug: 'empirical-articles', isPublic: true },
  },
  {
    id: 'tag-meta',
    type: 'Collection',
    data: { kind: 'tag', title: 'Meta-Research', slug: 'meta-research', isPublic: true },
  },
  {
    id: 'issue-2-1',
    type: 'Collection',
    data: {
      kind: 'issue',
      title: 'Volume 2 Issue 1',
      slug: 'volume-2-issue-1',
      isPublic: true,
      metadata: { volume: '2', issue: '1' },
    },
  },
  {
    id: 'pub-one',
    type: 'Pub',
    data: {
      kind: 'JournalArticle',
      title: 'Failing to Replicate: A Story',
      slug: 'failing',
      doi: '10.1234/ONE',
      publishedAt: '2022-03-03T10:00:00.000Z',
      licenseUri: 'https://creativecommons.org/licenses/by/4.0/',
      collectionIds: ['tag-empirical', 'issue-2-1'],
      latestReleaseId: 'rel-one',
    },
  },
  {
    id: 'pub-two',
    type: 'Pub',
    data: {
      kind: 'JournalArticle',
      title: 'Rewilding the Laboratory',
      slug: 'rewilding',
      doi: '10.1234/two',
      publishedAt: '2022-04-04T10:00:00.000Z',
      collectionIds: ['tag-meta', 'issue-2-1'],
      latestReleaseId: 'rel-two',
    },
  },
  {
    id: 'pub-three',
    type: 'Pub',
    data: {
      kind: 'JournalArticle',
      title: 'Something else entirely',
      slug: 'else',
      doi: '10.1234/three',
      publishedAt: '2022-05-05T10:00:00.000Z',
      latestReleaseId: 'rel-three',
    },
  },
  { id: 'rel-one', type: 'Release', data: { pubId: 'pub-one' } },
  { id: 'rel-two', type: 'Release', data: { pubId: 'pub-two' } },
  { id: 'rel-three', type: 'Release', data: { pubId: 'pub-three' } },
  {
    id: 'a1',
    type: 'PubAttribution',
    data: {
      pubId: 'pub-one',
      name: 'Ada Lovelace',
      orcid: '0000-0001-2345-6789',
      affiliation: 'Analytical Society',
      isAuthor: true,
      order: 0.25,
    },
  },
  {
    id: 'a2',
    type: 'PubAttribution',
    data: {
      pubId: 'pub-one',
      name: 'Charles Babbage',
      orcid: '0000-0009-8765-4321',
      isAuthor: true,
      order: 0.5,
    },
  },
  {
    id: 'a3',
    type: 'PubAttribution',
    data: { pubId: 'pub-two', name: 'Grace Hopper', isAuthor: true, order: 0.5 },
  },
]

const file = (bytes: Uint8Array, mediaType: string, fileName: string) => ({
  hash: sha256(bytes),
  bytes,
  mediaType,
  fileName,
})
const files: GalleyFiles = new Map([
  [101, file(pdf, 'application/pdf', 'one.pdf')],
  [102, file(html, 'text/html', 'one.html')],
  [103, file(png, 'image/png', 'figure1.png')],
  [104, file(png, 'image/png', 'image1.png')],
])

const { ojs: exported, skipped } = withoutTestIssues(ojs)
const pubpub = indexPubPub(pubpubRecords)
const matches = match(exported, pubpub)
const result = mapOjs({ ojs: exported, matches, files })
const record = (type: string, id: string) =>
  result.records.find((r) => r.type === type && r.id === id)

describe('match', () => {
  it('leaves out test issues', () => {
    expect(skipped).toEqual([4])
    expect(exported.issues.map((i) => i.id)).toEqual([2])
  })

  it('matches by DOI, and by title when the DOI is another article’s', () => {
    expect(matches.pubs.get(1)?.id).toBe('pub-one')
    expect(matches.pubBy.get(1)).toBe('doi')
    expect(matches.pubs.get(2)?.id).toBe('pub-two')
    expect(matches.pubBy.get(2)).toBe('title')
    expect(matches.pubs.has(3)).toBe(false)
  })

  it('matches issues by volume and number', () => {
    expect(matches.issues.get(2)).toMatchObject({
      record: { id: 'issue-2-1' },
      by: 'volume and number',
    })
  })
})

describe('mapOjs', () => {
  it('keeps the PubPub id and slug of a matched article and fills the rest from OJS', () => {
    expect(record('Pub', 'pub-one')?.data).toEqual({
      kind: 'JournalArticle',
      title: 'Failing to replicate: a story',
      slug: 'failing',
      doi: '10.1234/one',
      publishedAt: '2022-03-03T10:00:00.000Z',
      createdAt: '2021-01-02T10:00:00.000Z',
      license: 'cc-by',
      licenseSpdx: 'CC-BY-4.0',
      licenseUri: 'https://creativecommons.org/licenses/by/4.0/',
      collectionIds: ['tag-empirical', 'issue-2-1'],
      latestReleaseId: ojsId('publication', 1),
      metadata: { ojsSubmissionId: 1, ojsPublicationId: 1, ojsStatus: 'scheduled' },
    })
  })

  it('takes PubPub’s DOI when OJS has another article’s', () => {
    expect(record('Pub', 'pub-two')?.data.doi).toBe('10.1234/two')
    expect(result.warnings.some((w) => w.includes('10.1234/three'))).toBe(true)
  })

  it('makes an id from the OJS submission for a new article, and no publication date', () => {
    const pub = record('Pub', ojsId('submission', 3))
    expect(pub?.data).toMatchObject({ slug: 'brand-new', doi: '10.1234/new' })
    expect(pub?.data.publishedAt).toBeUndefined()
  })

  it('turns galleys into the HTML text, downloads and assets of the release', () => {
    const release = record('Release', ojsId('publication', 1))!.data as any
    expect(release.exports).toEqual([
      {
        $asset: `ul:asset:${sha256(pdf)}`,
        fileName: 'one.pdf',
        mediaType: 'application/pdf',
        mimeType: 'application/pdf',
        format: 'pdf',
      },
    ])
    expect(release.abstractHtml).toBe('<p>An abstract.</p>')
    expect(release.keywords).toEqual(['failure', 'replication'])
    // The HTML's image now points at the image's hash, so the HTML file is a new one
    const linked = new TextEncoder().encode(
      `<h1>Intro</h1><p><img src="sha256:${sha256(png)}"></p>`,
    )
    expect(release.contentFile.$asset).toBe(`ul:asset:${sha256(linked)}`)
    expect(release.assets.map((a: any) => a.$asset)).toContain(`ul:asset:${sha256(png)}`)
    expect(result.files.map((f) => f.hash)).toContain(sha256(linked))
  })

  it('writes authors as attributions with full ORCID URLs', () => {
    expect(record('PubAttribution', ojsId('author', 11))?.data).toEqual({
      pubId: 'pub-one',
      name: 'Ada Lovelace',
      orcid: 'https://orcid.org/0000-0001-2345-6789',
      affiliation: 'Analytical Society',
      isAuthor: true,
      order: 0,
    })
  })

  it('reuses PubPub’s type tags and issues, in OJS’s order', () => {
    expect(record('Collection', 'tag-empirical')?.data).toMatchObject({
      kind: 'tag',
      title: 'Empirical',
      slug: 'empirical-articles',
    })
    expect(record('Collection', 'issue-2-1')?.data).toMatchObject({
      kind: 'issue',
      title: 'Journal of Trial and Error Issue 2',
      slug: 'volume-2-issue-1',
      metadata: { volume: '2', issue: '1', ojsIssueId: 2 },
      pubIds: ['pub-one', ojsId('submission', 3), 'pub-two'],
    })
  })
})

describe('diffReport', () => {
  const report = diffReport(exported, pubpub, matches)
  const diffs = (id: number) => report.matched.find((a) => a.submissionId === id)?.diffs ?? []

  it('finds what OJS lacks or has otherwise', () => {
    expect(diffs(1)).toEqual([
      {
        field: 'ORCID',
        author: 'Charles Babbage',
        ojs: '(none)',
        pubpub: 'https://orcid.org/0000-0009-8765-4321',
      },
      { field: 'publication date', ojs: '(none)', pubpub: '2022-03-03' },
    ])
    expect(diffs(2).map((d) => d.field)).toEqual(['DOI', 'publication date', 'type', 'licence'])
  })

  it('lists PubPub articles OJS has none of', () => {
    expect(report.ojsOnly.map((a) => a.submissionId)).toEqual([3])
    expect(report.pubpubOnly.map((p) => p.slug)).toEqual(['else'])
    expect(reportMarkdown(report)).toContain(
      '| Matched by title, OJS DOI belongs to another article | 1 |',
    )
  })
})
