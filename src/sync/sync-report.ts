export interface SyncReport {
  status: "synced" | "conflict" | "offline" | "auth-required";
  uploaded: string[];
  downloaded: string[];
  deleted?: string[];
  conflicts: string[];
  errors: string[];
}
