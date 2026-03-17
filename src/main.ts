import * as THREE from "three";
import { FlyCamera } from "./fly-camera";
import { createTerrain, createWater, applySatelliteTexture, type TerrainData } from "./terrain";
import { createObjects } from "./objects";
import { PlanMode, type MarkColor } from "./plan-mode";
import type {
  WorkerMapLoadedMessage,
  WorkerProgressMessage,
  WorkerResponse,
  WorkerSatelliteReadyMessage,
  WorkerTerrainData,
  WorkerObjectsData,
} from "./workers/types";

// --- Three.js Setup ---
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(window.devicePixelRatio);
renderer.setClearColor(0x87ceeb);
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0x87ceeb, 5000, 30000);

const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 1, 100000);
(window as any).__camera = camera;
camera.position.set(0, 500, 0);

const flyCamera = new FlyCamera(camera, renderer.domElement);

const ambientLight = new THREE.AmbientLight(0x606080, 1.5);
scene.add(ambientLight);

const sunLight = new THREE.DirectionalLight(0xffeedd, 2.0);
sunLight.position.set(1, 0.8, 0.6).normalize().multiplyScalar(10000);
scene.add(sunLight);

const gridHelper = new THREE.GridHelper(10000, 100, 0x444444, 0x333333);
scene.add(gridHelper);

const hudEl = document.getElementById("hud")!;
const statusEl = document.getElementById("status")!;

function setStatus(text: string) {
  statusEl.textContent = text;
}

// --- Worker ---
const loaderWorker = new Worker(new URL("./workers/map-loader.worker.ts", import.meta.url), {
  type: "module",
});

// --- Plan Mode ---
const planMode = new PlanMode(scene, camera, renderer);
(window as any).__planMode = planMode;
const planToggle = document.getElementById("plan-toggle")!;
const planPanel = document.getElementById("plan-panel")!;
const planStatus = document.getElementById("plan-status")!;
const markListEl = document.getElementById("plan-mark-list")!;

const MARK_COLOR_CSS: Record<MarkColor, string> = {
  R: "#ff4444",
  G: "#44ff44",
  B: "#4488ff",
};

const markTextInput = document.getElementById("mark-text") as HTMLInputElement;
const markInputRow = document.querySelector(".plan-input-row") as HTMLElement;

function updatePlanUI() {
  markListEl.innerHTML = "";
  for (const mark of planMode.marks) {
    const item = document.createElement("div");
    item.className = "mark-item";
    item.style.borderLeftColor = MARK_COLOR_CSS[mark.color];

    const label = document.createElement("span");
    label.className = "mark-label";
    const pos = mark.worldPos;
    label.textContent = `${mark.text} (${pos.x.toFixed(0)}, ${pos.z.toFixed(0)})`;
    label.title = `${mark.text} at ${pos.x.toFixed(0)}, ${pos.y.toFixed(0)}, ${pos.z.toFixed(0)}`;
    item.appendChild(label);

    const moveBtn = document.createElement("button");
    moveBtn.textContent = "Move";
    moveBtn.addEventListener("click", () => {
      planMode.startMove(mark.id);
      updatePlanStatus();
    });
    item.appendChild(moveBtn);

    const delBtn = document.createElement("button");
    delBtn.className = "btn-del";
    delBtn.textContent = "Del";
    delBtn.addEventListener("click", () => {
      planMode.removeMark(mark.id);
    });
    item.appendChild(delBtn);

    markListEl.appendChild(item);
  }

  for (const line of planMode.lines) {
    const item = document.createElement("div");
    item.className = "mark-item";
    item.style.borderLeftColor = MARK_COLOR_CSS[line.color];

    const label = document.createElement("span");
    label.className = "mark-label";
    const s = line.start;
    const e = line.end;
    const dist = Math.sqrt((e.x - s.x) ** 2 + (e.z - s.z) ** 2);
    const typeLabel = line.lineType === "straight" ? "Straight" : "Ground";
    label.textContent = `${typeLabel} (${dist.toFixed(0)}m)`;
    label.title = `${s.x.toFixed(0)},${s.z.toFixed(0)} -> ${e.x.toFixed(0)},${e.z.toFixed(0)}`;
    item.appendChild(label);

    const delBtn = document.createElement("button");
    delBtn.className = "btn-del";
    delBtn.textContent = "Del";
    delBtn.addEventListener("click", () => {
      planMode.removeLine(line.id);
    });
    item.appendChild(delBtn);

    markListEl.appendChild(item);
  }

  updatePlanStatus();
}

