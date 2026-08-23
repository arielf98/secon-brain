export interface FileSnapshot {
  path: string;
  hash: string;
  size: number;
  modifiedAt: number;
  deleted?: boolean;
}

export interface RemoteFile extends FileSnapshot {
  driveId: string;
  mimeType: string;
}

export interface ManifestEntry {
  path: string;
  driveId?: string;
  baseHash?: string;
  localHash?: string;
  remoteHash?: string;
  lastSyncedAt: number;
}
