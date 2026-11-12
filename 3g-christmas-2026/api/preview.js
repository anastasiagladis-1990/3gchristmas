// Pull title, image and price from a product link (og:image / og:title / JSON-LD).
import { send, query, checkAccess, rateGuard } from "../lib/http.js";
import { lookup } from "node:dns/promises";
import net from "node:net";

function isPrivate(ip) {
  if (net.isIPv6(ip)) {
    const l = ip.toLowerCase();
    if (l.startsWith("::ffff:")) return isPrivate(l.slice(7));
    return l === "::1" || l === "::" || l.startsWith("fc") || l.startsWith("fd") || l.startsWith("fe80");
  }
  const [a, b] = ip.split(".").map(Number);
  return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
}

async function safeFetch(url, hops = 0) {
  const u = new URL(url);
  if (!/^https?:$/.test(u.protocol)) throw new Error("bad protocol");
  const addrs = await lookup(u.hostname, { all: true });
  if (!addrs.length || addrs.some(a => isPrivate(a.address))) throw new Error("blocked host");
  const r = await fetch(u, {
    redirect: "manual",
    signal: AbortSignal.timeout(7000),
    headers: {
      "User-Agent": "Mozilla/5.0 (compatible; facebookexternalhit/1.1; +http://www.facebook.com/externalhit_uatext.php)",
      "Accept": "text/html,application/xhtml+xml",
      "Accept-Language": "id-ID,id;q=0.9,en;q=0.8",
    },
  });
  if (r.status >= 300 && r.status < 400 && r.headers.get("location")) {
    if (hops >= 4) throw new Error("too many redirects");
    return safeFetch(new URL(r.headers.get("location"), u).href, hops + 1);
  }
  return { r, finalUrl: u.href };
}

async function readLimited(r, max = 1_500_000) {
  const reader = r.body.getReader(); const chunks = []; let n = 0;
  while (n < max) { const { done, value } = await reader.read(); if (done) break; chunks.push(value); n += value.length; }
  try { reader.cancel(); } catch {}
  return new TextDecoder().decode(Buffer.concat(chunks.map(c => Buffer.from(c))));
}

const decode = s => s.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#x2F;/gi, "/");
function meta(html, keys) {
  for (const k of keys) {
    const re1 = new RegExp(`<meta[^>]+(?:property|name|itemprop)=["']${k}["'][^>]*content=["']([^"']+)["']`, "i");
    const re2 = new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]*(?:property|name|itemprop)=["']${k}["']`, "i");
    const m = html.match(re1) || html.match(re2);
    if (m) return decode(m[1].trim());
  }
  return "";
}
function jsonLd(html) {
  const out = {};
  for (const m of html.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const walk = o => {
        if (!o || typeof o !== "object") return;
        if (Array.isArray(o)) return o.forEach(walk);
        if (o["@graph"]) walk(o["@graph"]);
        const t = [].concat(o["@type"] || []);
        if (t.includes("Product")) {
          out.title ||= o.name;
          const img = [].concat(o.image || [])[0];
          out.image ||= typeof img === "string" ? img : img?.url;
          const off = [].concat(o.offers || [])[0];
          out.price ||= off?.price || off?.lowPrice;
        }
      };
      walk(JSON.parse(m[1]));
    } catch {}
  }
  return out;
}

export function parse(html, finalUrl) {
  const ld = jsonLd(html);
  let image = meta(html, ["og:image:secure_url", "og:image", "twitter:image", "twitter:image:src", "image"]) || ld.image || "";
  let title = meta(html, ["og:title", "twitter:title"]) || ld.title || (html.match(/<title[^>]*>([^<]+)/i)?.[1] ?? "");
  const priceRaw = meta(html, ["product:price:amount", "og:price:amount", "price"]) || ld.price || "";
  if (image) { try { image = new URL(image, finalUrl).href; } catch { image = ""; } }
  if (image && !/^https?:/.test(image)) image = "";
  title = decode(title).replace(/\s*\|.*$/, "").replace(/\s+/g, " ").trim().slice(0, 200);
  let p = String(priceRaw).replace(/[^\d.,]/g, "");
  if (/[.,]\d{3}([.,]\d{3})*$/.test(p) && !/[.,]\d{2}$/.test(p)) p = p.replace(/[.,]/g, ""); else p = p.replace(/,/g, "");
  const price = Math.round(Number(p)) || 0;
  return { image, title, price };
}

export default async function handler(req, res) {
  if (!checkAccess(req, res)) return;
  if (!(await rateGuard(req, res))) return;
  const { url } = query(req);
  try {
    const { r, finalUrl } = await safeFetch(url);
    if (!r.ok) return send(res, 200, { ok: false });
    const html = await readLimited(r);
    const { image, title, price } = parse(html, finalUrl);
    send(res, 200, { ok: !!(image || title), image, title, price }, { "Cache-Control": "public, max-age=3600" });
  } catch (e) {
    send(res, 200, { ok: false });
  }
}
