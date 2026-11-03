import { createServer } from "node:http";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { getData } from "./lib/data.js";

const ROOT = path.dirname(new URL(import.meta.url).pathname);
const PORT = Number(process.env.PORT || 3000);

const STATIC_FILES = {
  "/styles.css": { file: "css/styles.css", type: "text/css; charset=utf-8" },
  "/app.js": { file: "js/app.js", type: "text/javascript; charset=utf-8" },
};

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".webp": "image/webp",
};

function staticType(file) {
  return MIME[path.extname(file).toLowerCase()] || "application/octet-stream";
}

function sendFile(res, file, type, cache = "public, max-age=31536000, immutable") {
  res.writeHead(200, {
    "Content-Type": type,
    "Cache-Control": cache,
  });
  res.end();
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  try {
    if (url.pathname === "/api/data") {
      const d = await getData();
      res.writeHead(200, {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
      });
      res.end(JSON.stringify(d));
      return;
    }
    if (url.pathname === "/") {
      const body = await readFile(path.join(ROOT, "index.html"));
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-cache" });
      res.end(body);
      return;
    }
    if (url.pathname.startsWith("/fonts/")) {
      const safe = (await readdir(path.join(ROOT, "fonts"))).find((f) => f === decodeURIComponent(url.pathname.slice("/fonts/".length)));
      if (!safe) {
        res.writeHead(404);
        res.end("not found");
        return;
      }
      const buf = await readFile(path.join(ROOT, "fonts", safe));
      res.writeHead(200, { "Content-Type": staticType(safe), "Cache-Control": "public, max-age=86400" });
      res.end(buf);
      return;
    }
    if (url.pathname === "/logo.webp") {
      const buf = await readFile(path.join(ROOT, "logo.webp"));
      res.writeHead(200, { "Content-Type": "image/webp", "Cache-Control": "public, max-age=86400" });
      res.end(buf);
      return;
    }
    const st = STATIC_FILES[url.pathname];
    if (st) {
      const buf = await readFile(path.join(ROOT, st.file));
      res.writeHead(200, { "Content-Type": st.type, "Cache-Control": "no-cache" });
      res.end(buf);
      return;
    }
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("not found");
  } catch (e) {
    res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
    res.end(String(e?.message || e));
  }
});

server.listen(PORT, () => {
  console.log(`showdown web on http://localhost:${PORT}`);
});
