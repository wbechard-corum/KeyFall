# Practising

## Scoring

Every press is judged against the nearest unjudged note of that pitch within
250 ms, and rated by how far off it was:

| Rating | Window |
|--------|--------|
| Perfect | within 50 ms |
| Good | within 120 ms |
| Early / Late | within 250 ms |
| Miss | the note's window closed unplayed |

The transport bar shows a running accuracy, the hit count, and your current
streak. At the end of a run you get a breakdown by rating, your best streak
and your average timing error.

Presses that match no expected note are counted separately as extras — a wrong
note doesn't also fail the note you were supposed to play.

## Hand modes

Each hand cycles through four modes from its **R** / **L** button. One
"muted" switch used to conflate three separate questions — should it be drawn,
should it sound, should it be graded — which made the most useful practice
setup impossible to express.

| Mode | Visible | Audible | Scored | Use |
|------|---------|---------|--------|-----|
| **BOTH** | yes | yes | yes | Default: you play it, the app plays along |
| **YOU** | yes | no | yes | You play it; the app stays out of the way |
| **APP** | yes | yes | no | The app plays it for you — hand isolation |
| **OFF** | no | no | no | Hidden entirely |

A hand set to **APP** doesn't block wait mode and isn't counted against your
accuracy, so you can drill the right hand while the left plays itself.

## Wait mode

**WAIT** holds the playhead until every note of the current chord has been
played. It only waits on hands that are being scored. Because the playhead
stalls, timing there is meaningless — those hits are credited as perfect and
the run is flagged as assisted, which the summary says rather than reporting a
hollow 100%.

## Section repeat

**A** and **B** drop loop points at the playhead; the progress bar shades the
section between them. Setting both arms the loop automatically, and the points
sort themselves so it doesn't matter which end you mark first.

Each pass re-arms the notes inside the section, so a repeat is scored fresh
instead of inheriting the previous pass's misses. **STOP** parks at the loop
start rather than the top of the piece.

## Metronome and count-in

**MET** is a click track driven by the song's own tempo map, so it stays
locked to the score through tempo changes. Downbeats are accented; beats per
bar and an optional one- or two-bar count-in are in **Settings → Practice**.

## Recording

**REC** captures what you played — from the on-screen piano or the hardware —
and stores it in song time, so a take recorded at 0.5× lines up with the score
at 1×. **TAKE** draws it beside the score, and **HEAR** replays your take
instead of the song. The last take per song is kept between sessions.

## Labels and fingering

Falling notes can carry note names or solfège (fixed do, where C is always Do,
or movable do, where Do is the tonic — which needs a key signature in the MIDI
file and falls back to C).

Automatic fingering numbers can be shown in the corner of each note. The
assigner produces the standard fingerings for scales:

```
RH C major ascending    1 2 3 1 2 3 4 5
RH C major descending   5 4 3 2 1 3 2 1
LH C major ascending    5 4 3 2 1 3 2 1
```

It is a heuristic, not an edition — real fingering depends on phrasing and
hand size, and busy music will get awkward suggestions. Treat it as a starting
point.

## Piano sound

The default synthesised piano starts instantly and costs nothing. Switching to
the **sampled grand** in **Settings → Piano sound** downloads 6.6 MB of
Salamander Grand Piano V3 recordings — all 88 keys every three semitones
across four velocity layers — and caches them for offline use. The synth
covers every note until the download finishes, so nothing goes silent.

## On a phone or tablet

- **Pinch** the keyboard to zoom to the range you're playing; **drag** in the
  note area to pan. The piano itself stays reserved for playing.
- **Swipe** the top nav to move between tabs.
- **Drag** the progress bar to scrub.

## Latency

If you're consistently marked late while playing in time, raise **Settings →
Practice → Input offset**. USB MIDI, Bluetooth and audio output all add delay;
the offset is subtracted before judging.
