import { copyFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

export const PLUGIN_FILES = ["manifest.json", "main.js", "styles.css"];

const projectRoot = fileURLToPath(new URL("..", import.meta.url));

export async function deployArtifacts(destination, sourceRoot = projectRoot) {
  await mkdir(destination, { recursive: true });
  await Promise.all(PLUGIN_FILES.map((file) => copyFile(join(sourceRoot, file), join(destination, file))));
}
