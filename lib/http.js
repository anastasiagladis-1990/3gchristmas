import store from "./store.js";

export function send(res, status, body, headers = {}) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store, max-age=0");
  for (const [k, v] of Object.entries(headers)) res.setHeader(k, v);
  res.end(JSON.stringify(body));
}

export function query(req) {
  return Object.fromEntries(new URL(req.url, "http://x").searchParams);
}

const MAX_BODY = 1_000_000;
export async function body(req) {
  if (req.body && typeof req.body === "object") return req.body;
  if (typeof req.body === "string") { try { return JSON.parse(req.body); } catch { return {}; } }
  let raw = "";
  for await (const c of req) { raw += c; if (raw.length > MAX_BODY) break; }
  try { return raw ? JSON.parse(raw) : {}; } catch { return {}; }
}

// Optional access code: set ACCESS_CODE in Vercel env vars so only people who know it can open the site.
export function checkAccess(req, res) {
  const code = process.env.ACCESS_CODE;
  if (!code) return true;
  const given = req.headers["x-access-code"] || query(req).code || "";
  if (String(given).trim().toLowerCase() === code.trim().toLowerCase()) return true;
  send(res, 401, { error: "access_code" });
  return false;
}

// Basic abuse protection for a public, no-login site: cap writes per IP per minute.
const WRITE_LIMIT = Number(process.env.WRITE_LIMIT_PER_MIN) || 90;
export async function writeGuard(req, res) {
  if (req.method === "GET" || req.method === "HEAD") return true;
  const len = Number(req.headers["content-length"] || 0);
  if (len > MAX_BODY) { send(res, 413, { error: "Request too large" }); return false; }
  const ip = String(req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "local").split(",")[0].trim().replace(/[^0-9a-f.:]/gi, "").slice(0, 45) || "local";
  try {
    if ((await store.hit(ip)) > WRITE_LIMIT) { send(res, 429, { error: "Too many changes in a short time — please wait a minute." }); return false; }
  } catch { /* never block writes because the limiter itself failed */ }
  return true;
}

// Shared helpers for validation.
export const str = (v, max) => String(v ?? "").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "").trim().slice(0, max);
export const httpUrl = (v, max = 2000) => { try { const u = new URL(String(v).trim()); return /^https?:$/.test(u.protocol) && u.href.length <= max ? u.href : ""; } catch { return ""; } };
export const clientId = v => typeof v === "string" && /^[A-Za-z0-9-]{8,64}$/.test(v) ? v : null;
export const baseOf = b => (b && b.base != null && Number.isFinite(Number(b.base))) ? Number(b.base) : null;

// Same per-IP limit for expensive reads (e.g. link previews that fetch other sites).
export const rateGuard = (req, res) => writeGuard({ method: "POST", headers: req.headers, socket: req.socket }, res);
