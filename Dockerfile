# syntax=docker/dockerfile:1
#
# Imagen del backend de PharmaPOS para la instalación en la nube
# (deploy/nube/docker-compose.yml). Ver docs/produccion/03-NUBE.md y ADR-0024.
#
# Al arrancar aplica las migraciones pendientes (`prisma migrate deploy`) y
# luego inicia la API. Con una sola instancia es seguro; si algún día hay
# varias réplicas, las migraciones deben salir a un paso aparte.

# ── 1. Compilación ──────────────────────────────────────────────────────────
FROM node:22-bookworm-slim AS build
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN npm ci

COPY . .
RUN npx prisma generate && npm run build

# ── 2. Ejecución ────────────────────────────────────────────────────────────
FROM node:22-bookworm-slim
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl \
  && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3005

# Se conservan las dependencias de desarrollo a propósito: `prisma` (CLI de
# migraciones) y `ts-node` (semilla del primer administrador) viven ahí.
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=build --chown=node:node /app/prisma ./prisma
# La semilla (prisma/seed.ts, vía ts-node) importa módulos de src/.
COPY --from=build --chown=node:node /app/src ./src
COPY --from=build --chown=node:node /app/scripts ./scripts
COPY --from=build --chown=node:node /app/package.json ./package.json
COPY --from=build --chown=node:node /app/tsconfig.json ./tsconfig.json

USER node
EXPOSE 3005

HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3005/health/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# `exec` para que Node reciba las señales de apagado (shutdown ordenado).
CMD ["sh", "-c", "npx prisma migrate deploy && exec node dist/src/main"]
