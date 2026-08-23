import esbuild from "esbuild";

const options = {
  entryPoints: ["src/main.ts"],
  bundle: true,
  external: ["obsidian", "electron"],
  format: "cjs",
  platform: "browser",
  target: "es2019",
  sourcemap: false,
  outfile: "main.js",
  logLevel: "info",
};

if (process.argv.includes("--watch")) {
  const context = await esbuild.context(options);
  await context.watch();
} else {
  await esbuild.build(options);
}
