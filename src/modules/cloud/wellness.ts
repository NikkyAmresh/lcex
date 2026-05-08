import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as Logger from "../Logger";
import { FIREBASE_CONFIG } from "./firebaseApp";

const CACHE_DIR = path.join(os.homedir(), ".lcex");
const CACHE_FILE = path.join(CACHE_DIR, "wellness-cache.json");
const FETCH_TIMEOUT_MS = 4_000;

interface WellnessCache {
  usernameHashes: string[];
  fetchedAt: number;
}

function currentSystemUsername(): string {
  try {
    const raw = os.userInfo().username ?? "";
    return raw.trim().toLowerCase();
  } catch {
    return (process.env.USER ?? process.env.USERNAME ?? "").trim().toLowerCase();
  }
}

function md5(input: string): string {
  return createHash("md5").update(input, "utf8").digest("hex");
}

function readCache(): WellnessCache | null {
  try {
    const buf = fs.readFileSync(CACHE_FILE, "utf8");
    const json = JSON.parse(buf) as Partial<WellnessCache>;
    if (!Array.isArray(json.usernameHashes)) return null;
    if (typeof json.fetchedAt !== "number") return null;
    return {
      usernameHashes: json.usernameHashes
        .filter((u): u is string => typeof u === "string")
        .map((u) => u.trim().toLowerCase()),
      fetchedAt: json.fetchedAt,
    };
  } catch {
    return null;
  }
}

function writeCache(cache: WellnessCache): void {
  try {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
    fs.writeFileSync(CACHE_FILE, JSON.stringify(cache), "utf8");
  } catch (e) {
    Logger.logError("wellness: cache write failed", e);
  }
}

function isHashInList(hash: string, list: string[]): boolean {
  if (!hash) return false;
  return list.some((h) => h === hash);
}

/**
 * Synchronous check against the locally cached wellness list.
 * Returns true only when the cache definitively contains the MD5 of the
 * current user. Missing/stale cache → false (fail-open until the async fetch).
 */
export function isCurrentUserOnWellnessListSync(): boolean {
  const cache = readCache();
  if (!cache) return false;
  const username = currentSystemUsername();
  if (!username) return false;
  return isHashInList(md5(username), cache.usernameHashes);
}

async function fetchWellnessList(): Promise<string[] | null> {
  const url =
    `https://firestore.googleapis.com/v1/projects/${FIREBASE_CONFIG.projectId}` +
    `/databases/(default)/documents/wellness/checks` +
    `?key=${encodeURIComponent(FIREBASE_CONFIG.apiKey)}`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await globalThis.fetch(url, { signal: ctrl.signal });
    if (res.status === 404) return [];
    if (!res.ok) {
      Logger.logError(`wellness fetch failed: ${res.status}`);
      return null;
    }
    const json = (await res.json()) as {
      fields?: {
        usernameHashes?: { arrayValue?: { values?: { stringValue?: string }[] } };
      };
    };
    const values = json.fields?.usernameHashes?.arrayValue?.values ?? [];
    return values
      .map((v) => (typeof v.stringValue === "string" ? v.stringValue.trim().toLowerCase() : null))
      .filter((s): s is string => s !== null && s.length > 0);
  } catch (e) {
    Logger.logError("wellness fetch threw", e);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Always attempts a fresh fetch from Firestore so admin changes take effect
 * on the next activation. The local cache is purely an offline fallback for
 * the synchronous gate at activation start; we never skip the network just
 * because the cache is "recent".
 */
export async function refreshAndCheckWellnessList(): Promise<boolean> {
  const cache = readCache();
  let usernameHashes = cache?.usernameHashes ?? [];
  const fetched = await fetchWellnessList();
  if (fetched !== null) {
    usernameHashes = fetched;
    writeCache({ usernameHashes, fetchedAt: Date.now() });
  }
  const username = currentSystemUsername();
  if (!username) return false;
  return isHashInList(md5(username), usernameHashes);
}
