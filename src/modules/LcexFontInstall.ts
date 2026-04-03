import { execFile } from "child_process";
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { promisify } from "util";
import * as Logger from "./Logger";

const execFileAsync = promisify(execFile);

/** Bundled with the extension under `resources/fonts/` (Fira Code iScript). */
export const LCEX_BUNDLED_FONT_FILES = [
  "FiraCodeiScript-Regular.ttf",
  "FiraCodeiScript-Bold.ttf",
  "FiraCodeiScript-Italic.ttf",
] as const;

function getUserFontsDirectory(): string | undefined {
  switch (process.platform) {
    case "darwin":
      return path.join(os.homedir(), "Library", "Fonts");
    case "win32": {
      const local = process.env.LOCALAPPDATA;
      if (!local) return undefined;
      return path.join(local, "Microsoft", "Windows", "Fonts");
    }
    case "linux":
      return path.join(os.homedir(), ".local", "share", "fonts");
    default:
      return undefined;
  }
}

async function copyIfDifferentSize(src: string, dest: string): Promise<boolean> {
  const srcStat = await fs.stat(src);
  try {
    const destStat = await fs.stat(dest);
    if (destStat.size === srcStat.size) return false;
  } catch {
    /* dest missing */
  }
  await fs.copyFile(src, dest);
  return true;
}

/**
 * Copies bundled Fira Code iScript TTFs into the OS user font directory so the editor can resolve
 * `editor.fontFamily` "Fira Code iScript". Skips copies when the destination already matches size.
 */
export async function ensureLcexBundledFontsInstalled(extensionRoot: string): Promise<void> {
  const destRoot = getUserFontsDirectory();
  if (!destRoot) {
    Logger.log("LCEX fonts: unsupported platform, skipping install");
    return;
  }

  const bundledDir = path.join(extensionRoot, "resources", "fonts");
  try {
    await fs.access(bundledDir);
  } catch (e) {
    Logger.logError("LCEX fonts: bundled fonts folder not found", e);
    return;
  }

  await fs.mkdir(destRoot, { recursive: true });

  let copied = false;
  for (const name of LCEX_BUNDLED_FONT_FILES) {
    const src = path.join(bundledDir, name);
    const dest = path.join(destRoot, name);
    try {
      await fs.access(src);
    } catch {
      Logger.log(`LCEX fonts: missing bundled file ${name}`);
      continue;
    }
    try {
      if (await copyIfDifferentSize(src, dest)) {
        copied = true;
        Logger.log(`LCEX fonts: installed ${name}`);
      }
    } catch (e) {
      Logger.logError(`LCEX fonts: failed to install ${name}`, e);
    }
  }

  if (copied && process.platform === "linux") {
    try {
      await execFileAsync("fc-cache", ["-f", destRoot], { timeout: 15_000 });
      Logger.log("LCEX fonts: fc-cache updated");
    } catch {
      Logger.log("LCEX fonts: fc-cache not run (install fontconfig or restart the editor)");
    }
  }
}
