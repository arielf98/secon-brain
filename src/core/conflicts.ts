import { normalizeVaultPath } from "./paths.js";

export function makeConflictPath(path: string, deviceId: string, now: number): string {
  const normalized = normalizeVaultPath(path);
  const segments = normalized.split("/");
  const filename = segments.pop() ?? normalized;
  const extensionIndex = filename.lastIndexOf(".");
  const hasExtension = extensionIndex > 0;
  const stem = hasExtension ? filename.slice(0, extensionIndex) : filename;
  const extension = hasExtension ? filename.slice(extensionIndex) : "";
  const safeDeviceId = deviceId.replace(/[^a-z0-9_-]+/gi, "-");
  const iso = new Date(now).toISOString();
  const timestamp = `${iso.slice(0, 10).replace(/-/g, "")}-${iso.slice(11, 19).replace(/:/g, "")}`;
  const folder = segments.length > 0 ? `${segments.join("/")}/` : "";
  return `_sync-conflicts/${folder}${stem} (conflict-${safeDeviceId}-${timestamp})${extension}`;
}
