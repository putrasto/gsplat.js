import * as SPLAT from "gsplat";
import "./style.css";
import {
    type PlyFileMeta,
    fetchFiles,
    uploadFiles,
    updateDescription,
    deleteFile,
    fileDataUrl,
} from "./api";

const viewer = document.getElementById("viewer") as HTMLDivElement;
const fileInput = document.getElementById("file-input") as HTMLInputElement;
const addFilesButton = document.getElementById("add-files-button") as HTMLButtonElement;
const deleteFileButton = document.getElementById("delete-file-button") as HTMLButtonElement;
const autoPositionButton = document.getElementById("auto-position-button") as HTMLButtonElement;
const orbitSideButton = document.getElementById("orbit-side-button") as HTMLButtonElement;
const cameraAidButton = document.getElementById("camera-aid-button") as HTMLButtonElement;
const centroidAxesButton = document.getElementById("centroid-axes-button") as HTMLButtonElement;
const fileList = document.getElementById("file-list") as HTMLUListElement;
const descriptionInput = document.getElementById("description-input") as HTMLInputElement;
const statusText = document.getElementById("status-text") as HTMLParagraphElement;
const loadProgress = document.getElementById("load-progress") as HTMLProgressElement;
const fovXInput = document.getElementById("fovx-input") as HTMLInputElement;
const fovYInput = document.getElementById("fovy-input") as HTMLInputElement;

const renderer = new SPLAT.WebGLRenderer();
viewer.appendChild(renderer.canvas);
const cameraAidCanvas = document.createElement("canvas");
cameraAidCanvas.className = "camera-aid-overlay";
viewer.appendChild(cameraAidCanvas);
const cameraAidCtx = cameraAidCanvas.getContext("2d");

const scene = new SPLAT.Scene();
const camera = new SPLAT.Camera();
let controls = new SPLAT.OrbitControls(camera, renderer.canvas);
// Nerfstudio/viser-style axis remap for splats:
// (x, y, z) -> (x, -z, y), equivalent to +90 deg around X.
const viserWorldToThreeRotation = SPLAT.Quaternion.FromAxisAngle(
    new SPLAT.Vector3(1, 0, 0),
    Math.PI / 2,
);
const viserOrbitAlpha = (3 * Math.PI) / 4;
const viserOrbitBetaMagnitude = Math.atan(1 / Math.sqrt(2));
const PER_FILE_UI_SETTINGS_KEY = "ply-file-manager:per-file-ui-settings:v1";
const DEFAULT_UI_SETTINGS: { orbitTop: boolean; cameraAid: boolean; centroidAxes: boolean } = {
    orbitTop: true,
    cameraAid: true,
    centroidAxes: true,
};

type PerFileUiSettings = {
    orbitTop?: boolean;
    cameraAid?: boolean;
    centroidAxes?: boolean;
};

let managedFiles: PlyFileMeta[] = [];
const plyFormat = "";

let selectedId: string | null = null;
let isLoading = false;
let queuedSelectionId: string | null = null;
let resetAfterLoad = false;
let currentSplat: SPLAT.Splat | null = null;
let autoOrbitFromTop = DEFAULT_UI_SETTINGS.orbitTop;
let showCameraAid = DEFAULT_UI_SETTINGS.cameraAid;
let showCentroidAxes = DEFAULT_UI_SETTINGS.centroidAxes;
let currentOrbitTarget: SPLAT.Vector3 | null = null;
let currentAidAxisLength = 1;
let perFileUiSettings: Record<string, PerFileUiSettings> = loadPerFileUiSettings();
let fovXDeg = focalPixelsToFovDeg(camera.data.fx, camera.data.width);
let fovYDeg = focalPixelsToFovDeg(camera.data.fy, camera.data.height);

let descriptionTimer: ReturnType<typeof setTimeout> | null = null;

function setStatus(message: string): void {
    statusText.textContent = message;
}

function clampFovDeg(value: number): number {
    return Math.min(Math.max(value, 1), 179);
}

function focalPixelsToFovDeg(focalPixels: number, imagePixels: number): number {
    const focal = Math.max(focalPixels, 1e-6);
    const imageSize = Math.max(imagePixels, 1);
    const fovRad = 2 * Math.atan(imageSize / (2 * focal));
    return clampFovDeg((fovRad * 180) / Math.PI);
}

