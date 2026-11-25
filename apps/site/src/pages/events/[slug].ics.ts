import type { APIRoute, GetStaticPaths } from "astro";
import { getEvents, type SiteEvent, toIcs } from "~/lib/sources/events";

// One event, for "Add to calendar"
export const getStaticPaths = (async () => (await getEvents()).map((event) => ({ params: { slug: event.slug }, props: { event } }))) satisfies GetStaticPaths;

export const GET: APIRoute = ({ props, site }) =>
	new Response(toIcs([(props as { event: SiteEvent }).event], site ?? "https://trialanderror.org"), {
		headers: { "Content-Type": "text/calendar; charset=utf-8", "Content-Disposition": "attachment" },
	});
