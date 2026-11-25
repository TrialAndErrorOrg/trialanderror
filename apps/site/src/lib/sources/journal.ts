import { inferRemoteSize } from "astro:assets";
import { stripHtml } from "../format";
import { type NavLink, navigation, site } from "../settings";
import type { Article, Picture, Term } from "../types";
import { assetHash, fetchFileText, fileResponse, fileUrl, getCollection, type UnderlayFile } from "./underlay";

/*
 * Journal articles, read from each journal's PubPub export on Underlay:
 * https://www.underlay.org/centeroftrialanderror/jote and
 * https://www.underlay.org/centeroftrialanderror/jrn
 *
 * `journal("jote")` gives one journal's loaders. The Journal of Trial and
 * Error's are also exported on their own (getArticles, getIssues...), since
 * that is the journal most of the site means.
 */

/** Link articles to their page on this site. Set to false to link to PubPub and skip the article pages */
export const ARTICLE_PAGES = true;

export interface JournalConfig {
	id: string;
	/** The Underlay collection holding the PubPub export */
	owner: string;
	collection: string;
	/** Where the journal's pages live on this site */
	path: string;
	/** Where all its articles are listed: the journal's own path, unless it has a front page */
	listPath: string;
	title: string;
	description: string;
	/** The journal on PubPub, where articles link when ARTICLE_PAGES is off */
	url: string;
	/** PubPub tags that say what kind of article something is, in order of preference */
	kinds: string[];
	/** Pubs tagged with these are calls and notices, not articles */
	notArticles: string[];
	/** Tags that group articles the way an issue does */
	issueTags: string[];
	/** The links in the bar under the header */
	menu: NavLink[];
	/** Where an issue's articles are listed */
	issueUrl: (slug: string) => string;
	/** Value of the search page's section filter */
	section: string;
	/**
	 * Classes for the journal's pages. The journal components are drawn in the
	 * `journal` colours, so another journal can swap those for its own.
	 */
	theme?: string;
	/** Shown on the list pages of a journal that is no longer updated */
	notice?: string;
	/** The online ISSN, for Google Scholar's citation_issn */
	issn?: string;
	/** Indexes that list the journal, shown on its front page */
	indexedIn?: { name: string; url: string; since?: string }[];
}

export const JOURNALS = {
	jote: {
		id: "jote",
		owner: "centeroftrialanderror",
		collection: "jote",
		path: "/journal",
		// /journal is the front page from pages/journal.yaml in site-content, or this list without one
		listPath: "/journal/articles",
		title: site.journal.title,
		description: site.journal.description,
		url: site.journal.url,
		kinds: [
			"Empirical",
			"Meta-Research",
			"Reflection",
			"Perspective",
			"Commentary",
			"Anecdotes",
			"Rejected Grant Application",
			"Peer Reviews",
			"Editorial",
			"Corrigenda & Errata",
		],
		notArticles: ["Call for Papers", "Call for Proposals", "Call for Abstracts", "Open Calls", "Current Calls", "Submission"],
		issueTags: ["Rolling Articles"],
		menu: navigation.journal,
		issueUrl: (slug) => `/journal/issue/${slug}`,
		section: "Journal",
		issn: "2667-1204",
		indexedIn: [{ name: "DOAJ", url: "https://doaj.org/toc/2667-1204", since: "2025" }],
	},
	// The Center's earlier journal, published 2020 to 2023 and kept online as an archive.
	// Its title and description are those of its PubPub community
	jrn: {
		id: "jrn",
		owner: "centeroftrialanderror",
		collection: "jrn",
		path: "/jrn",
		listPath: "/jrn",
		title: "Journal for Reproducibility in Neuroscience",
		description:
			"A platform for sharing results that support or contradict articles that have already been published in the scientific literature of basic and applied neuroscience.",
		url: "https://jrn.pubpub.org",
		kinds: ["Articles", "Reviews", "Commentary", "Editorial"],
		notArticles: [],
		issueTags: [],
		menu: [
			{ title: "Articles", url: "/jrn" },
			{ title: "Journal of Trial & Error", url: "/journal", button: true },
		],
		// Two volumes only, so they are sections of the archive page rather than pages of their own
		issueUrl: (slug) => `/jrn#${slug}`,
		section: "Journal for Reproducibility in Neuroscience",
		theme: "[--color-journal:var(--color-jrn)] [--color-journal-soft:var(--color-jrn-soft)]",
		notice: "This journal is no longer updated. Its articles stay available here as an archive.",
	},
} satisfies Record<string, JournalConfig>;

