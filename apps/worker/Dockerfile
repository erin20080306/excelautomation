FROM node:22-alpine AS build
WORKDIR /app
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
COPY apps/api/prisma apps/api/prisma
COPY apps/worker apps/worker
RUN npm run build -w @excelmaster/shared && npm run build -w @excelmaster/processor && npm run db:generate && npm run build -w @excelmaster/worker

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/apps/worker/dist ./apps/worker/dist
COPY --from=build /app/packages/shared/dist ./packages/shared/dist
COPY --from=build /app/packages/processor/dist ./packages/processor/dist
COPY package*.json ./
COPY apps/worker/package.json apps/worker/package.json
COPY packages/shared/package.json packages/shared/package.json
COPY packages/processor/package.json packages/processor/package.json
CMD ["node", "apps/worker/dist/index.js"]
