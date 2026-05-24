# rx-tech-blog

Static blog source. Built with [Astro](https://astro.build/), deployed via GitHub Pages, served from `https://wzmn.net/blog/` through an Nginx reverse proxy. Cross-posted to dev.to / Hashnode / Medium with canonical URLs pointing back here so the SEO weight stays on the origin.

## Local development

```bash
npm install
npm run dev       # http://localhost:4321/blog/
npm run build     # outputs to ./dist/
npm run preview   # serve the built site locally
```

Posts live in `src/content/blog/` as Markdown or MDX. Frontmatter schema (validated at build time by Zod in `src/content.config.ts`):

```yaml
---
title: "Post title"
date: 2026-05-21
description: "One-line summary."
tags:
  - docker
  - devops
slug: my-post-slug      # routes to /blog/posts/my-post-slug/
draft: false            # optional; true hides from build
---
```

## Deployment

`.github/workflows/deploy.yml` builds on every push to `main` and deploys the contents of `dist/` to GitHub Pages. The repo is served at `https://<your-gh-user>.github.io/rx-tech-blog/`. All internal hrefs (and the canonical tag) carry the `/blog/` prefix because of `base: '/blog'` in `astro.config.mjs`, so links resolve correctly when accessed through the Nginx proxy at `wzmn.net/blog/`.

### Nginx (wzmn.net front)

Nginx in front of `wzmn.net` rewrites `/blog/*` to the GitHub Pages URL. The proxy sends `Host: <gh-user>.github.io` so GH Pages routes correctly, and strips the `/blog/` prefix before forwarding (`wzmn.net/blog/posts/foo/` → `<gh-user>.github.io/rx-tech-blog/posts/foo/` → `dist/posts/foo/index.html`).

The actual config isn't in the repo. See your local `docs/private/` for the template (and `CLAUDE.local.md` for the topology overview).

## Cross-posting

```bash
npm run crosspost -- <slug>
# e.g.
npm run crosspost -- compose-native-multi-environment
```

Writes three files to `out/crosspost/<slug>/`:

- `devto.md` — `canonical_url` set, tags capped at 4, hyphens stripped.
- `hashnode.md` — `canonicalUrl` set.
- `medium.md` — leading comment with the canonical URL and instructions to use Medium's *Import a story* (preserves canonical automatically).

`out/` is `.gitignored`.

## Layout

```
.
├── astro.config.mjs              site=wzmn.net, base=/blog
├── src/
│   ├── content.config.ts         Zod schema for the blog collection
│   ├── content/blog/             your posts
│   ├── components/BaseHead.astro canonical + OG + RSS link
│   ├── layouts/                  BaseLayout + PostLayout
│   ├── pages/
│   │   ├── index.astro           post list
│   │   ├── posts/[...slug].astro post page
│   │   ├── rss.xml.js            RSS feed
│   │   └── 404.astro
│   ├── consts.ts                 SITE_TITLE / SITE_DESCRIPTION
│   └── styles/global.css
├── public/                       .nojekyll, robots.txt, favicon
├── scripts/crosspost.mjs         cross-post generator
└── .github/workflows/deploy.yml  build + GH Pages deploy
```
