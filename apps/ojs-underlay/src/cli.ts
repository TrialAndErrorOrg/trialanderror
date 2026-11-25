#!/usr/bin/env node
/**
 * ojs-underlay: export JOTE's articles from OJS to Underlay records, compare them with PubPub's.
 *
 *   node --env-file=.env src/cli.ts --dry-run --files
 *   node --env-file=.env src/cli.ts --files --push centeroftrialanderror/jote-ojs-test
 *
 * See README.md for the environment and what each output file holds.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { parseArgs } from 'node:util'
import type { GalleyFiles } from './map.ts'
import { mapOjs } from './map.ts'
import { match } from './match.ts'
import type { OjsExport } from './ojs.ts'
import { OjsClient, loadOjs, mapLimit, text, withoutTestIssues } from './ojs.ts'
import type { PubPubIndex } from './pubpub.ts'
import { loadPubPub } from './pubpub.ts'
import { diffReport, reportMarkdown } from './report.ts'
import type { PushPlan, PushRecord, UnderlayFile } from './underlay/client.ts'
import { UnderlayReader, UnderlayWriter } from './underlay/client.ts'
import { sha256 } from './underlay/hash.ts'
import { schemas } from './underlay/schemas.ts'

const HELP = `Usage: node src/cli.ts [options]

Reads JOTE's published and scheduled articles from OJS, maps them to Underlay records
(Pub, Release, PubAttribution, Collection), matches them to PubPub's export by DOI, and
writes the records, a summary and an OJS/PubPub difference report to --out.

Options
  --out <dir>          where to write (default: out)
  --statuses <list>    OJS submission statuses to export (default: 3,5, published and scheduled)
  --pubpub <source>    PubPub's export: owner/slug on Underlay or an .ndjson file
                       (default: centeroftrialanderror/jote)
  --no-pubpub          don't match against PubPub: every id and slug comes from OJS
  --files              download galley files, so releases get their PDF and other downloads
                       (needs the easyFileApi plugin on the OJS that serves them)
  --dry-run            write to --out only. With --push, also show what a push would change
  --push <owner/slug>  push the records to this Underlay collection, created private if missing.
                       Refuses jote, jrn, blog and any collection another app pushed to
  --prune              with --push: delete records of the written types that this run didn't make
  --allow-public       with --push: allow pushing to a public collection
  --message <text>     the version message (default: "OJS export <date>")
  --locale <code>      OJS locale to read (default: en)
  --help

Environment
  OJS_URL              the journal's OJS address, e.g. http://localhost:8090/index.php/jote
  OJS_TOKEN            an OJS API token of an editor, manager or admin
  OJS_FILES_URL        where to download galley files from, if not OJS_URL
  OJS_FILES_TOKEN      the API token for OJS_FILES_URL, if not OJS_TOKEN
  UNDERLAY_URL         default https://www.underlay.org
  UNDERLAY_TOKEN       an Underlay API key: read for --pubpub, write for --push
`

const { values: args } = parseArgs({
  options: {
    out: { type: 'string', default: 'out' },
    statuses: { type: 'string', default: '3,5' },
    pubpub: { type: 'string', default: 'centeroftrialanderror/jote' },
    'no-pubpub': { type: 'boolean', default: false },
    files: { type: 'boolean', default: false },
    'dry-run': { type: 'boolean', default: false },
    push: { type: 'string' },
    prune: { type: 'boolean', default: false },
    'allow-public': { type: 'boolean', default: false },
    message: { type: 'string' },
    locale: { type: 'string', default: 'en' },
    help: { type: 'boolean', default: false },
  },
})

const log = (line: string) => console.error(line)

function env(name: string, fallback?: string) {
  const value = process.env[name] || fallback
  if (!value) throw new Error(`Set ${name} (see --help)`)
  return value
}

/** Download every galley file (and HTML galleys' images), caching them in <out>/.cache */
async function fetchFiles(ojs: OjsExport, client: OjsClient, cacheDir: string, warnings: string[]) {
  const files: GalleyFiles = new Map()
  const wanted: { id: number; name: string; mediaType: string; where: string }[] = []
  for (const { submission, publications } of ojs.submissions) {
    for (const p of publications) {
      for (const g of p.galleys ?? []) {
        if (g.urlRemote)
          warnings.push(
            `Submission ${submission.id}: galley "${g.label}" is a remote link, not a file`,
          )
        if (!g.file || g.submissionFileId == null) continue
        const where = `submission ${submission.id}, galley "${g.label}"`
        wanted.push({
          id: g.submissionFileId,
          name: text(g.file.name),
          mediaType: g.file.mimetype ?? '',
          where,
        })
        for (const d of g.file.dependentFiles ?? []) {
          wanted.push({ id: d.id, name: text(d.name), mediaType: d.mimetype ?? '', where })
        }
      }
    }
  }
  await mkdir(cacheDir, { recursive: true })
  let failed = 0
  await mapLimit(wanted, 4, async (f) => {
    const cached = path.join(cacheDir, String(f.id))
    let bytes: Uint8Array
    try {
      bytes = new Uint8Array(await readFile(cached))
    } catch {
      try {
        bytes = await client.file(f.id)
        await writeFile(cached, bytes)
      } catch (error) {
        failed++
        warnings.push(
          `Could not download file ${f.id} (${f.where}): ${(error as Error).message.slice(0, 120)}`,
        )
        return
      }
    }
    files.set(f.id, {
      hash: sha256(bytes),
      bytes,
      mediaType: f.mediaType || 'application/octet-stream',
      fileName: f.name || undefined,
    })
  })
  log(`Files: ${files.size} downloaded or cached, ${failed} failed`)
  return files
}

