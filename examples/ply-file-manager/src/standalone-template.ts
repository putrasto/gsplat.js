/**
 * Shared standalone HTML viewer template.
 *
 * Used by both the client (for small files) and the server (for streaming
 * large files without crashing the browser).
 */

export type StandaloneViewerSettings = {
    filename: string;
    description: string;
    initialFovDeg: number;
    orbitTop: boolean;
    cameraAid: boolean;
    centroidAxes: boolean;
};

function escapeHtml(value: string): string {
    return value
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

const PLY_DATA_URL_PLACEHOLDER = "__PLY_DATA_URL_PLACEHOLDER_a9f7e2c1__";

/**
 * Build the full standalone viewer HTML using a placeholder for the PLY data
 * URL, then split it into prefix and suffix around that placeholder.
 *
 * Callers assemble: `prefix + plyDataUrl + suffix`
 *
 * For small files the client can pass a data-URL directly.
 * For large files the server streams base64 chunks between prefix and suffix.
 */
export function buildStandaloneViewerHtmlParts(
    settings: StandaloneViewerSettings,
    runtimeScript: string,
): { prefix: string; suffix: string } {
    const html = buildFullHtml(settings, PLY_DATA_URL_PLACEHOLDER, runtimeScript);
    const idx = html.indexOf(PLY_DATA_URL_PLACEHOLDER);
    return {
        prefix: html.slice(0, idx),
        suffix: html.slice(idx + PLY_DATA_URL_PLACEHOLDER.length),
    };
}

/** Convenience: build the complete HTML in one shot (used by the client for small files). */
export function buildStandaloneViewerHtml(
    settings: StandaloneViewerSettings,
    plyDataUrl: string,
    runtimeScript: string,
): string {
    return buildFullHtml(settings, plyDataUrl, runtimeScript);
}

// ---------------------------------------------------------------------------

function buildFullHtml(
    settings: StandaloneViewerSettings,
    plyDataUrl: string,
    runtimeScript: string,
): string {
    const title = settings.description.trim() === "" ? settings.filename : settings.description.trim();
    const safeTitle = escapeHtml(title);
    const safeFilename = escapeHtml(settings.filename);
    const settingsJson = JSON.stringify(settings).replace(/<\//g, "<\\/");

    return `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${safeTitle}</title>
  <style>
    :root {
      color: #e2e8f0;
      background: #0f172a;
      font-family: "Segoe UI", Tahoma, sans-serif;
    }
    * { box-sizing: border-box; }
    html, body { margin: 0; width: 100%; height: 100%; overflow: hidden; }
    #app { position: relative; width: 100%; height: 100%; background: radial-gradient(circle at 30% 20%, #1e293b 0%, #020617 100%); }
    #viewer-canvas, #camera-aid-canvas {
      position: absolute;
      inset: 0;
      width: 100%;
      height: 100%;
      display: block;
    }
    #camera-aid-canvas { pointer-events: none; }
    .hud {
      position: absolute;
      top: 12px;
      left: 12px;
      right: 12px;
      max-width: 720px;
      padding: 12px;
      border-radius: 10px;
      background: rgba(15, 23, 42, 0.72);
      border: 1px solid rgba(148, 163, 184, 0.4);
      backdrop-filter: blur(6px);
      color: #e2e8f0;
    }
    .hud h1 {
      margin: 0;
      font-size: 1rem;
      font-weight: 600;
      line-height: 1.2;
    }
    .hud .file-name {
      margin: 2px 0 10px;
      font-size: 0.78rem;
      color: #cbd5e1;
    }
    .toolbar {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 8px;
    }
    button {
      border: 1px solid rgba(148, 163, 184, 0.45);
      border-radius: 6px;
      padding: 6px 10px;
      background: rgba(15, 23, 42, 0.92);
      color: #f1f5f9;
      font-size: 0.8rem;
      cursor: pointer;
    }
    button:hover { background: rgba(30, 41, 59, 0.98); }
    .fov {
      margin-left: auto;
      min-width: 220px;
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 0.78rem;
      color: #cbd5e1;
    }
    .fov input[type="range"] { flex: 1; min-width: 0; }
    #status-text {
      margin: 10px 0 0;
      font-size: 0.78rem;
      color: #cbd5e1;
      min-height: 1.2em;
    }
    @media (max-width: 780px) {
      .hud { max-width: none; }
      .fov { margin-left: 0; width: 100%; min-width: 0; }
    }
  </style>
</head>
<body>
  <div id="app">
    <canvas id="viewer-canvas"></canvas>
    <canvas id="camera-aid-canvas"></canvas>
    <section class="hud">
      <h1>${safeTitle}</h1>
      <p class="file-name">${safeFilename}</p>
      <div class="toolbar">
        <button id="auto-position-button" type="button">Auto Position</button>
        <button id="orbit-side-button" type="button">Orbit: Top</button>
        <button id="camera-aid-button" type="button">Camera Aid: On</button>
        <button id="centroid-axes-button" type="button">Centroid Axes: On</button>
        <label class="fov" for="fov-slider">
          <span>FOV</span>
          <input id="fov-slider" type="range" min="1" max="179.9" step="0.1" />
          <span id="fov-value">60.0 deg</span>
        </label>
      </div>
      <p id="status-text">Initializing viewer...</p>
    </section>
  </div>

  <script>
${runtimeScript}
  </script>
  <script>
    (() => {
      const PLY_DATA_URL = "${plyDataUrl}";
      const payload = ${settingsJson};
      const statusText = document.getElementById("status-text");
      const viewerCanvas = document.getElementById("viewer-canvas");
      const cameraAidCanvas = document.getElementById("camera-aid-canvas");
      const autoPositionButton = document.getElementById("auto-position-button");
      const orbitSideButton = document.getElementById("orbit-side-button");
      const cameraAidButton = document.getElementById("camera-aid-button");
      const centroidAxesButton = document.getElementById("centroid-axes-button");
      const fovSlider = document.getElementById("fov-slider");
      const fovValue = document.getElementById("fov-value");

      const setStatus = (message) => {
        statusText.textContent = message;
      };

      if (typeof window.pc === "undefined") {
        setStatus("PlayCanvas runtime failed to initialize.");
        return;
      }

      const pc = window.pc;
      const VISER_WORLD_ROTATION = new pc.Quat().setFromEulerAngles(-90, 0, 0);
      const VISER_ORBIT_YAW_DEG = 135;
      const VISER_ORBIT_PITCH_DEG = Math.atan(1 / Math.sqrt(2)) * 180 / Math.PI;

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
      const cameraComponent = cameraEntity.camera;

      const cameraAidCtx = cameraAidCanvas.getContext("2d");
      const tempVecA = new pc.Vec3();
      const tempVecB = new pc.Vec3();
      const tempScreen = new pc.Vec3();
      const navigationKeyAliases = {
        ArrowUp: "KeyW",
        ArrowDown: "KeyS",
        ArrowLeft: "KeyA",
        ArrowRight: "KeyD",
        KeyX: "KeyS",
      };
      const supportedNavigationKeys = new Set(["KeyW", "KeyA", "KeyS", "KeyD", "KeyQ", "KeyE", "KeyR", "KeyF"]);

      let currentEntity = null;
      let currentData = null;
      let currentAabb = null;
      let currentOrbitTarget = null;
      let currentAidAxisLength = 1;
      let autoOrbitFromTop = !!payload.orbitTop;
      let showCameraAid = !!payload.cameraAid;
      let showCentroidAxes = !!payload.centroidAxes;
      let fovDeg = Math.min(Math.max(Number(payload.initialFovDeg) || 60, 1), 179.9);

      const isEditableTarget = (target) => {
        if (!(target instanceof HTMLElement)) return false;
        if (target.isContentEditable) return true;
        const tag = target.tagName;
        return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
      };

      const normalizeNavigationCode = (code) => {
        const mapped = navigationKeyAliases[code];
        if (mapped !== undefined) return mapped;
        if (supportedNavigationKeys.has(code)) return code;
        return null;
      };

      class SimpleOrbitControls {
        constructor(cameraEntity, canvas) {
          this.cameraEntity = cameraEntity;
          this.canvas = canvas;
          this.keyState = Object.create(null);
          this.movementForward = new pc.Vec3();
          this.movementRight = new pc.Vec3();
          this.target = new pc.Vec3();
          this.distance = 3;
          this.yawDeg = 135;
          this.pitchDeg = 20;
          this.dragButton = null;
          this.lastX = 0;
          this.lastY = 0;

          this.canvas.addEventListener("contextmenu", (event) => event.preventDefault());
          this.canvas.addEventListener("mousedown", (event) => {
            this.dragButton = (event.button === 0 || event.button === 1 || event.button === 2) ? event.button : null;
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
          this.canvas.addEventListener("wheel", (event) => {
            event.preventDefault();
            const factor = Math.exp(event.deltaY * 0.0012);
            this.distance *= factor;
            this.distance = Math.max(0.03, Math.min(5000, this.distance));
          }, { passive: false });
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

        handleKeyStateEvent(event, active) {
          if (isEditableTarget(event.target)) return;
          const code = normalizeNavigationCode(event.code);
          if (code === null) return;
          this.keyState[code] = active;
          event.preventDefault();
        }

        clearKeyState() {
          const keys = Object.keys(this.keyState);
          for (let i = 0; i < keys.length; i++) {
            this.keyState[keys[i]] = false;
          }
        }

        setPose(target, distance, yawDeg, pitchDeg) {
          this.target.copy(target);
          this.distance = Math.max(0.03, distance);
          this.yawDeg = yawDeg;
          this.pitchDeg = Math.max(-89.5, Math.min(89.5, pitchDeg));
          this.update();
        }

        update() {
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

        getCameraPosition(out = new pc.Vec3()) {
          return out.copy(this.cameraEntity.getPosition());
        }
      }

      const controls = new SimpleOrbitControls(cameraEntity, viewerCanvas);

      const quantile = (values, q) => {
        if (values.length === 0) return 0;
        const sorted = values.slice().sort((a, b) => a - b);
        const index = Math.min(Math.max((sorted.length - 1) * q, 0), sorted.length - 1);
        const low = Math.floor(index);
        const high = Math.ceil(index);
        if (low === high) return sorted[low];
        const t = index - low;
        return sorted[low] * (1 - t) + sorted[high] * t;
      };

      const isArrayLikeNumber = (value) => {
        if (value === null || value === undefined) return false;
        return Array.isArray(value) || ArrayBuffer.isView(value);
      };

      const getPositionProps = (gsplatData) => {
        const xProp = gsplatData.getProp("x");
        const yProp = gsplatData.getProp("y");
        const zProp = gsplatData.getProp("z");
        if (!isArrayLikeNumber(xProp) || !isArrayLikeNumber(yProp) || !isArrayLikeNumber(zProp)) {
          return null;
        }
        return { x: xProp, y: yProp, z: zProp };
      };

      const computeFallbackStats = (aabb) => {
        const center = aabb.center.clone();
        const half = aabb.halfExtents;
        return {
          center,
          maxDim: Math.max(half.x * 2, half.y * 2, half.z * 2, 1),
        };
      };

      const computeRobustStats = (gsplatData, aabb) => {
        const props = getPositionProps(gsplatData);
        if (props === null) return computeFallbackStats(aabb);

        const vertexCount = Math.min(props.x.length, props.y.length, props.z.length);
        if (vertexCount <= 0) return computeFallbackStats(aabb);

        const sampleCap = 20000;
        const step = Math.max(1, Math.floor(vertexCount / sampleCap));
        const xs = [];
        const ys = [];
        const zs = [];

        for (let i = 0; i < vertexCount; i += step) {
          xs.push(Number(props.x[i]));
          ys.push(Number(props.y[i]));
          zs.push(Number(props.z[i]));
          if (xs.length >= sampleCap) break;
        }

        if (xs.length === 0) return computeFallbackStats(aabb);

        const accumulate = (xMin, xMax, yMin, yMax, zMin, zMax) => {
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
            if (x < xMin || x > xMax || y < yMin || y > yMax || z < zMin || z > zMax) continue;

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

        const getRanges = (lowQ, highQ) => ({
          xMin: quantile(xs, lowQ),
          xMax: quantile(xs, highQ),
          yMin: quantile(ys, lowQ),
          yMax: quantile(ys, highQ),
          zMin: quantile(zs, lowQ),
          zMax: quantile(zs, highQ),
        });

        let ranges = getRanges(0.05, 0.95);
        let inliers = accumulate(ranges.xMin, ranges.xMax, ranges.yMin, ranges.yMax, ranges.zMin, ranges.zMax);
        const minInlierCount = Math.max(64, Math.floor(vertexCount * 0.01));

        if (inliers.count < minInlierCount) {
          ranges = getRanges(0.01, 0.99);
          inliers = accumulate(ranges.xMin, ranges.xMax, ranges.yMin, ranges.yMax, ranges.zMin, ranges.zMax);
        }

        if (inliers.count === 0) return computeFallbackStats(aabb);

        const center = new pc.Vec3(
          inliers.sumX / inliers.count,
          inliers.sumY / inliers.count,
          inliers.sumZ / inliers.count
        );
        const maxDim = Math.max(
          inliers.maxX - inliers.minX,
          inliers.maxY - inliers.minY,
          inliers.maxZ - inliers.minZ,
          1
        );
        return { center, maxDim };
      };

      const fitCameraToTarget = (target, maxDim) => {
        currentOrbitTarget = target.clone();
        currentAidAxisLength = Math.max(maxDim * 0.12, 0.08);

        const distance = Math.max(maxDim * 0.85, 0.75);
        cameraComponent.nearClip = Math.max(distance / 1000, 0.01);
        cameraComponent.farClip = Math.max(distance * 20, 1000);

        const pitch = autoOrbitFromTop ? VISER_ORBIT_PITCH_DEG : -VISER_ORBIT_PITCH_DEG;
        controls.setPose(target, distance, VISER_ORBIT_YAW_DEG, pitch);
      };

      const autoPositionCurrentSplat = () => {
        if (currentEntity === null || currentData === null || currentAabb === null) return;
        const stats = computeRobustStats(currentData, currentAabb);

        currentEntity.setLocalRotation(VISER_WORLD_ROTATION);
        const rotatedCenter = VISER_WORLD_ROTATION.transformVector(stats.center, tempVecA);
        const offset = tempVecB.sub2(stats.center, rotatedCenter);
        currentEntity.setLocalPosition(offset);

        fitCameraToTarget(stats.center, stats.maxDim);
        setStatus("Auto positioned " + payload.filename);
      };

      const resizeCameraAidCanvas = () => {
        const width = Math.max(1, window.innerWidth);
        const height = Math.max(1, window.innerHeight);
        const dpr = Math.max(1, window.devicePixelRatio || 1);
        const deviceWidth = Math.floor(width * dpr);
        const deviceHeight = Math.floor(height * dpr);
        if (cameraAidCanvas.width !== deviceWidth) cameraAidCanvas.width = deviceWidth;
        if (cameraAidCanvas.height !== deviceHeight) cameraAidCanvas.height = deviceHeight;
        cameraAidCanvas.style.width = width + "px";
        cameraAidCanvas.style.height = height + "px";
        if (cameraAidCtx !== null) cameraAidCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
        return { width, height };
      };

      const projectWorldToScreen = (point) => {
        const cameraPos = cameraEntity.getPosition();
        const toPoint = tempVecA.sub2(point, cameraPos);
        if (toPoint.dot(cameraEntity.forward) <= 0) return null;
        cameraComponent.worldToScreen(point, tempScreen);
        if (!Number.isFinite(tempScreen.x) || !Number.isFinite(tempScreen.y)) return null;
        return { x: tempScreen.x, y: tempScreen.y };
      };

      const drawRoundedRect = (ctx, x, y, width, height, radius) => {
        const r = Math.max(0, Math.min(radius, Math.min(width, height) * 0.5));
        ctx.beginPath();
        ctx.moveTo(x + r, y);
        ctx.arcTo(x + width, y, x + width, y + height, r);
        ctx.arcTo(x + width, y + height, x, y + height, r);
        ctx.arcTo(x, y + height, x, y, r);
        ctx.arcTo(x, y, x + width, y, r);
        ctx.closePath();
      };

      const drawCameraAid = () => {
        if (cameraAidCtx === null) return;
        const size = resizeCameraAidCanvas();
        const width = size.width;
        const height = size.height;
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
        drawRoundedRect(cameraAidCtx, panelX, panelY, panelSize, panelSize + 34, 10);
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
        cameraAidCtx.fillText("dist " + distance.toFixed(2), panelX + 9, panelY + panelSize + 15);
        cameraAidCtx.fillText("elev " + (elevationDeg >= 0 ? "+" : "") + elevationDeg.toFixed(1) + " deg", panelX + 9, panelY + panelSize + 29);

        if (!showCentroidAxes) return;

        const axisLen = Math.max(currentAidAxisLength, 0.05);
        const origin2D = projectWorldToScreen(target);
        if (origin2D === null) return;
        const xEnd2D = projectWorldToScreen(new pc.Vec3(target.x + axisLen, target.y, target.z));
        const yEnd2D = projectWorldToScreen(new pc.Vec3(target.x, target.y + axisLen, target.z));
        const zEnd2D = projectWorldToScreen(new pc.Vec3(target.x, target.y, target.z + axisLen));

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
      };

      const syncFov = () => {
        fovDeg = Math.min(Math.max(fovDeg, 1), 179.9);
        fovSlider.value = fovDeg.toFixed(2);
        fovValue.textContent = fovDeg.toFixed(1) + " deg";
        cameraComponent.fov = fovDeg;
      };

      const updateToggleLabels = () => {
        orbitSideButton.textContent = autoOrbitFromTop ? "Orbit: Top" : "Orbit: Bottom";
        cameraAidButton.textContent = showCameraAid ? "Camera Aid: On" : "Camera Aid: Off";
        centroidAxesButton.textContent = showCentroidAxes ? "Centroid Axes: On" : "Centroid Axes: Off";
      };

      const handleResize = () => {
        const width = Math.max(1, window.innerWidth);
        const height = Math.max(1, window.innerHeight);
        app.graphicsDevice.maxPixelRatio = Math.max(1, window.devicePixelRatio || 1);
        app.resizeCanvas(width, height);
        viewerCanvas.style.width = width + "px";
        viewerCanvas.style.height = height + "px";
        drawCameraAid();
      };

      const loadScene = async () => {
        setStatus("Loading embedded PLY...");
        const dataResponse = await fetch(PLY_DATA_URL);
        if (!dataResponse.ok) {
          throw new Error("Failed to decode embedded PLY data.");
        }
        const plyBlob = await dataResponse.blob();
        const objectUrl = URL.createObjectURL(plyBlob);

        const asset = new pc.Asset(payload.filename, "gsplat", { url: objectUrl, filename: payload.filename });
        app.assets.add(asset);

        const resource = await new Promise((resolve, reject) => {
          const handleError = (error) => {
            asset.off("error", handleError);
            reject(error instanceof Error ? error : new Error(String(error)));
          };

          asset.on("error", handleError);
          asset.ready(() => {
            asset.off("error", handleError);
            resolve(asset.resource);
          });
          app.assets.load(asset);
        });

        const entity = new pc.Entity("splat-" + payload.filename);
        entity.addComponent("gsplat", { asset });
        app.root.addChild(entity);

        currentEntity = entity;
        currentData = resource.gsplatData;
        currentAabb = resource.aabb.clone();

        autoPositionCurrentSplat();
        setStatus("Loaded " + payload.filename);
        URL.revokeObjectURL(objectUrl);
      };

      autoPositionButton.addEventListener("click", () => {
        autoPositionCurrentSplat();
      });

      orbitSideButton.addEventListener("click", () => {
        autoOrbitFromTop = !autoOrbitFromTop;
        updateToggleLabels();
        autoPositionCurrentSplat();
      });

      cameraAidButton.addEventListener("click", () => {
        showCameraAid = !showCameraAid;
        updateToggleLabels();
        drawCameraAid();
      });

      centroidAxesButton.addEventListener("click", () => {
        showCentroidAxes = !showCentroidAxes;
        updateToggleLabels();
        drawCameraAid();
      });

      fovSlider.addEventListener("input", () => {
        const parsed = Number.parseFloat(fovSlider.value);
        if (!Number.isFinite(parsed)) return;
        fovDeg = parsed;
        syncFov();
        drawCameraAid();
      });

      updateToggleLabels();
      syncFov();
      controls.setPose(new pc.Vec3(0, 0, 0), 2.5, VISER_ORBIT_YAW_DEG, VISER_ORBIT_PITCH_DEG);
      handleResize();

      window.addEventListener("resize", handleResize);
      app.on("update", () => {
        controls.update();
        drawCameraAid();
      });

      loadScene().catch((error) => {
        console.error(error);
        setStatus("Failed to load splat.");
      });
    })();
  </script>
</body>
</html>`;
}
