/*
 * The site's three parts, each with its own name and colour, as on the old
 * sites: the Center in orange, the Journal in blue and the Blog in black and
 * white. The header and footer show the part the reader is in. The name always
 * links to the homepage: the header's tabs lead to each part's front page.
 */

export type SiteSection = "center" | "journal" | "blog";

export interface Brand {
	/** The name, one box per line */
	lines: [string, string];
	/** The part's front page */
	href: string;
	/** Classes for the name's box */
	box: string;
	/** Classes for the footer's background */
	soft: string;
}

export const BRANDS: Record<SiteSection, Brand> = {
	center: { lines: ["Center of", "Trial & Error"], href: "/", box: "bg-accent text-ink", soft: "bg-accent-soft" },
	journal: { lines: ["Journal of", "Trial & Error"], href: "/journal", box: "bg-journal text-paper", soft: "bg-journal-soft" },
	blog: { lines: ["A Blog of", "Trial & Error"], href: "/blog", box: "bg-ink text-paper", soft: "bg-subtle" },
};

/** The part of the site a path belongs to. The archived JRN is the Center's, not the Journal's */
export const sectionOf = (path: string): SiteSection => {
	if (/^\/journal(?:\/|$)/.test(path)) return "journal";
	if (/^\/blog(?:\/|$)/.test(path)) return "blog";
	return "center";
};

/** The other two parts, in the order their boxes stack behind the current one */
export const behind = (section: SiteSection): SiteSection[] =>
	(["center", "journal", "blog"] as const).filter((s) => s !== section);
