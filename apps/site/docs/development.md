# Working on the site

## Running it

The site is `apps/site` in the `trialanderror` monorepo. Its content is in
site-content, checked out next to it. From the repository root:

```sh
git clone https://github.com/TrialAndErrorOrg/site-content ../site-content   # or set CONTENT_DIR
pnpm install
pnpm turbo run dev --filter=site           # http://localhost:4321
pnpm turbo run build --filter=site...      # into apps/site/dist, then `pnpm --filter site start`
```

Turbo builds the workspace packages the site uses (`sveltia-gateway`) first.
The site is not formatted by the repository's `oxfmt`, which can't read
`.astro` files. It keeps its own style (tabs, double quotes).

## Secrets

`dev`, `build` and `start` run through [varlock](https://varlock.dev), which
reads `.env.schema`: plain settings with their defaults, and the tokens as
references to the 1Password Website vault. The 1Password desktop app asks once
per session.

Without access to the vault, put `ONEPASSWORD=false` and your own values in
`apps/site/.env.local`. Most tokens are optional (published content is
public). `pnpm exec varlock load` in `apps/site` shows what was resolved, with
secrets hidden.

## Content

`src/integrations/content.ts` finds site-content. Pages are read from
`<site-content>/pages`, settings are imported as `@content/settings/*.yaml`,
and `uploads/` is served at `/uploads` in dev and copied into the build.

## Restyling

Change the values in `src/styles/theme.css`. Components only use those tokens
(`bg-accent`, `border-ink`, `shadow-hard`, `font-heading`) and the classes in
`global.css`, so a new palette or font is a one-file change. To change how all
cards or buttons look, edit `.card` or `.button` in `global.css`.

## Adding a section type

1. Make `src/components/sections/MySection.astro`.
2. Add its fields to the `section` union in `src/content.config.ts`.
3. Register it in `src/components/Sections.astro`.
4. Describe its fields under `sections.types` in `src/admin/config.yml`, so
   editors can use it.

## The blog

Posts, people and categories are content collections (`src/content.config.ts`)
read from site-content by `lib/sources/blog-content.ts`. Images under
`/uploads` are found with an `import.meta.glob` over `@content/uploads`, so
Astro resizes them like remote ones. Links to Unsplash are remote images.

They came out of Strapi with `scripts/blog-to-content.ts` (2026-10-14), which
only reads Strapi and can be run again to start over. It turned the HTML, much
of it pasted from Word, into Markdown, merged team members and guest authors
into one file per person, and made the images WebP. The 170 MB lecture video in
`video_professor_peter_bergeijk_economics` was too large and still plays from
Strapi.

The live preview in `/admin` is `src/admin/preview.ts`: a copy of the top of
`layouts/Post.astro`, drawn with React (which Sveltia provides) and the site's
CSS. A change to the post page's header belongs in both.

Components only see the types in `src/lib/types.ts`. Each source converts its
data into those. `BLOG_SOURCE=strapi` reads Strapi again, and `underlay` reads
`blog-underlay.ts`.

## Previews

Blog drafts are previewed in `/admin` for now. The routes below are for
Strapi's preview button, and only matter while something is still in Strapi.

`/api/draft?secret=...&slug=...` is what Strapi's preview button calls. It
checks the secret against `DRAFT_SECRET`, sets a cookie for an hour and
redirects to `/preview/blog/<slug>`, which renders the draft from Strapi on
request. Pages left Strapi on 2026-11-25. To preview another kind of content later, add
a `src/pages/preview/<kind>/[slug].astro` with `export const prerender = false`.

## Build caches

Share images (`/og/...png`) are drawn with satori in `src/lib/og.ts`, cached in
`node_modules/.astro/og`. Journal article HTML is cached by hash in
`node_modules/.cache/underlay`. Keep `node_modules/.astro` and
`node_modules/.cache` between builds: a cold build downloads and resizes every
image and draws every share image again.