function fovDegToFocalPixels(fovDeg: number, imagePixels: number): number {
    const clampedFov = clampFovDeg(fovDeg);
    const halfAngle = (clampedFov * Math.PI) / 360;
    const imageSize = Math.max(imagePixels, 1);
    return imageSize / (2 * Math.tan(halfAngle));
}

function getRenderSize(): { width: number; height: number } {
    const width = Math.max(1, renderer.canvas.width || viewer.clientWidth || camera.data.width);
    const height = Math.max(1, renderer.canvas.height || viewer.clientHeight || camera.data.height);
    return { width, height };
}

function applyCurrentFovToCamera(): void {
    const { width, height } = getRenderSize();
    camera.data.fx = fovDegToFocalPixels(fovXDeg, width);
    camera.data.fy = fovDegToFocalPixels(fovYDeg, height);
    camera.update();
}

function syncFovInputs(): void {
    fovXInput.value = fovXDeg.toFixed(2);
    fovYInput.value = fovYDeg.toFixed(2);
}

function commitFovInput(axis: "x" | "y"): void {
    const input = axis === "x" ? fovXInput : fovYInput;
    const parsed = Number.parseFloat(input.value);
    if (!Number.isFinite(parsed)) {
        syncFovInputs();
        return;
    }

    if (axis === "x") {
        fovXDeg = clampFovDeg(parsed);
    } else {
        fovYDeg = clampFovDeg(parsed);
    }

    syncFovInputs();
    applyCurrentFovToCamera();
    drawCameraAid();
}

function getFileById(id: string | null): PlyFileMeta | undefined {
    if (id === null) return undefined;
    return managedFiles.find((entry) => entry.id === id);
}

function getSelectedFile(): PlyFileMeta | undefined {
    return getFileById(selectedId);
}

function loadPerFileUiSettings(): Record<string, PerFileUiSettings> {
    try {
        const raw = window.localStorage.getItem(PER_FILE_UI_SETTINGS_KEY);
        if (raw === null) return {};

        const parsed = JSON.parse(raw);
        if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {};

        const normalized: Record<string, PerFileUiSettings> = {};
        for (const [id, value] of Object.entries(parsed as Record<string, unknown>)) {
            if (typeof value !== "object" || value === null || Array.isArray(value)) continue;
            const entry = value as Record<string, unknown>;
            normalized[id] = {
                orbitTop: typeof entry.orbitTop === "boolean" ? entry.orbitTop : undefined,
                cameraAid: typeof entry.cameraAid === "boolean" ? entry.cameraAid : undefined,
                centroidAxes: typeof entry.centroidAxes === "boolean" ? entry.centroidAxes : undefined,
            };
        }
        return normalized;
    } catch (error) {
        console.warn("Failed to load per-file UI settings.", error);
        return {};
    }
}

function savePerFileUiSettings(): void {
    try {
        window.localStorage.setItem(PER_FILE_UI_SETTINGS_KEY, JSON.stringify(perFileUiSettings));
    } catch (error) {
        console.warn("Failed to save per-file UI settings.", error);
    }
}

function applyPerFileUiSettings(id: string | null): void {
    const settings = id === null ? undefined : perFileUiSettings[id];
    autoOrbitFromTop = settings?.orbitTop ?? DEFAULT_UI_SETTINGS.orbitTop;
    showCameraAid = settings?.cameraAid ?? DEFAULT_UI_SETTINGS.cameraAid;
    showCentroidAxes = settings?.centroidAxes ?? DEFAULT_UI_SETTINGS.centroidAxes;
    updateOrbitSideButtonLabel();
    updateCameraAidButtonLabel();
    updateCentroidAxesButtonLabel();
    drawCameraAid();
}

function persistSelectedFileUiSettings(): void {
    if (selectedId === null) return;
    perFileUiSettings[selectedId] = {
        orbitTop: autoOrbitFromTop,
        cameraAid: showCameraAid,
        centroidAxes: showCentroidAxes,
    };
    savePerFileUiSettings();
}

