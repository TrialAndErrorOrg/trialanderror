/*
 * The shapes the site renders. Every content source (Strapi, Underlay, local
 * files) converts its data into these, so swapping a source never touches a
 * component.
 */

export interface Picture {
	url: string;
	/** A local image (site-content's uploads), which Astro resizes like a remote one */
	src?: ImageMetadata;
	width?: number;
	height?: number;
	alt?: string;
}

export interface Person {
	slug?: string;
	name: string;
	/** "team" for Center members, "guest" for outside blog authors */
	kind: "team" | "guest";
	position?: string;
	/** Only when the person chose to show them */
	pronouns?: string;
	/** HTML */
	summary?: string;
	image?: Picture;
	email?: string;
	orcid?: string;
	links: { icon: string; url: string }[];
	/** Old slugs, which redirect to this person's page */
	aliases?: string[];
}

export interface Term {
	slug: string;
	title: string;
}

export interface Post {
	id: string;
	slug: string;
	title: string;
	excerpt?: string;
	/** HTML. Left out of list queries */
	body?: string;
	date: string;
	updated?: string;
	doi?: string;
	image?: Picture;
	category?: Term;
	tags: Term[];
	authors: Person[];
	description?: string;
	related: string[];
	/** Shown big at the top of the blog's front page */
	featured?: boolean;
	/** The same post on Substack, where readers comment on it */
	substack?: string;
}

export interface Article {
	id: string;
	slug: string;
	title: string;
	description?: string;
	date: string;
	doi?: string;
	/** Type of article, from the journal's collections (Empirical paper, Reflection, ...) */
	kind?: string;
	issues: Term[];
	image?: Picture;
	authors: { name: string; orcid?: string; affiliation?: string }[];
	url: string;
	license?: { name: string; url: string };
}
