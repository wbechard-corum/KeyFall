#!/usr/bin/env node
// Builds the documentation site from the markdown in docs/.
//
// Deliberately small: one dependency (a markdown parser), one HTML shell, no
// framework. The pages are the same files a contributor reads in the repo, so
// there's no second copy of the docs to drift out of date.
//
//   npm run docs        # build into docs-site/
//   npm run docs:serve  # build and serve locally
import { readFile, writeFile, mkdir, rm, readdir, copyFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { marked } from 'marked';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const docsDir = path.join(repoRoot, 'docs');
const outDir = path.join(repoRoot, 'docs-site');

// Order here is the order in the sidebar.
const PAGES = [
  { file: 'index.md', title: 'KeyFall', nav: 'Overview' },
  { file: 'getting-started.md', title: 'Getting started', nav: 'Getting started' },
  { file: 'practice.md', title: 'Practising', nav: 'Practising' },
  { file: 'controller.md', title: 'Controller', nav: 'Controller' },
  { file: 'adding-a-profile.md', title: 'Adding a keyboard profile', nav: 'Adding a profile' },
  { file: 'profile-schema.md', title: 'Profile schema', nav: 'Profile schema' },
  { file: 'architecture.md', title: 'Architecture', nav: 'Architecture' },
  { file: 'development.md', title: 'Development', nav: 'Development' },
];

const pkg = JSON.parse(await readFile(path.join(repoRoot, 'package.json'), 'utf8'));

const htmlName = (file) => (file === 'index.md' ? 'index.html' : file.replace(/\.md$/, '.html'));

function shell({ title, nav, body, version }) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)} · KeyFall</title>
<meta name="description" content="KeyFall — open-source piano trainer and universal MIDI keyboard controller.">
<link rel="stylesheet" href="./docs.css">
</head>
<body>
<a class="skip" href="#content">Skip to content</a>
<header class="site-header">
  <a class="brand" href="./index.html"><span class="mark">K</span>KeyFall</a>
  <span class="version">v${escapeHtml(version)}</span>
  <a class="repo" href="https://github.com/wbechard-corum/keyfall">GitHub</a>
</header>
<div class="layout">
  <nav class="sidebar" aria-label="Documentation">
    <ul>${nav}</ul>
  </nav>
  <main id="content" class="content">
${body}
  </main>
</div>
<footer class="site-footer">
  KeyFall is MIT licensed. Piano samples are Salamander Grand Piano V3 by
  Alexander Holm, <a href="https://creativecommons.org/licenses/by/3.0/">CC BY 3.0</a>.
</footer>
</body>
</html>
`;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Rewrite in-repo markdown links so they work as site pages.
function rewriteLinks(html) {
  return html.replace(/href="([^"]+)\.md(#[^"]*)?"/g, (m, base, hash) => {
    const file = base.split('/').pop();
    return `href="${file === 'index' ? 'index' : file}.html${hash || ''}"`;
  });
}

const CSS = `:root {
  --bg: #0a0c0f;
  --surface: #12151a;
  --surface-2: #171b21;
  --border: #262c35;
  --text: #e6ebf1;
  --text-dim: #8d97a4;
  --accent: #4dd6c3;
  --accent-2: #c89dff;
}
* { box-sizing: border-box; }
html { scroll-behavior: smooth; }
body {
  margin: 0;
  background: var(--bg);
  color: var(--text);
  font: 15px/1.65 'IBM Plex Sans', system-ui, -apple-system, sans-serif;
  -webkit-font-smoothing: antialiased;
}
a { color: var(--accent); text-decoration: none; }
a:hover { text-decoration: underline; }

.skip {
  position: absolute; left: -9999px;
  background: var(--accent); color: #04110f; padding: 8px 14px; border-radius: 4px;
}
.skip:focus { left: 12px; top: 12px; z-index: 10; }

.site-header {
  display: flex; align-items: center; gap: 12px;
  padding: 14px 22px;
  border-bottom: 1px solid var(--border);
  position: sticky; top: 0; z-index: 5;
  background: rgba(10, 12, 15, 0.94);
  backdrop-filter: blur(8px);
}
.brand { display: flex; align-items: center; gap: 9px; font-weight: 700; color: var(--text); }
.brand .mark {
  display: grid; place-items: center;
  width: 24px; height: 24px; border-radius: 6px;
  background: var(--accent); color: #04110f; font-size: 13px;
}
.version {
  font-family: 'IBM Plex Mono', ui-monospace, monospace;
  font-size: 11px; color: var(--text-dim);
}
.repo { margin-left: auto; font-size: 13px; }