function updateDescriptionEditor(): void {
    const selectedFile = getSelectedFile();
    if (selectedFile === undefined) {
        descriptionInput.value = "";
        descriptionInput.placeholder = "Select a file first";
        descriptionInput.disabled = true;
        return;
    }

    descriptionInput.disabled = false;
    descriptionInput.placeholder = "Short description";
    descriptionInput.value = selectedFile.description;
}

function renderFileList(): void {
    fileList.innerHTML = "";

    for (const entry of managedFiles) {
        const item = document.createElement("li");
        item.className = "file-item";
        if (entry.id === selectedId) {
            item.classList.add("selected");
        }

        const button = document.createElement("button");
        button.type = "button";
        button.className = "file-entry";

        const description = document.createElement("span");
        description.className = "file-description";
        description.textContent = entry.description.trim() === "" ? "(no description)" : entry.description;

        const name = document.createElement("span");
        name.className = "file-name";
        name.textContent = entry.filename;

        button.append(description, name);
        button.addEventListener("click", () => {
            void selectAndRender(entry.id);
        });

        item.appendChild(button);
        fileList.appendChild(item);
    }

    updateActionButtons();
}

function updateActionButtons(): void {
    deleteFileButton.disabled = selectedId === null || isLoading;
    autoPositionButton.disabled = selectedId === null || isLoading || currentSplat === null;
    orbitSideButton.disabled = selectedId === null || isLoading || currentSplat === null;
    cameraAidButton.disabled = selectedId === null || isLoading || currentOrbitTarget === null;
    centroidAxesButton.disabled = selectedId === null || isLoading || currentOrbitTarget === null;
}

function updateOrbitSideButtonLabel(): void {
    orbitSideButton.textContent = autoOrbitFromTop ? "Orbit: Top" : "Orbit: Bottom";
}

function updateCameraAidButtonLabel(): void {
    cameraAidButton.textContent = showCameraAid ? "Camera Aid: On" : "Camera Aid: Off";
}

function updateCentroidAxesButtonLabel(): void {
    centroidAxesButton.textContent = showCentroidAxes ? "Centroid Axes: On" : "Centroid Axes: Off";
}

function resizeCameraAidCanvas(): { width: number; height: number } {
    const width = Math.max(1, viewer.clientWidth);
    const height = Math.max(1, viewer.clientHeight);
    const dpr = Math.max(1, window.devicePixelRatio || 1);

    const deviceWidth = Math.floor(width * dpr);
    const deviceHeight = Math.floor(height * dpr);
    if (cameraAidCanvas.width !== deviceWidth) cameraAidCanvas.width = deviceWidth;
    if (cameraAidCanvas.height !== deviceHeight) cameraAidCanvas.height = deviceHeight;

    cameraAidCanvas.style.width = `${width}px`;
    cameraAidCanvas.style.height = `${height}px`;
    cameraAidCtx?.setTransform(dpr, 0, 0, dpr, 0, 0);

    return { width, height };
}

