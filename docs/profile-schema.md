# Profile schema

```jsonc
{
  "id": "string",              // required, unique slug
  "manufacturer": "string",    // required
  "model": "string",           // required
  "identityResponse": {        // optional, for auto-detect
    "manufacturerId": 0x41 | "0x41",
    "familyCode":     [0x0f, 0x02] | "0x0f02",
    "modelNumber":    [0x00, 0x00] | "0x0000"
  },
  "banks": [                   // required
    {
      "id": "PR-A",
      "label": "PR-A",
      "msb": 87,
      "lsb": 0,
      "patches": ["Patch 1", "Patch 2", "..."]  // may be []
    }
  ],
  "effects": [                 // optional — CC sliders
    { "id": "reverb", "label": "Reverb", "type": "cc", "cc": 91, "min": 0, "max": 127, "default": 40 }
  ],
  "controls": [                // optional — CC toggles
    { "id": "sustain", "label": "Sustain", "type": "cc-toggle", "cc": 64, "onValue": 127, "offValue": 0 }
  ],
  "sysex": {                   // optional — manufacturer-specific commands
    "identityRequest": [240, 126, 127, 6, 1, 247],
    "parameterFormat": "roland-dt1",
    "deviceId": 16,
    "modelId": [0, 0, 0, 21],
    "commands": {
      "mfxType": { "address": [16, 0, 4, 0], "size": 2, "description": "..." }
    }
  },
  "notes": "string"            // optional, free text
}
```

## Notes

- Bank MSB/LSB values must match the keyboard's MIDI Implementation Chart.
- Patch arrays can be empty; placeholders are generated automatically.
- `parameterFormat` currently supports `"roland-dt1"`. Other manufacturers will be added as profiles require them.
