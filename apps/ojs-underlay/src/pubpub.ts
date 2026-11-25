import { readFile } from 'node:fs/promises'
import type { UnderlayReader } from './underlay/client.ts'
import { normalizeDoi, normalizeOrcid } from './text.ts'

/*
 * PubPub's export of the journal on Underlay (`centeroftrialanderror/jote`), read to match OJS
 * articles to the PubPub pubs they already are, and to compare their metadata.
 */

export interface UnderlayRecord<T = any> {
  id: string
  type: string
  data: T
  hash?: string
}

export interface PubPubAuthor {
  name: string
  orcid?: string
  affiliation?: string
}

export interface PubPubIndex {
  /** Every record, by type */
  byType: Map<string, UnderlayRecord[]>
  pubs: Map<string, UnderlayRecord>
  /** Pubs by normalized DOI */
  byDoi: Map<string, UnderlayRecord>
  collections: Map<string, UnderlayRecord>
  /** A pub's authors in order, with name and ORCID from the linked User when the credit has none */
  authors: (pubId: string) => PubPubAuthor[]
  /** The public collections a pub is in */
  collectionsOf: (pubId: string) => UnderlayRecord[]
}

export function indexPubPub(records: UnderlayRecord[]): PubPubIndex {
  const byType = new Map<string, UnderlayRecord[]>()
  for (const record of records) {
    const list = byType.get(record.type) ?? []
    list.push(record)
    byType.set(record.type, list)
  }
  const list = (type: string) => byType.get(type) ?? []
  const pubs = new Map(list('Pub').map((r) => [r.id, r]))
  const collections = new Map(list('Collection').map((r) => [r.id, r]))
  const users = new Map(list('User').map((r) => [r.id, r.data]))

  const byDoi = new Map<string, UnderlayRecord>()
  for (const pub of pubs.values()) {
    const doi = normalizeDoi(pub.data.doi)
    if (doi) byDoi.set(doi, pub)
  }

  const attributions = new Map<string, UnderlayRecord[]>()
  for (const a of list('PubAttribution')) {
    if (!a.data.isAuthor) continue
    const forPub = attributions.get(a.data.pubId) ?? []
    forPub.push(a)
    attributions.set(a.data.pubId, forPub)
  }

  const authors = (pubId: string): PubPubAuthor[] =>
    (attributions.get(pubId) ?? [])
      .slice()
      .sort((a, b) => (a.data.order ?? 0) - (b.data.order ?? 0))
      .map((a) => {
        const user = a.data.userId ? users.get(a.data.userId) : undefined
        return {
          name: (a.data.name || user?.name || '').trim(),
          orcid: normalizeOrcid(a.data.orcid || user?.orcid),
          affiliation: a.data.affiliation?.trim() || undefined,
        }
      })
      .filter((a) => a.name)

  const collectionsOf = (pubId: string) =>
    ((pubs.get(pubId)?.data.collectionIds ?? []) as string[])
      .map((id) => collections.get(id))
      .filter((c): c is UnderlayRecord => Boolean(c?.data.isPublic))

  return { byType, pubs, byDoi, collections, authors, collectionsOf }
}

/** PubPub's records from an ndjson file, or the collection's latest version on Underlay */
export async function loadPubPub(source: string, reader: UnderlayReader): Promise<PubPubIndex> {
  if (source.endsWith('.ndjson')) {
    const text = await readFile(source, 'utf8')
    return indexPubPub(
      text
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line)),
    )
  }
  const [owner, slug] = source.split('/')
  return indexPubPub(await reader.records(owner, slug))
}
