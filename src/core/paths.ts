const TEMP_FILE_PATTERNS = [/~$/, /\.swp$/i, /\.tmp$/i, /\.lock$/i];
const PLUGIN_REMOTE_PREFIX = "obsidian/plugins/";
const PLUGIN_REMOTE_ROOT = "obsidian/plugins/sken-brain/";
const PLUGIN_LOCAL_ROOT = ".obsidian/plugins/sken-brain/";
export const SKEN_BRAIN_PLUGIN_FILES = ["manifest.json", "main.js", "styles.css"] as const;
const PLUGIN_FILES = new Set<string>(SKEN_BRAIN_PLUGIN_FILES);

export function normalizeVaultPath(path: string): string {
  const normalized = path.replace(/\\/g, "/").replace(/^\.\//, "");
  const clean = normalized
    .split("/")
    .filter((segment: string) => segment.length > 0 && segment !== ".")
    .join("/");

  if (!clean) {
    throw new Error("empty path");
  }

  return clean;
}

export function isSyncablePath(path: string): boolean {
  try {
    const normalized = normalizeVaultPath(path);
    const lower = normalized.toLowerCase();
    if (lower === ".obsidian" || lower.startsWith(".obsidian/")) return false;
    if (lower === ".trash" || lower.startsWith(".trash/")) return false;
    return !TEMP_FILE_PATTERNS.some((pattern) => pattern.test(normalized));
  } catch {
    return false;
  }
}

export function pluginLocalPath(path: string): string | undefined {
  try {
    const normalized = normalizeVaultPath(path);
    if (!normalized.startsWith(PLUGIN_REMOTE_ROOT)) return undefined;
    const file = normalized.slice(PLUGIN_REMOTE_ROOT.length);
    return PLUGIN_FILES.has(file) ? `${PLUGIN_LOCAL_ROOT}${file}` : undefined;
  } catch {
    return undefined;
  }
}

export function isPluginRemotePath(path: string): boolean {
  try {
    return normalizeVaultPath(path).startsWith(PLUGIN_REMOTE_PREFIX);
  } catch {
    return false;
  }
}
