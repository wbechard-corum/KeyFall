# Controller

The controller drives a connected keyboard: choosing patches, moving effect
faders, toggling controls, and editing parameters that have no CC. What it
knows about any given instrument comes entirely from a
[profile](adding-a-profile.md) — a JSON file, no code.

## Patches

The bank bar lists the banks the profile declares; tapping a patch sends three
messages on the selected MIDI channel:

1. CC 0 — Bank Select MSB
2. CC 32 — Bank Select LSB
3. Program Change

The LCD-style panel shows the current bank, slot number and patch name, plus
the last message sent, which is usually enough to tell whether the keyboard
disagrees with the profile.

## Effects and controls

**EFFECTS** renders a vertical fader per CC the profile defines, with its own
range and default. **CONTROLS** renders on/off buttons for switch-like CCs —
sustain, portamento, sostenuto.

Values are clamped to the range the profile declares, so a profile can't drive
a parameter somewhere the instrument doesn't expect.

## SysEx

Some parameters have no CC at all — Roland's MFX, chorus and reverb blocks are
reached only through System Exclusive. **SYSEX** renders one row per entry in
the profile's `sysex.commands` map.

A command with a `values` list becomes a named dropdown; otherwise you get a
slider and a numeric field over whatever range the parameter's size allows.
Each row shows the exact bytes it will transmit, which is the quickest way to
check a parameter against a MIDI implementation chart — when something doesn't
do what the manual claims, the first question is what actually went on the
wire.

Dragging a slider previews continuously but only transmits on release, so a
drag doesn't flood the MIDI port.

### Roland value encoding

Roland splits multi-byte parameter values into 4-bit nibbles, most significant
first, because no SysEx data byte may reach `0x80`:

| `size` | Encoding | Range | `0x1234` becomes |
|--------|----------|-------|------------------|
| 1 | plain 7-bit byte | 0–127 | — |
| 2 | two nibbles | 0–255 | — |
| 4 | four nibbles | 0–65535 | `01 02 03 04` |

## Auto-detection

On connection the app sends a Universal Identity Request (`F0 7E 7F 06 01
F7`). The reply carries a manufacturer id, family code and model number, which
are matched against the `identityResponse` of every loaded profile. A match
selects that profile; no match falls back to Generic GM.

**Settings → Diagnostics** sends the request by hand and shows the decoded
reply, which is also how you find the values to put in a new profile.

## Capturing a profile

**PATCHES → CAPTURE** builds a profile from the keyboard in front of you —
see [Adding a keyboard profile](adding-a-profile.md).
