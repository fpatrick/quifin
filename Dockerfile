# syntax=docker/dockerfile:1.7

FROM node:22-alpine AS deps
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY package.json package-lock.json ./
RUN npm ci

FROM node:22-alpine AS builder
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:22-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV HOSTNAME=0.0.0.0
ENV PORT=3000
ENV QUIFIN_DB_PATH=/data/db/quifin.db

RUN addgroup -g 101 -S nodejs \
  && adduser -S -D -H -u 100 -G nodejs nextjs \
  && mkdir -p /data/db \
  && chown -R nextjs:nodejs /app /data

# Standalone output keeps runtime image small.
COPY --from=builder --chown=nextjs:nodejs /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

# Migrations are loaded from /app/db at runtime.
COPY --from=builder --chown=nextjs:nodejs /app/db ./db
COPY --chown=nextjs:nodejs docker/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

USER nextjs
EXPOSE 3000
VOLUME ["/data"]

ENTRYPOINT ["/entrypoint.sh"]
CMD ["node", "server.js"]
