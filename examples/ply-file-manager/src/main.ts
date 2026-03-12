import * as pc from "playcanvas";
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
const exportHtmlButton = document.getElementById("export-html-button") as HTMLButtonElement;
const autoPositionButton = document.getElementById("auto-position-button") as HTMLButtonElement;
const orbitSideButton = document.getElementById("orbit-side-button") as HTMLButtonElement;
const cameraAidButton = document.getElementById("camera-aid-button") as HTMLButtonElement;
const centroidAxesButton = document.getElementById("centroid-axes-button") as HTMLButtonElement;
const fileList = document.getElementById("file-list") as HTMLUListElement;
const descriptionInput = document.getElementById("description-input") as HTMLInputElement;
const statusText = document.getElementById("status-text") as HTMLParagraphElement;
const loadProgress = document.getElementById("load-progress") as HTMLProgressElement;
const fovInput = document.getElementById("fov-input") as HTMLInputElement;
const fovSlider = document.getElementById("fov-slider") as HTMLInputElement;
const fileFilterInput = document.getElementById("file-filter-input") as HTMLInputElement;
const resizeHandle = document.getElementById("resize-handle") as HTMLDivElement;
const sidebar = document.querySelector(".sidebar") as HTMLElement;

const viewerCanvas = document.createElement("canvas");
viewer.appendChild(viewerCanvas);

const app = new pc.Application(viewerCanvas, {
    mouse: new pc.Mouse(viewerCanvas),
    keyboard: new pc.Keyboard(window),
});
app.start();
app.setCanvasFillMode(pc.FILLMODE_NONE);
app.setCanvasResolution(pc.RESOLUTION_AUTO);

const cameraEntity = new pc.Entity("camera");
cameraEntity.addComponent("camera", {
    clearColor: new pc.Color(0.04, 0.05, 0.08),
    nearClip: 0.01,
    farClip: 2000,
    fov: 60,
});
app.root.addChild(cameraEntity);
const cameraComponent = cameraEntity.camera as pc.CameraComponent;

const cameraAidCanvas = document.createElement("canvas");
cameraAidCanvas.className = "camera-aid-overlay";
viewer.appendChild(cameraAidCanvas);
const cameraAidCtx = cameraAidCanvas.getContext("2d");

const PER_FILE_UI_SETTINGS_KEY = "ply-file-manager:per-file-ui-settings:v1";
const DEFAULT_UI_SETTINGS: { orbitTop: boolean; cameraAid: boolean; centroidAxes: boolean } = {
    orbitTop: true,
    cameraAid: true,
    centroidAxes: true,
};

const VISER_WORLD_ROTATION = new pc.Quat().setFromEulerAngles(-90, 0, 0);
const VISER_ORBIT_YAW_DEG = 135;
const VISER_ORBIT_PITCH_DEG = Math.atan(1 / Math.sqrt(2)) * 180 / Math.PI;
const NAVIGATION_KEY_ALIASES: Record<string, string> = {
    ArrowUp: "KeyW",
    ArrowDown: "KeyS",
    ArrowLeft: "KeyA",
    ArrowRight: "KeyD",
    KeyX: "KeyS",
};
const SUPPORTED_NAVIGATION_KEYS = new Set(["KeyW", "KeyA", "KeyS", "KeyD", "KeyQ", "KeyE", "KeyR", "KeyF"]);

const tempVecA = new pc.Vec3();
const tempVecB = new pc.Vec3();
const tempScreen = new pc.Vec3();

type PerFileUiSettings = {
    orbitTop?: boolean;
    cameraAid?: boolean;
    centroidAxes?: boolean;
};

type LoadedSplat = {
    asset: pc.Asset;
    entity: pc.Entity;
    gsplatData: pc.GSplatData;
    aabb: pc.BoundingBox;
    objectUrl: string | null;
};

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

function isEditableTarget(target: EventTarget | null): boolean {
    if (!(target instanceof HTMLElement)) return false;
    if (target.isContentEditable) return true;
    const tag = target.tagName;
    return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
}

