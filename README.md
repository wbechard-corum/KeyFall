# KeyFall

Open-source piano trainer and universal MIDI keyboard controller. Two tools in one, unified by a shared WebMIDI layer.

- **Trainer** — Falling-notes practice mode with MIDI file playback, on-screen piano, wait mode, and real-time feedback from a connected MIDI keyboard.
- **Controller** — Browse patches, tweak effects, and send SysEx from a phone or tablet — driven by JSON keyboard profiles so any hardware can be supported without code changes.

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

## Adding a keyboard profile

Drop a new JSON file into `src/profiles/` and register it in `src/profiles/index.js`. See `src/profiles/roland-juno-g.json` for a reference.

## License

MIT. See `LICENSE`.
