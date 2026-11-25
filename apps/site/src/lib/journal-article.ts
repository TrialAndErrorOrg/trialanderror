import { getImage, inferRemoteSize } from "astro:assets";
import { stripHtml } from "./format";
import type { Heading } from "./html";
import { decodeEntities, type Journal, journal, replaceElements, type Release, type Rich } from "./sources/journal";
import type { UnderlayFile } from "./sources/underlay";
import type { Article } from "./types";

/*
 * Everything an article page needs beyond the Article itself: the HTML export
 * of its latest release, made to fit the site, its downloads and its links to
 * reviews, commentaries and other pubs.
 */

export interface Download {
	format: string;
	label: string;
	url: string;
}

export interface Connection {
	/** How the other pub relates to this one, e.g. "Peer review" or "Commentary on" */
	label: string;
	title: string;
	url: string;
	article?: Article;
}

/** A section about the article rather than part of its argument, shown beside the text */
export interface ArticleNote {
	/** "Take-home message", "Purpose" or "Original purpose" */
	title: string;
	html: string;
	words: number;
}

export interface ArticleDetails {
	body: string;
	headings: Heading[];
	/** The take-home message and (original) purpose, taken out of the body */
	notes: ArticleNote[];
	/** The export has no text, so the PDF is the article */
	empty: boolean;
	keywords: string[];
	downloads: Download[];
	connections: Connection[];
	/** Date of the latest release, when it came well after the first */
	updated?: string;
}

const DOWNLOADS: Record<string, string> = { pdf: "PDF", epub: "EPUB", docx: "Word", jats: "JATS XML", tex: "LaTeX" };

/** Labels for PubPub's pub connections, seen from the parent and from the child */
const RELATIONS: Record<string, [parent: string, child: string]> = {
	review: ["Peer review", "Review of"],
	comment: ["Comment", "Comment on"],
	commentary: ["Commentary", "Commentary on"],
	reply: ["Reply", "Reply to"],
	supplement: ["Supplement", "Supplement to"],
	preprint: ["Preprint", "Preprint of"],
	version: ["Version", "Version of"],
	rejoinder: ["Rejoinder", "Rejoinder to"],
};

const DAY = 24 * 60 * 60 * 1000;

/** Widest image the article column ever needs, in pixels */
const IMAGE_WIDTH = 1600;

export async function getArticleDetails(article: Article, source: Journal = journal()): Promise<ArticleDetails> {
	const [release, html] = await Promise.all([source.getRelease(article), source.getArticleHtml(article)]);
	const assets = new Map((release?.assets ?? []).map((file) => [hash(file.$file), file]));
	const { body, headings, text, notes } = await prepareArticle(html ?? "", assets, source, true);

	return {
		body,
		headings,
		notes,
		empty: text.length < 200,
		keywords: keywords(html ?? ""),
		downloads: downloads(release, source.downloadUrl),
		connections: await connections(article, source),
		updated: release && Date.parse(release.createdAt) - Date.parse(article.date) > 2 * DAY ? release.createdAt : undefined,
	};
}

/** A PubPub page or issue intro, fitted into the site like an article's text */
export async function getRichBody(rich: Rich, source: Journal = journal()) {
	const assets = new Map(rich.assets.map((file) => [hash(file.$file), file]));
	const { body, headings } = await prepareArticle(rich.html, assets, source);
	return { body, headings };
}

/** The release's exports, with the typeset PDF in place of the generated one when there is one */
function downloads(release: Release | undefined, downloadUrl: FileUrl): Download[] {
	const files = (release?.exports ?? [])
		.filter((file) => DOWNLOADS[file.format])
		.sort((a, b) => Object.keys(DOWNLOADS).indexOf(a.format) - Object.keys(DOWNLOADS).indexOf(b.format))
		.map((file) => ({ format: file.format, label: DOWNLOADS[file.format], url: downloadUrl(file) }));
	if (!release?.formatted) return files;
	return [{ format: "pdf", label: "PDF", url: downloadUrl(release.formatted) }, ...files.filter((file) => file.format !== "pdf")];
}

/** Warm the download cache for every article at once, instead of one page at a time */
export const prefetchArticles = async (articles: Article[], source: Journal = journal()) => {
	await Promise.all(articles.map((article) => source.getArticleHtml(article).catch(() => undefined)));
};

