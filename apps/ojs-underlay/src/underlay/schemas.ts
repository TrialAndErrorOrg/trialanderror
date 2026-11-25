/*
 * JSON Schemas of the record types this exporter writes. They are PubPub's (`kf/pubpub`
 * `server/underlay/mapping.ts`), so the records read like PubPub's and PubPub's records stay
 * valid under them, with two additions on Release: `abstractHtml` and `keywords`.
 *
 * Underlay refuses data fields a schema does not list, so every field `map.ts` writes is here.
 */

export type JsonSchema = Record<string, unknown>

const ASSET_PATTERN = '^ul:asset:[0-9a-f]{64}$'

/**
 * A file a record attaches. `mediaType` is the protocol's name for the type, and decides what
 * Underlay serves the bytes as. `mimeType` is what PubPub's records in `jote` carry today, and
 * what the site reads. Both are written until the site reads `mediaType`.
 */
const fileRef = {
  type: 'object',
  properties: {
    $asset: { type: 'string', pattern: ASSET_PATTERN },
    fileName: { type: 'string' },
    mediaType: { type: 'string' },
    mimeType: { type: 'string' },
    originalUrl: { type: 'string' },
  },
  required: ['$asset'],
}

/** A download of a Release, tagged with its format (pdf, tex, bib...) */
const exportRef = {
  type: 'object',
  properties: { ...fileRef.properties, format: { type: 'string' } },
  required: ['format', '$asset'],
}

const ref = (type: string) => ({ type: 'string', 'x-ref-type': type })

export const schemas: Record<string, JsonSchema> = {
  Collection: {
    type: 'object',
    properties: {
      title: { type: 'string' },
      slug: { type: 'string' },
      kind: { type: 'string' },
      doi: { type: 'string' },
      isPublic: { type: 'boolean' },
      avatar: fileRef,
      metadata: { type: 'object' },
      createdAt: { type: 'string', format: 'date-time' },
      communityId: ref('Community'),
      pubIds: { type: 'array', items: ref('Pub') },
      layoutHtml: { type: 'string' },
      layoutAssets: { type: 'array', items: fileRef },
      layoutBlocks: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            type: { type: 'string' },
            title: { type: 'string' },
            html: { type: 'string' },
          },
          required: ['id', 'type'],
        },
      },
    },
  },
  PubAttribution: {
    type: 'object',
    properties: {
      pubId: ref('Pub'),
      userId: ref('User'),
      name: { type: 'string' },
      orcid: { type: 'string' },
      avatar: fileRef,
      affiliation: { type: 'string' },
      roles: { type: 'array', items: { type: 'string' } },
      isAuthor: { type: 'boolean' },
      order: { type: 'number' },
    },
  },
  Pub: {
    type: 'object',
    properties: {
      title: { type: 'string' },
      htmlTitle: { type: 'string' },
      slug: { type: 'string' },
      description: { type: 'string' },
      htmlDescription: { type: 'string' },
      avatar: fileRef,
      downloads: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            ...fileRef.properties,
            type: { type: 'string' },
            createdAt: { type: 'string', format: 'date-time' },
          },
          required: ['type', '$asset'],
        },
      },
      metadata: { type: 'object' },
      labels: {
        type: 'array',
        items: {
          type: 'object',
          properties: { id: { type: 'string' }, title: { type: 'string' } },
        },
      },
      doi: { type: 'string' },
      kind: { type: 'string' },
      license: { type: 'string' },
      licenseSpdx: { type: 'string' },
      licenseUri: { type: 'string' },
      createdAt: { type: 'string', format: 'date-time' },
      publishedAt: { type: 'string', format: 'date-time' },
      communityId: ref('Community'),
      collectionIds: { type: 'array', items: ref('Collection') },
      latestReleaseId: ref('Release'),
    },
  },
  Release: {
    type: 'object',
    properties: {
      pubId: ref('Pub'),
      historyKey: { type: 'number' },
      createdAt: { type: 'string', format: 'date-time' },
      wordCount: { type: 'number' },
      contentFile: fileRef,
      assets: { type: 'array', items: fileRef },
      exports: { type: 'array', items: exportRef },
      // New: read by the site when present, instead of digging them out of the HTML
      abstractHtml: { type: 'string' },
      keywords: { type: 'array', items: { type: 'string' } },
    },
  },
}