function normalizeNavigationCode(code: string): string | null {
    const mapped = NAVIGATION_KEY_ALIASES[code];
    if (mapped !== undefined) return mapped;
    if (SUPPORTED_NAVIGATION_KEYS.has(code)) return code;
    return null;
}

class SimpleOrbitControls {
    private readonly cameraEntity: pc.Entity;
    private readonly canvas: HTMLCanvasElement;
    private readonly keyState: Record<string, boolean> = {};
    private readonly movementForward = new pc.Vec3();
    private readonly movementRight = new pc.Vec3();

    private target = new pc.Vec3();
    private distance = 3;
    private yawDeg = 135;
    private pitchDeg = 20;

    private dragButton: 0 | 1 | 2 | null = null;
    private lastX = 0;
    private lastY = 0;

    constructor(cameraEntity: pc.Entity, canvas: HTMLCanvasElement) {
        this.cameraEntity = cameraEntity;
        this.canvas = canvas;

        this.canvas.addEventListener("contextmenu", (event) => {
            event.preventDefault();
        });

        this.canvas.addEventListener("mousedown", (event) => {
            this.dragButton = (event.button === 0 || event.button === 1 || event.button === 2)
                ? (event.button as 0 | 1 | 2)
                : null;
            this.lastX = event.clientX;
            this.lastY = event.clientY;
        });

        window.addEventListener("mousemove", (event) => {
            if (this.dragButton === null) return;

            const dx = event.clientX - this.lastX;
            const dy = event.clientY - this.lastY;
            this.lastX = event.clientX;
            this.lastY = event.clientY;

            if (this.dragButton === 0) {
                this.yawDeg -= dx * 0.28;
                this.pitchDeg -= dy * 0.22;
                this.pitchDeg = Math.max(-89.5, Math.min(89.5, this.pitchDeg));
                return;
            }

            const panScale = Math.max(this.distance * 0.0015, 0.00005);
            const right = this.cameraEntity.right.clone().mulScalar(-dx * panScale);
            const up = this.cameraEntity.up.clone().mulScalar(dy * panScale);
            this.target.add(right).add(up);
        });

        window.addEventListener("mouseup", () => {
            this.dragButton = null;
        });

        this.canvas.addEventListener(
            "wheel",
            (event) => {
                event.preventDefault();
                const factor = Math.exp(event.deltaY * 0.0012);
                this.distance *= factor;
                this.distance = Math.max(0.03, Math.min(5000, this.distance));
            },
            { passive: false },
        );

        window.addEventListener("keydown", (event) => {
            this.handleKeyStateEvent(event, true);
        });
        window.addEventListener("keyup", (event) => {
            this.handleKeyStateEvent(event, false);
        });
        window.addEventListener("blur", () => {
            this.clearKeyState();
        });
    }

    private handleKeyStateEvent(event: KeyboardEvent, active: boolean): void {
        if (isEditableTarget(event.target)) return;
        const code = normalizeNavigationCode(event.code);
        if (code === null) return;

        this.keyState[code] = active;
        event.preventDefault();
    }

    private clearKeyState(): void {
        for (const code of Object.keys(this.keyState)) {
            this.keyState[code] = false;
        }
    }

    setPose(target: pc.Vec3, distance: number, yawDeg: number, pitchDeg: number): void {
        this.target.copy(target);
        this.distance = Math.max(0.03, distance);
        this.yawDeg = yawDeg;
        this.pitchDeg = Math.max(-89.5, Math.min(89.5, pitchDeg));
        this.update();
    }

