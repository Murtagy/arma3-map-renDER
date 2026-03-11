import * as THREE from "three";
import { FlyCamera } from "./fly-camera";
import { createTerrain, createWater, applySatelliteTexture, type TerrainData } from "./terrain";
import { parseObjectsBinary, createObjects } from "./objects";
import { PlanMode, type MarkColor } from "./plan-mode";

// --- Three.js Setup ---
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(window.devicePixelRatio);
renderer.setClearColor(0x87ceeb); // sky blue
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0x87ceeb, 5000, 30000);

const camera = new THREE.PerspectiveCamera(
  70,
  window.innerWidth / window.innerHeight,
  1,
  100000
);
(window as any).__camera = camera;
camera.position.set(0, 500, 0);

const flyCamera = new FlyCamera(camera, renderer.domElement);

// Lighting
const ambientLight = new THREE.AmbientLight(0x606080, 1.5);
scene.add(ambientLight);

const sunLight = new THREE.DirectionalLight(0xffeedd, 2.0);
sunLight.position.set(1, 0.8, 0.6).normalize().multiplyScalar(10000);
scene.add(sunLight);

// Ground reference grid (shown before map is loaded)
const gridHelper = new THREE.GridHelper(10000, 100, 0x444444, 0x333333);
scene.add(gridHelper);

// HUD
const hudEl = document.getElementById("hud")!;
const statusEl = document.getElementById("status")!;

// Plan Mode
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

  // Lines
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
    label.title = `${s.x.toFixed(0)},${s.z.toFixed(0)} → ${e.x.toFixed(0)},${e.z.toFixed(0)}`;
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

// Enter to confirm pending mark
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

// Minimap
const minimapCanvas = document.getElementById("minimap") as HTMLCanvasElement;
const minimapCtx = minimapCanvas.getContext("2d")!;
let minimapImage: HTMLImageElement | null = null;
let currentMapSize = 0;

// --- Map Loading ---
let currentTerrain: THREE.Group | null = null;
let currentWater: THREE.Mesh | null = null;
let currentObjects: THREE.Group | null = null;

