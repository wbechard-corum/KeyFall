# syntax=docker/dockerfile:1

FROM node:20-bookworm-slim

# MuseScore + Xvfb so we can run mscore headlessly to convert MIDI
# files into MusicXML server-side. The Qt app insists on an X
# display being available even when -o is the only operation.
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
       musescore3 \
       xvfb \
       libgl1 \
       libfontconfig1 \
       libxrender1 \
       libxext6 \
       libxkbcommon0 \
       libdbus-1-3 \
       wget \
  && rm -rf /var/lib/apt/lists/*

# Wrap whichever mscore binary the distribution ships under
# xvfb-run so we can call it from Node without worrying about
# DISPLAY or the Qt platform plugin.
RUN printf '#!/bin/sh\nMSC=$(command -v mscore3 || command -v mscore || command -v musescore3 || command -v musescore)\nif [ -z "$MSC" ]; then\n  echo "No MuseScore binary found" >&2\n  exit 127\nfi\nexec xvfb-run -a -s "-screen 0 800x600x24" "$MSC" "$@"\n' > /usr/local/bin/mscore-headless \
  && chmod +x /usr/local/bin/mscore-headless

WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev
COPY mirror-server.js ./
EXPOSE 8081
HEALTHCHECK --interval=30s --timeout=5s \
  CMD wget -qO- http://127.0.0.1:8081/healthz > /dev/null || exit 1
CMD ["node", "mirror-server.js"]
