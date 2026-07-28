# Multi-stage build for @workspace/api-server.
#
# Stage 1 builds inside the full pnpm workspace (esbuild bundles the whole
# server — including workspace deps like @workspace/api-zod — into a single
# artifacts/api-server/dist/index.mjs, see build.mjs). Stage 2 ships only
# that bundle on a bare Node runtime — no node_modules needed at runtime,
# nothing native is actually used (see build.mjs's `external` list; none of
# those packages are imported here).
#
# Built and run from the REPO ROOT as the Docker build context:
#   docker build -f artifacts/api-server/Dockerfile -t p2p-api-server .
# railway.json (repo root) points Railway's Dockerfile builder at this path,
# with Root Directory left at the repo root so the build context is the
# whole workspace.
#
# EXPOSE 8080 below is documentation only — the app listens on whatever
# process.env.PORT is set to (required, no default), which Railway injects
# automatically at deploy time.
#
# IMPORTANT: the runtime stage's WORKDIR MUST equal the build stage's dist
# path exactly. esbuild-plugin-pino bakes the build machine's absolute
# output directory into the bundle as a literal string (it calls
# path.resolve(outputDir, "./thread-stream-worker.mjs") at build time, not
# something computed fresh via import.meta.url at runtime) so pino can
# locate its worker-thread files. Copying dist/ to any other path (this
# used to be /app/dist) leaves that baked-in path pointing nowhere, and the
# worker crashes at startup with MODULE_NOT_FOUND — confirmed by grepping
# the actual bundle: it contains the literal build machine path, not a
# relative computation.

FROM node:22-slim AS build
RUN corepack enable && corepack prepare pnpm@10.14.0 --activate
WORKDIR /repo
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @workspace/api-server run build

FROM node:22-slim AS runtime
WORKDIR /repo/artifacts/api-server
COPY --from=build /repo/artifacts/api-server/dist ./dist
ENV NODE_ENV=production
EXPOSE 8080
CMD ["node", "--enable-source-maps", "dist/index.mjs"]
