FROM node:lts-slim AS base
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl && rm -rf /var/lib/apt/lists/*

FROM base AS build
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install
COPY src ./src
COPY tsconfig.json ./
RUN npx tsc

FROM base AS production
WORKDIR /app
COPY --from=build /app/dist ./dist
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./
COPY dashboard ./dashboard
COPY hooks ./hooks

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3100

EXPOSE 3100

CMD ["node", "dist/index.js"]
