# KeyFall

An open-source piano trainer and universal MIDI keyboard controller, in the
browser. Two tools sharing one WebMIDI layer: connect the keyboard once, then
switch between learning a piece and tweaking its sound.

## What it does

**Trainer** — Falling notes with real feedback. Every press is judged against
the score and rated; unplayed notes are swept as misses; you get a running
accuracy, a streak, and a summary at the end of the run. Each hand can be
practised on its own, sections can be looped, and a sampled grand piano makes
it sound like an instrument rather than an exercise.

**Controller** — Browse patches, move effect faders, and edit SysEx
parameters from a phone or tablet. Which keyboard it speaks to is a JSON
profile, so adding hardware needs no code.

**Mirror** — Pair a second device with a six-digit code and drive everything
from an iPad on the music stand.

## Why it exists

The good web-based falling-notes trainers went closed-source. Nothing
open-source combines a browser-based trainer with hardware-specific keyboard
control, and no open web tool talks to a *particular* instrument rather than
generic General MIDI.

## Where to go next

- [Getting started](getting-started.md) — run it, load a song, connect a keyboard
- [Practising](practice.md) — scoring, hand modes, loops, the metronome
- [Controller](controller.md) — patches, effects, SysEx
- [Adding a keyboard profile](adding-a-profile.md) — including capturing one from your own keyboard
- [Architecture](architecture.md) — how it's built, and why
- [Development](development.md) — dev setup, tests, contributing

## Requirements

Web MIDI works in **Chrome and Edge**. Firefox and Safari don't implement it,
so the MIDI features are unavailable there — the on-screen piano and the demo
songs still work. Web MIDI also needs a [secure
context](https://developer.mozilla.org/en-US/docs/Web/Security/Secure_Contexts):
HTTPS, or `localhost`.
