# CLAUDE.md

Project context for Claude Code working in this repo.

## What this is

Personal tech blog, **WZMN Tech Blog**. Static site built with **Astro 6** (MDX, RSS, sitemap), published at `https://wzmn.net/blog/`: wzmn.net's own build clones this repo's `master` and builds it into `/blog`. It also still deploys to **GitHub Pages**. Details in `CLAUDE.local.md`.

## Stack & layout

- Astro 6 with `@astrojs/mdx`, `@astrojs/rss`, `@astrojs/sitemap`. Node ≥ 22.
- Content collection: `src/content/blog/*.{md,mdx}`. Schema in `src/content.config.ts` (Zod): `title`, `date`, `description`, `tags`, `slug`, `draft`.
- Routing: `src/pages/posts/[...slug].astro` routes on `entry.data.slug` (the schema field, **not** `entry.id`).
- URL strategy: `astro.config.mjs` sets `site: 'https://wzmn.net'` + `base: '/blog'`. Every internal link, the canonical tag in `src/components/BaseHead.astro`, the RSS feed, and the sitemap all carry the `/blog/` prefix. **Never hardcode `github.io` or strip the base** — the public URL is the source of truth.
- `scripts/crosspost.mjs` — utility script that emits platform-specific copies of a post under `out/crosspost/<slug>/` with the right canonical-URL field set. Not part of the build or deploy; runs on demand only.

## Part of wzmn.net

The blog is dressed as part of wzmn.net, whose home page is an Amstrad
computer:

- `src/styles/wzmn.css` — the look (the screen-lit top bar, nav Home,
  Projects, Blog, Contact with Blog marked, the footer strip, colours, the
  Amstrad font, IBM Plex Sans Hebrew for Hebrew text), used by
  `src/layouts/BaseLayout.astro`.
- `BaseLayout.astro`'s scripts handle the arrival from the home page: it
  passes `wzmn-from-crt` and `wzmn-dark` in `sessionStorage`, and the page
  starts dark and brightens. The keys and their meanings are listed in
  wzmn.net's `docs/ARCHITECTURE.md` ("Shared with the sub-sites"); change
  them there and on every side together.
- `src/pages/404.astro` — `/blog`'s own not-found page, in the same style as
  wzmn.net's (`noindex`).
- The RSS feed (`rss.xml`) feeds the home page's `TYPE LATEST.TXT` and the
  date of `BLOG` in its `DIR`.

## Commands

```bash
npm run dev               # localhost:4321/blog/
npm run build             # → dist/
npm run preview           # serve dist/ on localhost:4321/blog/
npm run crosspost -- <slug>
```

## Conventions

- Add posts as `src/content/blog/<slug>.md` (or `.mdx`). The `slug` frontmatter field controls the URL; keep the filename and the `slug` value in sync.
- **Don't start the post body with `# Title`.** `PostLayout.astro` renders the frontmatter `title` as the page `<h1>` already — adding it again in the body produces a duplicate. Start the body with the first paragraph or an `## H2` section. The `crosspost.mjs` script knows this and prepends `# Title` automatically for Medium output (which expects an in-body title).
- For colocated post assets (images, etc.), put them next to the markdown in `src/content/blog/<slug>/` and reference them with relative paths so `astro:assets` can optimize them.
- Don't put post images in `public/` — that bypasses optimization.
- The author for the site is `Arik W.`. It's set as the default on the `author` Zod field in `src/content.config.ts`, rendered as `<meta name="author">` in `BaseHead.astro`, and emitted per-item as `<dc:creator>` in the RSS feed. Override per post by setting `author:` in frontmatter. Don't add an `author` field to `package.json` (see `CLAUDE.local.md` for why).

## Deployment

- `.github/workflows/deploy.yml` builds on push to `master`, deploys `dist/` to GitHub Pages, then pings wzmn.net's Cloudflare deploy hook (the `WZMN_DEPLOY_HOOK` secret), which rebuilds wzmn.net with this repo's `master` in `/blog`.
- `docs/private/` (gitignored) still holds the old Nginx snippet from when `/blog` was proxied to GitHub Pages; see `CLAUDE.local.md`.

## Where things live that aren't in this file

- `CLAUDE.local.md` (gitignored) — deployment specifics, personal/sensitive context, and project-specific working preferences.
- `docs/private/` (gitignored) — Nginx config and any other deployment artifacts with real values.
- `README.md` — public-facing project intro.
