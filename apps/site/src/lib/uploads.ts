import type { Picture } from "./types";

/*
 * Images from site-content's uploads/, which Astro resizes at build like any
 * other. A link (Unsplash, say) is used as it is.
 */

const uploads = import.meta.glob<{ default: ImageMetadata }>("@content/uploads/**/*.{webp,jpg,jpeg,png,avif,gif}");
const uploadsByPath = new Map(
	Object.entries(uploads).map(([key, load]) => [key.startsWith("@content/") ? key.slice("@content".length) : key.slice(key.indexOf("/uploads/")), load]),
);

/** The picture at a path under /uploads or a link. `where` names the file that asked, for the error */
export async function uploadedPicture(path: string | undefined, alt?: string, where?: string): Promise<Picture | undefined> {
	if (!path) return undefined;
	if (/^https?:\/\//.test(path)) return { url: path, alt };
	const load = uploadsByPath.get(path);
	if (!load) throw new Error(`${where}: ${path} is not in site-content's uploads`);
	const src = (await load()).default;
	return { url: src.src, src, width: src.width, height: src.height, alt };
}
