# KeyFall — Open Source Piano Trainer & Keyboard Controller

## Project Vision

KeyFall is two tools in one, unified by a shared WebMIDI layer:

1. **Trainer** — A falling-notes piano learning tool inspired by Synthesia. Load MIDI files, watch notes fall toward a virtual keyboard, play along with real-time feedback from a connected MIDI keyboard.

2. **Controller** — A universal MIDI keyboard controller. Select patches, adjust effects, and manage your instrument from a phone or tablet screen — replacing broken displays or just providing a better interface. Extensible via keyboard profile definitions that describe any instrument's bank structure, CC mappings, and SysEx commands.

Both modes share a single WebMIDI connection layer. Connect your keyboard once, switch between learning a song and tweaking your sound.

The goal is to fill the gap left by web-based projects that went closed-source (Midiano, Sightread), and to provide something no existing tool does: a browser-based controller that works with specific hardware instruments, not just generic GM.

## Current State (v0.1 POC)

Two self-contained HTML prototypes that demonstrate both halves of the project:

- `keyfall-piano.html` — Falling notes trainer
- `juno-g-midi.html` — Keyboard controller (Roland Juno-G profile)

These need to be merged into a single app with a shared MIDI layer and a mode switcher.

### Trainer — What works today

- **MIDI file parser**: Built from scratch, no dependencies. Parses header, tracks, tempo map, note on/off events. Handles format 0 and format 1 MIDI files. Converts delta ticks to absolute time using tempo map.
- **Canvas renderer**: 88-key piano keyboard at bottom, falling note bars above. Notes colored by hand (right = blue `#4FC3F7`, left = orange `#FF8A65`). Active notes glow. Hit line separates note area from keyboard.
- **Auto hand splitting**: Multi-track files map first two tracks to right/left. Single-track files split at middle C (MIDI 60).
- **Playback engine**: `requestAnimationFrame` loop with delta-time accumulation. Speed multiplier (0.25x–1.5x). Play/pause/stop/seek.
- **Wait mode**: Pauses playback until the correct note is played (via MIDI keyboard or on-screen tap).
- **WebMIDI input**: Auto-detects connected MIDI keyboards. Captures note on/off. Highlights pressed keys on the virtual piano.
- **WebAudio output**: Oscillator-based sound (triangle + detuned sine). Functional but not realistic.
- **Touch piano**: Tap on-screen keys to play notes and trigger wait mode.
- **4 built-in demos**: Twinkle Twinkle, Ode to Joy, C Major Scale, Minuet in G — hardcoded note arrays for testing without needing a MIDI file.
- **Drag & drop**: Drop `.mid` files onto the canvas to load them.

### Controller — What works today

- **WebMIDI output**: Sends Bank Select (CC 0 + CC 32) and Program Change messages to switch patches on a connected keyboard.
- **Effect sliders**: Draggable vertical sliders that send CC messages in real-time. Current CCs: Reverb Send (91), Chorus Send (93), Cutoff (74), Resonance (71), Volume (7).
- **MIDI channel selector**: Send on any of 16 MIDI channels.
- **Device picker**: Lists all connected MIDI output devices. Auto-selects Roland devices.
- **SysEx Identity Request**: Sends the standard `F0 7E 7F 06 01 F7` identity request and parses the response to display manufacturer, model, and firmware version. Useful for diagnostics (e.g., checking firmware version on a keyboard with a broken display).
- **Roland Juno-G profile**: Bank definitions (PR-A through PR-H, USER, GM) with MSB/LSB values. Patch names for PR-A and PR-B; placeholder names for remaining banks.
- **LCD-style current patch display**: Shows selected bank, patch number, and patch name.
- **Mobile-optimized UI**: Designed for phone screens, touch-friendly controls.

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
│   ├── main.js              # Entry point, mode switching, app init
│   ├── midi/
│   │   ├── connection.js     # WebMIDI device discovery, connect/disconnect
│   │   ├── input.js          # MIDI input handling (note on/off, CC)
│   │   ├── output.js         # MIDI output (PC, CC, SysEx)
│   │   ├── sysex.js          # SysEx builders: Roland DT1, Yamaha, etc.
│   │   └── parser.js         # MIDI file parser (.mid → note objects)
│   ├── trainer/
│   │   ├── renderer.js       # Canvas rendering (piano, falling notes, grid)
│   │   ├── playback.js       # Timing, speed, wait mode, scoring
│   │   ├── audio.js          # WebAudio / SoundFont playback
│   │   └── ui.js             # Trainer controls (play, stop, speed, tracks)
│   ├── controller/
│   │   ├── controller.js     # Patch selection, CC sending, SysEx
│   │   ├── profile-loader.js # Load and validate keyboard profiles
│   │   ├── effects-ui.js     # Slider rendering and touch handling
│   │   └── ui.js             # Controller layout, bank/patch list, LCD
│   ├── shared/
│   │   ├── constants.js      # Colors, note names, key geometry
│   │   ├── piano-keyboard.js # Shared piano key layout computation
│   │   └── settings.js       # User preferences (channel, theme, etc.)
│   └── profiles/
│       ├── roland-juno-g.json
│       ├── generic-gm.json
│       └── index.js          # Profile registry and loader
├── assets/
│   └── sounds/               # SoundFont or sample files
├── demos/                    # Built-in demo MIDI files
├── docs/
│   ├── adding-a-profile.md   # Guide for contributing keyboard profiles
│   └── profile-schema.md     # Profile JSON schema reference
├── styles/
│   └── main.css
├── CLAUDE.md
├── README.md
├── LICENSE                   # MIT
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

