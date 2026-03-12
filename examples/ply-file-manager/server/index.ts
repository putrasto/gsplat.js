import { Hono } from "hono";
import { serveStatic } from "hono/bun";
import { join, resolve, relative } from "path";
import { unlinkSync, existsSync } from "fs";
import { DB_PATH, plyDb, UPLOADS_DIR, type PlyFileRow } from "./db";
import { buildStandaloneViewerHtmlParts, type StandaloneViewerSettings } from "../src/standalone-template";

const app = new Hono();

const resolvedUploadsDir = resolve(UPLOADS_DIR) + "/";

function isInsideUploads(filePath: string): boolean {
    return resolve(filePath).startsWith(resolvedUploadsDir);
}

function sanitizeRow({ id, filename, description, file_size, created_at, updated_at }: PlyFileRow) {
    return { id, filename, description, file_size, created_at, updated_at };
}

// --- API routes ---

app.get("/api/files", (c) => {
    const files = plyDb.listAll().map(sanitizeRow);
    return c.json(files);
});

app.get("/api/files/:id", (c) => {
    const row = plyDb.getById(c.req.param("id"));
    if (!row) return c.json({ error: "Not found" }, 404);
    return c.json(sanitizeRow(row));
});

// Single-file streaming upload: client sends raw binary body with filename in header.
// This avoids multipart buffering which causes AbortError on large files (300MB+).
app.post("/api/files", async (c) => {
    const filename = c.req.header("x-filename");
    if (!filename || !filename.toLowerCase().endsWith(".ply")) {
        return c.json({ error: "Missing or invalid X-Filename header (must end with .ply)" }, 400);
    }

    const reqBody = c.req.raw.body;
    if (!reqBody) {
        return c.json({ error: "Empty request body" }, 400);
    }

    const id = crypto.randomUUID();
    const storedName = `${id}.ply`;
    const filePath = join(UPLOADS_DIR, storedName);

    try {
        // Stream directly to disk — no full buffering in memory
        const writer = Bun.file(filePath).writer();
        const reader = reqBody.getReader();
        for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            writer.write(value);
        }
        await writer.end();
    } catch {
        if (existsSync(filePath)) unlinkSync(filePath);
        return c.json({ error: "Failed to write file" }, 500);
    }

    const stat = Bun.file(filePath);
    const fileSize = stat.size;

    try {
        plyDb.insert(id, filename, "", filePath, fileSize);
    } catch {
        if (existsSync(filePath)) unlinkSync(filePath);
        return c.json({ error: "Failed to save file metadata" }, 500);
    }

    return c.json({ uploaded: [{ id, filename }] }, 201);
});

app.patch("/api/files/:id", async (c) => {
    const id = c.req.param("id");
    const row = plyDb.getById(id);
    if (!row) return c.json({ error: "Not found" }, 404);

    const body = await c.req.json<{ description?: unknown }>();
    if (typeof body.description !== "string") {
        return c.json({ error: "description must be a string" }, 400);
    }
    const description = body.description.slice(0, 256);
    plyDb.updateDescription(id, description);

    return c.json({ ...sanitizeRow(row), description, updated_at: new Date().toISOString() });
});

app.delete("/api/files/:id", (c) => {
    const id = c.req.param("id");
    const row = plyDb.getById(id);
    if (!row) return c.json({ error: "Not found" }, 404);

    if (isInsideUploads(row.file_path) && existsSync(row.file_path)) {
        unlinkSync(row.file_path);
    }
    plyDb.remove(id);

    return c.json({ deleted: id });
});

app.get("/api/files/:id/data", (c) => {
    const row = plyDb.getById(c.req.param("id"));
    if (!row) return c.json({ error: "Not found" }, 404);

    if (!isInsideUploads(row.file_path)) {
        return c.json({ error: "Forbidden" }, 403);
    }

    const file = Bun.file(row.file_path);
    const encoded = encodeURIComponent(row.filename);
    return new Response(file, {
        headers: {
            "Content-Type": "application/octet-stream",
            "Content-Disposition": `attachment; filename*=UTF-8''${encoded}`,
        },
    });
});

// --- Export standalone HTML viewer (server-side) ---
// Generates the HTML on the server to avoid browser OOM on large PLY files.

