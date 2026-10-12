# CS- — browser FPS projects

Two first-person shooters built on [Three.js](https://threejs.org/), with no
art assets: every texture, mesh and sound is generated in code.

| Project | What it is | Stack | Status |
|---|---|---|---|
| [`overwatch/`](overwatch/) | **OVERWATCH** — a single-map FPS aiming for modern-shooter visual quality (HDR, bloom, AgX tone mapping, soft shadows, time of day). | JavaScript, Vite, Three.js r180 | Builds and runs; deployed by the root `netlify.toml` |
| [`stride-ops/`](stride-ops/) | **STRIDE OPS** — an "AI-native" FPS engine with Classic, AI-Director and Creator modes, procedural maps across 6 biomes, squad AI. | TypeScript, webpack, Jest, Three.js r162 | Builds, type-checks clean, 276 tests passing |

![OVERWATCH — plaza at golden hour](overwatch/shots/baseline/plaza.png)

## OVERWATCH

```bash
cd overwatch
npm install
npm run dev        # http://127.0.0.1:5173
npm run build      # -> overwatch/dist/
```

Controls: click to lock the mouse, **WASD** move, **Shift** sprint, **Space**
jump, **R** reload, **Q/E** lean, **F** interact, **G** use, **X** inspect.

URL options: `?q=low|medium|high|ultra` (quality), `?time=day|golden|dusk|night`,
`?seed=<n>`, `?debug`.

Engine rules for contributors are in [`overwatch/ARCHITECTURE.md`](overwatch/ARCHITECTURE.md).

**Visual regression check.** `npm run gate` captures 7 fixed camera shots and
diffs them against `overwatch/shots/baseline/`. It needs Chrome or Chromium
(set `CHROME_PATH` if it is not in a standard location) and a running dev
server.

## STRIDE OPS

```bash
cd stride-ops
npm install
npm test               # 25 suites, 276 tests
npm run typecheck      # strict tsc, no output
npm run demo:dev       # http://localhost:8080
npm run demo:build     # -> stride-ops/dist-demo/
```

Launch straight into a mode with `?mode=classic`, `?mode=ai` or `?mode=creator`.
Full documentation: [`stride-ops/README.md`](stride-ops/README.md), plus the
design docs in [`stride-ops/docs/`](stride-ops/docs/).

## Repository layout

```
overwatch/     Vite + JS game: src/, tools/ (capture, imagediff), shots/baseline/
stride-ops/    TypeScript engine: src/, tests/, demo/, docs/, webpack + jest config
netlify.toml   deploys overwatch/ (stride-ops/netlify.toml deploys the other)
```

Build output (`dist/`, `dist-demo/`) and `node_modules/` are not committed;
rebuild them with the commands above.
