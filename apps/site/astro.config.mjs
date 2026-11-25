import node from "@astrojs/node";
import react from "@astrojs/react";
import sitemap from "@astrojs/sitemap";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig, envField, fontProviders } from "astro/config";
import icon from "astro-icon";
import content from "./src/integrations/content";
import pagefind from "./src/integrations/pagefind";

export default defineConfig({
	site: "https://trialanderror.org",
	trailingSlash: "ignore",
	// Behind a proxy (Coolify), trust its Host and X-Forwarded-* headers for these domains only, so
	// the server knows its public address. /admin's sign-in and the CMS config are built from it.
	security: {
		allowedDomains: [
			{ hostname: "trialanderror.org", protocol: "https" },
			{ hostname: "*.trialanderror.org", protocol: "https" },
		],
	},
	// Lets parallel builds write to separate folders
	outDir: process.env.ASTRO_OUT_DIR ?? "./dist",
	// Every page is prebuilt. Only routes that set `prerender = false` (the
	// draft previews) need the server. Swap this adapter for another host's
	// (netlify, vercel, cloudflare) without touching anything else.
	adapter: node({ mode: "standalone" }),
	// /blog/author/* only redirects to /people/*. React is only for the converter at /admin/convert
	integrations: [content(), icon(), react(), sitemap({ filter: (page) => !page.includes("/preview/") && !page.includes("/blog/author/") }), pagefind()],
	vite: {
		plugins: [tailwindcss()],
	},
	image: {
		// Remote images from these hosts are downloaded and optimised at build
		// time, so the built site does not depend on them at runtime.
		domains: ["cms.trialanderror.org", "assets.pubpub.org", "www.underlay.org", "images.unsplash.com"],
	},
	fonts: [
		{
			provider: fontProviders.google(),
			name: "Overpass",
			cssVariable: "--font-overpass",
			weights: [400, 600, 700, 800, 900],
			fallbacks: ["sans-serif"],
		},
		{
			provider: fontProviders.google(),
			name: "Open Sans",
			cssVariable: "--font-open-sans",
			weights: [400, 500, 600, 700],
			styles: ["normal", "italic"],
			fallbacks: ["sans-serif"],
		},
	],
	env: {
		schema: {
			STRAPI_URL: envField.string({ context: "server", access: "secret", default: "https://cms.trialanderror.org" }),
			STRAPI_TOKEN: envField.string({ context: "server", access: "secret", optional: true }),
			DRAFT_SECRET: envField.string({ context: "server", access: "secret", optional: true }),
			UNDERLAY_URL: envField.string({ context: "server", access: "secret", default: "https://www.underlay.org" }),
			UNDERLAY_TOKEN: envField.string({ context: "server", access: "secret", optional: true }),
			UNDERLAY_BLOG_COLLECTION: envField.string({ context: "server", access: "secret", default: "centeroftrialanderror/blog" }),
			BLOG_SOURCE: envField.enum({ context: "server", access: "secret", values: ["content", "strapi", "underlay"], default: "content" }),
			// How editors sign in to /admin: their own GitHub account, or Microsoft (see src/lib/admin)
			ADMIN_AUTH: envField.enum({ context: "server", access: "secret", values: ["github", "microsoft", "dev"], default: "github" }),
			ADMIN_SESSION_SECRET: envField.string({ context: "server", access: "secret", optional: true }),
			ADMIN_READ_ONLY: envField.boolean({ context: "server", access: "secret", default: false }),
			ENTRA_TENANT_ID: envField.string({ context: "server", access: "secret", optional: true }),
			ENTRA_CLIENT_ID: envField.string({ context: "server", access: "secret", optional: true }),
			ENTRA_CLIENT_SECRET: envField.string({ context: "server", access: "secret", optional: true }),
			GITHUB_APP_ID: envField.string({ context: "server", access: "secret", optional: true }),
			GITHUB_APP_PRIVATE_KEY: envField.string({ context: "server", access: "secret", optional: true }),
			GITHUB_CONTENT_TOKEN: envField.string({ context: "server", access: "secret", optional: true }),
			// Unsplash in /admin's image picker. The Access Key, which Unsplash means for browsers
			UNSPLASH_ACCESS_KEY: envField.string({ context: "server", access: "secret", optional: true }),
			// The journal's OJS API, for the converter at /admin/convert
			OJS_API_URL: envField.string({ context: "server", access: "secret", default: "https://submit.trialanderror.org/index.php/jote/api/v1" }),
			// Umami, for "Most read" on the blog. Optional: without it the hand-picked list in Settings is used
			UMAMI_URL: envField.string({ context: "server", access: "secret", default: "https://analytics.trialanderror.org" }),
			UMAMI_USERNAME: envField.string({ context: "server", access: "secret", optional: true }),
			UMAMI_PASSWORD: envField.string({ context: "server", access: "secret", optional: true }),
		},
	},
});
