import { type CollectionEntry, getCollection } from "astro:content";
import { marked } from "marked";
import type { Person, Picture, Post, Term } from "../types";

/*
 * Reads the blog from site-content (blog/, people/, categories/), where /admin
 * edits it. Selected with BLOG_SOURCE=content, the default. Images under
 * /uploads are resized at build like any other; links (Unsplash) are fetched.
 */

const uploads = import.meta.glob<{ default: ImageMetadata }>("@content/uploads/**/*.{webp,jpg,jpeg,png,avif,gif}");
const uploadsByPath = new Map(
	Object.entries(uploads).map(([key, load]) => [key.startsWith("@content/") ? key.slice("@content".length) : key.slice(key.indexOf("/uploads/")), load]),
);

async function picture(path: string | undefined, alt?: string, where?: string): Promise<Picture | undefined> {
	if (!path) return undefined;
	if (/^https?:\/\//.test(path)) return { url: path, alt };
	const load = uploadsByPath.get(path);
	if (!load) throw new Error(`${where}: ${path} is not in site-content's uploads`);
	const src = (await load()).default;
	return { url: src.src, src, width: src.width, height: src.height, alt };
}

const slugify = (text: string) =>
	text
		.toLowerCase()
		.normalize("NFKD")
		.replace(/[^\w\s-]/g, "")
		.trim()
		.replace(/[\s_]+/g, "-");

async function toPerson({ id, data }: CollectionEntry<"people">): Promise<Person> {
	return {
		slug: id,
		name: [data.firstName, data.lastName].filter(Boolean).join(" "),
		kind: data.team ? "team" : "guest",
		position: data.position,
		pronouns: data.pronouns,
		summary: data.summary ? await marked.parse(data.summary) : undefined,
		image: await picture(data.image, undefined, `people/${id}.yaml`),
		email: data.team ? data.email : undefined,
		orcid: data.orcid,
		links: data.links,
		aliases: data.aliases,
	};
}

let people: Promise<Map<string, Person>> | undefined;
function getPeople() {
	people ??= getCollection("people").then(async (entries) => new Map(await Promise.all(entries.map(async (e) => [e.id, await toPerson(e)] as const))));
	return people;
}

export async function getPosts(): Promise<Post[]> {
	const [entries, byId, categories] = await Promise.all([getCollection("blog"), getPeople(), getCollection("categories")]);
	// An empty blog means site-content wasn't found or is broken, never that there are no posts
	if (!entries.length) throw new Error("No posts in site-content's blog/. Is CONTENT_DIR right?");
	const categoryTitles = new Map(categories.map((c) => [c.id, c.data.title]));
	return Promise.all(
		entries.map(async ({ id, data, rendered }): Promise<Post> => {
			const where = `blog/${id}.md`;
			const authors = data.authors.map((slug) => {
				const person = byId.get(slug);
				if (!person) throw new Error(`${where}: no person ${slug} in people/`);
				return person;
			});
			const category: Term | undefined = data.category ? { slug: data.category, title: categoryTitles.get(data.category) ?? data.category } : undefined;
			return {
				id,
				slug: id,
				title: data.title,
				excerpt: data.excerpt,
				body: rendered?.html,
				date: data.date.toISOString(),
				doi: data.doi,
				image: await picture(data.image, data.imageAlt, where),
				category,
				tags: data.tags.map((title) => ({ title, slug: slugify(title) })),
				authors,
				description: data.description ?? data.excerpt,
				related: data.related,
				featured: data.featured,
				substack: data.substack,
			};
		}),
	);
}

/** Blog categories with their descriptions, in /admin's order (by file name) */
export async function getCategories() {
	return (await getCollection("categories")).map((c) => ({ slug: c.id, title: c.data.title, description: c.data.description }));
}

/** Team members, by last name */
export async function getTeam(): Promise<Person[]> {
	const entries = await getCollection("people", (e) => e.data.team);
	const byId = await getPeople();
	return entries.sort((a, b) => a.data.lastName.localeCompare(b.data.lastName)).map((e) => byId.get(e.id)!);
}
