import type { APIRoute } from "astro";
import { adminGateway, siteSignIn } from "~/lib/admin";
import { analyticsConfigured, getOverview } from "~/lib/sources/analytics";

/*
 * What /admin shows a signed-in editor: who they are and the site's numbers
 * from GoatCounter. The site asks GoatCounter with its own token, so editors
 * need no GoatCounter login.
 */

export const prerender = false;

const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

export const GET: APIRoute = async ({ request, url }) => {
	if (!siteSignIn) return json({ error: "Signing in through the site is off (ADMIN_AUTH)" }, 404);
	const editor = await adminGateway().editor(request);
	if (!editor) return json({ error: "Not signed in, or the sign-in has expired" }, 401);

	const who = { name: editor.name, email: editor.email };
	if (!analyticsConfigured()) return json({ editor: who, analytics: { configured: false } });

	const days = Math.min(365, Math.max(7, Number(url.searchParams.get("days")) || 30));
	try {
		return json({ editor: who, analytics: { configured: true, ...(await getOverview(days)) } });
	} catch (error) {
		console.warn(`[admin] no numbers from GoatCounter: ${error instanceof Error ? error.message : error}`);
		return json({ editor: who, analytics: { configured: true, error: "GoatCounter didn't answer. Try again in a minute." } });
	}
};
