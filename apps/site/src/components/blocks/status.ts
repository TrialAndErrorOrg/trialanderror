/** What a card's status badge says, also used for the legend above a cards section */
export const statusLabels = { required: "Required", recommended: "Recommended", "not-needed": "Not needed" } as const;

export const badgeClass = {
	required: "bg-ink text-paper border-ink",
	recommended: "border-journal text-journal",
	"not-needed": "border-dashed border-muted text-muted",
} as const;

export const badge = "self-start border-[1.5px] px-2 py-0.5 text-xs font-bold tracking-wide uppercase";
