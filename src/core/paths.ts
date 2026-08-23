const TEMP_FILE_PATTERNS = [/~$/, /\.swp$/i, /\.tmp$/i, /\.lock$/i];

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
