import type { ManifestEntry } from "../core/sync-model.js";

interface StoredManifest {
  version: 1;
  entries: Record<string, ManifestEntry>;
}

type LoadData = () => Promise<unknown>;
type SaveData = (value: unknown) => Promise<void>;

export interface ManifestStore {
  load(): Promise<Record<string, ManifestEntry>>;
  save(entries: Record<string, ManifestEntry>): Promise<void>;
  clear(): Promise<void>;
}

export class DataManifestStore implements ManifestStore {
  constructor(
    private readonly loadData: LoadData,
    private readonly saveData: SaveData,
  ) {}

  async load(): Promise<Record<string, ManifestEntry>> {
    const value = await this.loadData();
    if (!isStoredManifest(value)) return {};
    return value.entries;
  }

  async save(entries: Record<string, ManifestEntry>): Promise<void> {
    const value: StoredManifest = { version: 1, entries };
    await this.saveData(value);
  }

  async clear(): Promise<void> {
    await this.saveData(undefined);
  }
}

function isStoredManifest(value: unknown): value is StoredManifest {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<StoredManifest>;
  return candidate.version === 1 && !!candidate.entries && typeof candidate.entries === "object";
}
