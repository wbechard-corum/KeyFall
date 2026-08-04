# Development

## Setup

```bash
npm install
npm run dev:all      # front end + backend
```

Optional extras, needed only for the full test suite:

```bash
npm run test:setup   # playwright + the server's dependencies
```

## Scripts

| Command | What it does |
|---------|--------------|
| `npm run dev` | Vite only |
| `npm run dev:server` | Backend only (songs API, mirror relay) |
| `npm run dev:all` | Both, with prefixed output |
| `npm run build` | Production build into `dist/` |
| `npm test` | The whole suite |
| `npm test <filter>` | Only files matching the filter |
| `npm run validate:profiles` | Check keyboard profile JSON |
| `npm run docs` | Build the documentation site |

## Tests

Plain Node scripts, no framework. Each file exits non-zero on failure, or with
code 64 to mean "not applicable here" — which the runner reports as a skip.

Files that need a browser or the server's `ws` dependency run whatever they
can without those and skip only the part that needs them, so a bare
`npm install` still reports real results rather than a row of skips.

The browser tests drive a real Chromium: pinch gestures through CDP touch
events, audio rendered through an `OfflineAudioContext` and measured, the
SysEx editor's byte output, the profile capture flow.

## Adding a test

Drop a `*.test.mjs` file in `test/`. Use the shared helpers:

```js
import { check, finish, note } from './helpers.mjs';

check('a label describing what should be true', someCondition, 'debug detail');
finish('my-area');
```

For a file that mixes pure checks with browser checks, use
`loadPlaywrightOptional()` and `finish()` early when it returns null — that
way the pure half still counts.

## CI

GitHub Actions runs profile validation, the build, and the full suite with
Playwright installed, on every push and pull request.

## Contributing a keyboard profile

This is the most useful thing to contribute and needs no JavaScript. See
[Adding a keyboard profile](adding-a-profile.md) — the app can capture one
from the keyboard in front of you.