const playcanvasRuntimePath = join(import.meta.dir, "..", "node_modules", "playcanvas", "build", "playcanvas.min.js");
const playcanvasRuntime = await Bun.file(playcanvasRuntimePath).text();
const playcanvasRuntimeSafe = playcanvasRuntime
    .replace(/<\/script/gi, "<\\/script")
    .replace(/\/\/# sourceMappingURL=.*$/gm, "");

function sanitizeDownloadBaseName(filename: string): string {
    const withoutExt = filename.replace(/\.[^./\\]+$/, "");
    const normalized = withoutExt
        .replace(/[^a-zA-Z0-9._-]+/g, "-")
        .replace(/-+/g, "-")
        .replace(/^-|-$/g, "");
    if (normalized.length === 0) return "splat-viewer";
    return normalized.slice(0, 80);
}

app.get("/api/files/:id/export-html", async (c) => {
    const row = plyDb.getById(c.req.param("id"));
    if (!row) return c.json({ error: "Not found" }, 404);

    if (!isInsideUploads(row.file_path)) {
        return c.json({ error: "Forbidden" }, 403);
    }

    const fov = Math.min(Math.max(parseFloat(c.req.query("fov") ?? "60"), 1), 179.9);
    const orbitTop = c.req.query("orbitTop") === "true";
    const cameraAid = c.req.query("cameraAid") === "true";
    const centroidAxes = c.req.query("centroidAxes") === "true";

    const settings: StandaloneViewerSettings = {
        filename: row.filename,
        description: row.description,
        initialFovDeg: fov,
        orbitTop,
        cameraAid,
        centroidAxes,
    };

    const { prefix, suffix } = buildStandaloneViewerHtmlParts(settings, playcanvasRuntimeSafe);

    // Stream: HTML prefix → "data:application/octet-stream;base64," → base64 PLY chunks → HTML suffix
    const encoder = new TextEncoder();
    const dataUrlPrefix = "data:application/octet-stream;base64,";

    const stream = new ReadableStream({
        async start(controller) {
            try {
                controller.enqueue(encoder.encode(prefix));
                controller.enqueue(encoder.encode(dataUrlPrefix));

                // Read PLY file and base64-encode in aligned chunks to keep memory low
                const fileReader = Bun.file(row.file_path).stream().getReader();
                let remainder = new Uint8Array(0);

                for (;;) {
                    const { done, value } = await fileReader.read();
                    if (done) break;

                    // Combine leftover bytes with new chunk
                    let combined: Uint8Array;
                    if (remainder.length > 0) {
                        combined = new Uint8Array(remainder.length + value.length);
                        combined.set(remainder);
                        combined.set(value, remainder.length);
                    } else {
                        combined = value;
                    }

                    const alignedLen = Math.floor(combined.length / 3) * 3;
                    if (alignedLen > 0) {
                        const toEncode = combined.slice(0, alignedLen);
                        controller.enqueue(encoder.encode(Buffer.from(toEncode).toString("base64")));
                    }
                    remainder = combined.slice(alignedLen);
                }

                // Encode any remaining bytes (1 or 2 bytes with base64 padding)
                if (remainder.length > 0) {
                    controller.enqueue(encoder.encode(Buffer.from(remainder).toString("base64")));
                }

                controller.enqueue(encoder.encode(suffix));
                controller.close();
            } catch (error) {
                controller.error(error);
            }
        },
    });

    const baseName = sanitizeDownloadBaseName(row.filename);
    return new Response(stream, {
        headers: {
            "Content-Type": "text/html; charset=utf-8",
            "Content-Disposition": `attachment; filename="${baseName}-viewer.html"`,
        },
    });
});

// --- Static file serving (production) ---
// API routes are registered above and matched first by Hono's registration order.
if (process.env.NODE_ENV === "production") {
    const distPath = relative(process.cwd(), join(import.meta.dir, "..", "dist"));
    app.use("/*", serveStatic({ root: distPath }));
    app.get("/*", serveStatic({ root: distPath, path: "index.html" }));
}

const host = process.env.HOST || "0.0.0.0";
const port = parseInt(process.env.PORT || "3001");
const defaultMaxRequestBodySize = 10 * 1024 * 1024 * 1024; // 10 GiB
const configuredMaxRequestBodySize = parseInt(process.env.MAX_REQUEST_BODY_SIZE || "", 10);
const maxRequestBodySize = Number.isFinite(configuredMaxRequestBodySize) && configuredMaxRequestBodySize > 0
    ? configuredMaxRequestBodySize
    : defaultMaxRequestBodySize;

console.log(`Hono server running on http://${host}:${port}`);
console.log(`SQLite DB path: ${DB_PATH}`);
console.log(`Max request body size: ${(maxRequestBodySize / (1024 * 1024)).toFixed(0)} MiB`);

export default {
    hostname: host,
    port,
    maxRequestBodySize,
    idleTimeout: 255, // seconds – prevent connection reset on large uploads (default is 10s)
    fetch: app.fetch,
};
