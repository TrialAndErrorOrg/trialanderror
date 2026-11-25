import { Converter, type OjsAccess } from "converter";
import "converter/styles.css";
import { useCallback, useMemo, useState } from "react";
import { forgetSession, signIn as signInToAdmin, storedSession } from "../session";

/*
 * The converter (apps/converter) with this site's sign-in. Editors who are
 * signed in to /admin already are signed in here too: the CMS keeps its
 * session in localStorage. Others sign in through the same popup the CMS
 * uses (../session.ts). OJS calls go through /admin/ojs, which checks the session.
 */

export default function AdminConverter({ ojsUrl, ojs }: { ojsUrl: string; ojs: boolean }) {
	const [session, setSession] = useState(storedSession);

	const signIn = useCallback(async () => {
		setSession(await signInToAdmin());
	}, []);

	const fetchOjs = useCallback(
		async (path: string, apiKey: string, params: Record<string, string> = {}) => {
			const query = new URLSearchParams(params).toString();
			const response = await fetch(`/admin/ojs/${path}${query ? `?${query}` : ""}`, {
				headers: { Authorization: `Bearer ${session}`, "X-OJS-API-Key": apiKey },
			});
			if (response.status === 401) {
				forgetSession();
				setSession(undefined);
			}
			return response;
		},
		[session],
	);

	const access = useMemo<OjsAccess>(() => ({ url: ojsUrl, signedIn: Boolean(session), signIn, fetch: fetchOjs }), [ojsUrl, session, signIn, fetchOjs]);

	return <Converter ojs={ojs ? access : undefined} />;
}
