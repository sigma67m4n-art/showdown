export default async function handler(_req, res) {
  const out = { node: process.version };
  try {
    const m = await import("express");
    out.express = typeof (m.default || m);
  } catch (e) {
    out.expressErr = String(e?.stack || e);
  }
  try {
    const m = await import("../lib/data.js");
    out.data = typeof m.getData;
  } catch (e) {
    out.dataErr = String(e?.stack || e);
  }
  try {
    const m = await import("../server.js");
    out.server = typeof m.default;
  } catch (e) {
    out.serverErr = String(e?.stack || e);
  }
  res.status(200).json(out);
}
