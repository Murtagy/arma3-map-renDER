# Arma 3 Map Viewer

Browser-based 3D viewer for Arma 3 maps (`.pbo` / `.wrp`), fully client-side.

![Screenshot](screenshot.png)

## Features

- No backend runtime: parse/render pipeline runs in browser workers
- Reads Arma formats directly (`PBO`, `WRP`, `PAA`, `LZO`)
- Terrain + object rendering with minimap and fly camera controls
- Satellite texture generation is automatic for maps with satellite tiles
- Shareable map-name URL param: `?map=<map_name>`
- Replay timeline support (player positions, shots, kills, killboard, eventboard)
- Replay server filter (`T1` / `T2` / `T3` / etc.) in replay selector
- Player name labels rendered above 3D replay units
- Collapsible UI: global controls panel, map/replay sections, killboard, eventboard

## Quick Start

Prerequisites:

- Node.js 20+ (Node 22 is used in CI)
- npm

```bash
npm install
npm run dev
```

Open `http://localhost:5173`.

For a production-style local check:

```bash
npm run build
npm run preview
```

If you want replay fetch to work in local `npm run dev`, set:

```bash
echo 'VITE_REPLAY_PROXY_URL=https://replay-cors-proxy.<your-subdomain>.workers.dev' > .env.local
```

Then restart `npm run dev` so Vite picks up the new env value.

## Development Hotpaths

Use these loops to test changes quickly:

### 1) UI / camera / rendering tweaks

```bash
npm run dev
```

- Edit `src/main.ts`, `src/terrain.ts`, `src/objects.ts`, `src/fly-camera.ts`, `src/plan-mode.ts`
- Vite HMR updates most changes immediately

### 2) Parser / worker changes

- Edit `src/parsers/*` or `src/workers/map-loader.worker.ts`
- After changes, do a hard refresh in browser to ensure the worker bundle is reloaded
- Reload the map and verify:
  - map size and elevation range look sane in status
  - object placement is coherent (not scrambled)
  - satellite texture applies for PBO maps with tiles

### 3) Agent self-test (automated)

Run a full automated smoke loop (build + preview + headless load + assertions + screenshot):

```bash
MAP_FILE=/abs/path/to/map.pbo npm run test:agent
```

First run on a machine may require:

```bash
npx playwright install chromium
```

Optional env vars:

- `MAP_NAME=<name>` - force-select map by dropdown name when multiple maps are provided
- `SCREENSHOT_PATH=<path>` - output screenshot path (default: `artifacts/agent-smoke.png`)
- `SMOKE_PORT=<port>` - preview server port (default: `4173`)

What the script validates:

- app builds and starts
- map appears in dropdown after file injection
- map load completes without `Error:` in status
- satellite completes (or correctly reports no satellite tiles)
- minimap is visible
- no runtime console errors

If any check fails, command exits non-zero.

### 4) Production parity check

```bash
npm run build
npm run preview
```

- Use this before pushing to catch build-only issues

### Recommended regression maps

- `cup_zargabad.pbo` (smaller, faster sanity check)
- `cup_chernarus_s.pbo` (large map, stresses parser/memory path)

## Usage

1. Expand **Map Viewer Controls** if collapsed.
2. Click **Pick Folder** (recommended) or **Pick File(s)**
3. Select a map from the dropdown
4. Click **Load Map**
5. If the map PBO has satellite tiles, texture generation starts automatically
6. In **Replay Selection**, click **Fetch Replays**
7. (Optional) Choose server in **Server** filter (`T2`, `T3`, etc.)
8. Pick replay and click **Load Replay**

### Replay UI Notes

- Replay loading attempts to auto-match and auto-load map by replay map key.
- If multiple maps match, select one manually and click **Load Map**.
- Replay panel (top-right) includes:
  - transport: play / pause / seek / speed
  - filters: messages / kills / hits / medical
  - collapsible killboard and eventboard
- Click killboard row to focus camera on that unit.
- Click eventboard row to jump to event time.

## Replay Proxy (Required on Pages)

`replay.tsgames.ru` API currently does not send browser CORS headers for cross-origin fetch.
For GitHub Pages you need one HTTPS CORS proxy endpoint.

### One-time owner setup (all users benefit)

Worker source is included:

- [proxy/replay-cors-proxy-worker.js](proxy/replay-cors-proxy-worker.js)

Deploy once:

```bash
npm install -g wrangler
wrangler login
wrangler deploy
```

You will get:

```text
https://replay-cors-proxy.<your-subdomain>.workers.dev
```

Then set GitHub repo secret:

- `Settings -> Secrets and variables -> Actions -> Secrets`
- add `VITE_REPLAY_PROXY_URL = https://replay-cors-proxy.<your-subdomain>.workers.dev`

After next deploy, the app uses this proxy by default for everyone.
Users do not need to configure anything.

For local dev, use `.env.local` with the same `VITE_REPLAY_PROXY_URL` value.

Notes:

- Use `https://` only.
- Worker is restricted to `https://replay.tsgames.ru/ajax.php` (not a generic open proxy).
- Free/limits policy depends on your Cloudflare plan; monitor usage in Cloudflare dashboard.

Troubleshooting:

- If replay requests still go direct in local dev, stop and restart `npm run dev` after editing `.env.local`.
- `Proxy URL (override)` input is shown when no default proxy env is configured.

### Auto-load by URL

Use:

```text
http://localhost:5173/?map=chernarus
```

After selecting a folder, the app auto-loads the matching map name when present.

Replay deep-link params are also supported:

```text
http://localhost:5173/?replay=<full_replay_name>&archive=1
```

## Screenshots (Automated Baseline)

Generate a reproducible screenshot via the smoke test:

```bash
MAP_FILE=/abs/path/to/map.pbo SCREENSHOT_PATH=artifacts/agent-smoke.png npm run test:agent
```

Use the generated image as baseline evidence in PRs or to refresh repo screenshots after visual changes.

## GitHub Pages

Deployment workflow is included at `.github/workflows/deploy-pages.yml`.

- Push to `main` or `master`
- GitHub Actions builds and deploys `dist/`
- Vite `base` is provided by `VITE_BASE_PATH` in the workflow (`/<repo>/`)
- Optional: set repo secret `VITE_REPLAY_PROXY_URL` to make replay fetching work on Pages with zero user setup
- In repository settings, set **Pages -> Build and deployment -> Source = GitHub Actions** (not branch root)

## Controls

| Key | Action |
|-----|--------|
| Click viewport | Enable mouse look (pointer lock) |
| WASD | Move |
| Q / Space | Move up |
| E / C | Move down |
| Shift | Faster movement |
| Mouse | Look around |
| Scroll | Adjust movement speed |
| Click minimap | Teleport |
| P | Toggle plan mode |
| Space (during replay) | Play/pause replay |
| Esc | Release mouse / cancel move |

## Architecture

- `src/main.ts` - app entry, UI flow, worker orchestration
- `src/workers/map-loader.worker.ts` - map parsing + satellite generation
- `src/workers/replay-loader.worker.ts` - replay list/detail fetch + replay parsing
- `src/parsers/*` - browser parsers for Arma formats
- `src/terrain.ts` - terrain mesh generation and satellite application
- `src/objects.ts` - instanced object rendering
- `src/plan-mode.ts` - tactical marks and lines
- `proxy/replay-cors-proxy-worker.js` - optional CORS proxy worker for replay API
- `wrangler.toml` - Wrangler deploy config for the proxy worker

No native/C build dependencies are required.
