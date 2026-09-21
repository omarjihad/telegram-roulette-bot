FROM node:22-bookworm-slim

WORKDIR /app

# Keep the package manager version aligned with the lockfile used to build this project.
RUN corepack enable && corepack prepare pnpm@10.26.1 --activate

COPY . .

# Render builds the frontend and API in one container. The build context must not contain
# local dependencies or Replit-only files; see .dockerignore.
RUN pnpm install --frozen-lockfile \
  && BASE_PATH=/ PORT=10000 NODE_ENV=production pnpm --filter @workspace/bounty-roulette run build \
  && pnpm --filter @workspace/api-server run build \
  && CI=true pnpm prune --prod

ENV NODE_ENV=production
ENV BASE_PATH=/
ENV CLIENT_DIST_DIR=/app/artifacts/bounty-roulette/dist/public

EXPOSE 10000

CMD ["node", "--enable-source-maps", "artifacts/api-server/dist/index.mjs"]