import { writeFileSync } from "node:fs";
import path from "node:path";

// Emit a vercel.json at build time so Vercel serves the static files
// (index.html, css/, js/, fonts/, logo.webp) directly and the api/
// functions as serverless. Without this, Vercel treats the whole project
// as a Node server and static files return ENOENT (500).
const vercelJson = {
  rewrites: [
    {
      // SPA fallback only for routes that are NOT static files or api/.
      // Vercel already checks static files and api/ functions first, so
      // this catchall only fires for real unknown routes.
      source: "/((?!api/|css/|js/|fonts/|logo\\.webp|index\\.html).*)",
      destination: "/index.html",
    },
  ],
  headers: [
    {
      source: "/fonts/((?!\\.well-known/).*)",
      headers: [{ key: "cache-control", value: "public, max-age=31536000, immutable" }],
    },
    {
      source: "/logo.webp",
      headers: [{ key: "cache-control", value: "public, max-age=86400" }],
    },
  ],
};

const out = path.join(process.cwd(), "vercel.json");
writeFileSync(out, JSON.stringify(vercelJson, null, 2) + "\n");
console.log(`wrote ${out}`);
