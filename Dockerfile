# Use Node.js LTS version
FROM node:20-alpine AS base

# Install dependencies only when needed
FROM base AS deps
WORKDIR /app

# Copy package files and prisma schema (needed for postinstall script)
COPY package.json package-lock.json* ./
COPY prisma ./prisma

# Install dependencies with cache mount (line 24 - modified cache ID to fix EBUSY)
RUN --mount=type=cache,id=s/dfcc2668-df5d-4a1e-89be-3fae693fb258-node_modules/cache-fix1,target=/root/.npm \
    npm ci

# Rebuild the source code only when needed
FROM base AS builder
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Generate Prisma client and build TypeScript
RUN npm run prisma:generate && \
    npm run build

# Production image
FROM base AS runner
WORKDIR /app

ENV NODE_ENV=production

# Copy necessary files
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/prisma ./prisma

# Expose port (Railway sets PORT dynamically, default to 10000)
EXPOSE 10000

# Note: Railway handles healthchecks via its own system, not Docker HEALTHCHECK
# The healthcheck path is configured in railway.json

# Start the application
CMD ["npm", "start"]
