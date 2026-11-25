import { GOATCOUNTER_TOKEN } from "astro:env/server";
import { site } from "../settings";

/*
 * Page views from the site's GoatCounter (settings/site.yaml analytics), read
 * through its API with GOATCOUNTER_TOKEN: at build time for "Most read" lists,
 * and on request for the numbers on /admin. Without a token, or when
 * GoatCounter can't be reached, the counts are missing and callers fall back,
 * so a build never fails over analytics.
 */

const DAY = 24 * 60 * 60 * 1000;

export interface Overview {
	/** First and last day counted, as YYYY-MM-DD */
	start: string;
	end: string;
	/** Visitors over the whole period */
	total: number;
	/** Visitors per day */
	days: { day: string; count: number }[];
	pages: { path: string; title: string; count: number }[];
	/** Where visitors came from: sites, search engines, campaigns */
	referrers: { name: string; count: number }[];
	/** GoatCounter's own dashboard, for people with a GoatCounter login */
	dashboard: string;
}

/** Whether the site has what it needs to read GoatCounter */
export const analyticsConfigured = () => Boolean(site.analytics?.goatcounter && GOATCOUNTER_TOKEN);

async function api<T>(path: string, params: Record<string, string | number | boolean>): Promise<T> {
	const base = site.analytics?.goatcounter;
	if (!base || !GOATCOUNTER_TOKEN) throw new Error("analytics.goatcounter in Settings or GOATCOUNTER_TOKEN is missing");
	const url = new URL(`/api/v0/${path}`, base);
	for (const [key, value] of Object.entries(params)) url.searchParams.set(key, String(value));
	const response = await fetch(url, {
		headers: { Authorization: `Bearer ${GOATCOUNTER_TOKEN}`, "Content-Type": "application/json" },
		signal: AbortSignal.timeout(15_000),
	});
	if (!response.ok) throw new Error(`GoatCounter answered ${response.status} for ${path}`);
	return response.json() as Promise<T>;
}

const isoDay = (time: number) => new Date(time).toISOString().slice(0, 10);
const cleanPath = (path: string) => path.replace(/[?#].*$/, "").replace(/\/$/, "") || "/";

interface Hits {
	hits: { path: string; title: string; count: number; event: boolean }[];
	more: boolean;
}

let views: Promise<Map<string, number>> | undefined;

/** Visitors per path over the last `days` days, like "/blog/some-post" → 120 */
export function getPageViews(days = 365): Promise<Map<string, number>> {
	views ??= api<Hits>("stats/hits", { start: isoDay(Date.now() - days * DAY), end: isoDay(Date.now()), limit: 200 })
		.then(({ hits }) => {
			const counts = new Map<string, number>();
			for (const hit of hits) if (!hit.event) counts.set(cleanPath(hit.path), (counts.get(cleanPath(hit.path)) ?? 0) + hit.count);
			return counts;
		})
		.catch((error) => {
			console.warn(`[analytics] no page views: ${error instanceof Error ? error.message : error}`);
			return new Map();
		});
	return views;
}

// /admin asks on every visit, GoatCounter only needs asking every few minutes
const overviews = new Map<number, { at: number; overview: Promise<Overview> }>();
const FRESH = 10 * 60 * 1000;

/** Visitors per day, the most read pages and where readers came from, over the last `days` days */
export function getOverview(days: number): Promise<Overview> {
	const cached = overviews.get(days);
	if (cached && Date.now() - cached.at < FRESH) return cached.overview;
	const overview = loadOverview(days);
	overviews.set(days, { at: Date.now(), overview });
	// A failure isn't kept, so the next visit tries again
	overview.catch(() => overviews.delete(days));
	return overview;
}

async function loadOverview(days: number): Promise<Overview> {
	const start = isoDay(Date.now() - (days - 1) * DAY);
	const end = isoDay(Date.now());
	const [total, hits, refs] = await Promise.all([
		api<{ total: number; total_events: number; stats: { day: string; daily: number }[] }>("stats/total", { start, end }),
		api<Hits>("stats/hits", { start, end, limit: 15 }),
		api<{ stats: { name: string; count: number }[] }>("stats/toprefs", { start, end, limit: 10 }),
	]);
	return {
		start,
		end,
		total: total.total - total.total_events,
		days: total.stats.map((s) => ({ day: s.day, count: s.daily })),
		pages: hits.hits.filter((h) => !h.event).map((h) => ({ path: h.path, title: h.title, count: h.count })),
		referrers: refs.stats.map((r) => ({ name: r.name || "Direct or unknown", count: r.count })),
		dashboard: site.analytics!.goatcounter,
	};
}
