import { normalizeVaultPath } from "../core/paths.js";
import type { RemoteFile } from "../core/sync-model.js";
import {
  requireSuccess,
  responseJson,
  type HttpRequest,
  type HttpTransport,
} from "./http.js";

const DRIVE_API = "https://www.googleapis.com/drive/v3/files";
const DRIVE_UPLOAD_API = "https://www.googleapis.com/upload/drive/v3/files";
const FOLDER_MIME = "application/vnd.google-apps.folder";

interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  size?: string;
  modifiedTime?: string;
  md5Checksum?: string;
  parents?: string[];
}

interface FileListResponse {
  files?: DriveFile[];
  nextPageToken?: string;
}

interface DriveFileResponse {
  id: string;
  name: string;
  mimeType: string;
}

export interface DriveUploadResult {
  driveId: string;
  hash: string;
}

export interface GoogleDrive {
  listTree(rootId: string): Promise<RemoteFile[]>;
  download(driveId: string): Promise<Uint8Array>;
  upload(path: string, bytes: Uint8Array, parentId: string, mimeType: string): Promise<DriveUploadResult>;
  update(driveId: string, bytes: Uint8Array, mimeType: string): Promise<DriveUploadResult>;
  ensureFolder(path: string, rootId: string): Promise<string>;
}

function remoteHash(file: DriveFile): string {
  return file.md5Checksum ?? `${file.modifiedTime ?? ""}:${file.size ?? "0"}`;
}

function isDownloadable(file: DriveFile): boolean {
  return file.mimeType !== FOLDER_MIME && !file.mimeType.startsWith("application/vnd.google-apps.");
}

function escapeQueryValue(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

function concatBytes(...parts: Uint8Array[]): Uint8Array {
  const result = new Uint8Array(parts.reduce((total, part) => total + part.byteLength, 0));
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.byteLength;
  }
  return result;
}

function jsonBytes(value: unknown): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(value));
}

function basename(path: string): string {
  return path.split("/").pop() ?? path;
}

export class GoogleDriveClient implements GoogleDrive {
  constructor(
    private readonly transport: HttpTransport,
    private readonly getAccessToken: () => Promise<string>,
  ) {}

  private async request(request: HttpRequest) {
    const token = await this.getAccessToken();
    return requireSuccess(await this.transport.request({
      ...request,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(request.headers ?? {}),
      },
    }));
  }

  private async listChildren(parentId: string, queryExtra = ""): Promise<DriveFile[]> {
    const files: DriveFile[] = [];
    let pageToken: string | undefined;
    do {
      const params = new URLSearchParams({
        q: `'${parentId}' in parents and trashed = false${queryExtra}`,
        fields: "nextPageToken,files(id,name,mimeType,size,modifiedTime,md5Checksum,parents)",
        pageSize: "1000",
      });
      if (pageToken) params.set("pageToken", pageToken);
      const response = await this.request({ method: "GET", url: `${DRIVE_API}?${params.toString()}` });
      const page = responseJson<FileListResponse>(response);
      files.push(...(page.files ?? []));
      pageToken = page.nextPageToken;
    } while (pageToken);
    return files;
  }

  async listTree(rootId: string): Promise<RemoteFile[]> {
    const result: RemoteFile[] = [];
    const walk = async (parentId: string, prefix: string): Promise<void> => {
      for (const file of await this.listChildren(parentId)) {
        const path = normalizeVaultPath(prefix ? `${prefix}/${file.name}` : file.name);
        if (file.mimeType === FOLDER_MIME) {
          await walk(file.id, path);
        } else if (isDownloadable(file)) {
          result.push({
            path,
            hash: remoteHash(file),
            size: Number(file.size ?? 0),
            modifiedAt: file.modifiedTime ? Date.parse(file.modifiedTime) : 0,
            driveId: file.id,
            mimeType: file.mimeType,
          });
        }
      }
    };
    await walk(rootId, "");
    return result.sort((a, b) => a.path.localeCompare(b.path));
  }

  async download(driveId: string): Promise<Uint8Array> {
    const response = await this.request({ method: "GET", url: `${DRIVE_API}/${encodeURIComponent(driveId)}?alt=media` });
    return new Uint8Array(response.body);
  }

  async upload(path: string, bytes: Uint8Array, parentId: string, mimeType: string): Promise<DriveUploadResult> {
    const boundary = `second-brain-${Date.now().toString(36)}`;
    const metadata = jsonBytes({ name: basename(path), parents: [parentId], mimeType });
    const line = new TextEncoder().encode;
    const body = concatBytes(
      line(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n`),
      metadata,
      line(`\r\n--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`),
      bytes,
      line(`\r\n--${boundary}--\r\n`),
    );
    const response = await this.request({
      method: "POST",
      url: `${DRIVE_UPLOAD_API}?uploadType=multipart&fields=id,name,mimeType,md5Checksum,modifiedTime,size`,
      headers: { "Content-Type": `multipart/related; boundary=${boundary}` },
      body,
    });
    const file = responseJson<DriveFile>(response);
    return { driveId: file.id, hash: remoteHash(file) };
  }

  async update(driveId: string, bytes: Uint8Array, mimeType: string): Promise<DriveUploadResult> {
    const response = await this.request({
      method: "PATCH",
      url: `${DRIVE_UPLOAD_API}/${encodeURIComponent(driveId)}?uploadType=media&fields=id,name,mimeType,md5Checksum,modifiedTime,size`,
      headers: { "Content-Type": mimeType },
      body: bytes,
    });
    const file = responseJson<DriveFile>(response);
    return { driveId: file.id, hash: remoteHash(file) };
  }

  async ensureFolder(path: string, rootId: string): Promise<string> {
    let parentId = rootId;
    const parts = normalizeVaultPath(path).split("/").filter(Boolean);
    for (const part of parts) {
      const matches = await this.listChildren(
        parentId,
        ` and name = '${escapeQueryValue(part)}' and mimeType = '${FOLDER_MIME}'`,
      );
      const existing = matches[0];
      if (existing) {
        parentId = existing.id;
        continue;
      }
      const response = await this.request({
        method: "POST",
        url: DRIVE_API,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: part, mimeType: FOLDER_MIME, parents: [parentId] }),
      });
      parentId = responseJson<DriveFileResponse>(response).id;
    }
    return parentId;
  }
}
