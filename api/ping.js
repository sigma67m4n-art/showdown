import { predictMatch } from "../lib/predict.js";

export default async function handler(_req, res) {
  const out = { node: process.version, steps: {} };
  const tests = [
    { home: "Napoli", away: "Lazio", date: "2026-11-08", time: "11:30" },
    { home: "Stade Rennais", away: "Lille", date: "2026-11-08", time: "14:00" },
  ];
  for (const t of tests) {
    const t0 = Date.now();
    try {
      out.steps[`${t.home} vs ${t.away}`] = { ...(await predictMatch(t)), ms: Date.now() - t0 };
    } catch (e) {
      out.steps[`${t.home} vs ${t.away}`] = { err: String(e?.message || e), ms: Date.now() - t0 };
    }
  }
  res.status(200).json(out);
}