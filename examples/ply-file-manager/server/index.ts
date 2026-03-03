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

app.post("/api/files", async (c) => {
    const body = await c.req.parseBody({ all: true });
    const rawFiles = body["files"];
    const fileArray = Array.isArray(rawFiles) ? rawFiles : rawFiles ? [rawFiles] : [];
    const results: { id: string; filename: string }[] = [];

    for (const item of fileArray) {
        if (!(item instanceof File)) continue;
        if (!item.name.toLowerCase().endsWith(".ply")) continue;

        const id = crypto.randomUUID();
        const storedName = `${id}.ply`;
        const filePath = join(UPLOADS_DIR, storedName);

        try {
            await Bun.write(filePath, item);
        } catch {
            continue;
        }

        try {
            plyDb.insert(id, item.name, "", filePath, item.size);
        } catch {
            if (existsSync(filePath)) unlinkSync(filePath);
            continue;
        }

        results.push({ id, filename: item.name });
    }

    if (results.length === 0) {
        return c.json({ error: "No valid .ply files in request" }, 400);
    }

    return c.json({ uploaded: results }, 201);
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
    fetch: app.fetch,
};