async function loadMap(endpoint: string, filePath: string) {
  statusEl.textContent = `Loading ${filePath}...`;

  try {
    // Request server to parse the file
    const loadRes = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: filePath }),
    });

    if (!loadRes.ok) {
      const err = await loadRes.json();
      statusEl.textContent = `Error: ${err.error}\n${err.entries ? "Files in PBO:\n" + err.entries.join("\n") : ""}`;
      return;
    }

    const mapInfo = await loadRes.json();
    statusEl.textContent = `Loaded: ${mapInfo.name}\n${JSON.stringify(mapInfo.info, null, 2)}`;
    console.log("Map info:", mapInfo);

    // Fetch terrain elevation data
    statusEl.textContent += "\nFetching terrain data...";
    const terrainRes = await fetch(`/api/map/${mapInfo.name}/terrain`);
    if (!terrainRes.ok) {
      statusEl.textContent += "\nError fetching terrain data";
      return;
    }

    const gridWidth = parseInt(terrainRes.headers.get("X-Grid-Width")!);
    const gridHeight = parseInt(terrainRes.headers.get("X-Grid-Height")!);
    const cellSize = parseFloat(terrainRes.headers.get("X-Cell-Size")!);
    const mapSize = parseFloat(terrainRes.headers.get("X-Map-Size")!);
    const elevationMin = parseFloat(terrainRes.headers.get("X-Elevation-Min")!);
    const elevationMax = parseFloat(terrainRes.headers.get("X-Elevation-Max")!);

    const arrayBuf = await terrainRes.arrayBuffer();
    const elevations = new Float32Array(arrayBuf);

    const terrainData: TerrainData = {
      gridWidth,
      gridHeight,
      cellSize,
      mapSize,
      elevationMin,
      elevationMax,
      elevations,
    };

    statusEl.textContent += `\nTerrain: ${gridWidth}x${gridHeight}, cell ${cellSize}m`;
    statusEl.textContent += `\nElevation: ${elevationMin.toFixed(1)} to ${elevationMax.toFixed(1)}m`;
    statusEl.textContent += "\nBuilding mesh...";

    // Remove old terrain
    if (currentTerrain) scene.remove(currentTerrain);
    if (currentWater) scene.remove(currentWater);
    if (currentObjects) scene.remove(currentObjects);
    scene.remove(gridHelper);

    // Create terrain mesh
    currentTerrain = createTerrain(terrainData);
    scene.add(currentTerrain);
    planMode.setTerrain(currentTerrain);

    // Create water plane
    currentWater = createWater(mapSize);
    scene.add(currentWater);
    currentMapSize = mapSize;

    // Set terrain data for camera height clamping and line drawing
    const terrainInfoData = { elevations, gridWidth, gridHeight, cellSize, mapSize };
    flyCamera.terrain = terrainInfoData;
    planMode.setTerrainInfo(terrainInfoData);

    // Position camera at center of map, above terrain
    const centerX = mapSize / 2;
    const centerZ = mapSize / 2;
    const centerIdx =
      Math.floor(gridHeight / 2) * gridWidth + Math.floor(gridWidth / 2);
    const centerElev = elevations[centerIdx] || 100;
    camera.position.set(centerX, centerElev + 500, centerZ);

    // Fetch satellite texture
    if (mapInfo.satelliteTiles > 0) {
      statusEl.textContent += "\nFetching satellite texture...";
      try {
        const loader = new THREE.TextureLoader();
        const satTexture = await new Promise<THREE.Texture>((resolve, reject) => {
          loader.load(
            `/api/map/${mapInfo.name}/satellite?size=4096`,
            resolve,
            undefined,
            reject,
          );
        });
        applySatelliteTexture(currentTerrain!, satTexture);
        statusEl.textContent += "\nSatellite texture applied!";

        // Load satellite into minimap (reuse same cached image)
        const mmImg = new Image();
        mmImg.src = `/api/map/${mapInfo.name}/satellite?size=4096`;
        mmImg.onload = () => {
          minimapImage = mmImg;
          minimapCanvas.style.display = "block";
        };
      } catch (satErr: any) {
        console.error("Satellite texture error:", satErr);
        statusEl.textContent += `\nSatellite: ${satErr.message || "failed"}`;
      }
    }

    // Fetch and render placed objects
    statusEl.textContent += "\nFetching objects...";
    try {
      const objRes = await fetch(`/api/map/${mapInfo.name}/objects-bin`);
      if (objRes.ok) {
        const objBuf = await objRes.arrayBuffer();
        const objData = parseObjectsBinary(objBuf);
        statusEl.textContent += `\nPlacing ${objData.nObjects} objects...`;
        currentObjects = createObjects(objData);
        scene.add(currentObjects);
        statusEl.textContent += `\n${objData.nObjects} objects placed.`;
      }
    } catch (objErr: any) {
      console.error("Error loading objects:", objErr);
      statusEl.textContent += `\nObjects error: ${objErr.message}`;
    }

    // Show minimap even without satellite texture (green fallback)
    if (!minimapImage) {
      minimapCanvas.style.display = "block";
    }

    statusEl.textContent += "\nDone! Click viewport to fly.";
  } catch (err: any) {
    statusEl.textContent = `Error: ${err.message}`;
    console.error(err);
  }
}

// --- UI Bindings ---
document.getElementById("btn-load-pbo")!.addEventListener("click", () => {
  const filePath = (document.getElementById("file-path") as HTMLInputElement).value.trim();
  if (filePath) loadMap("/api/load-pbo", filePath);
});

document.getElementById("btn-load-wrp")!.addEventListener("click", () => {
  const filePath = (document.getElementById("file-path") as HTMLInputElement).value.trim();
  if (filePath) loadMap("/api/load-wrp", filePath);
});

// --- Maps folder scan + dropdown ---
const mapsFolderInput = document.getElementById("maps-folder") as HTMLInputElement;
const mapSelect = document.getElementById("map-select") as HTMLSelectElement;
const btnLoadMap = document.getElementById("btn-load-map") as HTMLButtonElement;
let scannedFiles: string[] = [];

// Restore saved folder from localStorage
const savedFolder = localStorage.getItem("arma3-maps-folder");
if (savedFolder) mapsFolderInput.value = savedFolder;

function extractMapName(filePath: string): string {
  const basename = filePath.split("/").pop()?.split("\\").pop() || filePath;
  return basename.replace(/\.(pbo|wrp)$/i, "");
}

function populateDropdown(files: string[]) {
  scannedFiles = files;
  mapSelect.innerHTML = "";
  if (files.length === 0) {
    mapSelect.innerHTML = '<option value="">-- no maps found --</option>';
    mapSelect.disabled = true;
    btnLoadMap.disabled = true;
    return;
  }
  for (const f of files) {
    const opt = document.createElement("option");
    opt.value = f;
    opt.textContent = extractMapName(f);
    mapSelect.appendChild(opt);
  }
  mapSelect.disabled = false;
  btnLoadMap.disabled = false;
}