function updatePlanStatus() {
  if (planMode.hasPending()) {
    planStatus.textContent = "Type mark name and press Enter (Esc to cancel)";
    markInputRow.style.display = "flex";
    markTextInput.focus();
  } else if (planMode.isMoving()) {
    const movingMark = planMode.marks.find((m) => m.id === planMode.getMovingId());
    planStatus.textContent = `Click terrain to move "${movingMark?.text}"`;
    markInputRow.style.display = "none";
  } else {
    planStatus.textContent = "Double-click: mark | Click+drag: line";
    markInputRow.style.display = "none";
  }
}

planMode.onMarksChanged = updatePlanUI;
planMode.onPendingChanged = () => updatePlanStatus();

markTextInput.addEventListener("keydown", (e) => {
  if (e.code === "Enter") {
    e.preventDefault();
    const text = markTextInput.value.trim();
    if (text && planMode.hasPending()) {
      planMode.confirmPending(text);
      markTextInput.value = "";
    }
  }
  if (e.code === "Escape") {
    planMode.cancelPending();
    markTextInput.value = "";
  }
});

function togglePlanMode() {
  planMode.toggle();
  planToggle.classList.toggle("active", planMode.active);
  planPanel.style.display = planMode.active ? "block" : "none";
  if (planMode.active && document.pointerLockElement) {
    document.exitPointerLock();
  }
  updatePlanUI();
}

planToggle.addEventListener("click", (e) => {
  e.stopPropagation();
  togglePlanMode();
});

document.addEventListener("keydown", (e) => {
  if (e.code === "KeyP" && !e.ctrlKey && !e.metaKey && !(e.target instanceof HTMLInputElement)) {
    togglePlanMode();
  }
  if (e.code === "Escape" && planMode.active && !planMode.hasPending() && planMode.isMoving()) {
    planMode.cancelMove();
    updatePlanUI();
  }
});

// --- Minimap ---
const minimapCanvas = document.getElementById("minimap") as HTMLCanvasElement;
const minimapCtx = minimapCanvas.getContext("2d")!;
let minimapImage: CanvasImageSource | null = null;
let currentMapSize = 0;

// --- Map State ---
let currentTerrain: THREE.Group | null = null;
let currentWater: THREE.Mesh | null = null;
let currentObjects: THREE.Group | null = null;
let currentMapName: string | null = null;
let isLoading = false;

const pendingAutoMap = new URLSearchParams(window.location.search).get("map")?.toLowerCase() ?? null;
const legacyPboParam = new URLSearchParams(window.location.search).get("pbo");
const legacyWrpParam = new URLSearchParams(window.location.search).get("wrp");

if (legacyPboParam || legacyWrpParam) {
  setStatus("Legacy ?pbo= and ?wrp= links are not supported in static mode. Use ?map=<name> and pick a folder.");
}

interface MapFileEntry {
  id: string;
  mapName: string;
  file: File;
  relativePath: string;
}

let mapFiles: MapFileEntry[] = [];

function extractMapName(name: string): string {
  const file = name.split("/").pop()?.split("\\").pop() ?? name;
  return file.replace(/\.(pbo|wrp)$/i, "");
}

function updateUrlMapParam(mapName: string) {
  const url = new URL(window.location.href);
  url.searchParams.set("map", mapName);
  url.searchParams.delete("pbo");
  url.searchParams.delete("wrp");
  history.replaceState(null, "", url);
}

function clearCurrentMap() {
  minimapImage = null;
  if (currentTerrain) scene.remove(currentTerrain);
  if (currentWater) scene.remove(currentWater);
  if (currentObjects) scene.remove(currentObjects);
  scene.remove(gridHelper);
}

