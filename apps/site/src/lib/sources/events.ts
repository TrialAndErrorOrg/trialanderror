import { type CollectionEntry, getCollection } from "astro:content";
import type { Picture } from "../types";
import { uploadedPicture as picture } from "../uploads";

/*
 * Events from site-content's events/, edited in /admin. "Upcoming" is decided
 * when the site is built, so pages also mark each event with its end time and
 * a small script hides upcoming ones that have since passed.
 */

export interface SiteEvent {
	slug: string;
	title: string;
	start: Date;
	end?: Date;
	allDay: boolean;
	location?: string;
	address?: string;
	online?: string;
	registration?: string;
	summary?: string;
	kind?: string;
	image?: Picture;
	/** Slug of a blog post about how it went */
	report?: string;
	/** HTML */
	body?: string;
	url: string;
}

async function toEvent({ id, data, rendered }: CollectionEntry<"events">): Promise<SiteEvent> {
	return {
		slug: id,
		title: data.title,
		start: data.start,
		end: data.end,
		allDay: data.allDay,
		location: data.location,
		address: data.address,
		online: data.online,
		registration: data.registration,
		summary: data.summary,
		kind: data.kind,
		image: await picture(data.image, data.imageAlt, `events/${id}.md`),
		report: data.report,
		body: rendered?.html,
		url: `/events/${id}`,
	};
}

let events: Promise<SiteEvent[]> | undefined;

/** Every event, soonest first */
export function getEvents() {
	events ??= getCollection("events")
		.then((entries) => Promise.all(entries.map(toEvent)))
		.then((all) => all.sort((a, b) => a.start.getTime() - b.start.getTime()));
	return events;
}

/** When an event is over: its end, or the end of its start day */
export const endOf = (event: SiteEvent) => event.end ?? new Date(event.start.getTime() + (event.allDay ? 24 : 3) * 60 * 60 * 1000);

/** Upcoming events soonest first, and past ones most recent first, as of the build */
export async function getEventsByTime(now = new Date()) {
	const all = await getEvents();
	return {
		upcoming: all.filter((e) => endOf(e) >= now),
		past: all.filter((e) => endOf(e) < now).reverse(),
	};
}

const AMSTERDAM = "Europe/Amsterdam";

/** "Tuesday 7 October 2025, 13:00–17:00" in Dutch time, the Center's */
export function formatWhen(event: SiteEvent) {
	const day = (d: Date) => d.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: AMSTERDAM });
	const time = (d: Date) => d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: AMSTERDAM });
	const sameDay = !event.end || day(event.start) === day(event.end);
	if (event.allDay) return sameDay ? day(event.start) : `${day(event.start)} to ${day(event.end!)}`;
	if (sameDay) return `${day(event.start)}, ${time(event.start)}${event.end ? `–${time(event.end)}` : ""} (Amsterdam time)`;
	return `${day(event.start)}, ${time(event.start)} to ${day(event.end!)}, ${time(event.end!)} (Amsterdam time)`;
}

/** The parts of a date badge: "7", "Oct", "2025" */
export const dateParts = (date: Date) => ({
	day: date.toLocaleDateString("en-GB", { day: "numeric", timeZone: AMSTERDAM }),
	month: date.toLocaleDateString("en-GB", { month: "short", timeZone: AMSTERDAM }),
	year: date.toLocaleDateString("en-GB", { year: "numeric", timeZone: AMSTERDAM }),
});

/** An iCalendar file with these events, for /events.ics and each event's "Add to calendar" */
export function toIcs(list: SiteEvent[], site: URL | string) {
	const stamp = (d: Date) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
	const date = (d: Date) => d.toISOString().slice(0, 10).replace(/-/g, "");
	const escape = (text: string) => text.replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/[,;]/g, (c) => `\\${c}`);
	// Lines longer than 75 octets are folded, as the format requires
	const fold = (line: string) => line.match(/.{1,73}/gu)?.join("\r\n ") ?? line;
	const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Center of Trial and Error//Events//EN", "CALSCALE:GREGORIAN", "X-WR-CALNAME:Center of Trial and Error"];
	for (const event of list) {
		const url = new URL(event.url, site).href;
		lines.push("BEGIN:VEVENT", `UID:${event.slug}@trialanderror.org`, `DTSTAMP:${stamp(new Date())}`);
		if (event.allDay) {
			const last = event.end ?? event.start;
			lines.push(`DTSTART;VALUE=DATE:${date(event.start)}`, `DTEND;VALUE=DATE:${date(new Date(last.getTime() + 24 * 60 * 60 * 1000))}`);
		} else {
			lines.push(`DTSTART:${stamp(event.start)}`, `DTEND:${stamp(endOf(event))}`);
		}
		lines.push(`SUMMARY:${escape(event.title)}`, `URL:${url}`);
		const where = [event.location, event.address].filter(Boolean).join(", ") || event.online;
		if (where) lines.push(`LOCATION:${escape(where)}`);
		lines.push(`DESCRIPTION:${escape([event.summary, event.online && `Online: ${event.online}`, url].filter(Boolean).join("\n\n"))}`, "END:VEVENT");
	}
	lines.push("END:VCALENDAR");
	return lines.map(fold).join("\r\n") + "\r\n";
}
