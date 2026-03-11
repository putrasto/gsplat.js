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

type UploadedFile = { id: string; filename: string };

type UploadResponse = {
    uploaded?: UploadedFile[];
};

function parseUploadResponse(xhr: XMLHttpRequest): UploadResponse {
    if (typeof xhr.response === "object" && xhr.response !== null) {
        return xhr.response as UploadResponse;
    }

    const rawText = xhr.responseText;
    if (rawText.trim() === "") return {};
    return JSON.parse(rawText) as UploadResponse;
}

function uploadSingleFile(
    file: File,
    onProgress?: (progress: number) => void,
): Promise<UploadedFile[]> {
    return new Promise<UploadedFile[]>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open("POST", "/api/files");
        xhr.setRequestHeader("X-Filename", file.name);
        xhr.setRequestHeader("Content-Type", "application/octet-stream");
        xhr.responseType = "json";

        if (onProgress !== undefined) {
            xhr.upload.onloadstart = () => {
                onProgress(0);
            };

            xhr.upload.onprogress = (event) => {
                if (!event.lengthComputable) return;
                const progress = event.total > 0 ? event.loaded / event.total : 0;
                onProgress(Math.min(Math.max(progress, 0), 1));
            };

            xhr.upload.onloadend = () => {
                onProgress(1);
            };
        }

        xhr.onerror = () => {
            reject(new Error("Upload failed"));
        };

        xhr.onabort = () => {
            reject(new Error("Upload aborted"));
        };

        xhr.onload = () => {
            if (xhr.status < 200 || xhr.status >= 300) {
                reject(new Error(`Upload failed: ${xhr.status}`));
                return;
            }

            try {
                const data = parseUploadResponse(xhr);
                const uploaded = Array.isArray(data.uploaded) ? data.uploaded : [];
                resolve(uploaded);
            } catch (error) {
                reject(error instanceof Error ? error : new Error("Upload response parse failed"));
            }
        };

        // Send raw file binary — no FormData/multipart overhead
        xhr.send(file);
    });
}

export async function uploadFiles(
    files: File[],
    onProgress?: (progress: number) => void,
): Promise<UploadedFile[]> {
    const totalSize = files.reduce((sum, f) => sum + f.size, 0);
    let completedSize = 0;
    const allUploaded: UploadedFile[] = [];

    for (const file of files) {
        const fileStartOffset = completedSize;
        const uploaded = await uploadSingleFile(file, onProgress ? (p) => {
            const overall = totalSize > 0
                ? (fileStartOffset + p * file.size) / totalSize
                : 0;
            onProgress(Math.min(Math.max(overall, 0), 1));
        } : undefined);
        completedSize += file.size;
        allUploaded.push(...uploaded);
    }

    return allUploaded;
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
