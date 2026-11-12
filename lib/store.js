// Storage: Upstash Redis (single shared source of truth) or in-memory fallback for local dev only.
import { Redis } from "@upstash/redis";

const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;

// Preview deployments use their own key prefix so testing never touches production data.
// (Set KEY_PREFIX explicitly to override; production keeps the original "wl:" keys.)
const P = process.env.KEY_PREFIX ?? (process.env.VERCEL_ENV === "preview" ? "preview:" : "");

export const K = {
  items: P + "wl:items",       // hash: id -> JSON gift
  people: P + "wl:people",     // hash: id -> JSON person
  names: P + "wl:names",       // hash: normalized name -> person id (duplicate guard)
  potluck: P + "wl:potluck",   // hash: id -> JSON dish
  event: P + "wl:event",       // JSON string: dinner details
  ver: P + "wl:ver",           // counter, bumped on every change (cheap polling)
  photo: id => `${P}wl:photo:${id}`,
  rate: (ip, min) => `${P}rl:${ip}:${min}`,
};

export const persistent = !!(url && token);

// Upstash HGETALL returns a flat [k1, v1, k2, v2…] array when automaticDeserialization is off
// (that was the original "names don't show" bug). Accept both shapes.
export function hashValues(h) {
  if (!h) return [];
  const vals = Array.isArray(h) ? h.filter((_, i) => i % 2 === 1) : Object.values(h);
  return vals.map(v => { try { return typeof v === "string" ? JSON.parse(v) : v; } catch { return null; } }).filter(Boolean);
}
const parse = s => { if (s == null) return null; if (typeof s !== "string") return s; try { return JSON.parse(s); } catch { return null; } };

// Compare-and-set on a hash record: only write if the stored record's updatedAt still equals `base`.
// Returns "ok" | "missing" | "conflict". An empty base skips the check.
const CAS_HASH = `
  local s = redis.call('HGET', KEYS[1], ARGV[1])
  if not s then return 'missing' end
  if ARGV[2] ~= '' then
    local it = cjson.decode(s)
    if tonumber(it.updatedAt or 0) ~= tonumber(ARGV[2]) then return 'conflict' end
  end
  redis.call('HSET', KEYS[1], ARGV[1], ARGV[3])
  redis.call('INCR', KEYS[2])
  return 'ok'`;
const CAS_STR = `
  local s = redis.call('GET', KEYS[1])
  if ARGV[1] ~= '' then
    local cur = 0
    if s then cur = tonumber(cjson.decode(s).updatedAt or 0) end
    if cur ~= tonumber(ARGV[1]) then return 'conflict' end
  end
  redis.call('SET', KEYS[1], ARGV[2])
  redis.call('INCR', KEYS[2])
  return 'ok'`;
const CLAIM = `
  local s = redis.call('HGET', KEYS[1], ARGV[1])
  if not s then return 'missing' end
  local it = cjson.decode(s)
  if it.status == 'done' then return 'taken:' .. (it.boughtBy or '') end
  it.status = 'done'; it.boughtBy = ARGV[2]; it.updatedBy = ARGV[2]; it.updatedAt = tonumber(ARGV[3])
  redis.call('HSET', KEYS[1], ARGV[1], cjson.encode(it))
  redis.call('INCR', KEYS[2])
  return 'ok'`;

let impl;
if (persistent) {
  const r = new Redis({ url, token, automaticDeserialization: false });
  impl = {
    async version() { return Number(await r.get(K.ver)) || 0; },
    async bump() { return r.incr(K.ver); },
    async all(key) { return hashValues(await r.hgetall(key)); },
    async count(key) { return Number(await r.hlen(key)) || 0; },
    async get(key, id) { return parse(await r.hget(key, id)); },
    // Create only if the id is new (makes repeated taps / retries harmless). true = created.
    async create(key, obj) { return Number(await r.hsetnx(key, obj.id, JSON.stringify(obj))) === 1; },
    async cas(key, obj, base) { return String(await r.eval(CAS_HASH, [key, K.ver], [obj.id, base == null ? "" : String(base), JSON.stringify(obj)])); },
    async del(key, id) { await r.hdel(key, id); },
    async getJSON(key) { return parse(await r.get(key)); },
    async casJSON(key, v, base) { return String(await r.eval(CAS_STR, [key, K.ver], [base == null ? "" : String(base), JSON.stringify(v)])); },
    async nameGet(n) { return r.hget(K.names, n); },
    async nameClaim(n, id) { return Number(await r.hsetnx(K.names, n, id)) === 1; },
    async nameDel(n) { await r.hdel(K.names, n); },
    async getPhoto(id) { return r.get(K.photo(id)); },
    async setPhoto(id, data) { data ? await r.set(K.photo(id), data) : await r.del(K.photo(id)); },
    async claim(id, by, now) { return String(await r.eval(CLAIM, [K.items, K.ver], [id, by, String(now)])); },
    async hit(ip) { const k = K.rate(ip, Math.floor(Date.now() / 60000)); const n = await r.incr(k); if (n === 1) await r.expire(k, 120); return n; },
  };
} else {
  console.warn("[3g] No UPSTASH/KV env vars found — using in-memory store (local dev only; data is lost on restart).");
  const hashes = new Map(), kv = new Map(); let ver = 0;
  const h = k => (hashes.has(k) || hashes.set(k, new Map()), hashes.get(k));
  const clone = x => x == null ? null : structuredClone(x);
  impl = {
    async version() { return ver; },
    async bump() { return ++ver; },
    async all(key) { return [...h(key).values()].map(clone); },
    async count(key) { return h(key).size; },
    async get(key, id) { return clone(h(key).get(id)); },
    async create(key, obj) { if (h(key).has(obj.id)) return false; h(key).set(obj.id, clone(obj)); return true; },
    async cas(key, obj, base) {
      const cur = h(key).get(obj.id); if (!cur) return "missing";
      if (base != null && Number(cur.updatedAt || 0) !== Number(base)) return "conflict";
      h(key).set(obj.id, clone(obj)); ver++; return "ok";
    },
    async del(key, id) { h(key).delete(id); },
    async getJSON(key) { return clone(kv.get(key)); },
    async casJSON(key, v, base) {
      const cur = kv.get(key);
      if (base != null && Number(cur?.updatedAt || 0) !== Number(base)) return "conflict";
      kv.set(key, clone(v)); ver++; return "ok";
    },
    async nameGet(n) { return h(K.names).get(n) || null; },
    async nameClaim(n, id) { if (h(K.names).has(n)) return false; h(K.names).set(n, id); return true; },
    async nameDel(n) { h(K.names).delete(n); },
    async getPhoto(id) { return kv.get(K.photo(id)) || null; },
    async setPhoto(id, d) { d ? kv.set(K.photo(id), d) : kv.delete(K.photo(id)); },
    async claim(id, by, now) {
      const it = h(K.items).get(id); if (!it) return "missing";
      if (it.status === "done") return "taken:" + (it.boughtBy || "");
      Object.assign(it, { status: "done", boughtBy: by, updatedBy: by, updatedAt: now }); ver++;
      return "ok";
    },
    async hit(ip) { const k = K.rate(ip, Math.floor(Date.now() / 60000)); const n = (kv.get(k) || 0) + 1; kv.set(k, n); return n; },
  };
}
export default impl;