    update(): void {
        const moveSpeed = Math.max(this.distance * 0.012, 0.01);
        const rotateSpeedDeg = 0.8;

        if (this.keyState.KeyE === true) this.yawDeg += rotateSpeedDeg;
        if (this.keyState.KeyQ === true) this.yawDeg -= rotateSpeedDeg;
        if (this.keyState.KeyR === true) this.pitchDeg += rotateSpeedDeg;
        if (this.keyState.KeyF === true) this.pitchDeg -= rotateSpeedDeg;
        this.pitchDeg = Math.max(-89.5, Math.min(89.5, this.pitchDeg));

        const hasMoveInput = this.keyState.KeyW === true
            || this.keyState.KeyA === true
            || this.keyState.KeyS === true
            || this.keyState.KeyD === true;

        if (hasMoveInput) {
            this.movementForward.sub2(this.target, this.cameraEntity.getPosition());
            if (this.movementForward.lengthSq() > 1e-8) {
                this.movementForward.normalize();
            } else {
                this.movementForward.set(0, 0, -1);
            }

            this.movementRight.copy(this.cameraEntity.right);
            if (this.movementRight.lengthSq() > 1e-8) {
                this.movementRight.normalize();
            } else {
                this.movementRight.set(1, 0, 0);
            }

            if (this.keyState.KeyW === true) {
                this.target.x += this.movementForward.x * moveSpeed;
                this.target.y += this.movementForward.y * moveSpeed;
                this.target.z += this.movementForward.z * moveSpeed;
            }

            if (this.keyState.KeyS === true) {
                this.target.x -= this.movementForward.x * moveSpeed;
                this.target.y -= this.movementForward.y * moveSpeed;
                this.target.z -= this.movementForward.z * moveSpeed;
            }

            if (this.keyState.KeyA === true) {
                this.target.x -= this.movementRight.x * moveSpeed;
                this.target.y -= this.movementRight.y * moveSpeed;
                this.target.z -= this.movementRight.z * moveSpeed;
            }

            if (this.keyState.KeyD === true) {
                this.target.x += this.movementRight.x * moveSpeed;
                this.target.y += this.movementRight.y * moveSpeed;
                this.target.z += this.movementRight.z * moveSpeed;
            }
        }

        const yawRad = this.yawDeg * Math.PI / 180;
        const pitchRad = this.pitchDeg * Math.PI / 180;

        const cosPitch = Math.cos(pitchRad);
        const x = this.target.x + this.distance * cosPitch * Math.sin(yawRad);
        const y = this.target.y + this.distance * Math.sin(pitchRad);
        const z = this.target.z + this.distance * cosPitch * Math.cos(yawRad);

        this.cameraEntity.setPosition(x, y, z);
        this.cameraEntity.lookAt(this.target);
    }

    getTarget(out: pc.Vec3 = new pc.Vec3()): pc.Vec3 {
        return out.copy(this.target);
    }

    getCameraPosition(out: pc.Vec3 = new pc.Vec3()): pc.Vec3 {
        return out.copy(this.cameraEntity.getPosition());
    }
}

const controls = new SimpleOrbitControls(cameraEntity, viewerCanvas);

type PositionProps = {
    x: ArrayLike<number>;
    y: ArrayLike<number>;
    z: ArrayLike<number>;
};


let managedFiles: PlyFileMeta[] = [];
let selectedId: string | null = null;
let isLoading = false;
let queuedSelectionId: string | null = null;
let resetAfterLoad = false;
let currentSplat: LoadedSplat | null = null;
let autoOrbitFromTop = DEFAULT_UI_SETTINGS.orbitTop;
let showCameraAid = DEFAULT_UI_SETTINGS.cameraAid;
let showCentroidAxes = DEFAULT_UI_SETTINGS.centroidAxes;
let currentOrbitTarget: pc.Vec3 | null = null;
let currentAidAxisLength = 1;
let perFileUiSettings: Record<string, PerFileUiSettings> = loadPerFileUiSettings();
let fovDeg = 60;
let descriptionTimer: ReturnType<typeof setTimeout> | null = null;

function setStatus(message: string): void {
    statusText.textContent = message;
}

function clampFovDeg(value: number): number {
    return Math.min(Math.max(value, 1), 179.9);
}

