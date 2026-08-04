# KeyFall — Open Source Piano Trainer & Keyboard Controller

## Project Vision

KeyFall is two tools in one, unified by a shared WebMIDI layer:

1. **Trainer** — A falling-notes piano learning tool inspired by Synthesia. Load MIDI files, watch notes fall toward a virtual keyboard, play along with real-time feedback from a connected MIDI keyboard.

2. **Controller** — A universal MIDI keyboard controller. Select patches, adjust effects, and manage your instrument from a phone or tablet screen — replacing broken displays or just providing a better interface. Extensible via keyboard profile definitions that describe any instrument's bank structure, CC mappings, and SysEx commands.

Both modes share a single WebMIDI connection layer. Connect your keyboard once, switch between learning a song and tweaking your sound.

The goal is to fill the gap left by web-based projects that went closed-source (Midiano, Sightread), and to provide something no existing tool does: a browser-based controller that works with specific hardware instruments, not just generic GM.

## Current State (v0.8)

A single Vite app with a shared WebMIDI layer and a mode switcher (LIVE /
SONGS / PATCHES / SETTINGS), plus a Node backend for the song library and the
iPad mirror. The original `keyfall-piano.html` and `juno-g-midi.html`
prototypes have been fully absorbed and removed.

Run `npm run dev:all` to start the front end and the backend together;
`npm test` runs the suite (`test/`, plain node scripts, no framework).

### Trainer — What works today

- **MIDI file parser**: Built from scratch, no dependencies. Formats 0 and 1,
  tempo map, running status, unknown-chunk skipping. Dangling note-ons are
  closed at end of track; a note retriggered before its note-off yields two
  notes.
- **Hand assignment**: By average pitch per track, with track-name hints
  ("Right Hand", "L.H.", "Bass") taking precedence. Single-track files split
  at middle C.
- **Canvas renderer**: 88-key keyboard with falling note bars, hand-coloured.
  Binary-searched note lookup, so a 40k-note song still renders in well under
  a millisecond per frame. Configurable keyboard range (25-88 keys), key and
  hand colours, and note labels.
- **Playback engine**: `requestAnimationFrame` with a clamped delta so a
  backgrounded tab doesn't teleport the playhead. Cursor-based note emission
  (no note is ever stepped over). Speed 0.25x-1.5x.
- **Scoring**: Every press is judged against the nearest unjudged note within
  250ms and rated perfect / good / early / late; unplayed notes are swept as
  misses. Running accuracy, streak, and an end-of-run summary. Works with wait
  mode on or off.
- **Hand modes**: Each hand is BOTH / YOU / APP / OFF — see "Hand modes" below.
- **Wait mode**: Stalls until every note of the current chord is played. Only
  waits on hands that are scored.
- **Section repeat**: A/B loop points on the progress bar; each pass is
  re-scored fresh.
- **Metronome and count-in**: Click track driven by the song's tempo map, with
  accented downbeats and an optional 1-2 bar count-in.
- **Input offset**: Compensates for MIDI/audio latency before judging.
- **Audio**: Two instruments behind one facade. A synthesised piano (register-
  dependent spectra, velocity-dependent brightness, two detuned strings,
  hammer noise, note-off damping, sustain pedal) that costs nothing to start,
  and the sampled Salamander Grand — all 88 keys every three semitones across
  four velocity layers, 6.6 MB, bundled. Nothing downloads until the sampled
  piano is chosen, and notes fall back to the synth until it lands.
- **Labels**: Falling notes carry note names or solfège (fixed or movable do),
  plus optional automatic fingering numbers.
- **Sheet music**: OpenSheetMusicDisplay view with a playback cursor, from
  MusicXML converted server-side.
- **WebMIDI input**: Auto-detects keyboards, captures note on/off and CC.
- **Touch piano**: Per-pointer tracking, so one finger releasing doesn't kill
  notes held elsewhere.
- **4 built-in demos** plus drag & drop of `.mid` files.

### Controller — What works today

- **WebMIDI output**: Bank Select (CC 0 + CC 32) and Program Change.
- **Effect sliders**: Vertical faders sending CC in real time, defined by the
  active profile.
- **Toggle controls**: On/off CC buttons (sustain, portamento, etc).
- **MIDI channel selector** and **device picker** with auto-select.
- **SysEx Identity Request**: Sends `F0 7E 7F 06 01 F7`, parses the reply, and
  auto-selects a matching profile.
- **Profile validation**: Every profile is checked at load; `npm run
  validate:profiles` and CI check them too.
- **Roland Juno-G and Generic GM profiles**, with an LCD-style patch display.
- **Mobile-optimized UI**.

