import type { Person, Picture, Post, Term } from "../types";

/*
 * Turns the records written by scripts/blog-to-underlay.ts back into the
 * site's types. Kept free of Astro imports so it can be tested on its own.
 */

type Rec = { id: string; type: string; data: any };
type FileRef = { $asset?: string; $file?: string; width?: number; height?: number; alt?: string; originalUrl?: string };

export function fromRecords(byType: Map<string, Rec[]>, fileUrl: (file: FileRef) => string) {
	const picture = (file?: FileRef): Picture | undefined =>
		file ? { url: fileUrl(file), width: file.width, height: file.height, alt: file.alt } : undefined;

	const terms = (type: string) => new Map<string, Term>((byType.get(type) ?? []).map((r) => [r.id, { slug: r.data.slug, title: r.data.title }]));
	const categories = terms("Category");
	const tags = terms("Tag");

	const people = new Map<string, Person>(
		(byType.get("Person") ?? []).map((r) => [
			r.id,
			{
				slug: r.data.slug,
				name: r.data.name,
				kind: r.data.kind,
				position: r.data.position,
				summary: r.data.summary,
				image: picture(r.data.image),
				email: r.data.email,
				orcid: r.data.orcid,
				links: r.data.links ?? [],
			},
		]),
	);

	const raw = byType.get("BlogPost") ?? [];
	const slugById = new Map(raw.map((r) => [r.id, r.data.slug as string]));

	const posts: Post[] = raw.map((r) => ({
		id: r.id,
		slug: r.data.slug,
		title: r.data.title,
		excerpt: r.data.excerpt,
		body: r.data.body,
		date: r.data.publishedAt,
		updated: r.data.updatedAt,
		doi: r.data.doi,
		image: picture(r.data.image),
		category: r.data.categoryId ? categories.get(r.data.categoryId) : undefined,
		tags: (r.data.tagIds ?? []).map((id: string) => tags.get(id)).filter(Boolean),
		authors: (r.data.authorIds ?? []).map((id: string) => people.get(id)).filter(Boolean),
		description: r.data.description ?? r.data.excerpt,
		related: (r.data.relatedIds ?? []).map((id: string) => slugById.get(id)).filter(Boolean),
	}));

	const team = [...people.values()].filter((p) => p.kind === "team");
	return { posts, team };
}
