# ──────────────────────────────────────────────────────────────
# Multi-stage Dockerfile for HMS v2 NestJS API
# Stage 1: deps       — install production deps
# Stage 2: builder    — compile TypeScript
# Stage 3: production — minimal runtime image
# ──────────────────────────────────────────────────────────────

# ── Stage 1: Dependencies ─────────────────────────────────────
FROM node:20-alpine AS deps
WORKDIR /app

# Copy package files only (cache layer)
COPY package*.json ./
COPY prisma ./prisma/

# Install all deps (including devDeps for build)
RUN npm ci --frozen-lockfile

# Generate Prisma client
RUN npx prisma generate

# ── Stage 2: Builder ──────────────────────────────────────────
FROM node:20-alpine AS builder
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/prisma ./prisma
COPY . .

RUN npm run build

# ── Stage 3: Production ───────────────────────────────────────
FROM node:20-alpine AS production
WORKDIR /app

ENV NODE_ENV=production

# Security: run as non-root user
RUN addgroup -g 1001 -S nodejs && adduser -S nestjs -u 1001

# Copy only production artifacts
COPY --from=deps --chown=nestjs:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=nestjs:nodejs /app/dist ./dist
COPY --from=builder --chown=nestjs:nodejs /app/prisma ./prisma
COPY --chown=nestjs:nodejs package*.json ./

USER nestjs

EXPOSE 3000

# Health check — liveness probe
HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
  CMD wget -qO- http://localhost:3000/api/health/live || exit 1

CMD ["node", "dist/main.js"]