function applyLoadedMap(
  mapName: string,
  terrainData: WorkerTerrainData,
  objectsData: WorkerObjectsData,
  satelliteTiles: number
) {
  clearCurrentMap();

  const terrainInput: TerrainData = {
    gridWidth: terrainData.gridWidth,
    gridHeight: terrainData.gridHeight,
    cellSize: terrainData.cellSize,
    mapSize: terrainData.mapSize,
    elevationMin: terrainData.elevationMin,
    elevationMax: terrainData.elevationMax,
    elevations: terrainData.elevations,
  };

  currentTerrain = createTerrain(terrainInput);
  scene.add(currentTerrain);
  planMode.setTerrain(currentTerrain);

  currentWater = createWater(terrainData.mapSize);
  scene.add(currentWater);
  currentMapSize = terrainData.mapSize;

  const terrainInfoData = {
    elevations: terrainData.elevations,
    gridWidth: terrainData.gridWidth,
    gridHeight: terrainData.gridHeight,
    cellSize: terrainData.cellSize,
    mapSize: terrainData.mapSize,
  };
  flyCamera.terrain = terrainInfoData;
  planMode.setTerrainInfo(terrainInfoData);

  const centerX = terrainData.mapSize / 2;
  const centerZ = terrainData.mapSize / 2;
  const centerIdx =
    Math.floor(terrainData.gridHeight / 2) * terrainData.gridWidth + Math.floor(terrainData.gridWidth / 2);
  const centerElev = terrainData.elevations[centerIdx] || 100;
  camera.position.set(centerX, centerElev + 500, centerZ);

  currentObjects = createObjects(objectsData);
  scene.add(currentObjects);

  currentMapName = mapName;
  minimapCanvas.style.display = "block";
  updateUrlMapParam(mapName);

  setStatus(
    [
      `Loaded ${mapName}`,
      `Terrain: ${terrainData.gridWidth}x${terrainData.gridHeight}, cell ${terrainData.cellSize.toFixed(2)}m`,
      `Elevation: ${terrainData.elevationMin.toFixed(1)} to ${terrainData.elevationMax.toFixed(1)}m`,
      `Objects: ${objectsData.nObjects}`,
      satelliteTiles > 0
        ? `Satellite tiles: ${satelliteTiles} (generating texture...)`
        : "No satellite tiles in this map",
    ].join("\n")
  );
}

function handleWorkerProgress(msg: WorkerProgressMessage) {
  const progressText =
    typeof msg.completed === "number" && typeof msg.total === "number"
      ? ` (${msg.completed}/${msg.total})`
      : "";
  setStatus(`Loading ${msg.mapName}: ${msg.stage}${progressText}${msg.detail ? `\n${msg.detail}` : ""}`);
}

function handleSatelliteReady(msg: WorkerSatelliteReadyMessage) {
  if (!currentTerrain || !currentMapName || msg.mapName !== currentMapName) return;

  const rgba = new Uint8ClampedArray(msg.rgba);
  const canvas = document.createElement("canvas");
  canvas.width = msg.width;
  canvas.height = msg.height;
  const ctx = canvas.getContext("2d")!;
  ctx.putImageData(new ImageData(rgba, msg.width, msg.height), 0, 0);

  minimapImage = canvas;

  const texture = new THREE.CanvasTexture(canvas);
  applySatelliteTexture(currentTerrain, texture);

  setStatus(`${statusEl.textContent}\nSatellite texture applied (${msg.width}x${msg.height}).`);
}

loaderWorker.onmessage = (event: MessageEvent<WorkerResponse>) => {
  const msg = event.data;

  if (msg.type === "progress") {
    handleWorkerProgress(msg);
    return;
  }

  if (msg.type === "error") {
    isLoading = false;
    setStatus(`Error: ${msg.message}`);
    return;
  }

  if (msg.type === "map_loaded") {
    const data = msg as WorkerMapLoadedMessage;
    isLoading = false;
    applyLoadedMap(data.map.name, data.terrain, data.objects, data.map.satelliteTiles);
    if (data.map.satelliteTiles > 0) {
      loaderWorker.postMessage({
        type: "generate_satellite",
        mapName: data.map.name,
        size: 4096,
      });
    }
    return;
  }

  if (msg.type === "satellite_ready") {
    handleSatelliteReady(msg);
  }
};

