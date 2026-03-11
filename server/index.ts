import express from "express";
import { readFileSync, readdirSync, statSync, existsSync } from "fs";
import path from "path";
import sharp from "sharp";
import { parsePbo, findEntry, extractEntry, listEntries, type PboFile } from "./parsers/pbo.js";
import { parseWrp, type WrpData } from "./parsers/wrp.js";
import { parsePaa } from "./parsers/paa.js";

const app = express();
const PORT = 3001;

// Cache parsed map data
interface CachedMap {
  wrp: WrpData;
  pbo?: PboFile; // keep PBO reference for texture extraction
}
const mapCache = new Map<string, CachedMap>();

app.use(express.json());

// Serve built frontend in production
const distPath = path.resolve(import.meta.dirname || ".", "../dist");
if (existsSync(distPath)) {
  app.use(express.static(distPath));
}

/**
 * POST /api/load-pbo
 * Body: { path: "/path/to/map.pbo" }
 * Loads and parses a PBO file containing a WRP map.
 */
app.post("/api/load-pbo", (req, res) => {
  try {
    const pboPath = req.body.path;
    if (!pboPath || !existsSync(pboPath)) {
      res.status(400).json({ error: `PBO file not found: ${pboPath}` });
      return;
    }

    console.log(`Loading PBO: ${pboPath}`);
    const pbo = parsePbo(pboPath);
    console.log(`PBO prefix: "${pbo.prefix}"`);

    const entries = listEntries(pbo);
    console.log(`PBO entries (${entries.length}):`);
    entries.forEach((e) => console.log(`  ${e}`));

    // Find the WRP file
    const wrpEntry = pbo.entries.find(
      (e) => e.filename.toLowerCase().endsWith(".wrp")
    );
    if (!wrpEntry) {
      res.status(400).json({
        error: "No WRP file found in PBO",
        entries: entries,
      });
      return;
    }

    console.log(
      `Found WRP: ${wrpEntry.filename} (${(wrpEntry.dataSize / 1024 / 1024).toFixed(1)} MB)`
    );

    const wrpData = extractEntry(pbo, wrpEntry);
    const parsed = parseWrp(wrpData);

    const mapName = path.basename(pboPath, ".pbo");
    mapCache.set(mapName, { wrp: parsed, pbo });

    // Count satellite tiles
    const satTiles = pbo.entries.filter(e =>
      e.filename.toLowerCase().includes("_lco.paa") && e.filename.toLowerCase().includes("layers")
    );

    // Send response immediately so client can start loading terrain
    res.json({
      name: mapName,
      info: parsed.info,
      rvmatCount: parsed.rvmats.length,
      objectCount: parsed.objects.length,
      satelliteTiles: satTiles.length,
    });

    // Pre-generate satellite in background so it's cached when client requests it
    if (satTiles.length > 0 && !satelliteCache.has(mapName)) {
      generateSatellite(pbo).then(buf => {
        satelliteCache.set(mapName, buf);
        console.log(`Satellite pre-cached for ${mapName}`);
      }).catch(err => console.warn("Satellite pre-gen failed:", err));
    }
  } catch (err: any) {
    console.error("Error loading PBO:", err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/load-wrp
 * Body: { path: "/path/to/map.wrp" }
 * Loads a standalone WRP file directly.
 */
app.post("/api/load-wrp", (req, res) => {
  try {
    const wrpPath = req.body.path;
    if (!wrpPath || !existsSync(wrpPath)) {
      res.status(400).json({ error: `WRP file not found: ${wrpPath}` });
      return;
    }

    console.log(`Loading WRP: ${wrpPath}`);
    const data = readFileSync(wrpPath);
    const parsed = parseWrp(data);

    const mapName = path.basename(wrpPath, ".wrp");
    mapCache.set(mapName, { wrp: parsed });

    res.json({
      name: mapName,
      info: parsed.info,
      rvmatCount: parsed.rvmats.length,
      objectCount: parsed.objects.length,
      satelliteTiles: 0,
    });
  } catch (err: any) {
    console.error("Error loading WRP:", err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/map/:name/terrain
 * Returns the elevation data as a binary float32 array.
 * Headers include grid dimensions and cell size.
 */
app.get("/api/map/:name/terrain", (req, res) => {
  const data = mapCache.get(req.params.name);
  if (!data) {
    res.status(404).json({ error: `Map "${req.params.name}" not loaded` });
    return;
  }

  const wrp = data.wrp;
  // Send metadata as JSON headers
  res.set("X-Grid-Width", String(wrp.info.mapSizeX));
  res.set("X-Grid-Height", String(wrp.info.mapSizeY));
  res.set("X-Cell-Size", String(wrp.info.cellSize));
  res.set("X-Map-Size", String(wrp.info.mapSizeMeters));
  res.set("X-Elevation-Min", String(wrp.info.elevationMin));
  res.set("X-Elevation-Max", String(wrp.info.elevationMax));
  res.set("Content-Type", "application/octet-stream");
  res.set("Access-Control-Expose-Headers", "*");

  // Send raw float32 elevation data
  res.send(Buffer.from(wrp.elevations.buffer));
});

/**
 * GET /api/map/:name/info
 * Returns map metadata as JSON.
 */
app.get("/api/map/:name/info", (req, res) => {
  const data = mapCache.get(req.params.name);
  if (!data) {
    res.status(404).json({ error: `Map "${req.params.name}" not loaded` });
    return;
  }
  res.json(data.wrp.info);
});

/**
 * GET /api/map/:name/objects
 * Returns object placement data as JSON.
 */
app.get("/api/map/:name/objects", (req, res) => {
  const data = mapCache.get(req.params.name);
  if (!data) {
    res.status(404).json({ error: `Map "${req.params.name}" not loaded` });
    return;
  }
  res.json({
    models: data.wrp.models,
    objects: data.wrp.objects,
  });
});

/**
 * Classify a model path into a category for rendering.
 */
function classifyModel(modelPath: string): number {
  const p = modelPath.toLowerCase();

  // Vegetation
  if (p.includes("tree") || p.includes("bush") || p.includes("forest") || p.includes("palm") ||
      p.includes("plant") || p.includes("ficus") || p.includes("shrub")) return 0;

  // Rocks
  if (p.includes("rock") || p.includes("stone") || p.includes("boulder") || p.includes("cliff")) return 2;

  // Platforms (flat)
  if (p.includes("nav_pier") || p.includes("pier") || p.includes("dock") || p.includes("quay") ||
      p.includes("runway") || p.includes("taxiway") || p.includes("helipad") ||
      p.includes("platform") || p.includes("conveyer")) return 6;

  // Structures (walls, fences)
  if (p.includes("wall") || p.includes("fence") || p.includes("gate") || p.includes("bridge") ||
      p.includes("dam") || p.includes("pavement") || p.includes("sidewalk") || p.includes("sw_") ||
      p.includes("kerb") || p.includes("rail") || p.includes("quarry") || p.includes("ruin") ||
      p.includes("plot_") || p.includes("pletivo")) return 3;

  // Infrastructure (poles, wires)
  if (p.includes("sign") || p.includes("lamp") || p.includes("light") || p.includes("pole") ||
      p.includes("powerline") || p.includes("wire") || p.includes("antenna") ||
      p.includes("cable") || p.includes("billboard")) return 4;

  // Tiny props (10) - check before buildings since some match "build" paths
  if (p.includes("haybale") || p.includes("woodpile") || p.includes("timberpile") ||
      p.includes("timberlog") || p.includes("strawstack") || p.includes("hutch_") ||
      p.includes("lavicka") || p.includes("bench") || p.includes("edgelight") ||
      p.includes("misc_concrete") || p.includes("crane_rail")) return 10;

  // Building sub-types
  if (p.includes("house") || p.includes("build") || p.includes("barrack") || p.includes("tower") ||
      p.includes("factory") || p.includes("church") || p.includes("mosque") || p.includes("school") ||
      p.includes("shop") || p.includes("hospital") || p.includes("castle") || p.includes("hangar") ||
      p.includes("barn") || p.includes("shed") || p.includes("garage") || p.includes("hut") ||
      p.includes("bunker") || p.includes("mil_") || p.includes("ind_") ||
      p.includes("cargo") || p.includes("crane") || p.includes("complex") || p.includes("clinic") ||
      p.includes("kiosk") || p.includes("market") || p.includes("shelter") || p.includes("mausoleum") ||
      p.includes("construction") || p.includes("tank_") || p.includes("watertank") ||
      p.includes("fuel_tank") || p.includes("transformer") || p.includes("greenhouse") ||
      p.includes("station") || p.includes("bouda")) {
    // Large: 2+ story, towers, churches, apartments, hospitals, castles
    if (p.includes("house_2") || p.includes("house_3") || p.includes("tower") ||
        p.includes("church") || p.includes("mosque") || p.includes("hospital") ||
        p.includes("castle") || p.includes("mausoleum") || p.includes("school") ||
        p.includes("barrack") || p.includes("factory") || p.includes("hotel") ||
        p.includes("complex")) return 7;
    // Industrial: ind_shed, hangars, warehouses
    if (p.includes("ind_") || p.includes("hangar") || p.includes("warehouse") ||
        p.includes("factory") || p.includes("cargo") || p.includes("crane") ||
        p.includes("fuel_tank") || p.includes("watertank") || p.includes("transformer") ||
        p.includes("construction") || p.includes("greenhouse")) return 9;
    // Small: sheds, huts, garages, small misc
    if (p.includes("shed") || p.includes("hut") || p.includes("garage") ||
        p.includes("bouda") || p.includes("kiosk") || p.includes("shelter") ||
        p.includes("tank_")) return 8;
    // Default medium building
    return 1;
  }

  return 5; // other
}

/**
 * GET /api/map/:name/objects-bin
 * Returns object data as compact binary:
 *   Header: u32 nObjects, u32 nModels
 *   Model classifications: u8[nModels]
 *   Per object: f32 x, f32 y, f32 z, f32 scaleApprox, u16 modelIndex
 *   (20 bytes per object)
 */
app.get("/api/map/:name/objects-bin", (req, res) => {
  const data = mapCache.get(req.params.name);
  if (!data) {
    res.status(404).json({ error: `Map "${req.params.name}" not loaded` });
    return;
  }

  const nObjects = data.wrp.objects.length;
  const nModels = data.wrp.models.length;

  // Classify all models
  const classifications = new Uint8Array(nModels);
  for (let i = 0; i < nModels; i++) {
    classifications[i] = classifyModel(data.wrp.models[i]);
  }

  // Build binary buffer: 8 (header) + nModels (classifications) + nObjects * 34
  // Per object: x,y,z (12) + scale (4) + qx,qy,qz,qw (16) + modelIndex (2) = 34
  const bufSize = 8 + nModels + nObjects * 34;
  const buf = Buffer.alloc(bufSize);
  let offset = 0;

  buf.writeUInt32LE(nObjects, offset); offset += 4;
  buf.writeUInt32LE(nModels, offset); offset += 4;

  // Write classifications
  for (let i = 0; i < nModels; i++) {
    buf.writeUInt8(classifications[i], offset++);
  }

  // Write objects: x, y, z, scale, quaternion (qx,qy,qz,qw), modelIndex
  for (const obj of data.wrp.objects) {
    const t = obj.transform;
    // Arma 3x4 transform: columns are [right, up, forward, position]
    // Arma 3x4 transform: column-major 3x3 rotation + position
    // t[0..2] = column 0, t[3..5] = column 1, t[6..8] = column 2, t[9..11] = position
    buf.writeFloatLE(t[9], offset); offset += 4;   // x
    buf.writeFloatLE(t[10], offset); offset += 4;  // y (up)
    buf.writeFloatLE(t[11], offset); offset += 4;  // z

    // Scale from the first column vector
    const scale = Math.sqrt(t[0]*t[0] + t[1]*t[1] + t[2]*t[2]);
    buf.writeFloatLE(scale, offset); offset += 4;

    // Extract rotation as quaternion from the 3x3 part (normalized)
    // Column-major: m[row][col], t[0..2]=col0, t[3..5]=col1, t[6..8]=col2
    const s = scale > 0.0001 ? 1 / scale : 1;
    const m00 = t[0]*s, m10 = t[1]*s, m20 = t[2]*s;
    const m01 = t[3]*s, m11 = t[4]*s, m21 = t[5]*s;
    const m02 = t[6]*s, m12 = t[7]*s, m22 = t[8]*s;

    // Rotation matrix to quaternion (Shepperd's method)
    const trace = m00 + m11 + m22;
    let qx: number, qy: number, qz: number, qw: number;
    if (trace > 0) {
      const r = Math.sqrt(1 + trace);
      const inv = 0.5 / r;
      qw = 0.5 * r;
      qx = (m21 - m12) * inv;
      qy = (m02 - m20) * inv;
      qz = (m10 - m01) * inv;
    } else if (m00 > m11 && m00 > m22) {
      const r = Math.sqrt(1 + m00 - m11 - m22);
      const inv = 0.5 / r;
      qx = 0.5 * r;
      qy = (m10 + m01) * inv;
      qz = (m02 + m20) * inv;
      qw = (m21 - m12) * inv;
    } else if (m11 > m22) {
      const r = Math.sqrt(1 - m00 + m11 - m22);
      const inv = 0.5 / r;
      qy = 0.5 * r;
      qx = (m10 + m01) * inv;
      qz = (m21 + m12) * inv;
      qw = (m02 - m20) * inv;
    } else {
      const r = Math.sqrt(1 - m00 - m11 + m22);
      const inv = 0.5 / r;
      qz = 0.5 * r;
      qx = (m02 + m20) * inv;
      qy = (m21 + m12) * inv;
      qw = (m10 - m01) * inv;
    }

    buf.writeFloatLE(qx, offset); offset += 4;
    buf.writeFloatLE(qy, offset); offset += 4;
    buf.writeFloatLE(qz, offset); offset += 4;
    buf.writeFloatLE(qw, offset); offset += 4;
    buf.writeUInt16LE(Math.min(obj.modelIndex, 65535), offset); offset += 2;
  }

  res.set("Content-Type", "application/octet-stream");
  res.set("X-Object-Count", String(nObjects));
  res.set("X-Model-Count", String(nModels));
  res.set("Access-Control-Expose-Headers", "*");
  res.send(buf);
});

// Cache for generated satellite images
const satelliteCache = new Map<string, Buffer>();

/**
 * Generate a composite satellite JPEG from PAA tiles.
 * Uses direct pixel blitting instead of per-tile sharp encoding.
 */
async function generateSatellite(pbo: PboFile, sizeParam?: string): Promise<Buffer> {
  const tileEntries = pbo.entries.filter(e =>
    /layers[\\\/]s_\d+_\d+_lco\.paa$/i.test(e.filename)
  );
  if (tileEntries.length === 0) throw new Error("No satellite tiles found");

  const tiles: { entry: typeof tileEntries[0]; col: number; row: number }[] = [];
  let maxCol = 0, maxRow = 0;
  for (const entry of tileEntries) {
    const match = entry.filename.match(/s_(\d+)_(\d+)_lco\.paa$/i);
    if (!match) continue;
    const col = parseInt(match[1]);
    const row = parseInt(match[2]);
    maxCol = Math.max(maxCol, col);
    maxRow = Math.max(maxRow, row);
    tiles.push({ entry, col, row });
  }

  const gridCols = maxCol + 1;
  const gridRows = maxRow + 1;
  const requestedSize = Math.min(parseInt(sizeParam || "") || 4096, 8192);
  const outTileW = Math.round(requestedSize / gridCols);
  const outTileH = Math.round(requestedSize / gridRows);
  const outW = gridCols * outTileW;
  const outH = gridRows * outTileH;

  console.log(`Satellite: ${tiles.length} tiles -> ${outW}x${outH} (${outTileW}px/tile)`);
  const t0 = Date.now();

  // Direct blit into raw RGB buffer (no per-tile sharp/PNG overhead)
  const rgb = Buffer.alloc(outW * outH * 3, 50);

  let decoded = 0;
  for (const tile of tiles) {
    try {
      const paa = parsePaa(extractEntry(pbo, tile.entry));
      const srcW = paa.width;
      const ox = tile.col * outTileW;
      const oy = tile.row * outTileH;

      // Nearest-neighbor downsample blit
      const scaleX = srcW / outTileW;
      const scaleY = paa.height / outTileH;
      for (let y = 0; y < outTileH; y++) {
        const srcY = Math.min((y * scaleY) | 0, paa.height - 1);
        const dstRowOff = (oy + y) * outW * 3;
        const srcRowOff = srcY * srcW * 4;
        for (let x = 0; x < outTileW; x++) {
          const srcX = Math.min((x * scaleX) | 0, srcW - 1);
          const si = srcRowOff + srcX * 4;
          const di = dstRowOff + (ox + x) * 3;
          rgb[di] = paa.rgba[si];
          rgb[di + 1] = paa.rgba[si + 1];
          rgb[di + 2] = paa.rgba[si + 2];
        }
      }
      decoded++;
      if (decoded % 100 === 0) console.log(`  ${decoded}/${tiles.length} tiles...`);
    } catch {
      // skip failed tiles
    }
  }

  const jpegBuf = await sharp(rgb, { raw: { width: outW, height: outH, channels: 3 } })
    .jpeg({ quality: 85 })
    .toBuffer();

  console.log(`Satellite done: ${(Date.now() - t0)}ms, ${(jpegBuf.length / 1024).toFixed(0)}KB`);
  return jpegBuf;
}

/**
 * GET /api/map/:name/satellite
 * Returns a composite satellite image (JPEG) assembled from PAA tiles in the PBO.
 * Query params:
 *   size - output image size (default: 4096, max 8192)
 */
app.get("/api/map/:name/satellite", async (req, res) => {
  try {
    const data = mapCache.get(req.params.name);
    if (!data) {
      res.status(404).json({ error: `Map "${req.params.name}" not loaded` });
      return;
    }
    if (!data.pbo) {
      res.status(400).json({ error: "Satellite textures only available for PBO-loaded maps" });
      return;
    }

    // Check cache
    const cacheKey = req.params.name;
    if (satelliteCache.has(cacheKey)) {
      res.set("Content-Type", "image/jpeg");
      res.send(satelliteCache.get(cacheKey)!);
      return;
    }

    const jpegBuf = await generateSatellite(data.pbo, req.query.size as string);

    console.log(`Satellite image: ${(jpegBuf.length / 1024).toFixed(0)} KB`);

    // Cache it
    satelliteCache.set(cacheKey, jpegBuf);

    res.set("Content-Type", "image/jpeg");
    res.set("X-Grid-Cols", String(gridCols));
    res.set("X-Grid-Rows", String(gridRows));
    res.set("X-Tile-Width", String(tileW));
    res.set("X-Tile-Height", String(tileH));
    res.set("Access-Control-Expose-Headers", "*");
    res.send(jpegBuf);
  } catch (err: any) {
    console.error("Error generating satellite image:", err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/scan-directory
 * Body: { path: "/path/to/arma3" }
 * Scans a directory for PBO and WRP files.
 */
app.post("/api/scan-directory", (req, res) => {
  try {
    const dirPath = req.body.path;
    if (!dirPath || !existsSync(dirPath)) {
      res.status(400).json({ error: `Directory not found: ${dirPath}` });
      return;
    }

    const files: string[] = [];
    function scan(dir: string, depth: number) {
      if (depth > 3) return; // don't go too deep
      try {
        for (const entry of readdirSync(dir)) {
          const full = path.join(dir, entry);
          try {
            const stat = statSync(full);
            if (stat.isDirectory()) {
              scan(full, depth + 1);
            } else if (
              entry.toLowerCase().endsWith(".pbo") ||
              entry.toLowerCase().endsWith(".wrp")
            ) {
              files.push(full);
            }
          } catch {
            // skip inaccessible files
          }
        }
      } catch {
        // skip inaccessible dirs
      }
    }

    scan(dirPath, 0);
    res.json({ files });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// SPA catch-all: serve index.html for non-API routes (production only)
if (existsSync(distPath)) {
  app.get("*", (req, res) => {
    res.sendFile(path.join(distPath, "index.html"));
  });
}

const host = process.env.HOST || "0.0.0.0";
app.listen(PORT, host, () => {
  console.log(`Arma 3 Map Viewer running on http://${host}:${PORT}`);
});
