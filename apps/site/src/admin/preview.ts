import { marked } from "marked";
import { formatDate, listNames, readingMinutes } from "~/lib/format";
import { prepareBody } from "~/lib/html";
import siteStyle from "./preview.css?inline";

/*
 * The live preview of a blog post in /admin, drawn like layouts/Post.astro
 * with the site's own styles (preview.css). It follows the post page by hand,
 * so a change to the page's layout belongs here too.
 *
 * Sveltia renders previews with React, which it provides as CMS.React, and
 * passes the entry being edited as an Immutable.js map (Decap's API). The
 * preview brings its own styles rather than CMS.registerPreviewStyle(), which
 * would also restyle the other collections' plain previews.
 */

interface Entry {
	get(key: string): any;
	getIn(path: string[]): any;
}
interface PreviewProps {
	entry: Entry;
	getAsset(path: string): { toString(): string } | undefined;
	getCollection(name: string): Promise<Entry[]>;
}

const CMS = (window as any).CMS;
const React = CMS.React;
const h = React.createElement;

// The site's fonts, from Astro's <Font> in admin/index.astro
const setup = document.getElementById("preview-setup") as HTMLTemplateElement;
const fonts = [...setup.content.querySelectorAll("style")].map((style) => style.textContent ?? "").join("\n");

/** Titles of people and categories by slug, loaded once per preview */
function useTitles(getCollection: PreviewProps["getCollection"]) {
	const [titles, setTitles] = React.useState({ people: new Map<string, string>(), categories: new Map<string, string>() });
	React.useEffect(() => {
		Promise.all([getCollection("people"), getCollection("categories")]).then(([people, categories]) =>
			setTitles({
				people: new Map(people.map((p) => [p.get("slug"), [p.getIn(["data", "firstName"]), p.getIn(["data", "lastName"])].filter(Boolean).join(" ")])),
				categories: new Map(categories.map((c) => [c.get("slug"), c.getIn(["data", "title"])])),
			}),
		);
		// Once: Sveltia passes a new getCollection with every keystroke
		// oxlint-disable-next-line react-hooks/exhaustive-deps
	}, []);
	return titles;
}

/** An image the editor picked: a new upload, a file in site-content or a link (Unsplash) */
const assetUrl = (getAsset: PreviewProps["getAsset"], path: string) => getAsset(path)?.toString() || path;

function BlogPreview({ entry, getAsset, getCollection }: PreviewProps) {
	const titles = useTitles(getCollection);
	const data = (key: string) => entry.getIn(["data", key]);
	const list = (key: string): string[] => data(key)?.toJS?.() ?? [];

	const markdown = marked.parse(data("body") ?? "", { async: false });
	const { body } = prepareBody(markdown, { dropCap: true });
	// Images in the text are shown from wherever Sveltia has them, also before they're saved
	const html = body.replace(/(<img\b[^>]*?\ssrc=")([^"]+)"/g, (_, start: string, src: string) => `${start}${assetUrl(getAsset, src)}"`);

	const date = new Date(data("date") ?? "");
	const category = data("category");
	const authors = list("authors").map((slug) => titles.people.get(slug) ?? slug);
	const tags = list("tags");
	const image = data("image");

	return h(
		"div",
		null,
		h("style", null, siteStyle),
		h("style", null, fonts),
		image &&
			h(
				"div",
				{ className: "max-h-[60vh] overflow-hidden border-b-frame border-ink" },
				h("img", { src: assetUrl(getAsset, image), alt: data("imageAlt") ?? "", className: "size-full max-h-[60vh] object-cover" }),
			),
		h(
			"article",
			{ className: "page py-10" },
			h(
				"header",
				{ className: "flex flex-col gap-4" },
				h(
					"div",
					{ className: "flex flex-wrap items-center gap-3 text-sm font-semibold" },
					category && h("span", { className: "label" }, titles.categories.get(category) ?? category),
					!Number.isNaN(date.getTime()) && h("time", null, formatDate(date.toISOString())),
					h("span", { "aria-hidden": true }, "·"),
					h("span", null, `${readingMinutes(markdown)} min read`),
				),
				h("h1", { className: "font-heading text-4xl leading-[1.05] font-black tracking-tighter md:text-6xl" }, data("title") || "Untitled"),
				authors.length > 0 && h("p", { className: "text-lg" }, "By ", h("span", { className: "font-bold" }, listNames(authors))),
				data("doi") &&
					h("p", { className: "text-sm" }, "DOI: ", h("span", { className: "font-mono font-semibold underline" }, `https://doi.org/${data("doi")}`)),
				tags.length > 0 &&
					h(
						"ul",
						{ className: "flex flex-wrap gap-2" },
						tags.map((tag) => h("li", { key: tag }, h("span", { className: "tag" }, `#${tag}`))),
					),
			),
			h("div", { className: "prose-site mt-10", dangerouslySetInnerHTML: { __html: html } }),
		),
	);
}

CMS.registerPreviewTemplate("blog", BlogPreview);

/** The editor's session, which the CMS keeps once they've signed in */
const session = () => JSON.parse(localStorage.getItem("sveltia-cms.user") ?? "null")?.token as string | undefined;

/*
 * A page of sections, drawn by the site itself rather than copied here: the page
 * as the editor has it goes to /admin/preview (src/pages/admin/preview.astro),
 * which answers with the page as it will look, shown in a frame.
 */
function PagePreview({ entry, collection }: PreviewProps & { collection: string }) {
	const [html, setHtml] = React.useState("<p style='font-family: sans-serif'>Loading the preview…</p>");
	const body = JSON.stringify({ slug: entry.get("slug"), collection, data: entry.get("data")?.toJS?.() ?? {} });

	React.useEffect(() => {
		const controller = new AbortController();
		// Wait for a pause in typing, and drop an answer the next change makes stale
		const timer = setTimeout(async () => {
			try {
				const response = await fetch("/admin/preview", {
					method: "POST",
					headers: { "Content-Type": "application/json", Authorization: `Bearer ${session()}` },
					body,
					signal: controller.signal,
				});
				setHtml(await response.text());
			} catch (error) {
				if (!controller.signal.aborted) setHtml(`<p style='font-family: sans-serif'>No preview: ${error}</p>`);
			}
		}, 500);
		return () => {
			clearTimeout(timer);
			controller.abort();
		};
	}, [body]);

	return h("iframe", { srcDoc: html, title: "Preview", style: { width: "100%", height: "100vh", border: 0, display: "block" } });
}

// Journal pages are drawn under the journal's menu
for (const collection of ["pages", "journal-pages"]) {
	CMS.registerPreviewTemplate(collection, (props: PreviewProps) => h(PagePreview, { ...props, collection }));
}