export type JournalId = keyof typeof JOURNALS;

const LICENSES: Record<string, string> = {
	"CC-BY-4.0": "Creative Commons Attribution 4.0 International",
	"CC-BY-SA-4.0": "Creative Commons Attribution-ShareAlike 4.0 International",
	"CC-BY-NC-4.0": "Creative Commons Attribution-NonCommercial 4.0 International",
	"CC-0-1.0": "CC0 1.0 Universal",
};

export interface Release {
	contentFile?: UnderlayFile;
	exports: (UnderlayFile & { format: string })[];
	/** Images and attachments the HTML export points to as sha256:<hash> */
	assets: UnderlayFile[];
	createdAt: string;
	/** The typeset PDF editors upload on PubPub, which replaces the generated one */
	formatted?: UnderlayFile;
}

export interface ArticleGroup extends Term {
	articles: Article[];
}

export interface Issue extends ArticleGroup {
	/** Published continuously instead of all at once, like Rolling Articles */
	rolling: boolean;
	image?: Picture;
	description?: string;
	volume?: string;
	number?: string;
	/** The issue's publication date, or else its newest article's */
	date: string;
	/** The intro text editors write on the issue's PubPub page */
	intro?: Rich;
}

/** HTML from the PubPub export, with the images it points to as sha256:<hash> */
export interface Rich {
	html: string;
	assets: UnderlayFile[];
}

/** A page of the journal's PubPub site, like For Authors or Editorial Board */
export interface JournalPage extends Rich {
	id: string;
	slug: string;
	title: string;
	description?: string;
	/** Where the page lives on this site */
	url: string;
}

/** Paths under a journal that are the site's own, so a PubPub page can't take them */
const RESERVED = ["articles", "issues", "issue", "kind", "files", "rss.xml"];

export const kindSlug = (kind: string) =>
	kind
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-|-$/g, "");

export type Journal = ReturnType<typeof createJournal>;

const journals = new Map<JournalId, Journal>();

/** One journal's articles, issues and files. Each is fetched once per build */
export function journal(id: JournalId = "jote"): Journal {
	let loaders = journals.get(id);
	if (!loaders) {
		loaders = createJournal(JOURNALS[id]);
		journals.set(id, loaders);
	}
	return loaders;
}

