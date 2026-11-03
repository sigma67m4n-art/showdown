export const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
export const num = (v, fallback = 0) =>
  typeof v === "number" && Number.isFinite(v) ? v : fallback;
export const pct = (v, digits = 2) => Number((v * 100).toFixed(digits));
export const round = (v, digits = 4) => Number(v.toFixed(digits));
export const sum = (arr) => arr.reduce((a, b) => a + b, 0);
export const mean = (arr) => (arr.length ? sum(arr) / arr.length : 0);
export const safeDiv = (a, b, fallback = 0) => (b ? a / b : fallback);
export const logistic = (x) => 1 / (1 + Math.exp(-x));
export const sigmoid = logistic;

export function expDecay(index, halfLife = 5) {
  return Math.pow(0.5, index / halfLife);
}

export function weightedMean(items, weightFn, valueFn) {
  let ws = 0;
  let vs = 0;
  for (const item of items) {
    const w = Math.max(0, weightFn(item));
    ws += w;
    vs += w * valueFn(item);
  }
  return ws ? vs / ws : null;
}

export function poissonPmf(lambda, k) {
  if (lambda <= 0) return k === 0 ? 1 : 0;
  let logp = -lambda + k * Math.log(lambda);
  for (let i = 2; i <= k; i++) logp -= Math.log(i);
  return Math.exp(logp);
}

export function normalizeDistribution(dist) {
  const total = sum(dist);
  if (!total) return dist.map(() => 0);
  return dist.map((v) => v / total);
}

export function entropy(probs) {
  return -sum(probs.filter((p) => p > 0).map((p) => p * Math.log(p)));
}

export function seededRandom(seed = 42) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

export function deepMerge(base, override) {
  if (Array.isArray(override)) return override.slice();
  if (override === undefined || override === null) return base;
  if (typeof override !== "object") return override;
  if (typeof base !== "object" || base === null) return { ...override };
  const out = { ...base };
  for (const [k, v] of Object.entries(override)) {
    out[k] = k in base ? deepMerge(base[k], v) : v;
  }
  return out;
}

export function has(obj, path) {
  let cur = obj;
  for (const key of path.split(".")) {
    if (cur === undefined || cur === null || !(key in cur)) return false;
    cur = cur[key];
  }
  return cur !== undefined && cur !== null;
}

export function daysBetween(a, b) {
  const d1 = new Date(a).getTime();
  const d2 = new Date(b).getTime();
  if (!Number.isFinite(d1) || !Number.isFinite(d2)) return null;
  return Math.round((d2 - d1) / 86400000);
}

export function normalizeName(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function clampReport(value, lo, hi) {
  const c = clamp(value, lo, hi);
  return { value: c, clamped: c !== value };
}