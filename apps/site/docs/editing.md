# Editing the site

## Publishing a blog post

In `/admin`, **Blog**, **New Post**. Fill in the title, date and authors, write
the text, and **Save**. Saving makes a draft: nothing changes on the site yet.

Drafts move through **Workflow** (the icon in the top bar): Draft, In Review,
Ready. Someone else can read and edit a draft there. **Publish** puts it on
the site, which rebuilds in a few minutes. Changing a published post goes the
same way: the change is a draft until it's published.

The preview next to the fields shows the post as it will look on the site and
follows along as you type. It leaves out what the post page adds around it,
like the table of contents and the author bios.

Authors are picked from **People**. Someone new writes for the blog? Add them
under People first (Team member off).

**Featured** puts a post big at the top of the blog's front page (the newest
featured one wins, otherwise the newest post). When the post is also on
Substack, paste its address in **The post on Substack**: the post then ends
with the number of comments it has there and a link to join the discussion.
Substack's terms don't allow copying the comments themselves onto the site.

The blog's front page lists the most read posts. They come from GoatCounter
when the build has `GOATCOUNTER_TOKEN`, and otherwise from **Settings → Site →
Blog → Most read**. Every post is in the archive at `/blog/page/1`.

### Images

Upload photos as they are: they are turned into WebP of at most 2400 pixels
before they are saved, so a 15 MB camera photo becomes a few hundred KB. The
image picker can also search **Unsplash**; those photos are linked, not copied.
Give the cover image a description for people who can't see it.

Everything uploaded is public, on the site and in site-content's history, the
moment it's saved. Deleting a file in `/admin` takes it off the site, but its
history stays: to remove something for good, ask someone who manages the
repository.

## Changing the homepage or another page

Go to `/admin` and sign in. Pages are lists of **sections**, drawn top to
bottom. You can add, remove, reorder and edit sections:

- **Big intro**: the large title block, in orange (the Center), journal blue or
  white on orange (the Blog). Each line of the title gets its own box. "Show the
  journal's numbers" adds the number of articles and issues.
- **Text**: a block of text, optionally with a title and a coloured background.
- **Columns**: two or three boxes side by side (like "What we do"). A column
  with a colour gets a title bar in that colour and its link covers the box.
- **Latest blog posts** / **Latest journal articles**: filled in automatically.
  Journal articles show as cards, as a compact list, or with the newest big
  and the others beside it.
- **Journal article types**: each type with its number of articles, and a line
  about it if you give one.
- **Events**: the next events, or the latest ones when nothing is planned.
- **Editorial board**: everyone under People with a journal role, grouped by
  role. Change someone's role (People → Journal editorial board) and the board
  follows.
- **Latest issues**: the newest numbered issues, as covers.
- **Team**: everyone under People marked as team member who has a photo.
- **Newsletter sign-up**
- **Buttons**

For pages that guide someone through steps, like the journal's For Authors
page, there are also:

- **On this page**: links to the sections below it that have an anchor and a
  title. "Short name" gives a section a shorter label there.
- **Chooser**: cards to pick from, each opening its own panel beside them
  ("What are you submitting?"). A panel holds text, numbered parts, cards,
  steps and "read more" boxes. Each card has an anchor, so
  `/journal/for-authors#registered-report` opens that card's panel. A card
  with no panel content is a plain card that opens nothing.
- **Cards**: boxes in a grid, optionally marked Required, Recommended or Not
  needed, with a key above them if you tick it. Each card can be framed,
  tinted, dashed, titled in a dark bar or have only a line on top, and can
  have small tags and extra text that opens on click. A tag can be a link:
  `[Methodology](https://credit.niso.org/contributor-roles/methodology/)`.
- **Steps**: a numbered process. Several routes (Standard, Perspective,
  Registered Report) become tabs.

Text sections can have buttons too.

Text fields take Markdown: `**bold**`, `*italic*`, `[a link](https://...)`.

To make a new page, click **New Page** in `/admin`. Its address is its title
in lowercase with dashes (`Open Positions` becomes `/open-positions`).

The page called `journal` is the journal's front page at `/journal`, with the
journal's menu above it. **Journal pages** in `/admin` are the journal's own
pages: `for-authors` is `/journal/for-authors`, under the journal's menu and in
its colours. A journal page replaces the PubPub page at the same address. All articles are at `/journal/articles`, as cards or
a compact list depending on Settings → Site → Journal.

The preview next to the fields is the page as the site draws it, updated a
moment after you stop typing. Links in it work, but lead away from the preview.

Saving in `/admin` makes a commit to site-content, which triggers a rebuild.

## /admin

`/admin` is the front door: a link into each part of the editor, the
converter, the services around the site (OJS, Substack, Underlay, the builds)
and what people read, from GoatCounter. The editor itself is at
`/admin/content`. Every page of the site links to `/admin` at the bottom
(**Editor sign-in**).

The numbers show for editors signed in with Microsoft: the site asks
GoatCounter with its own token, so nobody needs a GoatCounter login. They need
the GoatCounter address in **Settings → Site → Analytics** and
`GOATCOUNTER_TOKEN` where the site runs ([deploying.md](deploying.md#goatcounter)).

## Signing in to /admin

With `ADMIN_AUTH=microsoft`, editors sign in with their Center Microsoft
account and need no GitHub account: **Sign in with Microsoft** opens a
Microsoft sign-in in a popup. Editors have to be assigned to the "trialanderror admin" Entra app first
([admin-sign-in.md](admin-sign-in.md#adding-an-editor)), or Microsoft refuses
with `AADSTS50105`.

Otherwise (`ADMIN_AUTH=github`) they need a GitHub account with write access to
`TrialAndErrorOrg/site-content` and sign in with a
[personal access token](https://github.com/settings/tokens) (fine-grained,
repository contents read and write).

## Converting a manuscript

`/admin/convert` turns a `.docx` manuscript into LaTeX and Typst, with a zip of
each to download. The conversion happens in your browser, so the file goes
nowhere.

To pick a submission from OJS instead of uploading a file, sign in with
Microsoft (the same sign-in as `/admin`) and paste your own OJS API key, which
the page explains how to get: in OJS, your profile, the **API Key** tab. The key
stays in your browser, and OJS records what you do with it under your name. The
converter only reads from OJS. It needs `ADMIN_AUTH=microsoft`. With GitHub
sign-in the page only converts uploaded files.

## Events

In `/admin`, **Events**, **New Event**: title, when it starts and ends, where
(or a link to join online) and a link to sign up. They're listed at `/events`,
upcoming first, and in a calendar people can subscribe to at `/events.ics`.
Each event page has "Add to calendar" buttons while it's still to come. After
the event, pick the blog post about how it went under **Blog post about how it
went**.

An event counts as upcoming until it ends. The list is made when the site is
built, and the page hides events that have ended since.

## Announcements

**Settings → Site → Announcement** puts a line across the top of every page,
with a link if you give one, until the date under **Hide after**. Empty the
text to remove it.

## Supporters

**Supporters** in `/admin` lists who supports the Center: funders, partners
and donors, with a logo for organisations. A **Supporters** section shows them
on a page (the Donate page has one), grouped by kind, or only the kinds you
pick.

## Highlighting a journal issue

The **Featured journal issue** section shows one issue with its cover and
articles. Give it the last part of the issue's address
(`/journal/issue/<this>`), or leave that empty for the newest numbered issue.
Its own description is used unless you write a text.