function createJournal(config: JournalConfig) {
	const { owner, collection } = config;

	const articleUrl = (slug: string) => (ARTICLE_PAGES ? `${config.path}/${slug}` : `${config.url}/pub/${slug}`);
	const kindUrl = (kind: string) => `${config.path}/kind/${kindSlug(kind)}`;
	const journalFileUrl = (file: UnderlayFile) => fileUrl(owner, collection, file);
	/** Where a download is served on this site, see src/pages/journal/files */
	const downloadUrl = (file: UnderlayFile) => {
		const hash = assetHash(file);
		return `${config.path}/files/${hash}/${encodeURIComponent(file.fileName ?? hash)}`;
	};
	const serveFile = (hash: string, name: string) => fileResponse(owner, collection, hash, name);

	function picture(file: UnderlayFile | undefined): Picture | undefined {
		if (!file) return undefined;
		return { url: file.originalUrl ?? journalFileUrl(file) };
	}

	let records: ReturnType<typeof getCollection> | undefined;

	/** Every record in the journal's collection, grouped by type */
	function getJournalRecords() {
		records ??= getCollection(owner, collection);
		return records;
	}

	let releases: Promise<Map<string, Release>> | undefined;

	/** The latest release of every pub, by pub id */
	function getReleases() {
		releases ??= getJournalRecords().then((byType) => {
			const all = new Map((byType.get("Release") ?? []).map((r) => [r.id, r.data]));
			const latest = new Map<string, Release>();
			for (const pub of byType.get("Pub") ?? []) {
				const release = all.get(pub.data.latestReleaseId);
				const formatted = (pub.data.downloads ?? []).filter((d: any) => d.type === "formatted").at(-1);
				if (release) latest.set(pub.id, { ...release, exports: release.exports ?? [], assets: release.assets ?? [], formatted });
			}
			return latest;
		});
		return releases;
	}

	async function getRelease(article: Pick<Article, "id">) {
		return (await getReleases()).get(article.id);
	}

	const html = new Map<string, Promise<string | undefined>>();

	/** The HTML export of an article's latest release, downloaded once per build */
	function getArticleHtml(article: Pick<Article, "id">) {
		let text = html.get(article.id);
		if (!text) {
			text = getRelease(article).then((release) =>
				release?.contentFile ? fetchFileText(owner, collection, release.contentFile) : undefined,
			);
			html.set(article.id, text);
		}
		return text;
	}

	let articles: Promise<Article[]> | undefined;

	/** Published articles, newest first */
	function getArticles(): Promise<Article[]> {
		articles ??= load();
		return articles;
	}

	async function getArticle(slug: string) {
		return (await getArticles()).find((article) => article.slug === slug);
	}

	/** Article types, in the journal's order */
	async function getKinds(): Promise<ArticleGroup[]> {
		const all = await getArticles();
		return config.kinds
			.map((title) => ({ slug: kindSlug(title), title, articles: all.filter((a) => a.kind === title) }))
			.filter((kind) => kind.articles.length > 0);
	}

	/** Issues, rolling ones first, then the most recent */
	async function getIssues(): Promise<Issue[]> {
		const records = await getJournalRecords();
		const collections = new Map((records.get("Collection") ?? []).map((c) => [c.data.slug as string, c]));
		const issues = new Map<string, Issue>();
		for (const article of await getArticles()) {
			for (const term of article.issues) {
				const issue = issues.get(term.slug) ?? toIssue(term, collections.get(term.slug));
				issue.articles.push(article);
				issues.set(term.slug, issue);
			}
		}
		for (const issue of issues.values()) {
			issue.date ||= issue.articles[0].date;
			const order = collections.get(issue.slug)?.data.pubIds as string[] | undefined;
			if (order) issue.articles.sort((a, b) => rank(order, a.id) - rank(order, b.id));
		}
		return [...issues.values()].sort((a, b) => Number(b.rolling) - Number(a.rolling) || b.date.localeCompare(a.date));
	}

	async function getIssue(slug: string) {
		return (await getIssues()).find((issue) => issue.slug === slug);
	}

	/** An issue from its PubPub collection. PubPub keeps volume, number and dates in `metadata`, and the order in `pubIds` */
	function toIssue(term: Term, collection?: { data: any }): Issue {
		const d = collection?.data ?? {};
		const meta = d.metadata ?? {};
		return {
			...term,
			articles: [],
			rolling: config.issueTags.includes(term.title),
			image: picture(d.avatar),
			description: d.description || undefined,
			volume: meta.volume ?? term.title.match(/\bVol(?:ume|\.) ?(\d+)/i)?.[1],
			number: meta.issue ?? term.title.match(/\bIssue (\d+)/i)?.[1],
			date: meta.publicationDate ?? meta.printPublicationDate ?? "",
			intro: d.layoutHtml ? { html: d.layoutHtml, assets: d.layoutAssets ?? [] } : undefined,
		};
	}

	let pages: Promise<JournalPage[]> | undefined;

	/**
	 * The journal's PubPub pages that have text of their own. Pages that only
	 * list pubs (the home page, issue and type pages) are left out, the site
	 * makes those itself. So are pages whose address an article already has.
	 */
	function getPages() {
		pages ??= Promise.all([getJournalRecords(), getArticles()]).then(([records, articles]) => {
			const taken = new Set([...RESERVED, ...articles.map((a) => a.slug)]);
			return (records.get("Page") ?? [])
				.filter((page) => page.data.slug && page.data.isPublic !== false && page.data.html?.trim() && !taken.has(page.data.slug))
				.map(
					(page): JournalPage => ({
						id: page.id,
						slug: page.data.slug,
						title: page.data.title,
						description: page.data.description || undefined,
						html: page.data.html,
						assets: page.data.assets ?? [],
						url: `${config.path}/${page.data.slug}`,
					}),
				);
		});
		return pages;
	}

	/** A link to the journal's PubPub site, pointed at this site when the page is here */
	async function localUrl(url: string) {
		const slug = url.startsWith(`${config.url}/`) ? url.slice(config.url.length + 1).replace(/\/$/, "") : undefined;
		const page = slug && (await getPages()).find((p) => p.slug === slug);
		return page ? page.url : url;
	}

	async function load(): Promise<Article[]> {
		const records = await getJournalRecords();
		const releases = await getReleases();

		const collections = new Map((records.get("Collection") ?? []).map((c) => [c.id, c.data]));
		const attributions = Map.groupBy(
			(records.get("PubAttribution") ?? []).filter((a) => a.data.isAuthor),
			(a) => a.data.pubId as string,
		);
		const users = new Map((records.get("User") ?? []).map((u) => [u.id, u.data]));

		const list = (records.get("Pub") ?? [])
			// Some older pubs have no kind, but are articles all the same
			.filter((pub) => (pub.data.kind ?? "JournalArticle") === "JournalArticle" && pub.data.publishedAt && releases.has(pub.id))
			.map((pub) => {
				const tags = (pub.data.collectionIds ?? [])
					.map((id: string) => collections.get(id))
					.filter((c: any) => c?.isPublic);
				return { pub, tags };
			})
			.filter(({ tags }) => !tags.some((t: any) => config.notArticles.includes(t.title)))
			.map(({ pub, tags }): Article => {
				const d = pub.data;
				const kind = config.kinds.find((k) => tags.some((t: any) => t.title === k));
				const issues: Term[] = tags
					.filter((t: any) => t.kind === "issue" || config.issueTags.includes(t.title))
					.map((t: any) => ({ slug: t.slug, title: t.title }));
				const authors = (attributions.get(pub.id) ?? [])
					.sort((a, b) => (a.data.order ?? 0) - (b.data.order ?? 0))
					.map((a) => {
						const user = a.data.userId ? users.get(a.data.userId) : undefined;
						const orcid: string | undefined = a.data.orcid || user?.orcid || undefined;
						return {
							name: a.data.name ?? user?.name ?? "",
							orcid: orcid && (orcid.startsWith("http") ? orcid : `https://orcid.org/${orcid}`),
							affiliation: a.data.affiliation || undefined,
						};
					})
					.filter((a) => a.name);

				return {
					id: pub.id,
					slug: d.slug,
					title: d.title,
					description: d.description || undefined,
					date: d.publishedAt,
					doi: d.doi || undefined,
					kind,
					issues,
					image: picture(d.avatar),
					authors,
					url: articleUrl(d.slug),
					license: d.licenseUri ? { name: LICENSES[d.licenseSpdx] ?? d.licenseSpdx ?? d.license, url: d.licenseUri } : undefined,
				};
			})
			.sort((a, b) => b.date.localeCompare(a.date));

		await Promise.all(
			list.map(async (article) => {
				// Most pubs have no description, so fall back to the start of the abstract
				if (!article.description) {
					const text = await getArticleHtml(article).catch(() => undefined);
					if (text) article.description = summary(text);
				}
				// Measure each cover once, rather than on every page that shows it
				if (article.image) {
					const size = await inferRemoteSize(article.image.url).catch(() => undefined);
					if (size) Object.assign(article.image, { width: size.width, height: size.height });
				}
			}),
		);

		return list;
	}

	return {
		config,
		articleUrl,
		kindUrl,
		journalFileUrl,
		downloadUrl,
		serveFile,
		getJournalRecords,
		getRelease,
		getArticleHtml,
		getArticles,
		getArticle,
		getKinds,
		getIssues,
		getIssue,
		getPages,
		localUrl,
	};
}