### Songs, mirror and settings

- **Song library**: Server-backed upload / rename / star / delete, with
  atomic index writes and MIDI validation on upload.
- **iPad mirror**: Host shows a 6-digit code; a second device drives playback,
  patches and effects over a WebSocket relay. The code survives a host
  reconnect.
- **Settings**: Key range, colours, labels, look-ahead, input offset, beats
  per bar, count-in, MIDI device and channel, profile, mirror pairing.
- **PWA**: Manifest, service worker, self-hosted fonts, wake lock.

### Hand modes

A single "muted" flag used to conflate three questions — draw it, sound it,
grade it. Each hand now carries a mode:

| Mode | Visible | Audible | Scored | Use |
|------|---------|---------|--------|-----|
| BOTH | yes | yes | yes | Default: you play it, the app plays along |
| YOU  | yes | no  | yes | You play it, the app stays out of the way |
| APP  | yes | yes | no  | Hand isolation: the app plays it for you |
| OFF  | no  | no  | no  | Hidden entirely |

## Keyboard Profile System

The controller module is built around a **profile** abstraction. Each supported keyboard gets a JSON profile that describes everything the controller needs to know about the instrument. This keeps the controller code generic and makes adding new keyboards a data problem, not a code problem.

### Profile structure

```json
{
  "id": "roland-juno-g",
  "manufacturer": "Roland",
  "model": "JUNO-G",
  "identityResponse": {
    "manufacturerId": "0x41",
    "familyCode": "0x0f02",
    "modelNumber": "0x0000"
  },
  "banks": [
    {
      "id": "PR-A",
      "label": "PR-A",
      "msb": 87,
      "lsb": 0,
      "patches": [
        "Juno-G Grand",
        "Bright Grand",
        "..."
      ]
    }
  ],
  "effects": [
    {
      "id": "reverb",
      "label": "Reverb Send",
      "type": "cc",
      "cc": 91,
      "min": 0,
      "max": 127,
      "default": 40
    },
    {
      "id": "cutoff",
      "label": "Filter Cutoff",
      "type": "cc",
      "cc": 74,
      "min": 0,
      "max": 127,
      "default": 127
    }
  ],
  "controls": [
    {
      "id": "sustain",
      "label": "Sustain",
      "type": "cc-toggle",
      "cc": 64,
      "onValue": 127,
      "offValue": 0
    }
  ],
  "sysex": {
    "identityRequest": [240, 126, 127, 6, 1, 247],
    "parameterFormat": "roland-dt1",
    "modelId": [0, 0, 0, 21],
    "commands": {
      "mfxType": {
        "address": [16, 0, 4, 0],
        "size": 2,
        "description": "MFX effect type selection"
      }
    }
  },
  "notes": "Bank MSB/LSB values are from community documentation. Firmware 2.0 or lower required for some replacement LCD screens. The Juno-G is USB MIDI class-compliant."
}
```

A reference profile file for the Juno-G is included at `src/profiles/roland-juno-g.json`.

### Profile capabilities

Each profile can define:

- **Banks and patches**: Bank Select MSB/LSB values and patch names for every bank. The controller renders a browsable list; tapping a patch sends Bank Select + Program Change.
- **Effects (CC-based)**: Any number of continuous controller sliders. Each defines a CC number, range, default, and label. Rendered as vertical faders.
- **Toggle controls**: On/off buttons for CCs like sustain (CC 64), portamento (CC 65), sostenuto (CC 66), etc.
- **SysEx commands**: For parameters that aren't accessible via standard CCs (e.g., Roland MFX parameters, Yamaha system exclusive). The profile defines address maps; the controller builds and sends the SysEx messages. This is keyboard-specific and optional — many controllers only need CC.
- **Identity matching**: The `identityResponse` field lets the app auto-detect which profile to load when a keyboard is connected, by matching against the response to a Universal SysEx Identity Request.
- **Notes**: Free-text field for keyboard-specific caveats, firmware requirements, or known issues.

### Planned profiles

| Keyboard | Status | Notes |
|----------|--------|-------|
| Roland Juno-G | POC complete | Banks PR-A through GM. CC effects. SysEx identity. Patch names for PR-A, PR-B; rest need filling in. |
| Generic GM | Planned | Standard General MIDI bank/patch structure. Works with any GM-compliant keyboard. Should be the fallback profile. |
| Roland Juno-DS | Planned | Similar bank structure to Juno-G but different MSB/LSB values. |
| Yamaha PSR series | Planned | Large voice bank with XG extensions. |
| Korg Minilogue | Planned | CC-heavy — most parameters are standard CCs. |
| Nord Stage | Planned | Program Change based, minimal SysEx. |

