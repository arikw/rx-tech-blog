#!/usr/bin/env node
// Usage: node scripts/crosspost.mjs <slug>
//
// Reads src/content/blog/<slug>.{md,mdx} and writes platform-specific
// versions to out/crosspost/<slug>/{devto.md,hashnode.md,medium.md}.
// Every version points its canonical URL back to wzmn.net/blog/posts/<slug>/
// so SEO weight stays on the original.

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CANONICAL_BASE = 'https://wzmn.net/blog/posts/';

function parseFrontmatter(raw) {
  const m = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!m) throw new Error('Missing frontmatter (--- ... ---)');
  const [, yaml, body] = m;
  const data = {};
  const lines = yaml.split('\n');
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }
    const kv = line.match(/^([A-Za-z_][A-Za-z0-9_]*):\s*(.*)$/);
    if (!kv) { i++; continue; }
    const [, key, rest] = kv;
    if (rest === '' && i + 1 < lines.length && /^\s+-\s+/.test(lines[i + 1])) {
      const arr = [];
      i++;
      while (i < lines.length && /^\s+-\s+/.test(lines[i])) {
        arr.push(lines[i].replace(/^\s+-\s+/, '').replace(/^"(.*)"$|^'(.*)'$/, '$1$2').trim());
        i++;
      }
      data[key] = arr;
    } else {
      data[key] = rest.replace(/^"(.*)"$|^'(.*)'$/, '$1$2').trim();
      i++;
    }
  }
  return { data, body: body || '' };
}

function fm(obj) {
  const lines = [];
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null || v === '') continue;
    if (typeof v === 'boolean') lines.push(`${k}: ${v}`);
    else lines.push(`${k}: ${JSON.stringify(String(v))}`);
  }
  return `---\n${lines.join('\n')}\n---\n`;
}

async function main() {
  const slug = process.argv[2];
  if (!slug) {
    console.error('Usage: node scripts/crosspost.mjs <slug>');
    process.exit(1);
  }

  const candidates = [
    resolve(REPO_ROOT, 'src/content/blog', `${slug}.md`),
    resolve(REPO_ROOT, 'src/content/blog', `${slug}.mdx`),
  ];
  const src = candidates.find(existsSync);
  if (!src) {
    console.error(`Post not found. Looked for:\n  ${candidates.join('\n  ')}`);
    process.exit(1);
  }

  const raw = await readFile(src, 'utf8');
  const { data, body } = parseFrontmatter(raw);
  const postSlug = data.slug || slug;
  const canonical = `${CANONICAL_BASE}${postSlug}/`;
  const outDir = resolve(REPO_ROOT, 'out/crosspost', slug);
  await mkdir(outDir, { recursive: true });

  const allTags = Array.isArray(data.tags) ? data.tags : [];

  // dev.to: max 4 tags, alphanumeric (hyphens removed). canonical_url supported.
  const devtoTags = allTags.slice(0, 4).map((t) => t.replace(/-/g, ''));
  const devto =
    fm({
      title: data.title,
      published: false,
      description: data.description,
      tags: devtoTags.join(', '),
      canonical_url: canonical,
    }) + '\n' + body.trimStart();

  // Hashnode: canonicalUrl supported (camelCase).
  const hashnode =
    fm({
      title: data.title,
      subtitle: data.description,
      tags: allTags.join(', '),
      canonicalUrl: canonical,
    }) + '\n' + body.trimStart();

  // Medium: no frontmatter canonical. Use "Import a story" with the URL below
  // so Medium fetches the source and preserves the canonical link automatically.
  const trimmedBody = body.trimStart();
  const bodyHasH1 = /^#\s/.test(trimmedBody);
  const titleHeader = bodyHasH1 ? '' : `# ${data.title}\n\n`;
  const medium =
`<!--
  Source canonical URL: ${canonical}

  Preferred: paste the URL above into Medium's "Import a story"
  (Settings → Stories → Import a story). Medium will fetch the post
  and preserve canonical attribution back to wzmn.net.

  Manual fallback: paste the body below into a new Medium story, then
  set canonical via "More options" → "Advanced" → "Original source".
-->

${titleHeader}${trimmedBody}`;

  await writeFile(resolve(outDir, 'devto.md'), devto);
  await writeFile(resolve(outDir, 'hashnode.md'), hashnode);
  await writeFile(resolve(outDir, 'medium.md'), medium);

  console.log('Wrote:');
  console.log(`  ${resolve(outDir, 'devto.md')}`);
  console.log(`  ${resolve(outDir, 'hashnode.md')}`);
  console.log(`  ${resolve(outDir, 'medium.md')}`);
  console.log(`Canonical: ${canonical}`);
  if (allTags.length > 4) {
    console.warn(`\nNote: dev.to limits to 4 tags. Used: ${devtoTags.join(', ')}`);
    console.warn(`                            Dropped: ${allTags.slice(4).join(', ')}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
