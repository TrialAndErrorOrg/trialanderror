import { glob } from "astro/loaders";
import { defineCollection } from "astro:content";
import { z } from "astro/zod";
import { contentDir } from "./integrations/content";

/*
 * Pages built from sections. Each file in pages/ of site-content is one page:
 * index.yaml is the homepage, about.yaml is /about, and so on. Files in
 * pages/journal/ are the journal's own pages: pages/journal/for-authors.yaml
 * is /journal/for-authors, under the journal's menu. A page is a
 * list of sections, drawn top to bottom. Each section type is a component in
 * src/components/sections. Text fields accept Markdown.
 */

const button = z.object({ label: z.string(), url: z.string(), style: z.enum(["accent", "plain"]).default("accent") });
const background = z.enum(["paper", "accent", "accent-soft", "journal", "journal-soft"]).default("paper");
/** How a list of journal articles looks: cards with the abstract, or a compact list like a table of contents */
export const articleStyle = z.enum(["cards", "list"]);

/*
 * Building blocks for structured pages, like the journal's For Authors page.
 * Cards and steps are sections of their own, and also go inside the panel
 * of a chooser option, with text, numbered parts and "read more" boxes.
 */

/** Required / recommended / not needed: sets a card's badge and frame */
const status = z.enum(["required", "recommended", "not-needed"]);

const card = z.object({
	title: z.string(),
	body: z.string().optional(),
	status: status.optional(),
	/** Badge text instead of the status's own ("Required if 2+ authors") */
	badge: z.string().optional(),
	/** box: framed; headed: title in a dark bar; soft: tinted; dashed; rule: a line on top; plain: nothing */
	look: z.enum(["box", "headed", "soft", "dashed", "rule", "plain"]).default("box"),
	/** Small boxed words under the text (CRediT roles) */
	/** Markdown, so a tag can be a link: [Methodology](https://…) */
	tags: z.array(z.string()).default([]),
	/** Extra text that opens on click */
	more: z.object({ label: z.string(), body: z.string() }).optional(),
});

const step = z.object({
	/** Small text above the title ("Stage 1 · You"). Steps without one are numbered */
	kicker: z.string().optional(),
	title: z.string(),
	text: z.string().optional(),
	/** Draw this step in the journal colour, for a milestone */
	highlight: z.boolean().default(false),
});

const block = z.discriminatedUnion("type", [
	z.object({ type: z.literal("text"), body: z.string() }),
	/** Numbered rows, such as the parts of a manuscript in order */
	z.object({
		type: z.literal("parts"),
		items: z.array(z.object({ title: z.string(), text: z.string().default("") })),
	}),
	z.object({
		type: z.literal("cards"),
		/** Most cards side by side */
		columns: z.number().int().min(1).max(4).optional(),
		items: z.array(card),
	}),
	z.object({ type: z.literal("steps"), steps: z.array(step) }),
	z.object({ type: z.literal("more"), label: z.string(), body: z.string() }),
]);

export type Card = z.infer<typeof card>;
export type Step = z.infer<typeof step>;
export type Block = z.infer<typeof block>;

/** The top of every structured section: "Step 1", the title, a line of text */
const heading = {
	id: z.string().optional(),
	eyebrow: z.string().optional(),
	title: z.string().optional(),
	intro: z.string().optional(),
	/** Shorter name for the "On this page" list */
	short: z.string().optional(),
};

const option = z.object({
	/** For links straight to this option (/journal/for-authors#registered-report). Made from the title if empty */
	id: z.string().optional(),
	title: z.string(),
	badge: z.string().optional(),
	summary: z.string().optional(),
	facts: z.array(z.object({ label: z.string(), value: z.string() })).default([]),
	/** The panel's title ("Empirical article: what to include"). The option's title if empty */
	heading: z.string().optional(),
	/** Small text beside the panel's title */
	note: z.string().optional(),
	/** journal: the chosen card and the panel's title bar are in the journal colour instead of black */
	tone: z.enum(["ink", "journal"]).default("ink"),
	blocks: z.array(block).default([]),
});

export type Option = z.infer<typeof option>;