function setMaps(files: File[]) {
  mapFiles = files
    .filter((file) => /\.(pbo|wrp)$/i.test(file.name))
    .map((file, index) => {
      const relativePath = (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name;
      return {
        id: `${index}:${relativePath}`,
        mapName: extractMapName(file.name),
        file,
        relativePath,
      };
    })
    .sort((a, b) => a.mapName.localeCompare(b.mapName));

  const mapSelect = document.getElementById("map-select") as HTMLSelectElement;
  const btnLoadMap = document.getElementById("btn-load-map") as HTMLButtonElement;

  mapSelect.innerHTML = "";
  if (mapFiles.length === 0) {
    mapSelect.innerHTML = '<option value="">-- no maps found --</option>';
    mapSelect.disabled = true;
    btnLoadMap.disabled = true;
    setStatus("No .pbo/.wrp files found in the selected files.");
    return;
  }

  for (const entry of mapFiles) {
    const opt = document.createElement("option");
    opt.value = entry.id;
    opt.textContent = entry.mapName;
    opt.title = entry.relativePath;
    mapSelect.appendChild(opt);
  }

  mapSelect.disabled = false;
  btnLoadMap.disabled = false;

  const autoTarget = pendingAutoMap;
  if (autoTarget) {
    const matched = mapFiles.find((entry) => entry.mapName.toLowerCase() === autoTarget);
    if (matched) {
      mapSelect.value = matched.id;
      void loadMapFile(matched.file, matched.relativePath);
      return;
    }
    setStatus(`Found ${mapFiles.length} maps. Auto-load target "${autoTarget}" not found.`);
    return;
  }

  setStatus(`Found ${mapFiles.length} maps. Select one and click Load Map.`);
}

async function loadMapFile(file: File, displayName: string) {
  if (isLoading) return;
  isLoading = true;

  setStatus(`Reading ${displayName}...`);
  const buffer = await file.arrayBuffer();

  loaderWorker.postMessage(
    {
      type: "load_map",
      fileName: displayName,
      fileBytes: buffer,
    },
    [buffer]
  );
}

// --- UI Bindings ---
const mapSelect = document.getElementById("map-select") as HTMLSelectElement;
const btnLoadMap = document.getElementById("btn-load-map") as HTMLButtonElement;
const btnPickFolder = document.getElementById("btn-pick-folder") as HTMLButtonElement;
const btnPickFiles = document.getElementById("btn-pick-files") as HTMLButtonElement;
const folderInput = document.getElementById("folder-picker") as HTMLInputElement;
const filesInput = document.getElementById("file-picker") as HTMLInputElement;

btnPickFolder.addEventListener("click", () => {
  folderInput.value = "";
  folderInput.click();
});

btnPickFiles.addEventListener("click", () => {
  filesInput.value = "";
  filesInput.click();
});

folderInput.addEventListener("change", () => {
  const files = Array.from(folderInput.files || []);
  setMaps(files);
});

filesInput.addEventListener("change", () => {
  const files = Array.from(filesInput.files || []);
  setMaps(files);
});

btnLoadMap.addEventListener("click", () => {
  const selected = mapFiles.find((entry) => entry.id === mapSelect.value);
  if (!selected) return;
  void loadMapFile(selected.file, selected.relativePath);
});

// --- Render Loop ---
const clock = new THREE.Clock();

function updateMinimap() {
  if (!currentMapSize) return;
  const size = minimapCanvas.width;
  if (minimapImage) {
    minimapCtx.drawImage(minimapImage, 0, 0, size, size);
  } else {
    minimapCtx.fillStyle = "#2a3a2a";
    minimapCtx.fillRect(0, 0, size, size);
  }

  const px = Math.max(0, Math.min(1, camera.position.x / currentMapSize));
  const pz = Math.max(0, Math.min(1, camera.position.z / currentMapSize));
  const mx = px * size;
  const my = (1 - pz) * size;

  const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
  const angle = Math.atan2(dir.x, dir.z);

  const coneLen = 25;
  const coneSpread = 0.5;
  minimapCtx.beginPath();
  minimapCtx.moveTo(mx, my);
  minimapCtx.lineTo(mx + Math.sin(angle - coneSpread) * coneLen, my - Math.cos(angle - coneSpread) * coneLen);
  minimapCtx.lineTo(mx + Math.sin(angle + coneSpread) * coneLen, my - Math.cos(angle + coneSpread) * coneLen);
  minimapCtx.closePath();
  minimapCtx.fillStyle = "rgba(255,255,255,0.2)";
  minimapCtx.fill();

  const lineLen = 15;
  minimapCtx.beginPath();
  minimapCtx.moveTo(mx, my);
  minimapCtx.lineTo(mx + Math.sin(angle) * lineLen, my - Math.cos(angle) * lineLen);
  minimapCtx.strokeStyle = "#ff3333";
  minimapCtx.lineWidth = 2;
  minimapCtx.stroke();

  minimapCtx.beginPath();
  minimapCtx.arc(mx, my, 4, 0, Math.PI * 2);
  minimapCtx.fillStyle = "#ff3333";
  minimapCtx.fill();
  minimapCtx.strokeStyle = "#fff";
  minimapCtx.lineWidth = 1.5;
  minimapCtx.stroke();

  for (const mark of planMode.marks) {
    const markPx = (mark.worldPos.x / currentMapSize) * size;
    const markPy = (1 - mark.worldPos.z / currentMapSize) * size;

    minimapCtx.beginPath();
    minimapCtx.moveTo(markPx, markPy - 5);
    minimapCtx.lineTo(markPx + 4, markPy);
    minimapCtx.lineTo(markPx, markPy + 5);
    minimapCtx.lineTo(markPx - 4, markPy);
    minimapCtx.closePath();
    minimapCtx.fillStyle = MARK_COLOR_CSS[mark.color];
    minimapCtx.fill();
    minimapCtx.strokeStyle = "#fff";
    minimapCtx.lineWidth = 1;
    minimapCtx.stroke();

    minimapCtx.font = "bold 9px monospace";
    minimapCtx.fillStyle = "#fff";
    minimapCtx.textAlign = "center";
    minimapCtx.fillText(mark.text, markPx, markPy - 8);
  }

  for (const line of planMode.lines) {
    const sx = (line.start.x / currentMapSize) * size;
    const sy = (1 - line.start.z / currentMapSize) * size;
    const ex = (line.end.x / currentMapSize) * size;
    const ey = (1 - line.end.z / currentMapSize) * size;

    minimapCtx.beginPath();
    minimapCtx.moveTo(sx, sy);
    minimapCtx.lineTo(ex, ey);
    minimapCtx.strokeStyle = MARK_COLOR_CSS[line.color];
    minimapCtx.lineWidth = 2;
    minimapCtx.stroke();
  }
}

minimapCanvas.addEventListener("click", (e) => {
  if (!currentMapSize) return;
  const rect = minimapCanvas.getBoundingClientRect();
  const scaleX = minimapCanvas.width / rect.width;
  const scaleY = minimapCanvas.height / rect.height;
  const cx = (e.clientX - rect.left) * scaleX;
  const cy = (e.clientY - rect.top) * scaleY;
  const size = minimapCanvas.width;

  const worldX = (cx / size) * currentMapSize;
  const worldZ = (1 - cy / size) * currentMapSize;
  camera.position.set(worldX, camera.position.y, worldZ);
});

minimapCanvas.addEventListener("mousedown", (e) => {
  e.stopPropagation();
});
planPanel.addEventListener("mousedown", (e) => {
  e.stopPropagation();
});
planToggle.addEventListener("mousedown", (e) => {
  e.stopPropagation();
});

function animate() {
  requestAnimationFrame(animate);
  const dt = clock.getDelta();
  flyCamera.update(dt);
  hudEl.textContent = flyCamera.getInfo();
  renderer.render(scene, camera);
  updateMinimap();
}

animate();

window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

setStatus("Pick a folder with map files (or pick files) to start.");
