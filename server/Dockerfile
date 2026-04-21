# syntax=docker/dockerfile:1

FROM node:20-alpine
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install --omit=dev && npm cache clean --force
COPY index.js ./
ENV NODE_ENV=production
ENV PORT=3030
EXPOSE 3030
HEALTHCHECK --interval=30s --timeout=3s \
  CMD wget -qO- http://127.0.0.1:3030/healthz > /dev/null || exit 1
CMD ["node", "index.js"]
