/*
 * The sign-in to /admin, shared by its pages (the landing page, the
 * converter): sveltia-gateway's session, a signed token. Editors signed in to
 * the CMS already have one, which the CMS keeps in localStorage. Others sign
 * in through the same popup the CMS uses, and the session is kept under its
 * own key so signing out of the CMS doesn't sign them out here.
 */

const CMS_USER = "sveltia-cms.user";
const OWN_SESSION = "admin.session";

/** Whether a session (sveltia-gateway's signed `data.signature`) is still valid, going by its expiry */
function current(session: unknown): session is string {
	if (typeof session !== "string") return false;
	try {
		const data = JSON.parse(atob(session.split(".")[0].replaceAll("-", "+").replaceAll("_", "/")));
		return typeof data.exp === "number" && data.exp > Date.now() / 1000;
	} catch {
		return false;
	}
}

export function storedSession() {
	try {
		const cms = JSON.parse(localStorage.getItem(CMS_USER) ?? "null");
		return [localStorage.getItem(OWN_SESSION), cms?.token].find(current);
	} catch {
		return undefined;
	}
}

export function forgetSession() {
	try {
		localStorage.removeItem(OWN_SESSION);
	} catch {}
}

/** Sign in in a popup, the way Sveltia CMS does, and answer with the session */
export function signInPopup() {
	return new Promise<string>((resolve, reject) => {
		const popup = window.open("/admin/auth", "admin-sign-in", "width=600,height=700");
		if (!popup) return reject(new Error("The sign-in window was blocked. Allow popups for this site and try again."));

		const done = () => {
			window.removeEventListener("message", onMessage);
			clearInterval(closed);
		};
		const onMessage = (event: MessageEvent) => {
			if (event.source !== popup || event.origin !== location.origin || typeof event.data !== "string") return;
			// The popup says hello, we answer, it sends the result
			if (event.data === "authorizing:github") return popup.postMessage(event.data, location.origin);
			const result = event.data.match(/^authorization:github:(success|error):(.*)$/s);
			if (!result) return;
			done();
			const body = JSON.parse(result[2]);
			if (result[1] === "success") resolve(body.token);
			else reject(new Error(body.error ?? "Sign-in failed"));
		};
		const closed = setInterval(() => {
			if (!popup.closed) return;
			done();
			reject(new Error("The sign-in window was closed"));
		}, 500);
		window.addEventListener("message", onMessage);
	});
}

/** Sign in, and keep the session for the next visit */
export async function signIn() {
	const token = await signInPopup();
	try {
		localStorage.setItem(OWN_SESSION, token);
	} catch {}
	return token;
}