const hash = (ref: string) => ref.replace(/^sha256:/, "");

/** Where a journal's files can be downloaded */
type FileUrl = (file: UnderlayFile) => string;

async function connections(article: Article, source: Journal): Promise<Connection[]> {
	const records = await source.getJournalRecords();
	const articles = new Map((await source.getArticles()).map((a) => [a.id, a]));
	const result: Connection[] = [];

	for (const { data: edge } of records.get("PubEdge") ?? []) {
		const [parent, child] = edge.pubIsParent ? [edge.sourcePubId, edge.targetPubId] : [edge.targetPubId, edge.sourcePubId];
		if (parent !== article.id && child !== article.id) continue;

		const labels = RELATIONS[edge.relationType] ?? [edge.relationType, edge.relationType];
		const label = parent === article.id ? labels[0] : labels[1];
		const other = articles.get(parent === article.id ? child : parent);
		if (other) result.push({ label, title: other.title, url: other.url, article: other });
		else if (edge.externalUrl) result.push({ label, title: (edge.externalTitle ?? edge.externalUrl).trim(), url: edge.externalUrl });
	}
	return result;
}

function keywords(html: string) {
	const line = html.match(/<p\b[^>]*>\s*(?:<[^>]+>\s*)*Key ?words?\s*:?([\s\S]*?)<\/p>/i)?.[1];
	if (!line) return [];
	return decodeEntities(stripHtml(line))
		.replace(/^:\s*/, "")
		.split(/[,;]/)
		.map((k) => k.trim().replace(/\.$/, ""))
		.filter(Boolean);
}

/**
 * Fit PubPub's HTML export into the site: drop the parts the page renders
 * itself, move headings one level down under the page's h1, serve images
 * from this site and point attachments at their Underlay file.
 */
async function prepareArticle(html: string, assets: Map<string, UnderlayFile>, source: Journal, withNotes = false) {
	let body = html
		.replace(/^\s*<article>|<\/article>\s*$/g, "")
		.replace(/<footer class="pub-footer">[\s\S]*?<\/footer>/, "")
		.replace(/<div class="pub-notes"><\/div>/, "")
		.replace(/<p\b[^>]*>\s*<\/p>/g, "")
		.replace(/<figcaption\b[^>]*>(?:<div>)*(?:<\/div>)*<\/figcaption>/g, "")
		.replace(/<a [^>]*class="bp3-button[^"]*"[^>]*><\/a>|<div [^>]*class="file-icon[^"]*"[^>]*><\/div>/g, "")
		.replace(/\s(?:data-(?!node-type|align|size)[\w-]+|date-structured-value|style|class="MsoNormal")(?:="[^"]*")?/g, "")
		.replace(/<(\/?)h([1-6])\b/g, (_, slash: string, level: string) => `<${slash}h${Math.min(Number(level) + 1, 6)}`)
		.replace(/<iframe\b/g, '<iframe loading="lazy" title="Embedded figure"')
		.replace(/href="sha256:([0-9a-f]{64})"/g, (_, h: string) => `href="${source.downloadUrl(assets.get(h) ?? { $file: h })}"`);

	// An empty "References" heading in the text duplicates the one PubPub adds to the notes
	if (/<div class="pub-notes">[\s\S]*<h2>References<\/h2>/.test(body)) {
		body = body.replace(/<h2[^>]*>\s*References\s*<\/h2>\s*(?=<div class="pub-notes">)/, "");
	}

	// PubPub sizes figures as a share of the text column
	body = body.replace(
		/<figure([^>]*?) data-size="(\d+)" data-align="(left|center|right)"/g,
		(match, attrs: string, size: string, align: string) =>
			Number(size) < 100 ? `<figure${attrs} data-align="${align}" style="width: ${size}%"` : match,
	);

	body = await replaceImages(body, assets, source.journalFileUrl);
	body = await replaceDeadEmbeds(body);

	const notes: ArticleNote[] = [];
	if (withNotes) {
		body = body.replace(/<h2[^>]*>([\s\S]*?)<\/h2>([\s\S]*?)(?=<h2[\s>]|<div class="pub-notes"|$)/g, (section, title: string, content: string) => {
			const text = decodeEntities(stripHtml(title)).replace(/[\s:.]+$/, "").trim();
			if (!NOTE_TITLE.test(text)) return section;
			const label = text.toLowerCase().replace(/^take[- ]home/, "take-home");
			notes.push({
				title: label[0].toUpperCase() + label.slice(1),
				html: content.trim(),
				words: stripHtml(content).split(/\s+/).filter(Boolean).length,
			});
			return "";
		});
	}

	const ids = new Set([...body.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]));
	const headings: Heading[] = [];
	body = body.replace(/<(h[23])([^>]*)>([\s\S]*?)<\/\1>/g, (_, tag: string, attrs: string, content: string) => {
		const text = decodeEntities(stripHtml(content)).replace(/^[|\s]+/, "");
		let id = attrs.match(/\sid="([^"]+)"/)?.[1];
		if (!id) {
			const base = text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "section";
			id = base;
			for (let n = 2; ids.has(id); n++) id = `${base}-${n}`;
			ids.add(id);
			attrs += ` id="${id}"`;
		}
		headings.push({ depth: tag === "h2" ? 2 : 3, slug: id, text });
		return `<${tag}${attrs}>${content}</${tag}>`;
	});

	const main = body.replace(/<div class="pub-notes">[\s\S]*$|<h2[^>]*>\s*References\s*<\/h2>[\s\S]*$/, "");
	const text = stripHtml(replaceElements(main, /<span class="katex-html"/, () => ""));
	return { body, headings, text, notes };
}

