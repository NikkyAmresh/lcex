import { build, context } from "esbuild";
import { copyFile, mkdir, readdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const watch = process.argv.includes("--watch");
const minify = process.argv.includes("--minify") || !watch;

const buildOpts = {
  entryPoints: [join(__dirname, "src/extension.ts")],
  bundle: true,
  outfile: join(__dirname, "out/extension.js"),
  platform: "node",
  format: "cjs",
  target: "node18",
  external: ["vscode"],
  sourcemap: !minify,
  minify,
  logLevel: "info",
};

async function copyTemplates() {
  const srcDir = join(__dirname, "src/templates");
  const outDir = join(__dirname, "out/templates");
  await mkdir(outDir, { recursive: true });
  const entries = await readdir(srcDir);
  await Promise.all(
    entries
      .filter((f) => f.endsWith(".ejs"))
      .map((f) => copyFile(join(srcDir, f), join(outDir, f)))
  );
}

async function copyData() {
  const srcDir = join(__dirname, "data");
  const outDir = join(__dirname, "out/data");
  await mkdir(outDir, { recursive: true });
  await copyFile(join(srcDir, "companies.json"), join(outDir, "companies.json"));
}

await copyTemplates();
await copyData();

if (watch) {
  const ctx = await context(buildOpts);
  await ctx.watch();
} else {
  await build(buildOpts);
}
