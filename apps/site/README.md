# trialanderror.org

The website of the Center of Trial and Error: the main site, the blog (formerly
blog.trialanderror.org) and the Journal of Trial and Error's articles, in one
Astro site.

Everything is built into plain HTML files ahead of time. The only parts that run
on a server are draft previews (`/preview/...`, `/api/draft`), `/admin`'s
sign-in and the converter's way into OJS (`/admin/ojs/...`).

`/admin/convert` is the JOTE converter (`apps/converter`): a `.docx` manuscript
to LaTeX and Typst, converted in the browser. Editors signed in with Microsoft
can also search OJS with their own OJS API key.

## Where things come from

| What | Where it lives | How to change it |
| --- | --- | --- |
| Homepage, About and other section-built pages | site-content: `pages/*.yaml` | `/admin`, or edit the file |
| The journal's own section-built pages (For Authors) | site-content: `pages/journal/*.yaml` | `/admin` → Journal pages |
| Menus, footer, social links | site-content: `settings/navigation.yaml` | `/admin` → Settings → Menus |
| Site name, newsletter, analytics | site-content: `settings/site.yaml` | `/admin` → Settings → Site |
| Images and files uploaded in `/admin` | site-content: `uploads/` | `/admin` |
| Colours, fonts, borders, shadows | `src/styles/theme.css` | edit the file |
| Blog posts, categories, tags | site-content: `blog/*.md`, `categories/` | `/admin` → Blog |
| Team members and blog authors | site-content: `people/*.yaml` | `/admin` → People |
| Free-text pages (donate, events, award calls) | Strapi → Pages | Strapi |
| Journal articles | Underlay ([centeroftrialanderror/jote](https://www.underlay.org/centeroftrialanderror/jote)), exported from PubPub | PubPub |

site-content is its own repository,
[TrialAndErrorOrg/site-content](https://github.com/TrialAndErrorOrg/site-content), so
saving in `/admin` doesn't add commits to this one. A page in site-content wins
over a Strapi page with the same slug.

## Docs

| | |
| --- | --- |
| [docs/editing.md](docs/editing.md) | For editors: blog posts, pages, signing in to `/admin` |
| [docs/development.md](docs/development.md) | Running it, secrets, restyling, new section types, previews |
| [docs/admin-sign-in.md](docs/admin-sign-in.md) | Microsoft sign-in for `/admin`: how it works, the Entra app and GitHub App, adding editors |
| [docs/deploying.md](docs/deploying.md) | GitHub Actions, rebuilds, 1Password, Coolify, redirects |

Quick start, from the repository root, with site-content cloned next to it:
`pnpm install && pnpm turbo run dev --filter=site`.

## Layout

```
src/
  content.config.ts  the section types and their fields
  integrations/      content.ts (reads site-content), pagefind.ts (search index)
  styles/theme.css   every colour, font and size token
  styles/global.css  shared component classes (.card, .button, .label, .prose-site...)
  components/        Header, Footer, cards; sections/ holds one component per section type
  layouts/           Base (every page), Post (blog post), Page (CMS page), BlogList
  lib/sources/       one module per content source: blog (site-content, or Strapi), journal (Underlay), pages
  lib/admin.ts       /admin's sign-in (sveltia-gateway), pages/admin/ its routes
  admin/convert/     the converter (apps/converter) with the site's sign-in, pages/admin/ojs/ its OJS proxy
  pages/             routes
  admin/config.yml   the /admin editing interface
.env.schema          every environment variable, secrets as 1Password references
Dockerfile           packages the built site, see docs/deploying.md
```

site-content holds `pages/` (section-built pages, `index.yaml` is the
homepage, `journal/` the journal's own pages), `blog/` (posts, Markdown), `people/`, `categories/`, `settings/`
(`site.yaml`, `navigation.yaml`) and `uploads/`.

## What's where

### Journal

`/journal` lists the articles from Underlay, filtered by type
(`/journal/kind/...`) and issue (`/journal/issue/...`). `/journal/<slug>` renders
the latest release's HTML export with downloads (PDF, EPUB, Word, JATS, LaTeX)
and citation metadata. Set `ARTICLE_PAGES = false` in
`src/lib/sources/journal.ts` to link to PubPub instead and skip those pages.
Article HTML is cached by hash in `node_modules/.cache/underlay`.

`/jrn` is the archive of the Journal for Reproducibility in Neuroscience
([centeroftrialanderror/jrn](https://www.underlay.org/centeroftrialanderror/jrn)),
which is no longer updated. It uses the same article pages, in grey. Each
journal is an entry in `JOURNALS` in `src/lib/sources/journal.ts` (its
collection, path, article types and issue tags), and `journal("jrn")` gives
its loaders.

### People

`/people/<slug>` has a page for every team member and blog author, with their
posts and journal articles (`src/lib/people.ts`). Journal articles join a
person on ORCID iD, or on the exact full name when the iDs don't conflict.
`/blog/author/<slug>` redirects there, from a person's slug and their old ones
(`aliases`).

### Built at build time, not by services

- Share images (`/og/...png`) are drawn with satori in `src/lib/og.ts`, using
  the colours from `theme.css`. Cached in `node_modules/.astro/og`.
- Feeds: `/rss.xml` (blog) and `/journal/rss.xml`.
- Search is [Pagefind](https://pagefind.app): an index written after the build
  (`src/integrations/pagefind.ts`) and searched in the browser at `/search`.
  Only elements marked `data-pagefind-body` are indexed.

### Secrets and hosting

Secrets live in the 1Password Website vault. varlock reads them for `dev`,
`build` and the running server (`.env.schema`), so `OP_TOKEN` is the only
secret GitHub or Coolify hold. GitHub Actions builds the image, Coolify runs
it ([docs/deploying.md](docs/deploying.md)).