function syncFovInput(): void {
    fovInput.value = fovDeg.toFixed(2);
    fovSlider.value = fovDeg.toFixed(2);
}

function applyCurrentFovToCamera(): void {
    cameraComponent.fov = fovDeg;
}

function commitFovInput(): void {
    const parsed = Number.parseFloat(fovInput.value);
    if (!Number.isFinite(parsed)) {
        syncFovInput();
        return;
    }

    fovDeg = clampFovDeg(parsed);
    syncFovInput();
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

function getFilteredSortedFiles(): PlyFileMeta[] {
    const sorted = [...managedFiles].sort((a, b) =>
        a.filename.localeCompare(b.filename, undefined, { sensitivity: "base" }),
    );

    const raw = fileFilterInput.value.trim().toLowerCase();
    if (raw === "") return sorted;

    const keywords = raw.split(/\s+/);
    return sorted.filter((entry) => {
        const haystack = (entry.filename + " " + entry.description).toLowerCase();
        return keywords.every((kw) => haystack.includes(kw));
    });
}

function renderFileList(): void {
    fileList.innerHTML = "";

    for (const entry of getFilteredSortedFiles()) {
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
    exportHtmlButton.disabled = selectedId === null || isLoading;
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

function projectWorldToScreen(point: pc.Vec3): { x: number; y: number } | null {
    const cameraPos = cameraEntity.getPosition();
    const toPoint = tempVecA.sub2(point, cameraPos);
    if (toPoint.dot(cameraEntity.forward) <= 0) return null;

    cameraComponent.worldToScreen(point, tempScreen);
    if (!Number.isFinite(tempScreen.x) || !Number.isFinite(tempScreen.y)) return null;

    return { x: tempScreen.x, y: tempScreen.y };
}

function drawCameraAid(): void {
    if (cameraAidCtx === null) return;

    const { width, height } = resizeCameraAidCanvas();
    cameraAidCtx.clearRect(0, 0, width, height);

    if (!showCameraAid || currentOrbitTarget === null) return;

    const target = currentOrbitTarget;
    const camPos = controls.getCameraPosition(tempVecA);
    const relative = tempVecB.sub2(camPos, target);

    const horizontalDistance = Math.hypot(relative.x, relative.z);
    const distance = relative.length();
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

    const centroid = currentOrbitTarget;
    const axisLen = Math.max(currentAidAxisLength, 0.05);
    const origin2D = projectWorldToScreen(centroid);
    if (origin2D === null) return;

    if (!showCentroidAxes) return;

    const xEnd2D = projectWorldToScreen(new pc.Vec3(centroid.x + axisLen, centroid.y, centroid.z));
    const yEnd2D = projectWorldToScreen(new pc.Vec3(centroid.x, centroid.y + axisLen, centroid.z));
    const zEnd2D = projectWorldToScreen(new pc.Vec3(centroid.x, centroid.y, centroid.z + axisLen));

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

function isArrayLikeNumber(value: unknown): value is ArrayLike<number> {
    if (value === null || value === undefined) return false;
    if (ArrayBuffer.isView(value)) return true;
    return Array.isArray(value);
}

function getPositionProps(gsplatData: pc.GSplatData): PositionProps | null {
    const xProp = gsplatData.getProp("x");
    const yProp = gsplatData.getProp("y");
    const zProp = gsplatData.getProp("z");

    if (!isArrayLikeNumber(xProp) || !isArrayLikeNumber(yProp) || !isArrayLikeNumber(zProp)) {
        return null;
    }

    return { x: xProp, y: yProp, z: zProp };
}

function computeFallbackStats(splat: LoadedSplat): { center: pc.Vec3; maxDim: number } {
    const center = splat.aabb.center.clone();
    const half = splat.aabb.halfExtents;
    return {
        center,
        maxDim: Math.max(half.x * 2, half.y * 2, half.z * 2, 1),
    };
}

function computeRobustSplatStats(splat: LoadedSplat): { center: pc.Vec3; maxDim: number } {
    const props = getPositionProps(splat.gsplatData);
    if (props === null) return computeFallbackStats(splat);

    const vertexCount = Math.min(props.x.length, props.y.length, props.z.length);
    if (vertexCount <= 0) return computeFallbackStats(splat);

    const sampleCap = 20000;
    const step = Math.max(1, Math.floor(vertexCount / sampleCap));
    const xs: number[] = [];
    const ys: number[] = [];
    const zs: number[] = [];

    for (let i = 0; i < vertexCount; i += step) {
        xs.push(Number(props.x[i]));
        ys.push(Number(props.y[i]));
        zs.push(Number(props.z[i]));
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
            const x = Number(props.x[i]);
            const y = Number(props.y[i]);
            const z = Number(props.z[i]);

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

    const center = new pc.Vec3(
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

function fitCameraToTarget(target: pc.Vec3, mode: "default" | "viser", maxDim: number): void {
    currentOrbitTarget = target.clone();
    currentAidAxisLength = Math.max(maxDim * 0.12, 0.08);

    const distanceScale = mode === "viser" ? 0.85 : 1.5;
    const distance = Math.max(maxDim * distanceScale, 0.75);

    cameraComponent.nearClip = Math.max(distance / 1000, 0.01);
    cameraComponent.farClip = Math.max(distance * 20, 1000);

    const yaw = mode === "viser" ? VISER_ORBIT_YAW_DEG : 0;
    const pitch = mode === "viser"
        ? (autoOrbitFromTop ? VISER_ORBIT_PITCH_DEG : -VISER_ORBIT_PITCH_DEG)
        : 18;

    controls.setPose(target, distance, yaw, pitch);
}

function autoPositionCurrentSplat(): void {
    const selectedFile = getSelectedFile();
    if (selectedFile === undefined || currentSplat === null) return;

    const robustStats = computeRobustSplatStats(currentSplat);
    const center = robustStats.center;

    currentSplat.entity.setLocalRotation(VISER_WORLD_ROTATION);

    const rotatedCenter = VISER_WORLD_ROTATION.transformVector(center, tempVecA);
    const offset = tempVecB.sub2(center, rotatedCenter);
    currentSplat.entity.setLocalPosition(offset);

    fitCameraToTarget(center, "viser", robustStats.maxDim);
    setStatus(`Auto positioned ${selectedFile.filename}`);
    updateActionButtons();
}

async function fetchBlobWithProgress(url: string, onProgress: (progress: number) => void): Promise<Blob> {
    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`Failed to fetch PLY: HTTP ${response.status}`);
    }

    const contentType = response.headers.get("content-type") ?? "application/octet-stream";
    const totalRaw = Number.parseInt(response.headers.get("content-length") ?? "", 10);
    const total = Number.isFinite(totalRaw) && totalRaw > 0 ? totalRaw : null;

    if (response.body === null) {
        const blob = await response.blob();
        onProgress(1);
        return blob;
    }

    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let loaded = 0;

    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value === undefined) continue;

        chunks.push(value);
        loaded += value.byteLength;

        if (total !== null) {
            onProgress(Math.min(loaded / total, 1));
        }
    }

    if (total === null) {
        onProgress(0.95);
    }

    return new Blob(chunks as BlobPart[], { type: contentType });
}

function sanitizeDownloadBaseName(filename: string): string {
    const withoutExt = filename.replace(/\.[^./\\]+$/, "");
    const normalized = withoutExt
        .replace(/[^a-zA-Z0-9._-]+/g, "-")
        .replace(/-+/g, "-")
        .replace(/^-|-$/g, "");
    if (normalized.length === 0) return "splat-viewer";
    return normalized.slice(0, 80);
}



function exportSelectedFileAsHtml(): void {
    const selectedFile = getSelectedFile();
    if (selectedFile === undefined) return;
    if (isLoading) return;

    const params = new URLSearchParams({
        fov: String(fovDeg),
        orbitTop: String(autoOrbitFromTop),
        cameraAid: String(showCameraAid),
        centroidAxes: String(showCentroidAxes),
    });

    const baseName = sanitizeDownloadBaseName(selectedFile.filename);
    const anchor = document.createElement("a");
    anchor.href = `/api/files/${selectedFile.id}/export-html?${params}`;
    anchor.download = `${baseName}-viewer.html`;
    anchor.rel = "noopener";
    anchor.style.display = "none";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();

    setStatus(`Exporting ${baseName}-viewer.html (server-side)...`);
}

async function loadPlayCanvasSplat(
    url: string,
    filename: string,
    onProgress: (progress: number) => void,
): Promise<LoadedSplat> {
    const blob = await fetchBlobWithProgress(url, (progress) => {
        onProgress(Math.min(progress * 0.9, 0.9));
    });

    const objectUrl = URL.createObjectURL(blob);
    onProgress(0.92);

    const asset = new pc.Asset(filename, "gsplat", { url: objectUrl, filename });
    app.assets.add(asset);

    const resource = await new Promise<pc.GSplatResource>((resolve, reject) => {
        const handleError = (error: unknown) => {
            asset.off("error", handleError);
            reject(error instanceof Error ? error : new Error(String(error)));
        };

        asset.on("error", handleError);

        asset.ready(() => {
            asset.off("error", handleError);
            resolve(asset.resource as pc.GSplatResource);
        });

        app.assets.load(asset);
    });

    const entity = new pc.Entity(`splat-${filename}`);
    entity.addComponent("gsplat", { asset });
    app.root.addChild(entity);

    onProgress(1);

    return {
        asset,
        entity,
        gsplatData: resource.gsplatData as pc.GSplatData,
        aabb: resource.aabb.clone(),
        objectUrl,
    };
}

function clearCurrentSplat(): void {
    if (currentSplat === null) return;

    app.root.removeChild(currentSplat.entity);
    currentSplat.entity.destroy();

    app.assets.remove(currentSplat.asset);
    currentSplat.asset.unload();

    if (currentSplat.objectUrl !== null) {
        URL.revokeObjectURL(currentSplat.objectUrl);
    }

    currentSplat = null;
}

async function renderSelectedFile(autoPositionAfterLoad = false): Promise<void> {
    const selectedFile = getSelectedFile();

    if (selectedFile === undefined) {
        clearCurrentSplat();
        currentOrbitTarget = null;
        updateActionButtons();

        if (isLoading) {
            resetAfterLoad = true;
            return;
        }

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

    clearCurrentSplat();
    currentOrbitTarget = null;

    updateActionButtons();
    loadProgress.value = 0;
    setStatus(`Loading ${selectedFile.filename}...`);

    try {
        const url = fileDataUrl(selectedFile.id);
        const splat = await loadPlayCanvasSplat(url, selectedFile.filename, (progress) => {
            loadProgress.value = progress * 100;
        });

        currentSplat = splat;

        if (autoPositionAfterLoad) {
            autoPositionCurrentSplat();
        } else {
            const fallback = computeFallbackStats(splat);
            fitCameraToTarget(fallback.center, "default", fallback.maxDim);
            setStatus(`Loaded ${selectedFile.filename}`);
        }

        updateActionButtons();
    } catch (error) {
        console.error(error);
        clearCurrentSplat();
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
            clearCurrentSplat();
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
    loadProgress.value = 0;
    addFilesButton.disabled = true;

    try {
        const uploaded = await uploadFiles(plyFiles, (progress) => {
            loadProgress.value = progress * 100;
        });
        loadProgress.value = 100;
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
        loadProgress.value = 0;
        setStatus("Upload failed.");
    } finally {
        addFilesButton.disabled = false;
    }
}

async function deleteSelectedFile(): Promise<void> {
    if (selectedId === null) return;

    const deleted = managedFiles.find((entry) => entry.id === selectedId);
    if (deleted === undefined) return;

    const visibleFiles = getFilteredSortedFiles();
    const visibleIndex = visibleFiles.findIndex((entry) => entry.id === selectedId);
    setStatus(`Deleting ${deleted.filename}...`);

    try {
        await deleteFile(selectedId);
        delete perFileUiSettings[deleted.id];
        savePerFileUiSettings();
        managedFiles = await fetchFiles();

        const nextVisible = getFilteredSortedFiles();
        if (nextVisible.length === 0) {
            selectedId = null;
            queuedSelectionId = null;
            resetAfterLoad = true;
            clearCurrentSplat();
            currentOrbitTarget = null;
            applyPerFileUiSettings(null);
            loadProgress.value = 0;
            setStatus("No file selected.");
        } else {
            const nextIndex = Math.min(Math.max(visibleIndex, 0), nextVisible.length - 1);
            selectedId = nextVisible[nextIndex].id;
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
    const width = Math.max(1, viewer.clientWidth);
    const height = Math.max(1, viewer.clientHeight);

    app.graphicsDevice.maxPixelRatio = Math.max(1, window.devicePixelRatio || 1);
    app.resizeCanvas(width, height);

    viewerCanvas.style.width = `${width}px`;
    viewerCanvas.style.height = `${height}px`;

    drawCameraAid();
}

// --- Sidebar resize handle ---
{
    let isResizing = false;

    resizeHandle.addEventListener("mousedown", (e) => {
        e.preventDefault();
        isResizing = true;
        resizeHandle.classList.add("active");
        document.body.style.cursor = "col-resize";
        document.body.style.userSelect = "none";
    });

    window.addEventListener("mousemove", (e) => {
        if (!isResizing) return;
        const maxWidth = window.innerWidth * 0.6;
        const newWidth = Math.min(maxWidth, Math.max(200, e.clientX));
        sidebar.style.width = `${newWidth}px`;
        handleResize();
    });

    window.addEventListener("mouseup", () => {
        if (!isResizing) return;
        isResizing = false;
        resizeHandle.classList.remove("active");
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
    });
}

// --- File filter input ---
fileFilterInput.addEventListener("input", () => {
    renderFileList();
});

async function main(): Promise<void> {
    updateOrbitSideButtonLabel();
    updateCameraAidButtonLabel();
    updateCentroidAxesButtonLabel();

    fovDeg = clampFovDeg(cameraComponent.fov);
    syncFovInput();
    applyCurrentFovToCamera();

    controls.setPose(new pc.Vec3(0, 0, 0), 2.5, VISER_ORBIT_YAW_DEG, VISER_ORBIT_PITCH_DEG);

    handleResize();
    drawCameraAid();

    window.addEventListener("resize", handleResize);
    new ResizeObserver(handleResize).observe(viewer);

    app.on("update", () => {
        controls.update();
        drawCameraAid();
    });

    try {
        managedFiles = await fetchFiles();
        if (managedFiles.length > 0) {
            selectedId = null;
            applyPerFileUiSettings(null);
            updateDescriptionEditor();
            renderFileList();
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

    exportHtmlButton.addEventListener("click", () => {
        exportSelectedFileAsHtml();
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

    fovInput.addEventListener("change", () => {
        commitFovInput();
    });

    fovInput.addEventListener("blur", () => {
        commitFovInput();
    });

    fovSlider.addEventListener("input", () => {
        const parsed = Number.parseFloat(fovSlider.value);
        if (!Number.isFinite(parsed)) return;
        fovDeg = clampFovDeg(parsed);
        syncFovInput();
        applyCurrentFovToCamera();
        drawCameraAid();
    });

    descriptionInput.addEventListener("input", () => {
        const selectedFile = getSelectedFile();
        if (selectedFile === undefined) return;

        selectedFile.description = descriptionInput.value;
        renderFileList();

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
