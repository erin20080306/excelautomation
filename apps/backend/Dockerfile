FROM node:22-bookworm-slim
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends dumb-init python3 python3-venv python3-pip && rm -rf /var/lib/apt/lists/*
COPY package*.json ./
COPY tsconfig.base.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/api/prisma apps/api/prisma
COPY apps/worker/package.json apps/worker/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/shared/package.json packages/shared/package.json
COPY packages/processor/package.json packages/processor/package.json
RUN npm ci
COPY packages/shared packages/shared
COPY packages/processor packages/processor
COPY apps/api apps/api
COPY apps/worker apps/worker
COPY apps/backend apps/backend
COPY apps/parser apps/parser
RUN python3 -m venv /opt/parser-venv && /opt/parser-venv/bin/pip install --no-cache-dir -r apps/parser/requirements.txt
RUN npm run build -w @excelmaster/shared && npm run build -w @excelmaster/processor && npm run build -w @excelmaster/api && npm run build -w @excelmaster/worker && npm run db:generate
ENV NODE_ENV=production
EXPOSE 10000
ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "apps/backend/supervisor.mjs"]