.layout { display: flex; align-items: flex-start; max-width: 1120px; margin: 0 auto; }
.sidebar {
  flex: 0 0 216px;
  padding: 26px 14px;
  position: sticky; top: 53px;
  max-height: calc(100vh - 53px);
  overflow-y: auto;
}
.sidebar ul { list-style: none; margin: 0; padding: 0; }
.sidebar li { margin-bottom: 2px; }
.sidebar a {
  display: block; padding: 6px 11px; border-radius: 5px;
  color: var(--text-dim); font-size: 13.5px;
}
.sidebar a:hover { background: var(--surface-2); color: var(--text); text-decoration: none; }
.sidebar a.active { background: var(--surface-2); color: var(--accent); font-weight: 600; }

.content { flex: 1; min-width: 0; padding: 26px 30px 80px; }
.content h1 { font-size: 30px; line-height: 1.2; margin: 0 0 18px; letter-spacing: -0.02em; }
.content h2 {
  font-size: 20px; margin: 36px 0 12px; padding-top: 14px;
  border-top: 1px solid var(--border); letter-spacing: -0.01em;
}
.content h3 { font-size: 16px; margin: 24px 0 8px; }
.content p, .content li { color: #cdd6e0; }
.content ul, .content ol { padding-left: 22px; }
.content li { margin: 4px 0; }
.content strong { color: var(--text); }

.content code {
  font-family: 'IBM Plex Mono', ui-monospace, monospace;
  font-size: 0.88em;
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: 4px;
  padding: 1px 5px;
}
.content pre {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 7px;
  padding: 13px 15px;
  overflow-x: auto;
}
.content pre code { background: none; border: none; padding: 0; font-size: 12.5px; line-height: 1.6; }

.content table { border-collapse: collapse; width: 100%; margin: 14px 0; display: block; overflow-x: auto; }
.content th, .content td {
  border: 1px solid var(--border);
  padding: 7px 11px;
  text-align: left;
  font-size: 13.5px;
}
.content th { background: var(--surface-2); color: var(--text); }

.content blockquote {
  margin: 14px 0;
  padding: 2px 16px;
  border-left: 3px solid var(--accent-2);
  color: var(--text-dim);
}
.content hr { border: none; border-top: 1px solid var(--border); margin: 28px 0; }

.site-footer {
  border-top: 1px solid var(--border);
  padding: 20px 22px 40px;
  text-align: center;
  color: var(--text-dim);
  font-size: 12.5px;
}

@media (max-width: 760px) {
  .layout { flex-direction: column; }
  .sidebar {
    position: static; flex: none; width: 100%; max-height: none;
    padding: 12px; border-bottom: 1px solid var(--border);
  }
  .sidebar ul { display: flex; flex-wrap: wrap; gap: 4px; }
  .content { padding: 20px 18px 60px; }
}
`;

async function main() {
  const missing = PAGES.filter(p => !existsSync(path.join(docsDir, p.file)));
  if (missing.length > 0) {
    console.error('Missing doc pages:', missing.map(m => m.file).join(', '));
    process.exit(1);
  }

  await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });

  for (const page of PAGES) {
    const nav = PAGES.map(p =>
      `<li><a href="./${htmlName(p.file)}"${p.file === page.file ? ' class="active"' : ''}>` +
      `${escapeHtml(p.nav)}</a></li>`).join('');

    const md = await readFile(path.join(docsDir, page.file), 'utf8');
    const body = rewriteLinks(marked.parse(md));
    await writeFile(path.join(outDir, htmlName(page.file)),
      shell({ title: page.title, nav, body, version: pkg.version }));
    console.log(`  ${htmlName(page.file)}`);
  }

  await writeFile(path.join(outDir, 'docs.css'), CSS);
  // GitHub Pages would otherwise run the output through Jekyll.
  await writeFile(path.join(outDir, '.nojekyll'), '');

  console.log(`\nBuilt ${PAGES.length} pages into ${path.relative(repoRoot, outDir)}/`);
}

await main();
