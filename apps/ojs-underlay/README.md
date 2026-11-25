# ojs-underlay

Exports the Journal of Trial and Error's articles from OJS to Underlay records, in the shape
PubPub's exporter writes and the site (`apps/site`, `src/lib/sources/journal.ts`) reads. It is
the first step towards publishing the journal from OJS instead of PubPub. The record shape is
described in the planning note `jote/_notes/underlay-article-records.md`.

It also compares every OJS article with its PubPub counterpart and writes the differences as a
report, the list to work through when backfilling OJS from PubPub.

First version, run against a local OJS 3.5 with a copy of the live database. Nothing writes to
the site's collections: pushing is only allowed to a scratch collection (see *Pushing*).

## Running it

Node 24 or later runs the TypeScript directly. There are no dependencies.

```sh
cd apps/ojs-underlay
cat > .env <<'EOF'
OJS_URL=http://localhost:8090/index.php/jote
OJS_TOKEN=<an OJS API token of an editor or admin>
UNDERLAY_TOKEN=<an Underlay API key>
EOF

# Records, summary and report in ./out, nothing pushed
node --env-file=.env src/cli.ts --dry-run

# Also download the galley files, so releases get their PDF and LaTeX downloads
node --env-file=.env src/cli.ts --dry-run --files

# Push to a scratch collection (created private if it doesn't exist)
node --env-file=.env src/cli.ts --files --push centeroftrialanderror/jote-ojs-test
```

`node src/cli.ts --help` lists every option. The useful ones:

| Option | What it does |
| --- | --- |
| `--out <dir>` | Where to write. Default `out` (ignored by git) |
| `--statuses 3,5` | OJS submission statuses to export. Default published (3) and scheduled (5) |
| `--pubpub <source>` | PubPub's export, as `owner/slug` on Underlay or a local `.ndjson`. Default `centeroftrialanderror/jote` |
| `--no-pubpub` | Skip matching: every id and slug comes from OJS |
| `--files` | Download galley files through the easyFileApi plugin |
| `--dry-run` | Write only. With `--push`, also say what a push would change |
| `--push <owner/slug>` | Push the records as a new version of that collection |
| `--prune` | With `--push`, delete records of the written types that this run didn't make |

Environment: `OJS_URL`, `OJS_TOKEN`, optionally `OJS_FILES_URL` and `OJS_FILES_TOKEN` (download
files from another OJS than the metadata, for example live while the metadata comes from a local
copy), `UNDERLAY_URL` (default `https://www.underlay.org`) and `UNDERLAY_TOKEN`.

### What it writes

| File | What |
| --- | --- |
| `records/<Type>.ndjson` | The records, one per line, `{id, type, data}`, as they would be pushed |
| `files.json` | The files the records attach: hash, name, media type, size |
| `summary.md` | Counts, every article with its slug, where its id comes from and its galleys, warnings |
| `report.md`, `report.json` | OJS against PubPub, article by article (see below) |
| `.cache/files/` | Downloaded galley files, so a rerun doesn't fetch them again |

### A local OJS to run it against

`TrialAndErrorOrg/ojs-docker`, branch `ojs-3.5`, has `compose.local.yml`, which upgrades a copy
of the live database to 3.5 (see its README). Two things this needed on 2026-11-25:

- The `funding` plugin's URL in `plugins.lock` is gone: the plugin moved from `ajnyga/funding` to
  `pkp/funding`, and its 3.5 release is now
  `https://github.com/pkp/funding/releases/download/3.5.0.3/funding-stable-3_5_0.tar.gz` (md5 not
  checked). The image doesn't build until the lock points there.
- An API token. The copy's API key secret is `local`, so live tokens don't work. Give a user an
  `apiKey` and `apiKeyEnabled` in `user_settings` and sign `["<apiKey>"]` as an HS256 JWT with the
  secret `local`, as OJS's own form does.

