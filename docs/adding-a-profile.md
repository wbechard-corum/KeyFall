# Adding a keyboard profile

A profile is a single JSON file that describes a keyboard's banks, effects, controls, and (optionally) SysEx addresses. Profiles are pure data — no JavaScript required.

## Steps

1. Copy `src/profiles/roland-juno-g.json` as a starting template.
2. Fill in the fields below.
3. Register the profile in `src/profiles/index.js`:

   ```js
   import yourProfile from './your-keyboard.json';
   const REGISTRY = [junoG, yourProfile, genericGM];
   ```

## Required fields

| Field | Description |
|-------|-------------|
| `id` | Unique slug, e.g. `"roland-juno-g"`. |
| `manufacturer` | Human-readable name. |
| `model` | Model name. |
| `banks` | List of `{ id, label, msb, lsb, patches }`. |

## Optional fields

| Field | Description |
|-------|-------------|
| `identityResponse` | Manufacturer ID + family + model bytes from the SysEx Identity Reply. Used for auto-detection. |
| `effects` | CC-based sliders: `{ id, label, cc, min, max, default }`. |
| `controls` | On/off toggles: `{ id, label, cc, onValue, offValue }`. |
| `sysex` | Manufacturer SysEx definitions (Roland DT1, etc). Used by the SysEx editor. |
| `notes` | Free text — firmware caveats, source of bank data, etc. |

## Bank patches

If patch names aren't known, leave the array empty. The loader fills in `Bank Patch 001`..`Bank Patch 128` placeholders so the controller still works.

## Auto-detection

Populate `identityResponse` with the bytes returned by a connected keyboard. Use the controller's **SEND IDENTITY REQUEST** button in the settings tab — the reply is displayed and can be pasted directly into the profile.
