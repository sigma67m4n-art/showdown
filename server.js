import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getData } from "./lib/data.js";

const ROOT = path.dirname(fileURLToPath(import.meta.url));

const app = express();

app.get("/api/data", async (_req, res) => {
  try {
    const d = await getData();
    res.set({ "Content-Type": "application/json; charset=utf-8", "Cache-Control": "s-maxage=300, stale-while-revalidate=600" });
    res.json(d);
  } catch (e) {
    res.status(502).json({ error: String(e?.message || e) });
  }
});

app.use(express.static(ROOT, { extensions: ["html"], index: "index.html" }));

app.use((_req, res) => {
  res.sendFile(path.join(ROOT, "index.html"));
});

if (!process.env.VERCEL) {
  const PORT = Number(process.env.PORT || 3000);
  app.listen(PORT, () => {
    console.log(`showdown web on http://localhost:${PORT}`);
  });
}

export default app;
