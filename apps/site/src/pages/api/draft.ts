import type { APIRoute } from "astro";
import { getDraft } from "~/lib/sources/blog";
import { allowPreview, isValidSecret } from "~/lib/preview";

export const prerender = false;

// Strapi's preview button calls this for blog posts. Pages live in
// site-content now and are previewed in /admin.
export const GET: APIRoute = async ({ url, cookies, redirect }) => {
	const secret = url.searchParams.get("secret");
	const slug = url.searchParams.get("slug");
	const type = url.searchParams.get("type");

	if (!isValidSecret(secret) || !slug) {
		return new Response("Invalid token", { status: 401 });
	}

	const kind = type === "blog" || (await getDraft(slug)) ? "blog" : undefined;
	if (!kind) return new Response("No draft with that slug", { status: 404 });

	allowPreview(cookies);
	return redirect(`/preview/${kind}/${encodeURIComponent(slug)}`, 307);
};
