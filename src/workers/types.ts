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

export type MapWorkerRequest = LoadMapRequest | GenerateSatelliteRequest;

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

export type MapWorkerResponse =
  | WorkerProgressMessage
  | WorkerMapLoadedMessage
  | WorkerSatelliteReadyMessage
  | WorkerErrorMessage;

export interface ReplayListItem {
  name: string;
  archive: number;
  fileSize: number;
  tags: string[];
  serverTag: string;
  mapKey: string;
  missionName: string;
  missionDate: string;
}

export interface ReplayHeader {
  mapKey: string;
  missionName: string;
  recordedAt: string;
  missionDateParts: number[];
  stepSec: number;
  initialMarkers: unknown[];
}

export type ReplayUnitKind = "unit" | "vehicle";

export interface ReplayUnitDef {
  id: number;
  kind: ReplayUnitKind;
  name: string;
  playerName: string;
  model: string;
  side: number;
  unitType: string;
  group: string;
  slot: string;
  steamId: string;
}

export interface ReplayKillEvent {
  type: 4;
  frame: number;
  timeSec: number;
  killerId: number;
  victimId: number;
  weapon: string;
  ammo: string;
  distance: number;
}

export interface ReplayHitEvent {
  type: 5;
  frame: number;
  timeSec: number;
  sourceId: number;
  targetId: number;
  weapon: string;
  ammo: string;
  distance: number;
  damage: number;
  fatal: boolean;
  projectile: string;
}

export interface ReplayMessageEvent {
  type: 0;
  frame: number;
  timeSec: number;
  message: string;
}

export interface ReplayMedicalEvent {
  type: 7;
  frame: number;
  timeSec: number;
  actorId: number;
  targetId: number;
  action: string;
  amount: number;
  success: boolean;
  canCancel: boolean;
}

export interface ReplayRawEvent {
  type: -1;
  eventType: number;
  frame: number;
  timeSec: number;
  raw: unknown[];
}

export type ReplayTimelineEvent =
  | ReplayKillEvent
  | ReplayHitEvent
  | ReplayMessageEvent
  | ReplayMedicalEvent
  | ReplayRawEvent;

export interface ReplayData {
  replayName: string;
  archive: number;
  source: "direct" | "proxy";
  header: ReplayHeader;
  units: ReplayUnitDef[];
  frameTimes: Uint32Array;
  frameStateOffsets: Uint32Array;
  frameStateCounts: Uint32Array;
  stateStride: 7;
  stateData: Float32Array;
  frameEventOffsets: Uint32Array;
  frameEventCounts: Uint32Array;
  events: ReplayTimelineEvent[];
}

export type LoadReplayListRequest = {
  type: "load_replay_list";
  filters?: string[];
  proxyUrl?: string;
};

export type LoadReplayDetailRequest = {
  type: "load_replay_detail";
  replayName: string;
  archive?: number;
  proxyUrl?: string;
};

export type ReplayWorkerRequest = LoadReplayListRequest | LoadReplayDetailRequest;

export type ReplayListLoadedMessage = {
  type: "replay_list_loaded";
  rows: ReplayListItem[];
  source: "direct" | "proxy";
};

export type ReplayParsedMessage = {
  type: "replay_parsed";
  replay: ReplayData;
};

export type ReplayProgressMessage = {
  type: "replay_progress";
  stage: "fetch_list" | "fetch_replay" | "parse_replay";
  detail?: string;
};

export type ReplayWorkerResponse =
  | ReplayListLoadedMessage
  | ReplayParsedMessage
  | ReplayProgressMessage
  | WorkerErrorMessage;
