import esbuild from "esbuild";
import { deployArtifacts } from "./scripts/obsidian-deploy.mjs";

const deployTo = valueAfter("--deploy-to");

const options = {
  entryPoints: ["src/main.ts"],
  bundle: true,
  external: ["obsidian", "electron", "node:http"],
  format: "cjs",
  platform: "browser",
  target: "es2019",
  sourcemap: false,
  outfile: "main.js",
  logLevel: "info",
  plugins: deployTo ? [deployPlugin(deployTo)] : [],
};

if (process.argv.includes("--watch")) {
  const context = await esbuild.context(options);
  await context.watch();
} else {
  await esbuild.build(options);
}

function valueAfter(flag) {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function deployPlugin(destination) {
  return {
    name: "sken-brain-deploy",
    setup(build) {
      build.onEnd(async (result) => {
        if (result.errors.length) return;
        await deployArtifacts(destination);
        console.log(`Deployed Sken Brain to ${destination}`);
      });
    },
  };
}
