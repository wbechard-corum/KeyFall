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

## Validating your profile

```bash
npm run validate:profiles                    # every profile in src/profiles/
npm run validate:profiles -- my-keyboard.json
```

The validator is also run by CI on every pull request, and the app checks all
registered profiles at startup — a profile with errors is reported in the
browser console instead of failing later when someone selects it.

It reports two kinds of finding:

- **error** — the profile will not load. Fix these.
- **warn** — the profile works, but something is probably not what you meant
  (a bank with no `msb`, or an `identityResponse` with no `manufacturerId`,
  which can never auto-detect).

### Patch addressing

The check most worth understanding: every patch must resolve to a **distinct**
Bank Select MSB + LSB + Program Change. A patch's address comes from its bank
unless the patch overrides it.

Program Change only addresses 0–127. A bank may still list more than 128
patches as a single browsable group — the Juno-G's USER bank has 256 — but the
entries past the first 128 must carry an explicit `lsb` and `pc`:

```jsonc
{
  "id": "USER", "msb": 87, "lsb": 0,
  "patches": [
    "Juno-G Grand",                              // -> MSB 87, LSB 0, PC 0
    "Autotrance",                                // -> MSB 87, LSB 0, PC 1
    // ...126 more...
    { "name": "FX World",  "lsb": 1, "pc": 0 },  // -> MSB 87, LSB 1, PC 0
    { "name": "Tape Memory", "lsb": 1, "pc": 72 }
  ]
}
```

Without those overrides the 129th patch would resolve to Program Change 128,
which doesn't exist — the validator rejects it rather than letting the app
silently re-send patch 1. It also rejects two patches that resolve to the same
address, since one of them could be selected but never actually reached.
