# OVERWATCH: one container that serves the game page and runs the multiplayer
# server on the same port (PORT, default 8787). Works on any host that runs
# containers (Fly.io, Railway, Render, a VPS):
#
#   docker build -t overwatch .
#   docker run -p 8787:8787 overwatch      # then open http://localhost:8787/

FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY server/package.json server/
RUN npm ci
COPY . .
# optional: a server address baked into the page (default: the page's own host)
ARG VITE_SERVER_URL=
RUN npm run build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
COPY server/package.json server/
# the server runs shared/ gameplay, and builds the plaza's colliders from the
# client's world code (src/world, three.js), so it needs both at runtime
RUN npm ci --omit=dev && npm cache clean --force
COPY shared shared
COPY src src
COPY server server
COPY --from=build /app/dist dist
USER node
EXPOSE 8787
HEALTHCHECK CMD wget -qO- http://127.0.0.1:${PORT:-8787}/health || exit 1
CMD ["node", "server/index.js"]
