import type { APIRoute } from "astro";

// PubPub's issue pages (journal.trialanderror.org/collection/<slug>) moved for good to the issue on this site
export const prerender = false;

export const GET: APIRoute = ({ params, redirect, site }) => {
	const slug = (params.path ?? "").split("/").filter(Boolean)[0];
	const base = site ?? "https://trialanderror.org";
	return redirect(new URL(slug ? `/journal/issue/${encodeURIComponent(slug)}` : "/journal/issues", base).href, 301);
};
