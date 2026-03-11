# Arma 3 Map Viewer

A browser-based 3D map viewer for Arma 3. Loads PBO/WRP files and renders terrain with satellite textures, placed objects (buildings, trees, rocks), water, and a minimap. Fly around with FPS-style controls.

![Screenshot](screenshot.png)

## Features

- Loads any Arma 3 map from `.pbo` or `.wrp` files
- Satellite ground textures from PAA tiles
- 2M+ placed objects rendered as instanced meshes (buildings, trees, rocks, structures, infrastructure)
- Minimap with click-to-teleport
- FPS fly camera with terrain collision
- Water plane at sea level

## How It Works

The viewer reads Arma 3's native file formats directly — no game installation or conversion tools needed. A PBO archive is unpacked in memory, the OPRW terrain file inside is parsed to extract the elevation grid, object placements (2M+ on Chernarus), and model paths. Satellite ground textures are decoded from DXT1/DXT5-compressed PAA files with LZO decompression handled by a custom C native addon for speed. Everything is assembled into a Three.js 3D scene: terrain as a heightmap mesh, satellite imagery projected on top, objects rendered as instanced low-poly shapes (cones for trees, boxes for buildings, etc.), and a flat blue water plane at sea level.

The server parses once and caches — subsequent requests (terrain data, objects, satellite image) are served from memory. Satellite tiles are composited into a single JPEG in the background immediately after PBO load, so it's ready by the time the browser asks for it.

## Potential Improvements (Closer to In-Game)

What currently exists is a "strategic overview" — shapes and colors on real terrain. To get closer to the actual Arma 3 camera experience:

