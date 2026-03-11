import { Hono } from "hono";
import { serveStatic } from "hono/bun";
import { join, resolve, relative } from "path";
import { unlinkSync, existsSync } from "fs";
import { DB_PATH, plyDb, UPLOADS_DIR, type PlyFileRow } from "./db";

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