The copy has no submission files (they live on live's files volume, not in the database), so
`--files` against it fails for every file. Point `OJS_FILES_URL` and `OJS_FILES_TOKEN` at an OJS
that has them.

## How OJS becomes records

| OJS | Record | Notes |
| --- | --- | --- |
| submission, current publication | `Pub` | `metadata.ojsSubmissionId`, `ojsPublicationId`, `ojsStatus` |
| every exported publication (version) | `Release` | `abstractHtml` and `keywords` from OJS. `latestReleaseId` is the current publication's |
| author | `PubAttribution` | name inline, no `User` records. ORCID as `https://orcid.org/...`. Affiliations joined with "; " |
| section | `Collection`, `kind: "tag"` | the article type, see `SECTION_KINDS` in `src/match.ts` |
| issue | `Collection`, `kind: "issue"` | `metadata.volume`, `issue`, `publicationDate`, `ojsIssueId`. `pubIds` in section order, then OJS's order. The description becomes `layoutHtml` |
| galley | `Release.exports`, `contentFile`, `assets` | `pdf`, `tex`, `bib`, `docx`, `epub`, `jats` become downloads. An HTML galley becomes `contentFile`, with its images as `sha256:<hex>` and listed in `assets`. Figure galleys (the LaTeX source's images) go to `assets` |

**Ids.** Records made from OJS objects get a UUIDv5 from the object (`src/ids.ts`, namespace made
from the journal's OJS address), so a rerun updates the same records. An article, issue or type
that is already on PubPub keeps PubPub's id and slug, and an issue keeps PubPub's kind (Rolling
Articles is a tag there). Everything else comes from OJS, with two exceptions:

- `publishedAt`: OJS has a publication date for only 11 of the 74 exported articles, since it
  only schedules them. A matched article keeps PubPub's date. An article that isn't on PubPub
  and has no OJS date gets none, and the site doesn't show it.
- DOI, for articles OJS gave another article's DOI (two, see the report). Crossref resolves the
  DOI PubPub deposited, so that one is kept.

**Matching.** By DOI. When the PubPub pub with OJS's DOI has a title with almost nothing in common
with OJS's (title similarity below 0.3) while another PubPub pub has nearly the same title (0.8 or
more), the DOI is wrong in OJS and the article is matched by title instead. Issues are matched by
title, then volume and number, then by where their articles are on PubPub. Type tags by title.

**Statuses.** JOTE never publishes in OJS. Accepted articles stay *scheduled* (status 5), in an
issue that is never published, and are published on PubPub. So the default is to export
scheduled articles too. Submissions in OJS's "TEST ISSUE" are left out.

**File references** are written as `{"$asset": "ul:asset:<hex>", fileName, mediaType, mimeType}`.
`mediaType` is the protocol's name and decides how Underlay serves the bytes. `mimeType` is what
PubPub's records in `jote` carry and what the site reads today. Drop it once the site reads
`mediaType`. PubPub's newest exporter (`kf/pubpub` `a0884cc3e`) also writes `ul:asset:<hex>`
instead of `sha256:<hex>` in HTML. This exporter keeps `sha256:` until the site reads both.

**Schemas** are PubPub's (`src/underlay/schemas.ts`), with `abstractHtml` and `keywords` added to
`Release`. PubPub's records stay valid under them.

### Not done yet

- **Covers.** OJS's article and issue cover images live in its public files folder, not in the
  API. They need a download from `public/journals/1/` and become `avatar`.
- **PubEdge.** OJS has no links between submissions, so peer reviews, commentaries and replies
  can't come from it. Until they do, they stay PubPub's.
- **HTML.** No OJS galley is HTML today, so no release has a `contentFile`. The text will come
  from Typst's HTML export: the import adapter in `jote/typst/html-export.md` (§Proof of
  concept) turns it into PubPub's shape and belongs in `mapRelease()` in `src/map.ts`, at the
  `format === 'html'` branch, before the images are linked.
- **Writing back to OJS.** The report is the input for backfilling OJS from PubPub (dates, ORCIDs,
  sections, issues, URL paths). That needs write access to OJS and isn't automated.

## The report

`report.md` compares each exported OJS article with the PubPub pub it matched: DOI, title,
authors (who, in which order, names), ORCID, affiliation, publication date, type (OJS section
against PubPub tag), issue and licence. It also lists issues side by side, OJS articles with no
PubPub pub, and PubPub articles (those the site shows) with no exported OJS submission, saying
where they are in OJS if they are there under another status.

Comparisons ignore case, punctuation and diacritics. Authors are paired by ORCID, then name,
then family name, so a reordering shows as "author order" and not as wrong names.

## Pushing

`--push` writes only to a collection this tool owns:

- `jote`, `jrn` and `blog` are refused, whatever the owner.
- A collection whose latest version another app pushed (Underlay's `appId`) is refused.
- A missing collection is created **private**. A public one is refused without `--allow-public`.
  The export holds scheduled articles that may not be public yet, so keep test collections
  private.

A push reads the head's manifest, sends only records whose hash changed (`src/underlay/hash.ts`
reproduces Underlay's record hashes exactly, checked against all 724 records of `jote` v2.2.0),
uploads only the files Underlay doesn't hold, and keeps the head's other types and their
schemas. Deletes happen only with `--prune`.

The key needs the **write** scope. A read key gets 403 when the collection is created. Either
use an unconfined write key (it creates the collection on the first push), or create the
collection on underlay.org first, private, and then a write key confined to it at
`https://www.underlay.org/centeroftrialanderror/settings/keys` (a confined key can't create
collections). The push is covered by a test against a fake Underlay
(`src/underlay/client.test.ts`), but has not run against the real one yet.

### Handing over `jote`

The planning note recommends that this exporter (or the converter) becomes the only writer of
`jote` once PubPub's integration is switched off. Before that:

- Remove `jote` from `PROTECTED_COLLECTIONS` and allow a head pushed by `pubpub`, in one
  deliberate commit.
- Push without `--prune`: PubPub's records for articles OJS doesn't have (the 2020 articles, peer
  reviews, pages) must stay.
- Attributions: OJS's have their own ids, so a matched article would end up with PubPub's
  attributions and OJS's. Either delete PubPub's for the articles written, or reuse their ids.
- Releases: a matched article's `latestReleaseId` moves to OJS's release, which has no HTML yet.
  Don't push an article's records before its HTML exists, or the site shows it without text.

## Peer reviews

Not exported. What OJS holds, from the live database of 2026-10-22 (counts only):

- Reviews are review assignments in review rounds. The text is in comments marked as peer review,
  each either visible to the authors or for the editors only, plus files reviewers attach.
- JOTE uses no review form, so there are no form responses and no question that could have
  recorded consent.
- Each assignment has a review method. "Open" (author and reviewer see each other's names) is
  used for most assignments since 2023, "double anonymous" before.
- Consent is only implied by the invitation a reviewer accepted. Since March 2025 the invitation
  says the process is fully open and asks reviewers who don't agree to "your name and review
  being open" to decline. Before that, from 2022, the reviewer guidelines in it said that the
  reviewers' names would be shown with the published article, which says nothing about the text.

So the data can say who was told what, but not that a reviewer agreed to publication of their
report. A consent question in a review form (OJS 3.5) is the way to start recording it.