/** Headings of the sections that become notes beside an article: its take-home message and purpose */
const NOTE_TITLE = /^(?:take[- ]home message|(?:original )?purpose)$/i;

/** Embedded pages that no longer load, such as the old interactive plots on assets.pubpub.org, become a short note */
async function replaceDeadEmbeds(body: string) {
	const dead = new Set<string>();
	await Promise.all(
		[...new Set([...body.matchAll(/<iframe\s[^>]*?src="([^"]+)"/g)].map((m) => m[1]))].map(async (src) => {
			const response = await fetch(decodeEntities(src), { method: "HEAD", signal: AbortSignal.timeout(10_000) }).catch(() => undefined);
			if (!response?.ok) dead.add(src);
		}),
	);
	if (dead.size === 0) return body;
	return body.replace(/<iframe\s[^>]*?src="([^"]+)"[^>]*>\s*<\/iframe>/g, (iframe, src: string) =>
		dead.has(src) ? `<p class="embed-missing">This embedded figure is no longer available online.</p>` : iframe,
	);
}

/** Swap sha256 image sources for optimised copies built with the site */
async function replaceImages(body: string, assets: Map<string, UnderlayFile>, journalFileUrl: FileUrl) {
	const sources = new Map<string, string>();
	await Promise.all(
		[...new Set([...body.matchAll(/<img\s[^>]*?src="sha256:([0-9a-f]{64})"/g)].map((m) => m[1]))].map(async (h) => {
			sources.set(h, await optimise(assets.get(h) ?? { $file: h }, journalFileUrl));
		}),
	);
	return body.replace(/<img(\s[^>]*?)src="sha256:([0-9a-f]{64})"([^>]*?)\/?>/g, (_, before: string, h: string, after: string) => {
		const attributes = `${before}${sources.get(h)}${after}`.replace(/\s+$/, "");
		return `<img${attributes.startsWith(" ") ? "" : " "}${attributes} loading="lazy" decoding="async" />`;
	});
}

/** The attributes for one image: copied, resized and converted at build time when possible, the original otherwise */
async function optimise(file: UnderlayFile, journalFileUrl: FileUrl) {
	const original = file.originalUrl ?? journalFileUrl(file);
	if (!file.originalUrl) return `src="${original}"`;
	try {
		const size = await inferRemoteSize(original);
		const width = Math.min(size.width, IMAGE_WIDTH);
		const height = Math.round((size.height / size.width) * width);
		if (file.mimeType === "image/svg+xml") {
			const image = await getImage({ src: original, width, height, format: "svg" });
			return `src="${image.src}" width="${width}" height="${height}"`;
		}
		const image = await getImage({ src: original, width, height, widths: [...new Set([Math.min(width, 800), width])] });
		return `src="${image.src}" srcset="${image.srcSet.attribute}" sizes="(min-width: 768px) 48rem, 100vw" width="${width}" height="${height}"`;
	} catch {
		return `src="${original}"`;
	}
}