Community contributions for new profiles would be a major value-add. Each profile is a single JSON file — no code changes needed to add support for a new keyboard.

### Auto-detection flow

1. On WebMIDI connection, send Identity Request (`F0 7E 7F 06 01 F7`) to all outputs
2. Parse Identity Reply from inputs
3. Match manufacturer ID + family + model against loaded profiles
4. If matched, auto-select the profile and show the keyboard's name in the UI
5. If no match, fall back to Generic GM profile

## Project Structure

```
keyfall/
├── index.html
├── src/
│   ├── main.js                # Entry point, mode switching, app init
│   ├── midi/
│   │   ├── connection.js      # WebMIDI device discovery, connect/disconnect
│   │   ├── input.js           # MIDI input (note on/off, CC, SysEx)
│   │   ├── output.js          # MIDI output (PC, CC, SysEx)
│   │   ├── sysex.js           # SysEx builders: Roland DT1, identity reply
│   │   └── parser.js          # MIDI file parser (.mid → note objects)
│   ├── trainer/
│   │   ├── renderer.js        # Canvas rendering (piano, falling notes, grid)
│   │   ├── playback.js        # Clock, wait mode, hand modes, section repeat
│   │   ├── scoring.js         # Hit/miss judging, accuracy, combo
│   │   ├── fingering.js       # Automatic fingering assignment
│   │   ├── metronome.js       # Click track + count-in from the tempo map
│   │   ├── audio.js           # Instrument facade (synth / sampled)
│   │   ├── audio-context.js   # Shared AudioContext + master bus
│   │   ├── synth.js           # Synthesised piano voice
│   │   ├── sampler.js         # Sampled piano playback
│   │   ├── sheet.js           # OpenSheetMusicDisplay wrapper + cursor
│   │   ├── library.js         # Songs API client
│   │   ├── demos.js           # Built-in demo songs
│   │   └── ui.js              # Trainer controls and layout
│   ├── controller/
│   │   ├── controller.js      # Patch selection, CC sending, SysEx
│   │   ├── profile-loader.js  # Load, validate and normalise profiles
│   │   ├── effects-ui.js      # Slider and toggle rendering
│   │   ├── sysex-ui.js        # SysEx parameter editor
│   │   └── ui.js              # Controller layout, bank/patch list, LCD
│   ├── songs/ui.js            # Song library screen
│   ├── settings/ui.js         # Settings screen
│   ├── mirror-client/ui.js    # Remote UI served at #mirror=<code>
│   ├── shared/
│   │   ├── constants.js       # Colors, note names, hand modes, timing windows
│   │   ├── piano-keyboard.js  # Shared piano key layout computation
│   │   ├── settings.js        # User preferences
│   │   ├── mirror.js          # WebSocket host/client
│   │   ├── app-mirror.js      # Mirror state aggregation + command routing
│   │   ├── wake-lock.js       # Keep the screen awake
│   │   └── fonts.js           # Self-hosted IBM Plex imports
│   └── profiles/
│       ├── roland-juno-g.json
│       ├── generic-gm.json
│       ├── validate.js        # Profile schema validation
│       └── index.js           # Profile registry
├── server/
│   ├── mirror-server.js       # Songs API + mirror relay + MIDI→MusicXML
│   └── Dockerfile             # Includes the music21 converter
├── test/                      # Test suite — `npm test`
├── public/samples/piano/      # Salamander Grand samples (CC BY 3.0)
├── scripts/                   # dev-all, validate-profiles, build-piano-samples
├── docs/
│   ├── adding-a-profile.md
│   └── profile-schema.md
├── styles/main.css
├── CLAUDE.md
├── README.md
├── LICENSE                    # MIT
└── package.json
```

### Key architectural boundaries

