# Getting started

## Run it

```bash
npm install
npm run dev:all
```

Open the printed URL in **Chrome or Edge**. SysEx permission is requested on
first use — accept it, or auto-detection and the SysEx editor won't work.

`dev:all` runs two processes: the Vite dev server, and the backend that stores
your song library and relays the iPad mirror. Vite proxies `/api` and
`/mirror/ws` to it, and songs land in `./.data`.

`npm run dev` starts only the front end. The trainer, the controller and the
built-in demos all work, but the **Songs** tab and the sheet-music view need
the backend — run `npm run dev:server` alongside it, or just use `dev:all`.

## Load something to play

Any of these work:

- Pick one of the four built-in demos on the start screen
- Drag a `.mid` file onto the window
- **OPEN** to browse for one
- Upload to the **Songs** tab, which keeps a library server-side

Format 0 and format 1 MIDI files are supported. Hands are assigned from track
names where the file has them ("Right Hand", "L.H.", "Bass"), and otherwise by
average pitch — the highest-average track becomes the right hand.

## Connect a keyboard

Plug in a USB MIDI keyboard and it should be picked up automatically; the
header shows which device is connected. **Settings → MIDI** lists every input
and output if you need to choose explicitly, or if the wrong one was picked.

The primary use case this was built for is a phone or tablet on a music stand,
running Chrome on Android with a USB MIDI keyboard.

## Install it as an app

KeyFall is a PWA: fonts and code are served from the same origin and cached,
so once installed it works offline. The sampled piano is a separate one-time
download (see [Practising](practice.md)) and is cached separately, so
upgrading the app doesn't discard it.
