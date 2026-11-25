import type { APIRoute } from "astro";
import { getEvents, toIcs } from "~/lib/sources/events";

// Every event as a calendar people can subscribe to
export const GET: APIRoute = async ({ site }) =>
	new Response(toIcs(await getEvents(), site ?? "https://trialanderror.org"), { headers: { "Content-Type": "text/calendar; charset=utf-8" } });
