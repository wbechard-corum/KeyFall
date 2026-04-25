# syntax=docker/dockerfile:1.4

FROM node:20-bookworm-slim

# music21 (Python) handles MIDI -> MusicXML server-side. No Qt, no
# Xvfb, no display — just a Python module call.
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
       python3 \
       python3-pip \
       wget \
  && pip3 install --break-system-packages --no-cache-dir 'music21>=9.1' \
  && rm -rf /var/lib/apt/lists/*

# Inline the conversion script via a BuildKit heredoc so the file
# content is part of the Dockerfile itself — no separate file to
# COPY, no risk of an out-of-tree build context missing it.
COPY <<'PYEOF' /usr/local/bin/midi2xml
#!/usr/bin/env python3
"""Convert a single MIDI file to MusicXML using music21.

Usage: midi2xml INPUT.mid OUTPUT.musicxml

Exits 0 on success. On failure, prints
    midi2xml ERROR <ExceptionType>: <message>
to stderr and exits 1, so the caller can surface a useful message
without parsing a Python traceback.
"""
import sys
import traceback

if len(sys.argv) != 3:
    sys.exit("usage: midi2xml INPUT.mid OUTPUT.musicxml")

src, dst = sys.argv[1], sys.argv[2]

try:
    from music21 import converter
    score = converter.parse(src)
    if not score.parts:
        raise RuntimeError("MIDI has no parts after parsing")
    score.write("musicxml", fp=dst)
except SystemExit:
    raise
except BaseException as e:
    print(f"midi2xml ERROR {type(e).__name__}: {e}", file=sys.stderr)
    traceback.print_exc(file=sys.stderr)
    sys.exit(1)
PYEOF
RUN chmod +x /usr/local/bin/midi2xml

WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev
COPY mirror-server.js ./
EXPOSE 8081
HEALTHCHECK --interval=30s --timeout=5s \
  CMD wget -qO- http://127.0.0.1:8081/healthz > /dev/null || exit 1
CMD ["node", "mirror-server.js"]