- **`src/midi/`** is the shared layer. Both trainer and controller import from here. It owns the WebMIDI connection lifecycle. Only one module should call `navigator.requestMIDIAccess()`.
- **`src/midi/sysex.js`** contains manufacturer-specific SysEx builders. Each format (Roland DT1, Yamaha Parameter Change, etc.) is a function that takes an address and data array and returns a complete SysEx byte array with checksum. Profiles reference these by the `parameterFormat` field.
- **`src/trainer/`** only reads MIDI input (note on/off from the keyboard). It never sends MIDI output (except optionally for MIDI-out playback to the keyboard's speakers).
- **`src/controller/`** only sends MIDI output (Bank Select, PC, CC, SysEx). It reads MIDI input only for SysEx responses (identity reply, parameter dumps).
- **`src/profiles/`** is pure data. Profile JSON files have no code. `profile-loader.js` validates the schema and provides typed access.
- **`src/shared/`** contains code used by both modes. The piano key layout computation is shared because the controller may display a visual keyboard for note feedback.

## Roadmap

Phases 1-3 are essentially done. Remaining work is listed under "Not done yet".

### Phase 1: Project scaffolding — done
- [x] Split both HTML prototypes into the module structure above
- [x] Vite with ES modules
- [x] Shared WebMIDI connection layer with SysEx support
- [x] Mode switcher UI
- [x] PWA manifest and service worker

### Phase 2: Controller hardening — mostly done
- [x] Profile schema validation with per-field error reporting
- [x] Profile loader with validation, plus a CLI and CI gate
- [x] Auto-detection via Identity Request/Reply matching
- [x] Generic GM fallback profile
- [x] Juno-G patch names for all banks
- [x] Toggle controls (sustain etc) from profiles
- [x] Profile contribution guide
- [x] SysEx parameter editor UI for Roland DT1

### Phase 3: Trainer improvements — mostly done
- [x] Accuracy scoring: per-note rating colours, running accuracy, summary
- [x] Loop mode: A/B section repeat
- [x] Hand isolation: APP mode plays a hand without scoring it
- [x] Chord wait mode
- [x] Metronome, count-in, configurable look-ahead, input latency offset
- [x] Audio: sampled Salamander Grand, bundled and cached for offline use,
      with the synthesised piano as the instant-start default and fallback.

### Phase 4: Polish and features
- [x] Sheet music rendering (OpenSheetMusicDisplay, server-side MusicXML)
- [x] Note labels
- [x] MIDI output playback through the keyboard's own sounds
- [x] Custom colours and themes
- [x] Fingering numbers and solfège labels
- [ ] Recording mode with playback comparison
- [ ] Mobile touch improvements (pinch zoom, swipe navigation)

### Phase 5: Community
- [x] Profile contribution guide with a validation CLI
- [x] CI validating profile JSON on PR
- [ ] MIDI file library (links to freely available sources, not hosted files)
- [ ] Documentation site
- [ ] More profiles: Juno-DS, Yamaha PSR, Korg Minilogue, Nord Stage

### Not done yet — the honest list
- Recording and playback comparison
- Mobile touch improvements (pinch zoom, swipe navigation)
- A documentation site
- Any profile beyond Juno-G and Generic GM. The Juno-G's SysEx value tables
  (MFX / chorus / reverb type numbering) are also still unfilled — the editor
  reads them from the profile, but guessing those numbers would send wrong
  bytes to real hardware, so they need to come from the MIDI implementation.

## Architecture Decisions

### Why vanilla JS + Canvas, not React/WebGL

Canvas 2D is more than fast enough for this rendering workload (hundreds of rectangles per frame). WebGL would add complexity without benefit until we're rendering thousands of particles or 3D effects. React adds overhead for what is fundamentally a real-time render loop — DOM diffing is the wrong paradigm here. The UI chrome (controls, file picker, settings) is minimal enough that vanilla DOM manipulation is cleaner than introducing a framework.

The controller UI is DOM-based (not canvas) since it's standard list/slider UI. No framework needed — the interactivity is simple enough that vanilla event listeners are clearer than component abstractions.

### Why a custom MIDI parser, not a library

The MIDI file format is well-specified and the parser is ~150 lines. External dependencies for this are heavier than the problem warrants (`@tonejs/midi` pulls in Tone.js concepts we don't need, `midi-parser-js` is unmaintained). Owning the parser also means we can extend it (e.g., extract track names, lyrics, key signatures) without waiting on upstream.

### Why WebMIDI, not a native app

The primary use case is running this on an Android phone propped up on a piano or keyboard's music stand. WebMIDI in Chrome on Android works with USB MIDI keyboards. A native app would require app store distribution and platform-specific MIDI APIs. The web version works everywhere Chrome runs, can be installed as a PWA, and shares a single codebase.

### Why JSON profiles, not code plugins

Keyboard profiles are data, not logic. A JSON file can describe banks, patch names, CC numbers, and SysEx addresses without any executable code. This means:
- Adding a new keyboard requires zero JavaScript knowledge — just fill in a JSON template
- Profiles can be validated against a schema at load time
- No security concerns from loading third-party code
- Profiles can be stored, shared, and versioned independently

The only exception is SysEx checksum calculation, which varies by manufacturer. The controller module has built-in checksum implementations for common formats (Roland, Yamaha, Korg). The profile specifies which format to use via a `parameterFormat` field (e.g., `"roland-dt1"`).

## Key Technical Details

### MIDI note range
Piano range: MIDI 21 (A0) through MIDI 108 (C8). The renderer dynamically computes white and black key positions based on canvas width. Key layout is computed in `computeKeyLayout()` and cached as `whiteKeyPositions[]`, `blackKeyPositions[]`, and `allKeyPositions[]` (indexed by MIDI note number).

### Timing model
The playback clock uses `performance.now()` with delta-time accumulation, multiplied by a speed factor. MIDI file ticks are converted to seconds via a tempo map built during parsing. The tempo map is an array of `{ tick, tempo (microseconds per beat), time (seconds) }` entries. `tickToTime(tick)` walks the map to convert any tick position to absolute seconds.

### Hand assignment heuristic
- Track names are checked first: a track called "Right Hand", "R.H.", "Treble" or "Melody" goes to the right hand; "Left Hand", "L.H.", "Bass" or "Accomp" to the left.
- Otherwise tracks are ranked by average pitch — the highest-average track becomes the right hand, the rest the left. With exactly two tracks this reduces to the familiar "melody on top, accompaniment below".
- Single-track MIDI: notes at or above MIDI 60 (middle C) are right hand, below are left.
- Still a heuristic. Manual track-to-hand mapping in the UI would be the next improvement.

### Wait mode implementation
When enabled, the playback loop looks for a scored note whose start time falls within ±50ms of the playhead, collects every note starting within 30ms of it into a chord, and stops advancing `currentTime` until all of them have been played. Notes belonging to a hand in APP or OFF mode are excluded, so the app can play one hand while you're only held to the other. Wait-mode hits are credited as perfect and flag the run as assisted, since a stalled playhead makes timing meaningless.

### Controller MIDI output
Patch selection sends three messages in sequence on the selected MIDI channel:
1. CC 0 (Bank Select MSB) — value from profile's bank definition
2. CC 32 (Bank Select LSB) — value from profile's bank definition
3. Program Change — patch index (0–127)

Effect sliders send a single CC message per value change. The CC number comes from the profile's effect definition. Values are clamped to the profile's min/max range.

SysEx messages are constructed from the profile's address map using the manufacturer-specific format. For Roland DT1 (Data Set 1), the format is: `F0 41 {deviceId} {modelId...} 12 {address...} {data...} {checksum} F7`. The checksum is calculated as `(128 - (sum of address + data bytes) % 128) % 128`.

### Auto-detection protocol
The Universal SysEx Identity Request (`F0 7E 7F 06 01 F7`) is defined in the MIDI spec and supported by virtually all keyboards made after 1990. The reply contains manufacturer ID (1 or 3 bytes), family code (2 bytes), model number (2 bytes), and firmware version (4 bytes). The controller matches these against the `identityResponse` fields in loaded profiles. If multiple profiles match (unlikely), the most specific match wins.

## Existing Open Source Landscape

### Piano trainers

| Project | Language | Platform | Status | Notes |
|---------|----------|----------|--------|-------|
| Neothesia | Rust/wgpu | Desktop (Lin/Win/Mac) | Active | Best desktop option. GPU-accelerated. No web/mobile support. |
| Linthesia | C++ | Desktop (Linux) | Stale | Fork of original open-source Synthesia. GTK2 era. |
| Piano From Above | C++ | Windows | Maintained | Windows-only. Popular but not cross-platform. |
| Midiano | JavaScript | Web | Closed source | Was great, developer moved to private repo. Code snapshot available but not open source. |
| Sightread | TypeScript | Web | Closed source | Went private March 2026. Snapshot remains under open license but no contributions accepted. |
| PianoBooster | C++ | Desktop | Maintained | Scrolling staff view, not falling notes. Good but different UX paradigm. |

### MIDI keyboard controllers

No significant open-source web-based keyboard controller exists. Native apps like MIDI Designer (iOS) and TouchDAW (Android) are closed-source and paid. Generic web MIDI tools (WebMIDI.js demos, MIDI Monitor) exist but none provide instrument-specific profile-driven control.

KeyFall's niche: **web-based, open-source, mobile-friendly, falling notes + hardware keyboard control with extensible instrument profiles**. Nothing else combines these.

## Development Environment

- Node.js (for Vite dev server and build)
- A MIDI keyboard + USB cable for testing WebMIDI (optional — on-screen piano and demo songs work without one)
- Chrome or Edge (WebMIDI is not supported in Firefox or Safari)
- For SysEx testing, Chrome must be granted SysEx permission via `navigator.requestMIDIAccess({ sysex: true })`

## License

MIT. Keep it simple, keep it permissive.
