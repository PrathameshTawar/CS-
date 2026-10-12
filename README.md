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
npm test           # shared gameplay tests (Node built-in runner, no deps)
```

Controls: click to lock the mouse, **WASD** move, **Shift** sprint, **Space**
jump, **R** reload, **Q/E** lean, **F** interact, **G** use, **X** inspect.

URL options: `?q=low|medium|high|ultra` (quality), `?time=day|golden|dusk|night`,
`?seed=<n>`, `?debug`.

Engine rules for contributors are in [`overwatch/ARCHITECTURE.md`](overwatch/ARCHITECTURE.md).

**Screenshot checks.** Both need Chrome or Chromium (set `CHROME_PATH` if it
is not in a standard location) and a running dev server.
- Regression against the committed baselines: `npm run shotset && npm run imagediff`
  captures 7 fixed camera shots and compares them pixel-for-pixel with
  `overwatch/shots/baseline/`.
- Determinism: `npm run gate` re-captures the baselines, captures again and
  diffs the two runs. It overwrites `shots/baseline/`, so don't commit those
  files after a gate run unless the visual change is intended.

### Multiplayer (early: movement and combat)

```bash
cd overwatch
npm install          # also installs the server workspace (ws)
npm run server       # ws://localhost:8787 (PORT, HOST, SEED env vars)
npm run dev          # in a second terminal
```

Open `http://127.0.0.1:5173/?server=ws://localhost:8787&name=alice` in two
windows (change `name`; add `&room=<name>` for a private room). Each window
sees the other player as a stand-in figure, and you can shoot each other.

To play across two PCs on one network, run the server on one of them, start
the game with `npm run dev -- --host` so other machines can load it, and use
`?server=ws://<that PC's LAN IP>:8787` on both (allow port 8787 and 5173 in
the firewall).

Works now: rooms (up to 10 players), server-authoritative movement, client
prediction with reconciliation, smoothed remote players, the protocol
version check, and rate and validation limits. Combat is server-authoritative
too: the server resolves every shot with lag compensation (up to 400 ms),
enforces fire rate, ammo and reloads, and applies damage (34 body, 100 head),
death and a 3 s respawn, with a kill feed on every client. AI enemies are
switched off online. **Not networked yet:** teams, rounds, and proper
character models.

A page served over https (such as the Netlify deploy) can only connect to a
`wss://` server, so playing online from there needs the server behind TLS.
Local and LAN play over `ws://` work from `npm run dev`.

`npm test` covers the shared gameplay and the server: rebuilding the
browser's map from the seed, movement matching a trace recorded from the
original game bit for bit, client prediction landing exactly on the server's
state, the anti-speed-hack input limit, the combat rules (fire rate, ammo,
lag compensation and its cap, spoofed shot origins), and two real WebSocket
clients seeing each other move and fighting to a kill.

Known behaviours the multiplayer work still has to account for:
- Falling is instant: the mover snaps the player onto the highest surface
  below them, so drops and the 60 m spawn land in one step.
- The map has no edge walls; walking past ±60 m falls forever.
- Collision resolves overlap instead of sweeping, so the server must only
  apply small per-step moves. It does: clients send inputs, never positions.

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
overwatch/     Vite + JS game: src/, shared/ (client+server gameplay), server/
               (multiplayer server), tests/, tools/ (capture, imagediff),
               shots/baseline/
stride-ops/    TypeScript engine: src/, tests/, demo/, docs/, webpack + jest config
netlify.toml   deploys overwatch/ (stride-ops/netlify.toml deploys the other)
```

Build output (`dist/`, `dist-demo/`) and `node_modules/` are not committed;
rebuild them with the commands above.