const rank = (order: string[], id: string) => {
	const index = order.indexOf(id);
	return index === -1 ? order.length : index;
};

// The Journal of Trial and Error, under the names the rest of the site uses
export const {
	articleUrl,
	journalFileUrl,
	getJournalRecords,
	getRelease,
	getArticleHtml,
	getArticles,
	getArticle,
	getKinds,
	getIssues,
	getIssue,
	getPages,
} = journal("jote");

/** The first real paragraph of the abstract, or of the text when there is none, cut to a teaser */
function summary(html: string, length = 300) {
	const paragraphs = (part: string) =>
		[...part.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/g)]
			.map((m) => decodeEntities(stripHtml(texMath(m[1]))))
			.filter((text) => text.length > 80 && !/^key ?words?\b/i.test(text));
	// Stop at the notes or the reference list, so a text-less export does not borrow its first reference
	const body = html.replace(/<(div class="pub-notes"|footer)[\s\S]*$|<h[1-6][^>]*>(?:\s|<[^>]+>)*References(?:\s|<[^>]+>)*<\/h[1-6]>[\s\S]*$/i, "");
	const abstract = body.match(/<h[1-6][^>]*>(?:\s|<[^>]+>)*Abstract\b[\s\S]*?<\/h[1-6]>([\s\S]*?)(?=<h[1-6]\b|$)/i)?.[1];
	const text = (abstract && paragraphs(abstract)[0]) || paragraphs(body)[0];
	if (!text || text.length <= length) return text;
	return `${text.slice(0, text.lastIndexOf(" ", length))}…`;
}

