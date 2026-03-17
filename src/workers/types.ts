export interface WorkerTerrainData {
  gridWidth: number;
  gridHeight: number;
  cellSize: number;
  mapSize: number;
  elevationMin: number;
  elevationMax: number;
  elevations: Float32Array;
}

export interface WorkerObjectsData {
  nObjects: number;
  nModels: number;
  classifications: Uint8Array;
  positions: Float32Array;
  scales: Float32Array;
  quaternions: Float32Array;
  modelIndices: Uint16Array;
}

export interface WorkerMapInfo {
  name: string;
  sourceType: "pbo" | "wrp";
  info: {
    version: number;
    layerSizeX: number;
    layerSizeY: number;
    mapSizeX: number;
    mapSizeY: number;
    cellSize: number;
    mapSizeMeters: number;
    elevationMin: number;
    elevationMax: number;
  };
  rvmatCount: number;
  objectCount: number;
  satelliteTiles: number;
}

export type LoadMapRequest = {
  type: "load_map";
  fileName: string;
  fileBytes: ArrayBuffer;
};

export type GenerateSatelliteRequest = {
  type: "generate_satellite";
  mapName: string;
  size?: number;
};

export type WorkerRequest = LoadMapRequest | GenerateSatelliteRequest;

export type WorkerProgressStage =
  | "read"
  | "parse_pbo"
  | "parse_wrp"
  | "prepare_terrain"
  | "prepare_objects"
  | "satellite"
  | "done";

export type WorkerProgressMessage = {
  type: "progress";
  mapName: string;
  stage: WorkerProgressStage;
  detail?: string;
  completed?: number;
  total?: number;
};

export type WorkerMapLoadedMessage = {
  type: "map_loaded";
  map: WorkerMapInfo;
  terrain: WorkerTerrainData;
  objects: WorkerObjectsData;
};

export type WorkerSatelliteReadyMessage = {
  type: "satellite_ready";
  mapName: string;
  width: number;
  height: number;
  rgba: ArrayBuffer;
};

export type WorkerErrorMessage = {
  type: "error";
  message: string;
};

export type WorkerResponse =
  | WorkerProgressMessage
  | WorkerMapLoadedMessage
  | WorkerSatelliteReadyMessage
  | WorkerErrorMessage;