function drawCameraAid(): void {
    if (cameraAidCtx === null) return;
    const { width, height } = resizeCameraAidCanvas();
    cameraAidCtx.clearRect(0, 0, width, height);

    if (!showCameraAid || currentOrbitTarget === null) return;

    const target = currentOrbitTarget;
    const camPos = camera.position;
    const relative = camPos.subtract(target);
    const horizontalDistance = Math.hypot(relative.x, relative.z);
    const distance = relative.magnitude();
    const elevationDeg = Math.atan2(relative.y, Math.max(horizontalDistance, 1e-6)) * 180 / Math.PI;

    const panelSize = Math.min(170, Math.max(120, Math.floor(Math.min(width, height) * 0.26)));
    const panelRadius = panelSize * 0.42;
    const panelPadding = 14;
    const panelX = width - panelSize - panelPadding;
    const panelY = panelPadding;
    const centerX = panelX + panelSize * 0.5;
    const centerY = panelY + panelSize * 0.5;

    const range = Math.max(horizontalDistance * 1.25, 1);
    const camX = centerX + (relative.x / range) * panelRadius;
    const camY = centerY + (relative.z / range) * panelRadius;

    cameraAidCtx.fillStyle = "rgba(15, 23, 42, 0.45)";
    cameraAidCtx.strokeStyle = "rgba(148, 163, 184, 0.55)";
    cameraAidCtx.lineWidth = 1;
    cameraAidCtx.beginPath();
    cameraAidCtx.roundRect(panelX, panelY, panelSize, panelSize + 34, 10);
    cameraAidCtx.fill();
    cameraAidCtx.stroke();

    cameraAidCtx.strokeStyle = "rgba(148, 163, 184, 0.7)";
    cameraAidCtx.beginPath();
    cameraAidCtx.arc(centerX, centerY, panelRadius, 0, Math.PI * 2);
    cameraAidCtx.stroke();

    cameraAidCtx.strokeStyle = "rgba(148, 163, 184, 0.35)";
    cameraAidCtx.beginPath();
    cameraAidCtx.moveTo(centerX - panelRadius, centerY);
    cameraAidCtx.lineTo(centerX + panelRadius, centerY);
    cameraAidCtx.moveTo(centerX, centerY - panelRadius);
    cameraAidCtx.lineTo(centerX, centerY + panelRadius);
    cameraAidCtx.stroke();

    cameraAidCtx.strokeStyle = "rgba(56, 189, 248, 0.95)";
    cameraAidCtx.lineWidth = 2;
    cameraAidCtx.beginPath();
    cameraAidCtx.moveTo(camX, camY);
    cameraAidCtx.lineTo(centerX, centerY);
    cameraAidCtx.stroke();

    const lineDx = centerX - camX;
    const lineDy = centerY - camY;
    const lineLen = Math.max(Math.hypot(lineDx, lineDy), 1e-6);
    const dirX = lineDx / lineLen;
    const dirY = lineDy / lineLen;
    const perpX = -dirY;
    const perpY = dirX;

    cameraAidCtx.fillStyle = "rgba(251, 146, 60, 0.95)";
    cameraAidCtx.beginPath();
    cameraAidCtx.moveTo(camX + dirX * 10, camY + dirY * 10);
    cameraAidCtx.lineTo(camX - dirX * 6 + perpX * 5, camY - dirY * 6 + perpY * 5);
    cameraAidCtx.lineTo(camX - dirX * 6 - perpX * 5, camY - dirY * 6 - perpY * 5);
    cameraAidCtx.closePath();
    cameraAidCtx.fill();

    cameraAidCtx.fillStyle = "rgba(34, 197, 94, 0.95)";
    cameraAidCtx.beginPath();
    cameraAidCtx.arc(centerX, centerY, 4, 0, Math.PI * 2);
    cameraAidCtx.fill();

    cameraAidCtx.fillStyle = "rgba(241, 245, 249, 0.95)";
    cameraAidCtx.font = '11px "Segoe UI", Tahoma, sans-serif';
    cameraAidCtx.fillText(`dist ${distance.toFixed(2)}`, panelX + 9, panelY + panelSize + 15);
    cameraAidCtx.fillText(`elev ${elevationDeg >= 0 ? "+" : ""}${elevationDeg.toFixed(1)} deg`, panelX + 9, panelY + panelSize + 29);

    const projectWorldToScreen = (point: SPLAT.Vector3) => {
        const clip = new SPLAT.Vector4(point.x, point.y, point.z, 1).multiply(camera.data.viewProj);
        if (Math.abs(clip.w) < 1e-6) return null;

        const ndcX = clip.x / clip.w;
        const ndcY = clip.y / clip.w;
        const ndcZ = clip.z / clip.w;
        const inFront = clip.w > 0;
        if (!inFront || ndcZ < -1.5 || ndcZ > 1.5) return null;

        return {
            x: (ndcX * 0.5 + 0.5) * width,
            y: (1 - (ndcY * 0.5 + 0.5)) * height,
        };
    };

    const centroid = currentOrbitTarget;
    const axisLen = Math.max(currentAidAxisLength, 0.05);
    const origin2D = projectWorldToScreen(centroid);
    if (origin2D === null) return;

    if (!showCentroidAxes) return;

    const xEnd2D = projectWorldToScreen(centroid.add(new SPLAT.Vector3(axisLen, 0, 0)));
    const yEnd2D = projectWorldToScreen(centroid.add(new SPLAT.Vector3(0, axisLen, 0)));
    const zEnd2D = projectWorldToScreen(centroid.add(new SPLAT.Vector3(0, 0, axisLen)));

    cameraAidCtx.lineWidth = 2.2;

    if (xEnd2D !== null) {
        cameraAidCtx.strokeStyle = "rgba(239, 68, 68, 0.95)";
        cameraAidCtx.beginPath();
        cameraAidCtx.moveTo(origin2D.x, origin2D.y);
        cameraAidCtx.lineTo(xEnd2D.x, xEnd2D.y);
        cameraAidCtx.stroke();
        cameraAidCtx.fillStyle = "rgba(254, 226, 226, 0.95)";
        cameraAidCtx.fillText("X", xEnd2D.x + 4, xEnd2D.y - 4);
    }

    if (yEnd2D !== null) {
        cameraAidCtx.strokeStyle = "rgba(34, 197, 94, 0.95)";
        cameraAidCtx.beginPath();
        cameraAidCtx.moveTo(origin2D.x, origin2D.y);
        cameraAidCtx.lineTo(yEnd2D.x, yEnd2D.y);
        cameraAidCtx.stroke();
        cameraAidCtx.fillStyle = "rgba(220, 252, 231, 0.95)";
        cameraAidCtx.fillText("Y", yEnd2D.x + 4, yEnd2D.y - 4);
    }

    if (zEnd2D !== null) {
        cameraAidCtx.strokeStyle = "rgba(59, 130, 246, 0.95)";
        cameraAidCtx.beginPath();
        cameraAidCtx.moveTo(origin2D.x, origin2D.y);
        cameraAidCtx.lineTo(zEnd2D.x, zEnd2D.y);
        cameraAidCtx.stroke();
        cameraAidCtx.fillStyle = "rgba(219, 234, 254, 0.95)";
        cameraAidCtx.fillText("Z", zEnd2D.x + 4, zEnd2D.y - 4);
    }

    cameraAidCtx.fillStyle = "rgba(248, 250, 252, 0.95)";
    cameraAidCtx.beginPath();
    cameraAidCtx.arc(origin2D.x, origin2D.y, 3.5, 0, Math.PI * 2);
    cameraAidCtx.fill();
}

