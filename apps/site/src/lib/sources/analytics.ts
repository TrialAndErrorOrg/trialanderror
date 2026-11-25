import { UMAMI_PASSWORD, UMAMI_URL, UMAMI_USERNAME } from "astro:env/server";
import { site } from "../settings";

/*
 * Page views from the site's Umami (analytics.trialanderror.org), read at
 * build time for "Most read" lists. Without credentials, or when Umami can't
 * be reached, every count is missing and callers fall back to a hand-picked
 * list, so a build never fails over analytics.
 */

const DAY = 24 * 60 * 60 * 1000;

let views: Promise<Map<string, number>> | undefined;

/** Views per path over the last `days` days, like "/blog/some-post" → 120 */
export function getPageViews(days = 365): Promise<Map<string, number>> {
	views ??= load(days).catch((error) => {
		console.warn(`[analytics] no page views from Umami: ${error instanceof Error ? error.message : error}`);
		return new Map();
	});
	return views;
}

async function load(days: number) {
	const websiteId = site.analytics?.websiteId;
	if (!UMAMI_USERNAME || !UMAMI_PASSWORD || !websiteId) throw new Error("UMAMI_USERNAME, UMAMI_PASSWORD or the website id is missing");

	const login = await fetch(new URL("/api/auth/login", UMAMI_URL), {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ username: UMAMI_USERNAME, password: UMAMI_PASSWORD }),
		signal: AbortSignal.timeout(15_000),
	});
	if (!login.ok) throw new Error(`login ${login.status}`);
	const { token } = (await login.json()) as { token: string };

	const endAt = Date.now();
	const startAt = endAt - days * DAY;
	// Umami 2 calls the dimension "url", Umami 3 "path"
	for (const type of ["path", "url"]) {
		const url = new URL(`/api/websites/${websiteId}/metrics`, UMAMI_URL);
		Object.entries({ startAt, endAt, type, limit: 500 }).forEach(([k, v]) => url.searchParams.set(k, String(v)));
		const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15_000) });
		if (!response.ok) continue;
		const rows = (await response.json()) as { x: string; y: number }[];
		const counts = new Map<string, number>();
		for (const { x, y } of rows) {
			const path = x.replace(/[?#].*$/, "").replace(/\/$/, "") || "/";
			counts.set(path, (counts.get(path) ?? 0) + y);
		}
		return counts;
	}
	throw new Error("the metrics endpoint answered neither type=path nor type=url");
}
