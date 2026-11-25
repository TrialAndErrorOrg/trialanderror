import { BLOG_SOURCE } from "astro:env/server";
import type { Person, Post } from "../types";
import * as strapiSource from "./blog-strapi";

/*
 * Where blog content comes from: site-content (BLOG_SOURCE=content, the
 * default, see blog-content.ts), Strapi, or Underlay. Strapi's preview button
 * still shows Strapi drafts.
 */

const sources = {
	content: () => import("./blog-content"),
	strapi: async () => strapiSource,
	underlay: () => import("./blog-underlay"),
};
// Loaded when posts are asked for, so the routes rendered on request (Strapi's
// draft previews) never load the others, or their build-only packages
const source = () => sources[BLOG_SOURCE]();

let posts: Promise<Post[]> | undefined;

/** All published posts, newest first. Fetched once per build */
export function getPosts(): Promise<Post[]> {
	posts ??= source()
		.then((s) => s.getPosts())
		.then((all) => all.sort((a, b) => b.date.localeCompare(a.date)));
	return posts;
}

export async function getPost(slug: string) {
	return (await getPosts()).find((post) => post.slug === slug);
}

export const getDraft = strapiSource.getDraft;

let team: Promise<Person[]> | undefined;
export function getTeam(): Promise<Person[]> {
	team ??= source().then((s) => s.getTeam());
	return team;
}

/** Everyone who wrote a post, with their posts */
export async function getAuthors() {
	const authors = new Map<string, { person: Person; posts: Post[] }>();
	for (const post of await getPosts()) {
		for (const person of post.authors) {
			if (!person.slug) continue;
			const entry = authors.get(person.slug) ?? { person, posts: [] };
			entry.posts.push(post);
			authors.set(person.slug, entry);
		}
	}
	return [...authors.values()];
}

export async function getTerms(kind: "category" | "tags") {
	const terms = new Map<string, { title: string; slug: string; posts: Post[] }>();
	for (const post of await getPosts()) {
		const list = kind === "category" ? (post.category ? [post.category] : []) : post.tags;
		for (const term of list) {
			const entry = terms.get(term.slug) ?? { ...term, posts: [] };
			entry.posts.push(post);
			terms.set(term.slug, entry);
		}
	}
	return [...terms.values()];
}

/** Categories with their posts, newest first, and the description /admin gives them */
export async function getCategories() {
	const [terms, s] = await Promise.all([getTerms("category"), source()]);
	const info: { slug: string; description?: string }[] = "getCategories" in s ? await s.getCategories() : [];
	const descriptions = new Map(info.map((c) => [c.slug, c.description]));
	return terms.map((term) => ({ ...term, description: descriptions.get(term.slug) }));
}
