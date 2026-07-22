# Prague AI Voice deploy image
# Render-safe Dockerfile: installs dev deps during build, then production deps at runtime.
FROM node:20-bookworm-slim AS builder

WORKDIR /app

COPY package.json .npmrc ./
RUN npm install --include=dev --no-audit --no-fund

COPY . .
RUN test -x ./node_modules/.bin/tsc
RUN ./node_modules/.bin/tsc -p tsconfig.json

FROM node:20-bookworm-slim AS runner

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 python3-pip ca-certificates \
  && rm -rf /var/lib/apt/lists/* \
  && python3 -m pip install --break-system-packages --no-cache-dir edge-tts

ENV NODE_ENV=production
ENV PORT=3000
ENV EDGE_TTS_PYTHON=/usr/bin/python3

COPY package.json .npmrc ./
RUN npm install --omit=dev --no-audit --no-fund

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/public ./public
COPY --from=builder /app/data ./data
COPY --from=builder /app/docs ./docs
COPY --from=builder /app/assets ./assets
COPY --from=builder /app/README.md ./README.md

EXPOSE 3000

CMD ["npm", "start"]
