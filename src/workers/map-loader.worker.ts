/// <reference lib="webworker" />

import { extractEntry, parsePboBuffer, type PboEntry, type PboFile } from "../parsers/pbo";
import { parseWrp } from "../parsers/wrp";
import { parsePaa } from "../parsers/paa";
import type {
  WorkerMapInfo,
  MapWorkerRequest,
  MapWorkerResponse,
  WorkerProgressMessage,
} from "./types";

interface TileEntry {
  entry: PboEntry;
  col: number;
  row: number;
}

interface CachedWorkerMap {
  map: WorkerMapInfo;
  pbo?: PboFile;
  satTiles: TileEntry[];
}

const cache = new Map<string, CachedWorkerMap>();

function post(msg: MapWorkerResponse, transfer?: Transferable[]) {
  if (transfer && transfer.length > 0) {
    self.postMessage(msg, transfer);
  } else {
    self.postMessage(msg);
  }
}

function progress(
  mapName: string,
  stage: WorkerProgressMessage["stage"],
  detail?: string,
  completed?: number,
  total?: number
) {
  post({ type: "progress", mapName, stage, detail, completed, total });
}

function getBaseName(pathOrName: string): string {
  const file = pathOrName.split("/").pop()?.split("\\").pop() ?? pathOrName;
  return file.replace(/\.[^.]+$/, "");
}

function detectSourceType(fileName: string): "pbo" | "wrp" {
  if (fileName.toLowerCase().endsWith(".pbo")) return "pbo";
  return "wrp";
}

function collectSatelliteTiles(pbo: PboFile): TileEntry[] {
  const tiles: TileEntry[] = [];
  for (const entry of pbo.entries) {
    const m = entry.filename.match(/layers[\\/]s_(\d+)_(\d+)_lco\.paa$/i);
    if (!m) continue;
    tiles.push({ entry, col: parseInt(m[1], 10), row: parseInt(m[2], 10) });
  }
  return tiles;
}

function generateSatelliteRgba(pbo: PboFile, tiles: TileEntry[], requestedSize: number, mapName: string) {
  if (tiles.length === 0) {
    throw new Error("В этом PBO карты не найдены спутниковые тайлы");
  }

  let maxCol = 0;
  let maxRow = 0;
  for (const tile of tiles) {
    if (tile.col > maxCol) maxCol = tile.col;
    if (tile.row > maxRow) maxRow = tile.row;
  }

  const gridCols = maxCol + 1;
  const gridRows = maxRow + 1;
  const size = Math.min(Math.max(requestedSize || 4096, 512), 8192);
  const outTileW = Math.max(1, Math.round(size / gridCols));
  const outTileH = Math.max(1, Math.round(size / gridRows));
  const outW = gridCols * outTileW;
  const outH = gridRows * outTileH;

  const out = new Uint8ClampedArray(outW * outH * 4);
  for (let i = 0; i < out.length; i += 4) {
    out[i] = 50;
    out[i + 1] = 50;
    out[i + 2] = 50;
    out[i + 3] = 255;
  }

  const total = tiles.length;
  let completed = 0;

  for (const tile of tiles) {
    try {
      const paa = parsePaa(extractEntry(pbo, tile.entry));
      const srcW = paa.width;
      const srcH = paa.height;
      const ox = tile.col * outTileW;
      const oy = tile.row * outTileH;

      const scaleX = srcW / outTileW;
      const scaleY = srcH / outTileH;

      for (let y = 0; y < outTileH; y++) {
        const srcY = Math.min((y * scaleY) | 0, srcH - 1);
        const dstRowOff = (oy + y) * outW * 4;
        const srcRowOff = srcY * srcW * 4;

        for (let x = 0; x < outTileW; x++) {
          const srcX = Math.min((x * scaleX) | 0, srcW - 1);
          const si = srcRowOff + srcX * 4;
          const di = dstRowOff + (ox + x) * 4;
          out[di] = paa.rgba[si];
          out[di + 1] = paa.rgba[si + 1];
          out[di + 2] = paa.rgba[si + 2];
          out[di + 3] = 255;
        }
      }
    } catch {
      // Keep default color for failed tiles.
    }

    completed++;
    if (completed % 100 === 0 || completed === total) {
      progress(mapName, "satellite", "Декодирование спутниковых тайлов", completed, total);
    }
  }

  return { width: outW, height: outH, rgba: out };
}