const section = z.discriminatedUnion("type", [
	z.object({
		type: z.literal("hero"),
		title: z.string(),
		subtitle: z.string().optional(),
		text: z.string().optional(),
		buttons: z.array(button).default([]),
		color: z.enum(["accent", "journal"]).default("accent"),
	}),
	z.object({
		type: z.literal("text"),
		id: z.string().optional(),
		title: z.string().optional(),
		body: z.string(),
		background,
		buttons: z.array(button).default([]),
	}),
	z.object({
		type: z.literal("features"),
		id: z.string().optional(),
		title: z.string().optional(),
		items: z.array(
			z.object({
				title: z.string(),
				body: z.string(),
				link: z.object({ label: z.string(), url: z.string() }).optional(),
			}),
		),
	}),
	z.object({
		type: z.literal("latest-posts"),
		title: z.string().default("From the Blog"),
		count: z.number().int().positive().default(4),
	}),
	z.object({
		type: z.literal("latest-articles"),
		title: z.string().default("From the Journal"),
		count: z.number().int().positive().default(4),
		style: articleStyle.default("cards"),
	}),
	z.object({
		type: z.literal("issues"),
		title: z.string().default("Issues"),
		count: z.number().int().positive().default(3),
	}),
	z.object({
		type: z.literal("team"),
		id: z.string().optional(),
		title: z.string().default("Meet the Team"),
	}),
	z.object({
		type: z.literal("newsletter"),
	}),
	z.object({
		type: z.literal("buttons"),
		buttons: z.array(button),
	}),
	/** "On this page": links to the sections below it that have an anchor and a title */
	z.object({
		type: z.literal("contents"),
		title: z.string().default("On this page"),
	}),
	/** Cards to pick from, each opening its own panel ("What are you submitting?") */
	z.object({
		type: z.literal("chooser"),
		...heading,
		groups: z.array(
			z.object({
				title: z.string().optional(),
				note: z.string().optional(),
				options: z.array(option),
			}),
		),
	}),
	z.object({
		type: z.literal("cards"),
		...heading,
		/** Explain the Required / Recommended / Not needed badges above the cards */
		legend: z.boolean().default(false),
		/** Most cards side by side */
		columns: z.number().int().min(1).max(4).optional(),
		items: z.array(card),
	}),
	/** A numbered process. With more than one route, the routes become tabs */
	z.object({
		type: z.literal("steps"),
		...heading,
		routes: z.array(z.object({ label: z.string().default(""), steps: z.array(step) })),
		note: z.string().optional(),
	}),
]);

export type Section = z.infer<typeof section>;

export const pageSchema = z.object({
	title: z.string(),
	description: z.string().optional(),
	/** Show the title as a big heading above the sections */
	showTitle: z.boolean().default(false),
	sections: z.array(section),
});

export type PageData = z.infer<typeof pageSchema>;

const pages = defineCollection({
	loader: glob({ pattern: "**/*.yaml", base: `${contentDir}/pages` }),
	schema: pageSchema,
});

/*
 * The blog, edited in /admin (Blog, People, Categories). Images are paths
 * under /uploads (site-content's uploads/) or links to Unsplash; authors,
 * category and related posts are file names in the other collections.
 */

const blog = defineCollection({
	loader: glob({ pattern: "**/*.md", base: `${contentDir}/blog` }),
	schema: z.object({
		title: z.string(),
		date: z.coerce.date(),
		excerpt: z.string().optional(),
		/** For search engines and link previews, when the excerpt won't do */
		description: z.string().optional(),
		image: z.string().optional(),
		imageAlt: z.string().optional(),
		category: z.string().optional(),
		tags: z.array(z.string()).default([]),
		authors: z.array(z.string()).default([]),
		doi: z.string().optional(),
		related: z.array(z.string()).default([]),
	}),
});

const people = defineCollection({
	loader: glob({ pattern: "**/*.yaml", base: `${contentDir}/people` }),
	schema: z.object({
		firstName: z.string().optional(),
		lastName: z.string(),
		/** A member of the Center, shown in the team. Everyone else is a guest author */
		team: z.boolean().default(false),
		position: z.string().optional(),
		pronouns: z.string().optional(),
		/** Markdown */
		summary: z.string().optional(),
		image: z.string().optional(),
		email: z.string().optional(),
		orcid: z.string().optional(),
		links: z.array(z.object({ icon: z.string(), url: z.string() })).default([]),
		/** Old slugs, which keep redirecting to this person */
		aliases: z.array(z.string()).default([]),
	}),
});

const categories = defineCollection({
	loader: glob({ pattern: "**/*.yaml", base: `${contentDir}/categories` }),
	schema: z.object({ title: z.string() }),
});

export const collections = { pages, blog, people, categories };