function quantile(values: number[], q: number): number {
    if (values.length === 0) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const index = Math.min(Math.max((sorted.length - 1) * q, 0), sorted.length - 1);
    const low = Math.floor(index);
    const high = Math.ceil(index);
    if (low === high) return sorted[low];
    const t = index - low;
    return sorted[low] * (1 - t) + sorted[high] * t;
}

type InlierStats = {
    count: number;
    sumX: number;
    sumY: number;
    sumZ: number;
    minX: number;
    minY: number;
    minZ: number;
    maxX: number;
    maxY: number;
    maxZ: number;
};

function computeFallbackStats(splat: SPLAT.Splat): { center: SPLAT.Vector3; maxDim: number } {
    const bounds = splat.bounds;
    const center = bounds.center();
    const size = bounds.size();
    return {
        center,
        maxDim: Math.max(size.x, size.y, size.z, 1),
    };
}

function computeRobustSplatStats(splat: SPLAT.Splat): { center: SPLAT.Vector3; maxDim: number } {
    const positions = splat.data.positions;
    const vertexCount = Math.floor(positions.length / 3);
    if (vertexCount <= 0) return computeFallbackStats(splat);

    const sampleCap = 20000;
    const step = Math.max(1, Math.floor(vertexCount / sampleCap));
    const xs: number[] = [];
    const ys: number[] = [];
    const zs: number[] = [];

    for (let i = 0; i < vertexCount; i += step) {
        const base = i * 3;
        xs.push(positions[base]);
        ys.push(positions[base + 1]);
        zs.push(positions[base + 2]);
        if (xs.length >= sampleCap) break;
    }

    if (xs.length === 0) return computeFallbackStats(splat);

    const accumulate = (
        xMin: number,
        xMax: number,
        yMin: number,
        yMax: number,
        zMin: number,
        zMax: number,
    ): InlierStats => {
        let count = 0;
        let sumX = 0;
        let sumY = 0;
        let sumZ = 0;
        let minX = Number.POSITIVE_INFINITY;
        let minY = Number.POSITIVE_INFINITY;
        let minZ = Number.POSITIVE_INFINITY;
        let maxX = Number.NEGATIVE_INFINITY;
        let maxY = Number.NEGATIVE_INFINITY;
        let maxZ = Number.NEGATIVE_INFINITY;

        for (let i = 0; i < vertexCount; i++) {
            const base = i * 3;
            const x = positions[base];
            const y = positions[base + 1];
            const z = positions[base + 2];

            if (x < xMin || x > xMax || y < yMin || y > yMax || z < zMin || z > zMax) {
                continue;
            }

            count += 1;
            sumX += x;
            sumY += y;
            sumZ += z;
            if (x < minX) minX = x;
            if (y < minY) minY = y;
            if (z < minZ) minZ = z;
            if (x > maxX) maxX = x;
            if (y > maxY) maxY = y;
            if (z > maxZ) maxZ = z;
        }

        return { count, sumX, sumY, sumZ, minX, minY, minZ, maxX, maxY, maxZ };
    };

    const getAxisRanges = (lowQ: number, highQ: number) => ({
        xMin: quantile(xs, lowQ),
        xMax: quantile(xs, highQ),
        yMin: quantile(ys, lowQ),
        yMax: quantile(ys, highQ),
        zMin: quantile(zs, lowQ),
        zMax: quantile(zs, highQ),
    });

    const preferred = getAxisRanges(0.05, 0.95);
    let inliers = accumulate(
        preferred.xMin,
        preferred.xMax,
        preferred.yMin,
        preferred.yMax,
        preferred.zMin,
        preferred.zMax,
    );

    const minInlierCount = Math.max(64, Math.floor(vertexCount * 0.01));
    if (inliers.count < minInlierCount) {
        const relaxed = getAxisRanges(0.01, 0.99);
        inliers = accumulate(
            relaxed.xMin,
            relaxed.xMax,
            relaxed.yMin,
            relaxed.yMax,
            relaxed.zMin,
            relaxed.zMax,
        );
    }

    if (inliers.count === 0) return computeFallbackStats(splat);

    const center = new SPLAT.Vector3(
        inliers.sumX / inliers.count,
        inliers.sumY / inliers.count,
        inliers.sumZ / inliers.count,
    );
    const maxDim = Math.max(
        inliers.maxX - inliers.minX,
        inliers.maxY - inliers.minY,
        inliers.maxZ - inliers.minZ,
        1,
    );
    return { center, maxDim };
}

