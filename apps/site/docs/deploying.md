# Deploying

```
push, site-content save, Strapi publish, daily
  └▶ .github/workflows/site.yml: build with secrets from 1Password
       └▶ ghcr.io/trialanderrororg/site:latest
            └▶ Coolify pulls it and restarts, the server reads its secrets from 1Password
```

## The workflow

`.github/workflows/site.yml` builds the site on GitHub Actions and publishes
the image `ghcr.io/trialanderrororg/site` (`:latest` and `:<commit>`), then
calls Coolify's deploy webhook. It checks out site-content next to the code.
A newer run cancels an older one.

It is quick because it keeps every cache between runs: pnpm's store, turbo's
cache for the workspace packages, and the site's own caches of resized images,
share images and journal article HTML (`node_modules/.astro`,
`node_modules/.cache`). The site's turbo `build` task is never cached itself,
since its pages come from services turbo can't see. The `Dockerfile` only
packages the build: `pnpm deploy --prod` leaves the built site with just its
production dependencies, and the image (Alpine, about 300 MB) copies that in.

Production dependencies are only what the server loads while it runs: Astro
bundles itself into `dist/server`, so `astro` and everything used only while
building are `devDependencies`. A package the server does import at runtime
must be in `dependencies`. If one is missing, the workflow's smoke test fails:
it runs the image and requests every route the server renders itself, before
anything is pushed.

## Rebuilding

Content is fetched at build time, so the site has to rebuild when it changes:

- `/admin`: every save is a commit to site-content, whose `rebuild` workflow
  starts `site.yml` (`gh workflow run`) with "Site rebuild token", a
  fine-grained token that may only start workflows in this repository
  (Actions: read and write).
- Strapi: a webhook on entry publish, unpublish, update and delete that sends
  a `content-updated` repository dispatch to this repository (GitHub's
  `POST /repos/TrialAndErrorOrg/trialanderror/dispatches`, with a token that
  may trigger workflows).
- Journal: a daily run picks up new articles from Underlay.
- Code: a push to `main` that touches the site.

## By hand

`scripts/release.sh` does what the workflow does, on your own machine: pull
site-content, build, package, build the image, smoke test it, push it and have
Coolify deploy it. For when the workflow can't, such as from a branch other than
`main`.

```sh
pnpm --filter site release                 # all of it
pnpm --filter site release --no-deploy     # push, but leave the running site alone
pnpm --filter site release --local         # only build and test the image
```

It needs Docker, the 1Password app, and `docker login ghcr.io` with a GitHub
token that has `write:packages`. The image gets the tags `latest` and the
commit, or `<commit>-dirty` with uncommitted changes. Coolify deploys `latest`.

## Secrets

One secret, `OP_TOKEN`, a 1Password service account token that can read the
Website vault and nothing else. Everything else is in that vault and named in
`apps/site/.env.schema`, which varlock reads:

- **In CI**, `OP_TOKEN` is an organisation secret shared with this repository
  and site-content. The build and deploy steps run through varlock, which hides
  the values in the log. No other step gets the token.
- **Where the site runs**, `OP_TOKEN` is set in Coolify. The image starts the
  server through `varlock run`, so it reads the secrets when it starts and a
  changed secret only needs a restart. The image itself holds no secrets.
- Anything set in the environment directly wins over 1Password.

A service account's vault access can't be changed after it is made. For
another vault, make a new service account and replace `OP_TOKEN`.

## Coolify

The app is a plain Docker image, so Coolify builds nothing and needs no access
to GitHub.

1. **Make the image public**, once, after the first run of `site.yml`: GitHub,
   TrialAndErrorOrg, Packages, `site`, Package settings, Change visibility,
   Public. (It holds the built site and its server, nothing secret.) Or keep it
   private and give Coolify registry credentials with `read:packages`.
2. **Create the app**: a project, its environment, **New**, **Docker Image**,
   image `ghcr.io/trialanderrororg/site`, tag `latest`.
3. **General**:
   - Domains: `https://trialanderror.org`. To try it first, use a subdomain such
     as `https://new.trialanderror.org` (a DNS record, and its own redirect URI
     in the Entra app, see [admin-sign-in.md](admin-sign-in.md)). Before moving
     the main domain, take it off the old Next.js app.
   - Ports Exposes: `4321`.
4. **Environment variables**, not build variables (nothing is built here):
   - `OP_TOKEN`: the service account token (1Password IT).
   - `ADMIN_AUTH=microsoft`.
5. **Healthcheck**: enabled, type command,
   `node -e "fetch('http://127.0.0.1:4321/').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"`
   (the image's own `HEALTHCHECK` is the same). An HTTP check on `/`, port
   4321, works too: Alpine has `wget`. With a health check,
   Coolify keeps the old container until the new one answers: if 1Password
   can't be reached, the new one never starts and the site stays up.
6. **Deploy** once by hand and check the site, `/admin` and a save.
7. **Deploy webhook**: the app's Webhooks page. Put its URL in
   `COOLIFY_DEPLOY_URL` in `apps/site/.env.schema` and commit it (it only works
   with the token). From then on `site.yml` deploys every build, using
   "Coolify Website Deploy Token" (a Coolify API token with only the deploy
   permission) from the vault.

## Redirects to set up when this goes live

- `blog.trialanderror.org/*` → `trialanderror.org/blog/*` (keeps old links and
  blog DOIs working; `/blog/api/draft` exists for the old preview URL). A
  plain rule like this breaks the old blog's lists: `/blog/<n>` should go to
  `/blog/page/<n>`, `/blog/<category>` to `/blog/category/<category>` and
  `/author/<slug>` to `/people/<slug>`. The research note of 2026-11-25 in the
  planning repo (cote/center) has a Caddyfile for one redirect-only service
  that owns all the old host names, with `redir ... permanent` inside `handle`.
- `blog.trialanderror.org/author/*` → `trialanderror.org/blog/author/*` falls
  out of the rule above.
- The old blog's page list (`blog.trialanderror.org/blog/2`) would land on
  `/blog/blog/2`; redirect `/blog/blog/*` to `/blog/page/*` if that matters.

- The journal's PubPub addresses on `journal.trialanderror.org`: send
  `/pub/*` and `/collection/*` on that domain to this server. The site
  answers them itself with permanent (301) redirects: `/pub/<slug>` and
  `/pub/<slug>/release/<n>` to `/journal/<slug>`, `/pub/<slug>/download/pdf`
  to the article's PDF, `/collection/<slug>` to `/journal/issue/<slug>`
  (`src/pages/pub`, `src/pages/collection`). Send the rest of the domain to
  `trialanderror.org/journal/*`. Ask Crossref to update the DOIs to the new
  addresses as well, so they don't go through the redirect.

## Elsewhere

Any host that runs Node or Docker works: give it `OP_TOKEN`, or the variables
from `.env.schema` directly. So does any host with an Astro adapter (replace
`@astrojs/node` in `astro.config.mjs`).