/** Replace rendered KaTeX with its TeX source, so math survives as plain text */
const texMath = (html: string) =>
	replaceElements(html, /<span class="katex">/, (math) => math.match(/<annotation encoding="application\/x-tex">([\s\S]*?)<\/annotation>/)?.[1] ?? "");

/** Replace each element whose opening tag matches `open`, along with everything inside it */
export function replaceElements(html: string, open: RegExp, replace: (element: string) => string) {
	let result = "";
	let rest = html;
	let match: RegExpMatchArray | null;
	while ((match = rest.match(open)) && match.index !== undefined) {
		const tags = new RegExp(`<(/?)${match[0].match(/^<(\w+)/)?.[1]}\\b[^>]*>`, "g");
		tags.lastIndex = match.index;
		let depth = 0;
		let end = rest.length;
		for (let tag; (tag = tags.exec(rest)); ) {
			depth += tag[1] ? -1 : 1;
			if (depth === 0) {
				end = tag.index + tag[0].length;
				break;
			}
		}
		result += rest.slice(0, match.index) + replace(rest.slice(match.index, end));
		rest = rest.slice(end);
	}
	return result + rest;
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

export const decodeEntities = (text: string) =>
	text.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (entity, code: string) =>
		code[0] === "#"
			? String.fromCodePoint(code[1].toLowerCase() === "x" ? parseInt(code.slice(2), 16) : Number(code.slice(1)))
			: (ENTITIES[code] ?? entity),
	);