async function writeRecords(dir: string, records: PushRecord[]) {
  await mkdir(dir, { recursive: true })
  const byType = new Map<string, PushRecord[]>()
  for (const r of records) byType.set(r.type, [...(byType.get(r.type) ?? []), r])
  for (const [type, list] of byType) {
    const lines = list
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((r) => JSON.stringify(r))
      .join('\n')
    await writeFile(path.join(dir, `${type}.ndjson`), `${lines}\n`)
  }
}

function summaryMarkdown(opts: {
  ojsUrl: string
  pubpub?: string
  result: ReturnType<typeof mapOjs>
  plan?: PushPlan
  target?: string
  pushed?: string
}) {
  const { result } = opts
  const count = (type: string) => result.records.filter((r) => r.type === type).length
  const lines = [
    '# OJS export',
    '',
    `From ${opts.ojsUrl}, ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC.`,
    opts.pubpub
      ? `Ids and slugs of articles already on PubPub come from ${opts.pubpub}.`
      : 'Not matched against PubPub.',
    '',
    '| Records | Count |',
    '| --- | ---: |',
    ...['Pub', 'Release', 'PubAttribution', 'Collection'].map((t) => `| ${t} | ${count(t)} |`),
    `| Files attached | ${result.files.length} |`,
    '',
  ]
  if (opts.plan) {
    lines.push(
      `## Push to ${opts.target}`,
      '',
      `Against ${opts.plan.base ?? 'an empty collection'}: ${opts.plan.upserts.length} records to add or change, ${opts.plan.deletes.length} to delete${opts.plan.schemasChanged ? ', schemas change' : ''}.`,
      opts.pushed ? `Result: ${opts.pushed}.` : 'Dry run: nothing was pushed.',
      '',
    )
  }
  lines.push(
    '## Articles',
    '',
    '| Submission | Slug | Id from | DOI | Published | Type | Issue | Galleys |',
    '| ---: | --- | --- | --- | --- | --- | --- | --- |',
    ...result.articles
      .map((a) =>
        [
          a.submissionId,
          `\`${a.slug}\``,
          a.identity === 'pubpub' ? 'PubPub' : 'OJS',
          a.doi ?? '',
          a.publishedAt?.slice(0, 10) ?? '(none)',
          a.kind ?? '',
          a.issue ?? '',
          a.galleys.map((g) => `${g.label}${g.included ? '' : ' (no file)'}`).join(', '),
        ]
          .map((c) => String(c).replace(/\|/g, '\\|'))
          .join(' | '),
      )
      .map((r) => `| ${r} |`),
    '',
    '## Warnings',
    '',
    ...(result.warnings.length ? result.warnings.map((w) => `- ${w}`) : ['None.']),
    '',
  )
  return lines.join('\n')
}

