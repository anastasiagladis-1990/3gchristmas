// Local dev server: serves /public and the /api functions the same way Vercel does.
// Run: npm install && npm run dev  → http://localhost:3000
// Without Upstash env vars it uses an in-memory store.
import http from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";

const PORT = process.env.PORT || 3000;
const types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon" };

http.createServer(async (req, res) => {
  const path = new URL(req.url, "http://x").pathname;
  if (path.startsWith("/api/")) {
    const name = path.slice(5).replace(/[^a-z]/gi, "");
    try {
      const mod = await import(`./api/${name}.js`);
      return mod.default(req, res);
    } catch (e) { res.statusCode = 404; return res.end("no such api"); }
  }
  const isPage = path === "/" || path === "/dinner" || path === "/wishlist" || path === "/dinner/" || path === "/wishlist/";
  const file = normalize(join("public", isPage ? "index.html" : path));
  if (!file.startsWith("public")) { res.statusCode = 403; return res.end(); }
  try {
    const buf = await readFile(file);
    res.setHeader("Content-Type", types[extname(file)] || "application/octet-stream");
    res.end(buf);
  } catch { res.statusCode = 404; res.end("not found"); }
}).listen(PORT, () => console.log(`Wishlist running on http://localhost:${PORT}`));