### Phase 1: Project scaffolding
- Split both HTML prototypes into the module structure above
- Set up Vite with ES modules
- Implement shared WebMIDI connection layer with SysEx support
- Mode switcher UI (trainer / controller tabs or a top-level nav)
- Basic PWA manifest and service worker

### Phase 2: Controller hardening
- Formalize the profile JSON schema (JSON Schema or TypeScript types)
- Build the profile loader with validation and error reporting
- Implement auto-detection via Identity Request/Reply matching
- Create the Generic GM profile as the fallback (128 standard GM patch names, standard drum map)
- Complete Juno-G profile: fill in patch names for PR-C through PR-H and USER banks
- Add sustain toggle (CC 64) and other common toggle controls from profiles
- SysEx parameter editor for Roland DT1 format (needed for MFX/delay control on Juno-G)
- Profile contribution guide (`docs/adding-a-profile.md`)

### Phase 3: Trainer improvements
- Replace oscillator audio with SoundFont-based playback (WebAudioFont or Tone.js Sampler with Salamander Grand Piano samples)
- Accuracy scoring: per-note hit/miss coloring, running accuracy %, end-of-song summary
- Loop mode: select a section on the progress bar, repeat until mastered
- Hand isolation: muted hand plays audio but isn't scored
- Chord wait mode: wait for all notes in a chord, not just one

### Phase 4: Polish and features
- Sheet music rendering alongside falling notes (VexFlow or OpenSheetMusicDisplay)
- Note labels (note names, fingering numbers, solfège)
- MIDI output playback (play the song on the keyboard's own sounds via the controller's output)
- Recording mode with playback comparison
- Mobile touch improvements (pinch zoom, swipe navigation)
- Custom themes and color preferences

### Phase 5: Community
- Profile contribution guide with template and validation CLI tool
- MIDI file library (links to freely available MIDI sources, not hosted files)
- Documentation site
- CI to validate profile JSON against schema on PR

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
- Multi-track MIDI: first two non-empty tracks map to track 0 (right) and track 1 (left)
- Single-track MIDI: notes at or above MIDI 60 (middle C) are right hand, below are left hand
- This heuristic is wrong for many pieces. A future improvement would be to use a smarter algorithm (e.g., voice separation by pitch contour continuity) or allow manual track-to-hand mapping in the UI.

### Wait mode implementation
When enabled, the playback loop checks if any note's start time falls within ±50ms of the current playback position. If so, it sets `waitingForNote` and stops advancing `currentTime`. When the matching MIDI note number is received (from WebMIDI input or on-screen tap), `waitingForNote` is cleared and playback resumes. Current limitation: only waits for one note at a time. Chords need all notes to be checked simultaneously.

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