async function scanFolder() {
  const dirPath = mapsFolderInput.value.trim();
  if (!dirPath) return;

  localStorage.setItem("arma3-maps-folder", dirPath);
  statusEl.textContent = `Scanning ${dirPath}...`;

  try {
    const res = await fetch("/api/scan-directory", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: dirPath }),
    });
    const data = await res.json();
    if (data.files?.length) {
      populateDropdown(data.files);
      statusEl.textContent = `Found ${data.files.length} maps.`;
    } else {
      populateDropdown([]);
      statusEl.textContent = "No PBO/WRP files found.";
    }
  } catch (err: any) {
    statusEl.textContent = `Scan error: ${err.message}`;
  }
}

document.getElementById("btn-scan")!.addEventListener("click", scanFolder);

btnLoadMap.addEventListener("click", () => {
  const filePath = mapSelect.value;
  if (!filePath) return;
  const isPbo = filePath.toLowerCase().endsWith(".pbo");
  loadMap(isPbo ? "/api/load-pbo" : "/api/load-wrp", filePath);
});

// Auto-scan on load if folder was saved
if (savedFolder) scanFolder();

// --- Auto-load from URL params ---
// Usage: http://localhost:5173/?pbo=/path/to/map.pbo
//    or: http://localhost:5173/?wrp=/path/to/map.wrp
const params = new URLSearchParams(window.location.search);
const autoPbo = params.get("pbo");
const autoWrp = params.get("wrp");
if (autoPbo) {
  (document.getElementById("file-path") as HTMLInputElement).value = autoPbo;
  loadMap("/api/load-pbo", autoPbo);
} else if (autoWrp) {
  (document.getElementById("file-path") as HTMLInputElement).value = autoWrp;
  loadMap("/api/load-wrp", autoWrp);
}

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

  // Camera position as fraction of map
  const px = Math.max(0, Math.min(1, camera.position.x / currentMapSize));
  const pz = Math.max(0, Math.min(1, camera.position.z / currentMapSize));
  // Three.js flipY=true means v=0 maps to image bottom, so on the terrain
  // z=0 (north) shows the bottom of the satellite image (tile row max).
  // The minimap draws the image normally (row 0 = top). To match the terrain,
  // we flip the Z axis on the minimap so camera z=0 maps to the bottom.
  const mx = px * size;
  const my = (1 - pz) * size;

  // Camera direction (projected onto XZ plane)
  // Minimap Y is flipped (1-pz), so world +Z = minimap down.
  // atan2(dx, dz) gives angle from +Z axis; cone draws with sin/cos where -cos = up.
  const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
  const angle = Math.atan2(dir.x, dir.z);

  // Draw view cone
  const coneLen = 25;
  const coneSpread = 0.5;
  minimapCtx.beginPath();
  minimapCtx.moveTo(mx, my);
  minimapCtx.lineTo(
    mx + Math.sin(angle - coneSpread) * coneLen,
    my - Math.cos(angle - coneSpread) * coneLen,
  );
  minimapCtx.lineTo(
    mx + Math.sin(angle + coneSpread) * coneLen,
    my - Math.cos(angle + coneSpread) * coneLen,
  );
  minimapCtx.closePath();
  minimapCtx.fillStyle = "rgba(255,255,255,0.2)";
  minimapCtx.fill();

  // Draw direction line
  const lineLen = 15;
  minimapCtx.beginPath();
  minimapCtx.moveTo(mx, my);
  minimapCtx.lineTo(mx + Math.sin(angle) * lineLen, my - Math.cos(angle) * lineLen);
  minimapCtx.strokeStyle = "#ff3333";
  minimapCtx.lineWidth = 2;
  minimapCtx.stroke();

  // Draw player dot
  minimapCtx.beginPath();
  minimapCtx.arc(mx, my, 4, 0, Math.PI * 2);
  minimapCtx.fillStyle = "#ff3333";
  minimapCtx.fill();
  minimapCtx.strokeStyle = "#fff";
  minimapCtx.lineWidth = 1.5;
  minimapCtx.stroke();

  // Draw plan marks on minimap
  for (const mark of planMode.marks) {
    const markPx = (mark.worldPos.x / currentMapSize) * size;
    const markPy = (1 - mark.worldPos.z / currentMapSize) * size;

    // Diamond shape
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

    // Label
    minimapCtx.font = "bold 9px monospace";
    minimapCtx.fillStyle = "#fff";
    minimapCtx.textAlign = "center";
    minimapCtx.fillText(mark.text, markPx, markPy - 8);
  }

  // Draw plan lines on minimap
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

// Click on minimap to teleport
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

  // Keep current height
  camera.position.set(worldX, camera.position.y, worldZ);
});

// Prevent pointer lock when clicking minimap or plan panel
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

// Handle resize
window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});
