import { Database } from "bun:sqlite";
import { mkdirSync } from "fs";
import { join } from "path";

const DATA_DIR = join(import.meta.dir, "..", "data");
const UPLOADS_DIR = join(import.meta.dir, "..", "uploads");

mkdirSync(DATA_DIR, { recursive: true });
mkdirSync(UPLOADS_DIR, { recursive: true });

const db = new Database(join(DATA_DIR, "ply-manager.db"));
db.exec("PRAGMA journal_mode = WAL;");

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

export { UPLOADS_DIR };
