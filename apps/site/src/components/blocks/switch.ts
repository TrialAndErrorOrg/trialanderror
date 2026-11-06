/*
 * Show one panel of a group at a time: the chooser's options and the routes
 * of a steps section. In the HTML, a group is
 *
 *   <div data-switch>
 *     <button data-switch-to="a" aria-pressed="true">…</button>
 *     <div data-switch-panel id="a">…</div>
 *
 * Without JavaScript every panel shows. A link to a panel's id
 * (/journal/for-authors#registered-report) opens that panel.
 */

function select(group: Element, id: string, scroll = false) {
	for (const button of group.querySelectorAll<HTMLElement>("[data-switch-to]")) {
		if (button.closest("[data-switch]") !== group) continue;
		button.setAttribute("aria-pressed", String(button.dataset.switchTo === id));
	}
	let shown: HTMLElement | undefined;
	for (const panel of group.querySelectorAll<HTMLElement>("[data-switch-panel]")) {
		if (panel.closest("[data-switch]") !== group) continue;
		panel.hidden = panel.id !== id;
		if (!panel.hidden) shown = panel;
	}
	// On narrow screens the panel sits below the cards, out of sight
	if (scroll && shown && shown.getBoundingClientRect().top > window.innerHeight * 0.6) {
		const smooth = !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
		shown.scrollIntoView({ behavior: smooth ? "smooth" : "auto", block: "start" });
	}
}

function openFromHash() {
	const id = decodeURIComponent(location.hash.slice(1));
	const panel = id && document.getElementById(id);
	const group = panel instanceof HTMLElement && panel.matches("[data-switch-panel]") ? panel.closest("[data-switch]") : null;
	if (!group || !panel) return;
	select(group, id);
	panel.scrollIntoView({ block: "start" });
}

document.addEventListener("click", (event) => {
	const button = (event.target as Element).closest<HTMLElement>("[data-switch-to]");
	const group = button?.closest("[data-switch]");
	if (!button || !group) return;
	const id = button.dataset.switchTo!;
	select(group, id, true);
	// So the address can be shared, without jumping
	history.replaceState(null, "", `#${id}`);
});

window.addEventListener("hashchange", openFromHash);
openFromHash();
