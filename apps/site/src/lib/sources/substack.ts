/*
 * How many comments a blog post's copy on Substack has, read at build time
 * from Substack's public (undocumented) JSON, so the post can send readers
 * there to join the discussion. Only the count: Substack's terms don't allow
 * copying the comments themselves. Anything that fails gives the link alone.
 */

export interface SubstackDiscussion {
	/** Where readers comment */
	url: string;
	count: number;
}

const cache = new Map<string, Promise<SubstackDiscussion>>();

/** The discussion of a Substack post, from its address (https://<pub>.substack.com/p/<slug>) */
export function getSubstackDiscussion(postUrl: string) {
	let discussion = cache.get(postUrl);
	if (!discussion) {
		const fallback = { url: `${postUrl.replace(/[?#].*$/, "").replace(/\/$/, "")}/comments`, count: 0 };
		discussion = load(postUrl).catch((error) => {
			console.warn(`[substack] no comment count for ${postUrl}: ${error instanceof Error ? error.message : error}`);
			return fallback;
		});
		cache.set(postUrl, discussion);
	}
	return discussion;
}

async function load(postUrl: string): Promise<SubstackDiscussion> {
	const url = new URL(postUrl);
	const slug = url.pathname.match(/\/p\/([^/]+)/)?.[1];
	if (!slug) throw new Error("not a /p/<slug> address");
	const response = await fetch(new URL(`/api/v1/posts/${slug}`, url.origin), { signal: AbortSignal.timeout(15_000), headers: { Accept: "application/json" } });
	if (!response.ok) throw new Error(`${response.status} for /api/v1/posts/${slug}`);
	const post = (await response.json()) as { comment_count?: number };
	return { url: `${url.origin}/p/${slug}/comments`, count: post.comment_count ?? 0 };
}
