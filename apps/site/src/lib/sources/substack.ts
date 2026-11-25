/*
 * The comments on a blog post's copy on Substack, read at build time from
 * Substack's public (undocumented) JSON API, so the post can show the
 * discussion and send readers there to join it. Anything that fails gives
 * no comments and the link alone.
 */

export interface SubstackComment {
	name: string;
	date: string;
	/** Plain text */
	body: string;
	replies: number;
}

export interface SubstackDiscussion {
	/** Where readers comment */
	url: string;
	count: number;
	/** The first few, best first */
	comments: SubstackComment[];
}

const cache = new Map<string, Promise<SubstackDiscussion | undefined>>();

/** The discussion of a Substack post, from its address (https://<pub>.substack.com/p/<slug>) */
export function getSubstackDiscussion(postUrl: string, shown = 3) {
	let discussion = cache.get(postUrl);
	if (!discussion) {
		discussion = load(postUrl, shown).catch((error) => {
			console.warn(`[substack] no comments for ${postUrl}: ${error instanceof Error ? error.message : error}`);
			return { url: `${postUrl.replace(/\/$/, "")}/comments`, count: 0, comments: [] };
		});
		cache.set(postUrl, discussion);
	}
	return discussion;
}

async function load(postUrl: string, shown: number): Promise<SubstackDiscussion | undefined> {
	const url = new URL(postUrl);
	const slug = url.pathname.match(/\/p\/([^/]+)/)?.[1];
	if (!slug) throw new Error("not a /p/<slug> address");
	const discussionUrl = `${url.origin}/p/${slug}/comments`;

	const get = async (path: string) => {
		const response = await fetch(new URL(path, url.origin), { signal: AbortSignal.timeout(15_000), headers: { Accept: "application/json" } });
		if (!response.ok) throw new Error(`${response.status} for ${path}`);
		return response.json();
	};

	const post = (await get(`/api/v1/posts/${slug}`)) as { id: number; comment_count?: number };
	const count = post.comment_count ?? 0;
	if (!count) return { url: discussionUrl, count, comments: [] };

	const { comments = [] } = (await get(`/api/v1/post/${post.id}/comments?all_comments=true&sort=best_first`)) as {
		comments?: { name?: string; date?: string; body?: string; deleted?: boolean; children?: unknown[] }[];
	};
	return {
		url: discussionUrl,
		count,
		comments: comments
			.filter((c) => !c.deleted && c.body)
			.slice(0, shown)
			.map((c) => ({ name: c.name ?? "A reader", date: c.date ?? "", body: c.body!, replies: c.children?.length ?? 0 })),
	};
}