function fitCameraToSplat(
    splat: SPLAT.Splat,
    target: SPLAT.Vector3,
    mode: "default" | "viser",
    maxDimOverride?: number,
): void {
    currentOrbitTarget = target.clone();
    const size = splat.bounds.size();
    const maxDim = maxDimOverride ?? Math.max(size.x, size.y, size.z);
    currentAidAxisLength = Math.max(maxDim * 0.12, 0.08);
    const distanceScale = mode === "viser" ? 0.85 : 1.5;
    const distance = Math.max(maxDim * distanceScale, 0.75);

    // Prevent far-plane clipping for large reconstructions.
    camera.data.near = Math.max(distance / 1000, 0.01);
    camera.data.far = Math.max(distance * 20, 1000);

    controls.dispose();
    const alpha = mode === "viser" ? viserOrbitAlpha : 0;
    const beta = mode === "viser"
        ? (autoOrbitFromTop ? viserOrbitBetaMagnitude : -viserOrbitBetaMagnitude)
        : 0.3;
    controls = new SPLAT.OrbitControls(
        camera,
        renderer.canvas,
        alpha,
        beta,
        distance,
        true,
        target,
    );
    controls.maxZoom = Math.max(30, distance * 3);
}

function autoPositionCurrentSplat(): void {
    const selectedFile = getSelectedFile();
    if (selectedFile === undefined || currentSplat === null) return;

    const robustStats = computeRobustSplatStats(currentSplat);
    const center = robustStats.center;
    currentSplat.rotation = viserWorldToThreeRotation;
    const rotatedCenter = viserWorldToThreeRotation.apply(center);
    currentSplat.position = center.subtract(rotatedCenter);
    fitCameraToSplat(currentSplat, center, "viser", robustStats.maxDim);

    setStatus(`Auto positioned ${selectedFile.filename}`);
    updateActionButtons();
}

