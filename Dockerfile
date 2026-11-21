# King of the Page: one image with the game server and the built client.
# Used by Railway (it builds any Dockerfile it finds); also works on Render, Fly.io or plain Docker.

FROM node:24-slim AS build
WORKDIR /app
RUN npm install -g pnpm@10.34.9
# Manifests first so dependency installs are cached between code changes.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/client/package.json apps/client/
COPY apps/server/package.json apps/server/
COPY packages/shared/package.json packages/shared/
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm build

# The server bundle includes all its dependencies, so the runtime image needs no node_modules.
FROM node:24-slim
ENV NODE_ENV=production
# "::" accepts IPv4 and IPv6 on Linux; platforms differ in which one their router uses.
ENV HOST=::
ENV PORT=8080
WORKDIR /app
COPY --from=build /app/apps/server/dist apps/server/dist
COPY --from=build /app/apps/server/drizzle apps/server/drizzle
COPY --from=build /app/apps/client/dist apps/client/dist
USER node
EXPOSE 8080
CMD ["node", "--enable-source-maps", "apps/server/dist/server.js"]
