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

# Copy the conversion script in so its content is verifiable from
# the build context rather than embedded in a printf heredoc.
COPY midi2xml /usr/local/bin/midi2xml
RUN chmod +x /usr/local/bin/midi2xml

WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev
COPY mirror-server.js ./
EXPOSE 8081
HEALTHCHECK --interval=30s --timeout=5s \
  CMD wget -qO- http://127.0.0.1:8081/healthz > /dev/null || exit 1
CMD ["node", "mirror-server.js"]