async function handleLoadMap(fileName: string, fileBytes: ArrayBuffer) {
  const sourceType = detectSourceType(fileName);
  const mapName = getBaseName(fileName);
  const bytes = new Uint8Array(fileBytes);

  progress(mapName, "read", `Чтение ${fileName}`);

  let wrpBytes: Uint8Array;
  let pbo: PboFile | undefined;
  let satTiles: TileEntry[] = [];

  if (sourceType === "pbo") {
    progress(mapName, "parse_pbo", "Разбор заголовков PBO");
    pbo = parsePboBuffer(bytes);

    const wrpEntry = pbo.entries.find((entry) => entry.filename.toLowerCase().endsWith(".wrp"));
    if (!wrpEntry) {
      throw new Error("В PBO не найден WRP-файл");
    }

    wrpBytes = extractEntry(pbo, wrpEntry);
    satTiles = collectSatelliteTiles(pbo);
  } else {
    wrpBytes = bytes;
  }

  progress(mapName, "parse_wrp", "Разбор рельефа и объектов WRP");
  const wrp = parseWrp(wrpBytes);

  progress(mapName, "prepare_terrain", "Подготовка буферов рельефа");
  const terrain = {
    gridWidth: wrp.info.mapSizeX,
    gridHeight: wrp.info.mapSizeY,
    cellSize: wrp.info.cellSize,
    mapSize: wrp.info.mapSizeMeters,
    elevationMin: wrp.info.elevationMin,
    elevationMax: wrp.info.elevationMax,
    elevations: wrp.elevations,
  };

  progress(mapName, "prepare_objects", "Подготовка экземпляров объектов");
  const objects = wrp.objects;

  const map: WorkerMapInfo = {
    name: mapName,
    sourceType,
    info: wrp.info,
    rvmatCount: wrp.rvmats.length,
    objectCount: objects.nObjects,
    satelliteTiles: satTiles.length,
  };

  cache.set(mapName, { map, pbo, satTiles });

  progress(mapName, "done", "Карта разобрана");
  post(
    {
      type: "map_loaded",
      map,
      terrain,
      objects,
    },
    [
      terrain.elevations.buffer,
      objects.classifications.buffer,
      objects.positions.buffer,
      objects.scales.buffer,
      objects.quaternions.buffer,
      objects.modelIndices.buffer,
    ]
  );
}

async function handleGenerateSatellite(mapName: string, size: number | undefined) {
  const cached = cache.get(mapName);
  if (!cached) {
    throw new Error(`Карта "${mapName}" не загружена`);
  }
  if (!cached.pbo) {
    throw new Error("Спутниковые текстуры доступны только для карт, загруженных из PBO");
  }

  progress(mapName, "satellite", "Запуск генерации спутниковой текстуры", 0, cached.satTiles.length);
  const { width, height, rgba } = generateSatelliteRgba(
    cached.pbo,
    cached.satTiles,
    size ?? 4096,
    mapName
  );

  post(
    {
      type: "satellite_ready",
      mapName,
      width,
      height,
      rgba: rgba.buffer,
    },
    [rgba.buffer]
  );
}

self.onmessage = async (event: MessageEvent<MapWorkerRequest>) => {
  const msg = event.data;
  try {
    if (msg.type === "load_map") {
      await handleLoadMap(msg.fileName, msg.fileBytes);
      return;
    }

    if (msg.type === "generate_satellite") {
      await handleGenerateSatellite(msg.mapName, msg.size);
      return;
    }
  } catch (err: unknown) {
    const message = err instanceof Error
      ? `${err.message}${err.stack ? `\n${err.stack}` : ""}`
      : "Неизвестная ошибка воркера";
    post({ type: "error", message });
  }
};

export {};
