import { z } from "astro/zod";
import { parse } from "yaml";
// From site-content, see src/integrations/content.ts
import navigationYaml from "@content/settings/navigation.yaml?raw";
import siteYaml from "@content/settings/site.yaml?raw";

const link = z.object({
	title: z.string(),
	url: z.string().optional(),
	description: z.string().optional(),
	/** Section colour for the header tab: accent (orange, default), accent-soft (light orange) or journal (blue) */
	color: z.enum(["accent", "accent-soft", "journal"]).optional(),
	/** Show as a button instead of a plain link */
	button: z.boolean().optional(),
	get children() {
		return z.array(link).optional();
	},
});

export type NavLink = z.infer<typeof link>;

const siteSchema = z.object({
	name: z.string(),
	description: z.string(),
	url: z.url(),
	email: z.string(),
	blog: z.object({
		title: z.string(),
		description: z.string(),
		postsPerPage: z.number().int().positive(),
		pitchEmail: z.string().optional(),
		/** The blog's Substack, where readers subscribe and comment */
		substack: z.url().optional(),
		/** Slugs of the most read posts, for when Umami can't be asked */
		popular: z.array(z.string()).default([]),
	}),
	journal: z.object({
		title: z.string(),
		description: z.string(),
		url: z.url(),
		/** How article lists (all articles, issues, types) look: cards with the abstract, or a compact list */
		listStyle: z.enum(["cards", "list"]).default("cards"),
	}),
	newsletter: z.object({
		title: z.string(),
		text: z.string(),
		action: z.url(),
	}),
	analytics: z
		.object({
			script: z.url(),
			websiteId: z.string(),
		})
		.optional(),
	adTracking: z
		.object({
			id: z.string(),
			pages: z.array(z.string()),
		})
		.optional(),
});

const navigationSchema = z.object({
	header: z.array(link),
	journal: z.array(link),
	footer: z.array(link),
	socials: z.array(z.object({ icon: z.string(), url: z.string() })),
});

export const site = siteSchema.parse(parse(siteYaml));
export const navigation = navigationSchema.parse(parse(navigationYaml));
