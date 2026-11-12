import store from "../lib/store.js";
import { query, checkAccess } from "../lib/http.js";

// Serves uploaded photos. URLs carry ?v=<timestamp>, so they can be cached forever.
export default async function handler(req, res) {
  if (!checkAccess(req, res)) return;
  const { id } = query(req);
  const data = id ? await store.getPhoto(id) : null;
  const m = data && /^data:(image\/(?:jpeg|png|webp));base64,(.+)$/.exec(data);
  if (!m) { res.statusCode = 404; return res.end("not found"); }
  res.statusCode = 200;
  res.setHeader("Content-Type", m[1]);
  res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
  res.end(Buffer.from(m[2], "base64"));
}
