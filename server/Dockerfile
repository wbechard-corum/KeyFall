# syntax=docker/dockerfile:1

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

# Tiny wrapper so Node can shell out to a stable command name.
RUN printf '#!/usr/bin/env python3\nimport sys\nfrom music21 import converter\nif len(sys.argv) != 3:\n    sys.exit("usage: midi2xml input.mid output.musicxml")\nscore = converter.parse(sys.argv[1])\nscore.write("musicxml", fp=sys.argv[2])\n' > /usr/local/bin/midi2xml \
  && chmod +x /usr/local/bin/midi2xml

WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev
COPY mirror-server.js ./
EXPOSE 8081
HEALTHCHECK --interval=30s --timeout=5s \
  CMD wget -qO- http://127.0.0.1:8081/healthz > /dev/null || exit 1
CMD ["node", "mirror-server.js"]
