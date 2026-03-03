import { Database } from "bun:sqlite";
import { homedir } from "os";
import { mkdirSync } from "fs";
import { dirname, join, resolve } from "path";

function expandHome(pathValue: string): string {
    if (pathValue === "~") return homedir();
    if (pathValue.startsWith("~/")) return join(homedir(), pathValue.slice(2));
    return pathValue;
}

const DEFAULT_DATA_DIR = join(homedir(), ".ply-file-manager", "data");
const DEFAULT_UPLOADS_DIR = join(import.meta.dir, "..", "uploads");
const DATA_DIR = resolve(expandHome(process.env.PLY_MANAGER_DATA_DIR ?? DEFAULT_DATA_DIR));
const UPLOADS_DIR = resolve(expandHome(process.env.PLY_MANAGER_UPLOADS_DIR ?? DEFAULT_UPLOADS_DIR));
const DB_PATH = resolve(expandHome(process.env.PLY_MANAGER_DB_PATH ?? join(DATA_DIR, "ply-manager.db")));

mkdirSync(DATA_DIR, { recursive: true });
mkdirSync(UPLOADS_DIR, { recursive: true });
mkdirSync(dirname(DB_PATH), { recursive: true });

const db = new Database(DB_PATH);
try {
    db.exec("PRAGMA journal_mode = WAL;");
} catch (error) {
    console.warn(
        `Failed to enable WAL mode for SQLite at ${DB_PATH}. Continuing with default journal mode.`,
        error,
    );
}

db.exec(`
    CREATE TABLE IF NOT EXISTS ply_files (
        id TEXT PRIMARY KEY,
        filename TEXT NOT NULL,
        description TEXT DEFAULT '',
        file_path TEXT NOT NULL,
        file_size INTEGER,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
    );
`);

export type PlyFileRow = {
    id: string;
    filename: string;
    description: string;
    file_path: string;
    file_size: number;
    created_at: string;
    updated_at: string;
};

const listAll = db.prepare<PlyFileRow, []>(
    "SELECT * FROM ply_files ORDER BY created_at DESC",
);

const getById = db.prepare<PlyFileRow, [string]>(
    "SELECT * FROM ply_files WHERE id = ?",
);

const insert = db.prepare<void, [string, string, string, string, number]>(
    "INSERT INTO ply_files (id, filename, description, file_path, file_size) VALUES (?, ?, ?, ?, ?)",
);

const updateDescription = db.prepare<void, [string, string]>(
    "UPDATE ply_files SET description = ?, updated_at = datetime('now') WHERE id = ?",
);

const remove = db.prepare<void, [string]>(
    "DELETE FROM ply_files WHERE id = ?",
);

export const plyDb = {
    listAll: () => listAll.all(),
    getById: (id: string) => getById.get(id),
    insert: (id: string, filename: string, description: string, filePath: string, fileSize: number) =>
        insert.run(id, filename, description, filePath, fileSize),
    updateDescription: (id: string, description: string) =>
        updateDescription.run(description, id),
    remove: (id: string) => remove.run(id),
};

export { UPLOADS_DIR, DB_PATH };
