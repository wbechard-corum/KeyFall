# KeyFall

Open-source piano trainer and universal MIDI keyboard controller. Two tools in one, unified by a shared WebMIDI layer.

- **Trainer** — Falling-notes practice with accuracy scoring, per-hand isolation, A/B section repeat, wait mode, a metronome and count-in, a sampled grand piano, fingering and solfège labels, and sheet music alongside.
- **Controller** — Browse patches, tweak effects, and edit SysEx parameters from a phone or tablet — driven by JSON keyboard profiles so any hardware can be supported without code changes.
- **Mirror** — Pair a second device with a 6-digit code and drive the whole thing from an iPad on the music stand.

See `CLAUDE.md` for the architecture, roadmap, and rationale.

## Quick start

```bash
npm install
npm run dev:all
```

Then open the printed URL in **Chrome or Edge** (Web MIDI is not supported in Firefox or Safari). SysEx access is granted on first use.

`dev:all` runs two processes: the Vite dev server and the backend that stores
your song library and relays the iPad mirror. Vite proxies `/api` and
`/mirror/ws` to it, and songs are written to `./.data`.

`npm run dev` starts only the front end. The trainer, controller and built-in
demos all work, but the **Songs** tab and the sheet-music view need the backend
— run `npm run dev:server` alongside it, or just use `dev:all`.

### Build

```bash
npm run build
npm run preview
```

### Tests

```bash
npm test              # everything
npm test parser       # just files matching "parser"
```

Plain Node scripts, no test framework. Tests that need the backend's `ws`
dependency or a browser skip themselves with a note when those aren't
installed; `npm run test:setup` installs both so the full suite runs.

### Docker

A multi-stage `Dockerfile` (Node build → nginx serve on port 8080) and a `docker-compose.yml` are included.

```bash
docker compose up -d --build
# Open http://localhost:8080
```

Override the host port with `KEYFALL_PORT`:

```bash
KEYFALL_PORT=9090 docker compose up -d --build
```

**Important:** Web MIDI only works in a [secure context](https://developer.mozilla.org/en-US/docs/Web/Security/Secure_Contexts) — HTTPS, or `localhost`. If you're fronting this with Traefik / Caddy / nginx-proxy-manager for HTTPS termination, remove the `ports:` block in `docker-compose.yml` and attach to the proxy's network. The container listens on `:8080` inside the Docker network.

## Project layout

```
index.html              # Entry HTML, mounts every mode view
src/
  main.js               # Bootstraps mode switching and MIDI
  midi/                 # Shared WebMIDI layer (connection, input, output, sysex, parser)
  trainer/              # Falling-notes trainer (renderer, playback, audio, sheet, ui, demos)
  controller/           # Patch/effect controller (controller, effects-ui, ui, profile-loader)
  songs/                # Server-backed song library UI
  settings/             # Settings tab (colors, MIDI devices, mirror pairing)
  mirror-client/        # Read-only remote UI served at #mirror=<code>
  shared/               # Cross-mode code (constants, piano layout, settings, mirror)
  profiles/             # Keyboard profile JSON + registry
server/                 # Songs API + mirror WebSocket relay + MIDI->MusicXML
test/                   # Test suite (node test/run.mjs)
scripts/                # Dev helpers
styles/main.css
```

## Practice features

| Control | What it does |
|---------|--------------|
| **R / L** | Cycles each hand through BOTH → YOU → APP → OFF. **APP** plays that hand for you without grading it — the hand-isolation mode. |
| **WAIT** | Holds the playhead until every note of the current chord is played. |
| **LOOP A / B** | Drops section markers at the playhead and repeats between them, re-scoring each pass. |
| **MET** | Click track locked to the song's tempo map, with accented downbeats. |
| **Accuracy** | Live percentage, hit count and streak; a summary card at the end of a run. |

Look-ahead, input latency offset, beats per bar, count-in, note labels
(names or solfège), automatic fingering, and the choice between the
synthesised and sampled piano all live in **Settings**.

### Piano sound

The default synth starts instantly and costs nothing. Switching to the
**sampled grand** downloads 6.6 MB of Salamander Grand Piano V3 recordings
(bundled in the repo, served from `public/samples/piano`) and caches them for
offline use; the synth covers every note until the download finishes.

Samples are by Alexander Holm, licensed [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/).
To rebuild or re-encode them:

```bash
npm i --no-save playwright lamejs
node scripts/build-piano-samples.mjs
```

## Adding a keyboard profile

Drop a new JSON file into `src/profiles/` and register it in `src/profiles/index.js`.
See `src/profiles/roland-juno-g.json` for a reference and `docs/adding-a-profile.md`
for the full guide.

```bash
npm run validate:profiles
```

Profiles are validated at load time, by this CLI, and by CI.

## License

MIT. See `LICENSE`.
