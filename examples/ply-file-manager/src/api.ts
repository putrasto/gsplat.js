export type PlyFileMeta = {
    id: string;
    filename: string;
    description: string;
    file_size: number;
    created_at: string;
    updated_at: string;
};

export async function fetchFiles(): Promise<PlyFileMeta[]> {
    const res = await fetch("/api/files");
    if (!res.ok) throw new Error("Failed to fetch files");
    return res.json();
}

export async function uploadFiles(files: File[]): Promise<{ id: string; filename: string }[]> {
    const form = new FormData();
    for (const file of files) {
        form.append("files", file);
    }
    const res = await fetch("/api/files", { method: "POST", body: form });
    if (!res.ok) throw new Error("Upload failed");
    const data = await res.json();
    return data.uploaded;
}

export async function updateDescription(id: string, description: string): Promise<void> {
    const res = await fetch(`/api/files/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ description }),
    });
    if (!res.ok) throw new Error(`Failed to update description: ${res.status}`);
}

export async function deleteFile(id: string): Promise<void> {
    const res = await fetch(`/api/files/${id}`, { method: "DELETE" });
    if (!res.ok) throw new Error(`Failed to delete file: ${res.status}`);
}

export function fileDataUrl(id: string): string {
    return `/api/files/${id}/data`;
}