async function renderSelectedFile(autoPositionAfterLoad = false): Promise<void> {
    const selectedFile = getSelectedFile();
    if (selectedFile === undefined) {
        currentSplat = null;
        currentOrbitTarget = null;
        updateActionButtons();
        if (isLoading) {
            resetAfterLoad = true;
            return;
        }
        scene.reset();
        loadProgress.value = 0;
        setStatus("No file selected.");
        return;
    }

    if (isLoading) {
        queuedSelectionId = selectedFile.id;
        return;
    }

    isLoading = true;
    resetAfterLoad = false;
    queuedSelectionId = null;
    currentSplat = null;
    currentOrbitTarget = null;
    updateActionButtons();
    loadProgress.value = 0;
    setStatus(`Loading ${selectedFile.filename}...`);
    scene.reset();

    try {
        const url = fileDataUrl(selectedFile.id);
        const splat = await SPLAT.PLYLoader.LoadAsync(
            url,
            scene,
            (progress: number) => {
                loadProgress.value = progress * 100;
            },
            plyFormat,
        );

        currentSplat = splat;
        if (autoPositionAfterLoad) {
            autoPositionCurrentSplat();
        } else {
            // Default render is "as is". Auto transform is optional via button.
            const center = splat.bounds.center();
            fitCameraToSplat(splat, center, "default");
            setStatus(`Loaded ${selectedFile.filename}`);
        }
        updateActionButtons();
    } catch (error) {
        console.error(error);
        currentSplat = null;
        currentOrbitTarget = null;
        updateActionButtons();
        setStatus(`Failed to load ${selectedFile.filename}`);
    } finally {
        isLoading = false;
        updateActionButtons();

        if (queuedSelectionId !== null && queuedSelectionId !== selectedFile.id) {
            const nextSelectionId = queuedSelectionId;
            queuedSelectionId = null;
            if (getFileById(nextSelectionId) !== undefined) {
                await selectAndRender(nextSelectionId);
            }
        }

        if (resetAfterLoad && selectedId === null) {
            scene.reset();
            loadProgress.value = 0;
            setStatus("No file selected.");
        }
    }
}

async function selectAndRender(id: string): Promise<void> {
    if (selectedId !== id) {
        selectedId = id;
        applyPerFileUiSettings(selectedId);
        updateDescriptionEditor();
        renderFileList();
    }

    await renderSelectedFile(true);
}

async function addFiles(files: File[]): Promise<void> {
    const plyFiles = files.filter((file) => file.name.toLowerCase().endsWith(".ply"));
    if (plyFiles.length === 0) {
        setStatus("No .ply files found in selection.");
        return;
    }

    setStatus(`Uploading ${plyFiles.length} file(s)...`);
    addFilesButton.disabled = true;

    try {
        const uploaded = await uploadFiles(plyFiles);
        // Refresh the full list from server
        managedFiles = await fetchFiles();

        if (selectedId === null && uploaded.length > 0) {
            selectedId = uploaded[0].id;
        }
        resetAfterLoad = false;

        applyPerFileUiSettings(selectedId);
        updateDescriptionEditor();
        renderFileList();
        setStatus(`Added ${uploaded.length} .ply file(s).`);

        if (selectedId !== null) {
            void renderSelectedFile();
        }
    } catch (error) {
        console.error(error);
        setStatus("Upload failed.");
    } finally {
        addFilesButton.disabled = false;
    }
}

