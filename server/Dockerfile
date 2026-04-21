# syntax=docker/dockerfile:1

FROM node:20-alpine
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev
COPY mirror-server.js ./
EXPOSE 8081
HEALTHCHECK --interval=30s --timeout=3s \
  CMD wget -qO- http://127.0.0.1:8081/healthz > /dev/null || exit 1
CMD ["node", "mirror-server.js"]
