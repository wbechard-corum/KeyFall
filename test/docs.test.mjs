// The documentation site build: every page renders, every link resolves, and
// nothing reaches outside the site.
import { check, finish, note, repoRoot } from './helpers.mjs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, readdir, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

const run = promisify(execFile);
const outDir = path.join(repoRoot, 'docs-site');
const docsDir = path.join(repoRoot, 'docs');

// The builder needs `marked`; it's a devDependency, so a bare install has it.
try {
  const { createRequire } = await import('node:module');
  createRequire(path.join(repoRoot, 'package.json')).resolve('marked');
} catch {
  note('skipped — marked not installed');
  finish('docs');
}

console.log('build');
await rm(outDir, { recursive: true, force: true });
let buildOutput = '';
try {
  const { stdout } = await run(process.execPath, ['scripts/build-docs.mjs'], { cwd: repoRoot });
  buildOutput = stdout;
  check('the site builds', true);
} catch (e) {
  check('the site builds', false, e.stderr || e.message);
  finish('docs');
}

const files = await readdir(outDir);
const pages = files.filter(f => f.endsWith('.html'));

// ── 1. Every markdown page becomes a page ────────────────────────────────
console.log('coverage');
{
  const sources = (await readdir(docsDir)).filter(f => f.endsWith('.md'));
  check('every markdown file is published', pages.length === sources.length,
    `${sources.length} sources -> ${pages.length} pages`);
  check('there is a home page', files.includes('index.html'));
  check('the stylesheet ships', files.includes('docs.css'));
  // GitHub Pages would otherwise run the output through Jekyll, which eats
  // files starting with an underscore.
  check('.nojekyll is present', files.includes('.nojekyll'));
}

// ── 2. Structure of each page ────────────────────────────────────────────
console.log('page structure');
{
  let problems = [];
  for (const page of pages) {
    const html = await readFile(path.join(outDir, page), 'utf8');
    if (!/<!DOCTYPE html>/i.test(html)) problems.push(`${page}: no doctype`);
    if (!/<title>[^<]+<\/title>/.test(html)) problems.push(`${page}: no title`);
    if (!/<h1[^>]*>/.test(html)) problems.push(`${page}: no h1`);
    if (!/class="sidebar"/.test(html)) problems.push(`${page}: no sidebar`);
    if (/<h1[^>]*>\s*<\/h1>/.test(html)) problems.push(`${page}: empty h1`);
  }
  check('every page has a doctype, title, h1 and sidebar', problems.length === 0,
    problems.slice(0, 3).join('; '));

  const home = await readFile(path.join(outDir, 'index.html'), 'utf8');
  check('the version is stamped in', /v\d+\.\d+\.\d+/.test(home));
  check('exactly one page is marked active per page',
    (home.match(/class="active"/g) || []).length === 1,
    `${(home.match(/class="active"/g) || []).length}`);
}

// ── 3. Links ─────────────────────────────────────────────────────────────
console.log('links');
{
  const internal = new Set();
  const unresolved = [];
  const leftoverMd = [];

  for (const page of pages) {
    const html = await readFile(path.join(outDir, page), 'utf8');
    for (const m of html.matchAll(/href="([^"]+)"/g)) {
      const href = m[1];
      if (/^(https?:|mailto:|#)/.test(href)) continue;
      if (href.endsWith('.md')) { leftoverMd.push(`${page} -> ${href}`); continue; }
      const target = href.replace(/^\.\//, '').split('#')[0];
      if (!target) continue;
      internal.add(target);
      if (!existsSync(path.join(outDir, target))) unresolved.push(`${page} -> ${href}`);
    }
  }

  check('no markdown links survive the build', leftoverMd.length === 0,
    leftoverMd.slice(0, 3).join('; '));
  check('every internal link resolves to a file', unresolved.length === 0,
    unresolved.slice(0, 3).join('; '));
  check('pages actually link to each other', internal.size >= pages.length,
    `${internal.size} distinct targets`);
}

// ── 4. Self-contained: nothing loaded from another origin ────────────────
console.log('self-contained');
{
  const external = [];
  for (const page of pages) {
    const html = await readFile(path.join(outDir, page), 'utf8');
    // Anchors to GitHub etc are fine; loading a resource from elsewhere is not.
    for (const m of html.matchAll(/<(?:link|script|img)[^>]*(?:href|src)="(https?:\/\/[^"]+)"/g)) {
      external.push(`${page}: ${m[1]}`);
    }
  }
  check('no page loads a resource from another origin', external.length === 0,
    external.slice(0, 3).join('; '));
}

// ── 5. A missing source page fails the build rather than shipping a gap ──
console.log('missing source');
{
  const tmp = path.join(docsDir, '__probe.md');
  const script = path.join(repoRoot, 'scripts', 'build-docs.mjs');
  const original = await readFile(script, 'utf8');
  try {
    // Point the builder at a page that doesn't exist.
    await import('node:fs/promises').then(fs => fs.writeFile(script,
      original.replace("{ file: 'index.md'", "{ file: '__missing.md'")));
    let failed = false;
    try { await run(process.execPath, [script], { cwd: repoRoot }); }
    catch { failed = true; }
    check('a missing source page fails the build', failed);
  } finally {
    await import('node:fs/promises').then(fs => fs.writeFile(script, original));
    await rm(tmp, { force: true });
  }
  // Leave a good build behind.
  await run(process.execPath, [script], { cwd: repoRoot });
}

finish('docs');
