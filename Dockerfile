FROM node:24-bookworm-slim@sha256:dc26ae92c9fb15cf6b1d63e20f0944b2efe0f115b20e00be48fb23fceb061c54 AS build
WORKDIR /app
COPY package.json package-lock.json .npmrc ./
COPY scripts ./scripts
RUN npm run install:ci
COPY app ./app
COPY components ./components
COPY hooks ./hooks
COPY lib ./lib
COPY db ./db
COPY public ./public
COPY server ./server
COPY tests ./tests
COPY drizzle ./drizzle
COPY vendor ./vendor
COPY worker ./worker
COPY .openai ./.openai
COPY tsconfig.json vite.config.ts next.config.ts postcss.config.mjs cloudflare-env.d.ts ./
RUN npm run test:server && npm exec -- tsc --noEmit && npm run build:server

FROM node:24-bookworm-slim@sha256:dc26ae92c9fb15cf6b1d63e20f0944b2efe0f115b20e00be48fb23fceb061c54
ENV NODE_ENV=production CDEK_RUNTIME=node CDEK_DATA_DIR=/data PORT=3000
WORKDIR /app
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=build --chown=node:node /app/public ./public
COPY --from=build --chown=node:node /app/server ./server
COPY --from=build --chown=node:node /app/drizzle ./drizzle
COPY --from=build --chown=node:node /app/scripts/server.mjs ./scripts/server.mjs
COPY --from=build --chown=node:node /app/package.json ./package.json
RUN mkdir /data && chown node:node /data
USER node
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=3 CMD ["node", "-e", "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
CMD ["node", "scripts/server.mjs", "start"]
