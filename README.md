# KeyFall

Open-source piano trainer and universal MIDI keyboard controller. Two tools in one, unified by a shared WebMIDI layer.

- **Trainer** — Falling-notes practice mode with MIDI file playback, on-screen piano, wait mode, and real-time feedback from a connected MIDI keyboard.
- **Controller** — Browse patches, tweak effects, and send SysEx from a phone or tablet — driven by JSON keyboard profiles so any hardware can be supported without code changes.

See `CLAUDE.md` for the architecture, roadmap, and rationale.

## Quick start

```bash
npm install
npm run dev
```

Then open the printed URL in **Chrome or Edge** (Web MIDI is not supported in Firefox or Safari). SysEx access is granted on first use.

### Build

```bash
npm run build
npm run preview
```

## Project layout

```
index.html              # Entry HTML, mounts trainer + controller views
src/
  main.js               # Bootstraps mode switching and MIDI
  midi/                 # Shared WebMIDI layer (connection, input, output, sysex, parser)
  trainer/              # Falling-notes trainer (renderer, playback, audio, ui, demos)
  controller/           # Patch/effect controller (controller, effects-ui, ui, profile-loader)
  shared/               # Cross-mode code (constants, piano layout, settings)
  profiles/             # Keyboard profile JSON + registry
styles/main.css
```

## Adding a keyboard profile

Drop a new JSON file into `src/profiles/` and register it in `src/profiles/index.js`. See `src/profiles/roland-juno-g.json` for a reference.

## License

MIT. See `LICENSE`.
