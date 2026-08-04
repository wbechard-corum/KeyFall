#!/usr/bin/env node
// Validates keyboard profile JSON. Run with no arguments to check everything
// in src/profiles/, or pass paths to check specific files:
//
//   npm run validate:profiles
//   npm run validate:profiles -- my-keyboard.json
//
// Exits non-zero if any profile has errors, so CI can gate on it.
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { validateProfile, formatValidationResult } from '../src/profiles/validate.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const profileDir = path.join(repoRoot, 'src', 'profiles');

const args = process.argv.slice(2);
let files;
if (args.length > 0) {
  files = args.map(a => path.resolve(a));
} else {
  files = (await readdir(profileDir))
    .filter(f => f.endsWith('.json'))
    .map(f => path.join(profileDir, f));
}

if (files.length === 0) {
  console.error('No profile JSON files found.');
  process.exit(1);
}

let failed = 0;
let warned = 0;

for (const file of files) {
  const rel = path.relative(repoRoot, file);
  let profile;
  try {
    profile = JSON.parse(await readFile(file, 'utf8'));
  } catch (err) {
    console.log(`\x1b[31mFAIL\x1b[0m ${rel}`);
    console.log(`  error  not valid JSON: ${err.message}`);
    failed += 1;
    continue;
  }

  const result = validateProfile(profile, { source: rel });
  const banks = Array.isArray(profile.banks) ? profile.banks.length : 0;
  const patches = Array.isArray(profile.banks)
    ? profile.banks.reduce((n, b) => n + (Array.isArray(b?.patches) ? b.patches.length : 0), 0)
    : 0;

  if (!result.valid) {
    console.log(`\x1b[31mFAIL\x1b[0m ${rel}`);
    console.log(formatValidationResult(result));
    failed += 1;
  } else if (result.warnings.length > 0) {
    console.log(`\x1b[33mWARN\x1b[0m ${rel}  (${banks} banks, ${patches} patch names)`);
    console.log(formatValidationResult(result));
    warned += 1;
  } else {
    console.log(`\x1b[32m OK \x1b[0m ${rel}  (${banks} banks, ${patches} patch names)`);
  }
}

console.log(`\n${files.length} profile(s): ${files.length - failed} valid, ${failed} invalid, ${warned} with warnings`);
process.exit(failed > 0 ? 1 : 0);
