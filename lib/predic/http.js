import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join } from "node:path";

const MEM = new Map();
const CACHE_DIR = process.env.PREDIC_CACHE_DIR || join(process.cwd(), ".cache", "predic");
const DEFAULT_TTL = Number(process.env.PREDIC_CACHE_TTL || 21600);

export class HttpError extends Error {
  constructor(message, code = "API_ERROR", hint) {
    super(message);
    this.code = code;
    this.hint = hint;
    this.exitCode = 3;
  }
}

function keyFor(url) {
  return createHash("sha1").update(url).digest("hex");
}

async function readDisk(key) {
  try {
    const txt = await readFile(join(CACHE_DIR, `${key}.json`), "utf8");
    return JSON.parse(txt);
  } catch {
    return null;
  }
}

async function writeDisk(key, payload) {
  try {
    await mkdir(CACHE_DIR, { recursive: true });
    await writeFile(join(CACHE_DIR, `${key}.json`), JSON.stringify(payload));
  } catch {}
}

export async function getJson(url, { ttl = DEFAULT_TTL, refresh = false, timeout = 9000, headers = {} } = {}) {
  const key = keyFor(url);
  const now = Date.now();
  if (!refresh) {
    const hit = MEM.get(key);
    if (hit && now - hit.t < ttl * 1000) return hit.data;
  }
  const disk = refresh ? null : await readDisk(key);
  if (disk && now - disk.t < ttl * 1000) {
    MEM.set(key, disk);
    return disk.data;
  }
  try {
    const res = await fetch(url, {
      headers: { accept: "application/json", "user-agent": "predic-cli/1.0", ...headers },
      signal: AbortSignal.timeout(timeout),
    });
    if (!res.ok) throw new HttpError(`HTTP ${res.status} from ${new URL(url).host}`, "API_HTTP", url);
    const data = await res.json();
    const payload = { t: now, data };
    MEM.set(key, payload);
    writeDisk(key, payload);
    return data;
  } catch (err) {
    if (disk) {
      MEM.set(key, disk);
      return disk.data;
    }
    if (err instanceof HttpError) throw err;
    throw new HttpError(`Failed to fetch data: ${err.message}`, "API_UNREACHABLE", url);
  }
}

export async function getText(url, { ttl = DEFAULT_TTL, refresh = false, timeout = 12000, headers = {} } = {}) {
  const key = keyFor(`text:${url}`);
  const now = Date.now();
  if (!refresh) {
    const hit = MEM.get(key);
    if (hit && now - hit.t < ttl * 1000) return hit.data;
  }
  const disk = refresh ? null : await readDisk(key);
  if (disk && now - disk.t < ttl * 1000) {
    MEM.set(key, disk);
    return disk.data;
  }
  try {
    const res = await fetch(url, {
      headers: { "user-agent": "predic-cli/1.0", ...headers },
      signal: AbortSignal.timeout(timeout),
    });
    if (!res.ok) throw new HttpError(`HTTP ${res.status} from ${new URL(url).host}`, "API_HTTP", url);
    const data = await res.text();
    const payload = { t: now, data };
    MEM.set(key, payload);
    writeDisk(key, payload);
    return data;
  } catch (err) {
    if (disk) {
      MEM.set(key, disk);
      return disk.data;
    }
    if (err instanceof HttpError) throw err;
    throw new HttpError(`Failed to fetch data: ${err.message}`, "API_UNREACHABLE", url);
  }
}

export async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx], idx);
    }
  });
  await Promise.all(workers);
  return out;
}

export function clearMemoryCache() {
  MEM.clear();
}