import { readFileSync, readdirSync } from "node:fs";
import { getData } from "./lib/data.js";

const body = readFileSync(new URL("./index.html", import.meta.url), "utf8");
const FONT_FILES = readdirSync(new URL("./fonts", import.meta.url));
const STATIC_FILES = {
  "/styles.css": { file: "./css/styles.css", type: "text/css; charset=utf-8" },
  "/app.js": { file: "./js/app.js", type: "text/javascript; charset=utf-8" },
};

Bun.serve({
  port: 3000,
  async fetch(req) {
    const url = new URL(req.url);
    if (url.pathname === "/api/data") {
      try {
        return Response.json(await getData());
      } catch (e) {
        return Response.json({ error: String(e?.message || e) }, { status: 502 });
      }
    }
    const st = STATIC_FILES[url.pathname];
    if (st) {
      const buf = await Bun.file(new URL(st.file, import.meta.url)).arrayBuffer();
      return new Response(buf, { headers: { "Content-Type": st.type, "Cache-Control": "no-cache" } });
    }
    if (url.pathname.startsWith("/fonts/")) {
      const file = url.pathname.slice("/fonts/".length).split("?")[0];
      const safe = FONT_FILES.find((f) => f === decodeURIComponent(file));
      if (!safe) return new Response("not found", { status: 404 });
      const buf = await Bun.file(new URL(`./fonts/${safe}`, import.meta.url)).arrayBuffer();
      const type = safe.endsWith(".woff2") ? "font/woff2" : "font/ttf";
      return new Response(buf, { headers: { "Content-Type": type, "Cache-Control": "public, max-age=86400" } });
    }
    if (url.pathname === "/logo.webp") {
      const buf = await Bun.file(new URL("./logo.webp", import.meta.url)).arrayBuffer();
      return new Response(buf, { headers: { "Content-Type": "image/webp", "Cache-Control": "public, max-age=86400" } });
    }
    return new Response(body, {
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  },
});

console.log("showdown web on http://localhost:3000");
