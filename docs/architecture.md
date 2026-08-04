# Architecture

## Layout

```
src/
  main.js            Entry point, mode switching, boot
  midi/              Shared WebMIDI layer
    connection.js    Device discovery and the access lifecycle
    input.js         Note on/off, CC, SysEx in
    output.js        PC, CC, SysEx out
    sysex.js         Roland DT1 builders, identity parsing, nibble encoding
    parser.js        MIDI file parser
  trainer/
    playback.js      Clock, wait mode, hand modes, section repeat
    scoring.js       Hit/miss judging, accuracy, combo
    renderer.js      Canvas: piano, falling notes, take overlay
    audio.js         Instrument facade over synth and sampler
    synth.js         Synthesised piano voice
    sampler.js       Sampled piano playback
    metronome.js     Click track and count-in from the tempo map
    fingering.js     Automatic fingering assignment
    recorder.js      Take capture and replay
    sheet.js         OpenSheetMusicDisplay wrapper
  controller/
    controller.js    Patch selection, CC, SysEx sending
    profile-loader.js  Load, validate, normalise profiles
    sysex-ui.js      SysEx parameter editor
    builder-ui.js    Profile capture screen
  shared/            Constants, piano layout, settings, mirror, gestures
  profiles/          Keyboard profile JSON, registry, validation
server/              Songs API, mirror relay, MIDI→MusicXML
```

### Boundaries that matter

- **`src/midi/`** owns the WebMIDI lifecycle. Only one module calls
  `navigator.requestMIDIAccess()`.
- **`src/trainer/`** only reads MIDI input, except for the optional MIDI-out
  playback through the keyboard's own sounds.
- **`src/controller/`** only sends, except for SysEx replies.
- **`src/profiles/`** is pure data. Profile JSON contains no executable code.

## Decisions

### Vanilla JS and Canvas, not React or WebGL

Canvas 2D handles hundreds of rectangles a frame comfortably. WebGL would add
complexity without benefit until there are thousands. React's DOM diffing is
the wrong paradigm for a real-time render loop, and the UI chrome is small
enough that plain DOM is clearer than components.

### A custom MIDI parser

The format is well specified and the parser is a few hundred lines. External
options were heavier than the problem: `@tonejs/midi` brings Tone.js concepts
that aren't needed, `midi-parser-js` is unmaintained. Owning it means the
parser can be extended — track names, key signatures — without waiting
upstream.

### WebMIDI over a native app

The target is a phone or tablet on a music stand. Chrome on Android speaks
WebMIDI to USB keyboards. A native app means app-store distribution and
platform-specific MIDI APIs; the web version runs everywhere Chrome does,
installs as a PWA, and is one codebase.

### JSON profiles, not code plugins

Keyboard support is data, not logic. A JSON file describes banks, patch names,
CC numbers and SysEx addresses without executable code, which means adding a
keyboard needs no JavaScript, profiles can be validated against a schema, and
there's no security question about loading third-party code.

The exception is SysEx checksums, which vary by manufacturer. Those live in
code and profiles select one with `parameterFormat`.

### Synthesis and samples side by side

The sampled grand sounds far better; the synth needs no download and works the
moment the page loads. Both implement the same instrument interface, and every
call falls back to the synth when a sample isn't available — so switching mid
phrase, or playing during the download, never produces silence.

## Timing model

The playback clock uses `performance.now()` with delta accumulation, clamped
per frame so a backgrounded tab can't teleport the playhead. MIDI ticks become
seconds through a tempo map built during parsing.

Notes are emitted through a cursor rather than a time window: the loop walks
forward over everything the playhead has passed. A fixed window drops notes
whenever a frame runs long, which is exactly when you least want it.

Rendering uses binary search plus a per-song longest-note duration to find the
first note that could still be on screen, so cost scales with what's visible
rather than with the length of the piece.