- **Real 3D models**: Parse ODOL P3D model files and render actual building/tree geometry instead of placeholder boxes and cones. This is the single biggest visual gap. P3D files live in separate PBOs (base game `a3\` and mod addons), not in the map PBO itself. Bounding box data is in the ODOL header (~first 100 bytes) — reading just that would give accurate object dimensions without full geometry parsing.
- **Surface textures (rvmat)**: The terrain has per-cell material layers (grass, dirt, rock) defined by rvmat files. Blending these would give ground detail at close range instead of a stretched satellite image.
- **Normal maps and lighting**: PAA files include normal maps. Using them with proper PBR shading would add depth and realism to terrain and objects.
- **Roads**: The WRP file contains road network data (paths + P3D models) that we currently skip. Rendering roads as textured strips would fill in a major missing feature.
- **Vegetation LOD**: Trees and bushes could use billboard sprites at distance and simple 3D shapes up close, similar to Arma's own LOD system.
- **Atmospheric effects**: Arma has distance haze, time-of-day lighting, and cloud shadows. Adding a sky dome, fog gradient, and sun position controls would sell the atmosphere.

## Requirements

- **Node.js** 18+ (tested on 22)
- **Python 3** (for building the native LZO addon via node-gyp)
- **C compiler** (Xcode Command Line Tools on macOS, `build-essential` on Ubuntu/Debian, Visual Studio Build Tools on Windows)

## Quick Start

```bash
git clone <repo-url>
cd arma3-map-viewer

# Install dependencies, build native addon, and build frontend
npm run setup

# Start the server
npm start
```

Open `http://localhost:3001` in your browser.

## Setup Step by Step

If `npm run setup` fails, run each step manually:

```bash
# 1. Install Node.js dependencies
npm install

# 2. Build the native LZO decompression addon
cd native && npx node-gyp rebuild && cd ..

# 3. Build the frontend
npm run build
```

### Common build issues

- **node-gyp fails**: Make sure you have Python 3 and a C compiler installed.
  - macOS: `xcode-select --install`
  - Ubuntu/Debian: `sudo apt install build-essential python3`
  - Windows: Install [Visual Studio Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/) with "Desktop development with C++"
- **sharp fails to install**: It downloads a prebuilt binary for your platform. If it fails, check [sharp installation docs](https://sharp.pixelplumbing.com/install).

## Usage

### Running

```bash
# Production mode (serves built frontend + API on one port)
npm start

# Development mode (hot reload, vite dev server + API server)
npm run dev
```

In production mode, everything runs on `http://localhost:3001`.
In dev mode, the frontend is at `http://localhost:5173` with API proxied to `:3001`.

### Loading a Map

1. Open the viewer in your browser
2. Enter the full path to a `.pbo` file on the **server's** filesystem
3. Click **Load PBO** (or **Load WRP** for standalone `.wrp` files)

You can also auto-load via URL parameter:
```
http://localhost:3001/?pbo=/home/user/arma3/!Workshop/@CUP Terrains - Maps/addons/cup_chernarus_s.pbo
http://localhost:3001/?pbo=/home/user/arma3/Addons/map_altis.pbo
http://localhost:3001/?wrp=/home/user/maps/stratis.wrp
```

### Where to Find Map Files

Map PBO files are typically found in:

- **Steam Workshop mods**: `<Arma 3>/!Workshop/@<mod_name>/addons/*.pbo`
- **Vanilla maps**: `<Arma 3>/Addons/map_*.pbo` (e.g., `map_altis.pbo`)
- **CUP Terrains**: Inside the CUP Terrains mod folder under `addons/`

### Sharing with Other Players

If you're running this on a server that others should access:

1. Make sure port `3001` is open in your firewall
2. Start with `npm start`
3. Share `http://<your-server-ip>:3001` with your players
4. Players enter PBO paths (paths are on the **server**, not their machine)

To pre-load a map so players don't need to type paths, share a direct URL:
```
http://192.168.1.50:3001/?pbo=/home/user/arma3/!Workshop/@CUP Terrains - Maps/addons/cup_chernarus_s.pbo
```

## Controls

| Key | Action |
|-----|--------|
| **Click viewport** | Enable mouse look (pointer lock) |
| **WASD** | Move forward/back/left/right |
| **Q / Space** | Move up |
| **E / C** | Move down |
| **Shift** | Move faster (3x) |
| **Mouse** | Look around |
| **Scroll wheel** | Adjust movement speed |
| **Click minimap** | Teleport to that location |
| **Esc** | Release mouse |

Camera stays between 2m above ground and 2000m altitude.

## Architecture

```
arma3-map-viewer/
  server/           - Express API server
    index.ts        - API routes, satellite generation, object classification
    parsers/
      pbo.ts        - PBO archive parser
      wrp.ts        - OPRW terrain format parser
      paa.ts        - PAA texture parser (DXT1/DXT5 + LZO)
      binary-reader.ts
  src/              - Three.js frontend
    main.ts         - App entry, map loading, minimap
    terrain.ts      - Terrain mesh generation, satellite textures
    objects.ts      - Instanced object rendering
    fly-camera.ts   - FPS camera with terrain collision
  native/           - C native addon
    lzo_addon.c     - N-API LZO decompressor (patched for byte tracking)
    minilzo.c/h     - miniLZO library (patched)
  index.html        - UI shell
```

## Developer Guide

### API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/load-pbo` | Load a PBO file. Body: `{ "path": "/abs/path.pbo" }`. Returns map info JSON. |
| POST | `/api/load-wrp` | Load a standalone WRP file. Body: `{ "path": "/abs/path.wrp" }`. |
| GET | `/api/map/:name/terrain` | Binary Float32Array of elevation grid. Headers: `X-Grid-Width`, `X-Grid-Height`, `X-Cell-Size`, `X-Map-Size`, `X-Elevation-Min`, `X-Elevation-Max`. |
| GET | `/api/map/:name/info` | Map metadata JSON. |
| GET | `/api/map/:name/objects-bin` | Binary object data (positions, rotations, classifications). See format below. |
| GET | `/api/map/:name/satellite?size=4096` | Composite satellite JPEG from PAA tiles. Cached after first generation. |
| POST | `/api/scan-directory` | Scan a directory for PBO/WRP files. Body: `{ "path": "/dir" }`. |

### Objects Binary Format

```
Header:
  u32  nObjects
  u32  nModels

Classifications:
  u8[nModels]  — category index per model (0=vegetation, 1=building, 2=rock, 3=structure, 4=infrastructure, 5=other, 6=platform, 7=building-large, 8=building-small, 9=building-industrial, 10=building-tiny)

Per object (× nObjects):
  f32  x          — world X position
  f32  y          — world Y position (up)
  f32  z          — world Z position
  f32  scale      — uniform scale from transform matrix
  f32  qx         — rotation quaternion X
  f32  qy         — rotation quaternion Y
  f32  qz         — rotation quaternion Z
  f32  qw         — rotation quaternion W
  u16  modelIndex — index into models/classifications array
```

### Arma 3 File Formats

**PBO** (archive): Header entries with filename + packing method + sizes, then concatenated file data. Entries end with an empty record. Optional `Vers` product entry with key-value properties (including `prefix`). See `server/parsers/pbo.ts`.

**OPRW** (terrain, inside PBO as `.wrp`): Binary format containing:
1. Header: signature `"OPRW"`, version, appId, layer/map dimensions, cell size
2. GridBlocks: recursive tree structures (geography, cfgEnvSounds, rvmatLayerIndex) — skipped
3. LZO-compressed blocks: randomClutter, unknown, **elevation** (Float32 grid) — only elevation is kept
4. String arrays: rvmat paths, model paths, classed models
5. More GridBlocks and LZO blocks (skipped)
6. Road networks: per-cell road segments with positions and model paths — currently skipped
7. Objects: array of `{ objectId(u32), modelIndex(u32), transform(12×f32), static0x02(u32) }`

The 3×4 transform matrix is column-major: `t[0..2]` = column 0 (right), `t[3..5]` = column 1 (up), `t[6..8]` = column 2 (forward), `t[9..11]` = position. Rotation quaternion is extracted server-side via Shepperd's method.

**PAA** (texture, inside PBO as `.paa`): DXT1 or DXT5 compressed textures with optional per-mipmap LZO compression.
1. Type tag: `0xFF01` = DXT1, `0xFF05` = DXT5
2. TAGGs: metadata blocks (8-byte signature + u32 length + data), ended by `TAGGFPAG`
3. Palette: u16 count + data (usually empty for DXT)
4. Mipmaps: largest first. Each has `u16 width` (bit 15 = LZO flag), `u16 height`, 3-byte LE data length, then data

See `server/parsers/paa.ts` for DXT1/DXT5 block decoding.

**P3D / ODOL** (3D models, NOT in map PBO): Model geometry files. Located in separate PBOs (`a3\structures_f_enoch`, `ca\buildings2`, etc.). The ODOL header contains bounding box min/max which could be used for accurate object sizing. Currently not parsed — objects use estimated sizes from model path keywords.

### LZO Native Addon

The WRP format uses LZO1X compression without storing compressed block sizes. Our patched `minilzo.c` exposes `lzo1x_last_consumed` (bytes read from input) after each decompress call, allowing single-pass decompression instead of the binary search needed with stock minilzo.

Two functions exported:
- `decompress(buffer, expectedSize)` → `{ data: Buffer, bytesRead: number }` — full decompress
- `skipDecompress(buffer, expectedSize)` → `number` (bytesRead) — decompress to find size, discard output

### Object Classification

Models are classified by keyword matching on the model path (`server/index.ts:classifyModel()`). Categories:

| ID | Name | Geometry | Keywords |
|----|------|----------|----------|
| 0 | Vegetation | Green cone | tree, bush, forest, palm, plant |
| 1 | Building (medium) | 8×4×6 beige box | house (1-story), shop, barn, default |
| 2 | Rock | Gray icosahedron | rock, stone, boulder, cliff |
| 3 | Structure | 5×2.5×0.3 thin box | wall, fence, gate, bridge, plot_ |
| 4 | Infrastructure | Thin cylinder | sign, lamp, pole, powerline, antenna |
| 5 | Other | Small gray cube | anything unclassified |
| 6 | Platform | 10×0.5×10 flat box | pier, dock, runway, platform |
| 7 | Building (large) | 12×10×10 dark box | house_2+, tower, church, factory |
| 8 | Building (small) | 4×3×3 light box | shed, hut, garage, kiosk |
| 9 | Building (industrial) | 15×6×10 gray box | ind_, hangar, cargo, crane |
| 10 | Building (tiny) | 1.5×1×1.5 prop | haybale, woodpile, bench, misc |

To add a new category: add a keyword check in `classifyModel()`, add a new `configs.set()` in `src/objects.ts:getCategoryConfigs()`, and increase the loop bound in `createObjects()`.

### Adding New File Format Support

Parsers live in `server/parsers/`. Each exports a parse function that takes a `Buffer` and returns structured data. Use `BinaryReader` for sequential binary reads — it handles endianness and null-terminated strings.

To add a new parser:
1. Create `server/parsers/yourformat.ts`
2. Import and use `BinaryReader`
3. Add an API endpoint in `server/index.ts`
4. Add client-side handling in `src/main.ts`

## Screenshots & Agent Debugging

Puppeteer-based screenshot scripts live in `scripts/` for headless visual validation.

### Basic screenshot

Captures the current page state after a short render delay:

```bash
# Default: http://localhost:5173 → screenshot.png
npx tsx scripts/screenshot.ts

# Custom URL and output
npx tsx scripts/screenshot.ts http://localhost:5173/?pbo=/path/to/map.pbo shot.png
```

### Screenshot with camera position

Loads a map, waits for it to finish, optionally positions the camera:

```bash
# Default map URL → screenshot.png
npx tsx scripts/screenshot-url.ts

# Custom URL + output + camera position (x,y,z) + lookAt target (lx,ly,lz)
npx tsx scripts/screenshot-url.ts http://localhost:5173/?pbo=/path/map.pbo out.png 3800,400,3800 3900,0,3900
```

### Plan mode screenshot

Tests the full plan mode flow — activates plan mode, double-clicks to place marks with different colors, then angles the camera for a 3D view:

```bash
npx tsx scripts/screenshot-plan.ts
npx tsx scripts/screenshot-plan.ts http://localhost:5173/?pbo=/path/map.pbo plan-shot.png
```

### Agent debugging flow

When using an AI coding agent (e.g. Claude Code) to develop features, use screenshots as a feedback loop:

1. **Start the dev server** in the background:
   ```bash
   npm run dev &
   ```

2. **Make code changes** — Vite HMR picks them up automatically.

3. **Take a screenshot** to verify visually:
   ```bash
   npx tsx scripts/screenshot.ts
   ```

4. **Read the screenshot** — the agent can view the PNG to check if UI elements rendered correctly, marks appear in the right places, colors are correct, etc.

5. **Iterate** — fix issues and re-screenshot without restarting the server.

For testing specific interactions (clicking, typing, keyboard shortcuts), write a Puppeteer script similar to `scripts/screenshot-plan.ts` that drives the browser programmatically and captures the result. Key patterns:

- `page.click("#element")` — click UI buttons
- `page.mouse.click(x, y, { count: 2 })` — double-click on the 3D viewport
- `page.type("#input", "text")` — type into inputs
- `page.keyboard.press("Enter")` — press keys
- `page.evaluate(() => { ... })` — run JS in the page (e.g. position camera via `window.__camera`)
- `page.waitForFunction(() => condition, { timeout })` — wait for async operations
- `page.$$eval(selector, els => els.length)` — assert DOM state

## License

The `native/minilzo.*` files are from the [miniLZO library](http://www.oberhumer.com/opensource/lzo/) by Markus Oberhumer, licensed under GPLv2.
