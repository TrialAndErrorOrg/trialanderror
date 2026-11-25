import type { APIRoute } from "astro";
import { articlePdfUrl } from "~/lib/journal-article";
import { journal } from "~/lib/sources/journal";

/*
 * The journal's old PubPub addresses, which DOIs, Google Scholar and other
 * sites still link to, moved for good (301) to the article on this site:
 *
 *   /pub/<slug>, /pub/<slug>/release/<n>  →  /journal/<slug>
 *   /pub/<slug>/download/pdf              →  the article's PDF
 *
 * PubPub served these on journal.trialanderror.org. Point that domain at this
 * server for anything under /pub/ and /collection/ (docs/deploying.md).
 */
export const prerender = false;

export const GET: APIRoute = async ({ params, redirect, site }) => {
	const [slug, ...rest] = (params.path ?? "").split("/").filter(Boolean);
	const base = site ?? "https://trialanderror.org";
	if (!slug) return redirect(new URL("/journal", base).href, 301);

	if (rest[0] === "download" && rest[1] === "pdf") {
		const source = journal("jote");
		const article = await source.getArticle(slug).catch(() => undefined);
		const pdf = article && (await articlePdfUrl(article, source).catch(() => undefined));
		if (pdf) return redirect(new URL(pdf, base).href, 301);
	}
	return redirect(new URL(`/journal/${encodeURIComponent(slug)}`, base).href, 301);
};