async function deleteSelectedFile(): Promise<void> {
    if (selectedId === null) return;

    const index = managedFiles.findIndex((entry) => entry.id === selectedId);
    if (index < 0) return;

    const deleted = managedFiles[index];
    setStatus(`Deleting ${deleted.filename}...`);

    try {
        await deleteFile(selectedId);
        delete perFileUiSettings[deleted.id];
        savePerFileUiSettings();
        managedFiles = await fetchFiles();

        if (managedFiles.length === 0) {
            selectedId = null;
            queuedSelectionId = null;
            resetAfterLoad = true;
            currentSplat = null;
            currentOrbitTarget = null;
            applyPerFileUiSettings(null);
            scene.reset();
            loadProgress.value = 0;
            setStatus("No file selected.");
        } else {
            const nextIndex = Math.min(index, managedFiles.length - 1);
            selectedId = managedFiles[nextIndex].id;
            resetAfterLoad = false;
            applyPerFileUiSettings(selectedId);
        }

        updateDescriptionEditor();
        renderFileList();

        if (selectedId !== null) {
            void renderSelectedFile();
        }
    } catch (error) {
        console.error(error);
        setStatus(`Failed to delete ${deleted.filename}`);
    }
}

function handleResize(): void {
    renderer.setSize(viewer.clientWidth, viewer.clientHeight);
    applyCurrentFovToCamera();
}

async function main(): Promise<void> {
    updateOrbitSideButtonLabel();
    updateCameraAidButtonLabel();
    updateCentroidAxesButtonLabel();
    syncFovInputs();
    handleResize();
    drawCameraAid();
    window.addEventListener("resize", handleResize);
    new ResizeObserver(handleResize).observe(viewer);

    const frame = () => {
        controls.update();
        renderer.render(scene, camera);
        drawCameraAid();
        requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);

    // Load existing files from server
    try {
        managedFiles = await fetchFiles();
        if (managedFiles.length > 0) {
            selectedId = null;
            applyPerFileUiSettings(null);
            updateDescriptionEditor();
            renderFileList();
            scene.reset();
            loadProgress.value = 0;
            setStatus("No file selected.");
        } else {
            applyPerFileUiSettings(null);
            renderFileList();
        }
    } catch {
        setStatus("Failed to connect to server.");
        renderFileList();
    }

    addFilesButton.addEventListener("click", () => {
        fileInput.click();
    });

    fileInput.addEventListener("change", () => {
        if (fileInput.files === null || fileInput.files.length === 0) return;
        void addFiles(Array.from(fileInput.files));
        fileInput.value = "";
    });

    deleteFileButton.addEventListener("click", () => {
        void deleteSelectedFile();
    });

    autoPositionButton.addEventListener("click", () => {
        autoPositionCurrentSplat();
    });

    orbitSideButton.addEventListener("click", () => {
        autoOrbitFromTop = !autoOrbitFromTop;
        persistSelectedFileUiSettings();
        updateOrbitSideButtonLabel();
        autoPositionCurrentSplat();
    });

    cameraAidButton.addEventListener("click", () => {
        showCameraAid = !showCameraAid;
        persistSelectedFileUiSettings();
        updateCameraAidButtonLabel();
        drawCameraAid();
    });

    centroidAxesButton.addEventListener("click", () => {
        showCentroidAxes = !showCentroidAxes;
        persistSelectedFileUiSettings();
        updateCentroidAxesButtonLabel();
        drawCameraAid();
    });

    fovXInput.addEventListener("change", () => {
        commitFovInput("x");
    });
    fovYInput.addEventListener("change", () => {
        commitFovInput("y");
    });
    fovXInput.addEventListener("blur", () => {
        commitFovInput("x");
    });
    fovYInput.addEventListener("blur", () => {
        commitFovInput("y");
    });

    descriptionInput.addEventListener("input", () => {
        const selectedFile = getSelectedFile();
        if (selectedFile === undefined) return;
        selectedFile.description = descriptionInput.value;
        renderFileList();

        // Debounced save to server
        if (descriptionTimer !== null) clearTimeout(descriptionTimer);
        descriptionTimer = setTimeout(() => {
            void updateDescription(selectedFile.id, selectedFile.description);
        }, 300);
    });

    document.addEventListener("dragover", (event) => {
        event.preventDefault();
    });

    document.addEventListener("drop", (event) => {
        event.preventDefault();
        event.stopPropagation();

        if (event.dataTransfer === null) return;
        void addFiles(Array.from(event.dataTransfer.files));
    });
}

void main();