async function main() {
  if (args.help) {
    console.log(HELP)
    return
  }
  const out = path.resolve(args.out!)
  const statuses = args.statuses!.split(',').map(Number)
  const ojsUrl = env('OJS_URL')
  const client = new OjsClient({ url: ojsUrl, token: process.env.OJS_TOKEN })
  const underlayUrl = process.env.UNDERLAY_URL || 'https://www.underlay.org'
  const reader = new UnderlayReader(underlayUrl, process.env.UNDERLAY_TOKEN)

  log(`Reading OJS at ${ojsUrl} (statuses ${statuses.join(', ')})`)
  const loaded = withoutTestIssues(await loadOjs(client, statuses))
  const ojs = loaded.ojs
  if (loaded.skipped.length) log(`Skipped submissions in test issues: ${loaded.skipped.join(', ')}`)
  log(
    `OJS: ${ojs.submissions.length} submissions, ${ojs.issues.length} issues, ${ojs.sections.length} sections`,
  )

  let pubpub: PubPubIndex | undefined
  if (!args['no-pubpub']) {
    pubpub = await loadPubPub(args.pubpub!, reader)
    log(`PubPub: ${pubpub.pubs.size} pubs from ${args.pubpub}`)
  }
  const matches = match(ojs, pubpub)
  const byTitle = [...matches.pubBy.values()].filter((by) => by === 'title').length
  log(
    `Matched ${matches.pubs.size} of ${ojs.submissions.length} (${byTitle} by title), ${matches.issues.size} issues`,
  )

  const warnings: string[] = loaded.skipped.map(
    (id) => `Submission ${id} is in a test issue and was left out`,
  )
  let files: GalleyFiles = new Map()
  if (args.files) {
    const filesClient = new OjsClient({
      url: process.env.OJS_FILES_URL || ojsUrl,
      token: process.env.OJS_FILES_TOKEN || process.env.OJS_TOKEN,
    })
    files = await fetchFiles(ojs, filesClient, path.join(out, '.cache', 'files'), warnings)
  }

  const result = mapOjs({ ojs, matches, files, locale: args.locale })
  result.warnings.unshift(...warnings)

  await mkdir(out, { recursive: true })
  await writeRecords(path.join(out, 'records'), result.records)
  await writeFile(
    path.join(out, 'files.json'),
    `${JSON.stringify(
      result.files.map((f: UnderlayFile) => ({
        hash: f.hash,
        fileName: f.fileName,
        mediaType: f.mediaType,
        size: f.bytes.length,
      })),
      null,
      2,
    )}\n`,
  )
  if (pubpub) {
    const others = await client.submissions([1, 3, 4, 5].filter((s) => !statuses.includes(s)))
    const report = diffReport(ojs, pubpub, matches, others, args.locale)
    await writeFile(path.join(out, 'report.json'), `${JSON.stringify(report, null, 2)}\n`)
    await writeFile(path.join(out, 'report.md'), reportMarkdown(report))
    log(
      `Report: ${report.matched.filter((a) => a.diffs.length).length} matched articles differ, ${report.ojsOnly.length} OJS only, ${report.pubpubOnly.length} PubPub only`,
    )
  }

  let plan: PushPlan | undefined
  let pushed: string | undefined
  if (args.push) {
    const writer = new UnderlayWriter(underlayUrl, env('UNDERLAY_TOKEN'), args.push)
    const options = {
      records: result.records,
      schemas,
      files: result.files,
      prune: args.prune,
      allowPublic: args['allow-public'],
      message: args.message ?? `OJS export ${new Date().toISOString().slice(0, 10)}`,
      log,
    }
    plan = await writer.plan(options)
    if (args['dry-run']) {
      log(
        `Dry run: a push to ${args.push} would send ${plan.upserts.length} upserts and ${plan.deletes.length} deletes`,
      )
    } else {
      const outcome = await writer.push(options)
      pushed =
        outcome.status === 'committed'
          ? `committed ${outcome.semver}`
          : `nothing to push (${outcome.reason})`
      log(`Push: ${pushed}`)
    }
  }

  await writeFile(
    path.join(out, 'summary.md'),
    summaryMarkdown({
      ojsUrl,
      pubpub: pubpub ? args.pubpub : undefined,
      result,
      plan,
      target: args.push,
      pushed,
    }),
  )
  log(
    `Wrote ${result.records.length} records to ${path.join(out, 'records')}, summary.md${pubpub ? ', report.md' : ''}`,
  )
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
