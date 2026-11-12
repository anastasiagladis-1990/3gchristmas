import store, { K } from "../lib/store.js";
import { send, query, body, checkAccess, writeGuard, str, clientId, baseOf } from "../lib/http.js";
import { randomUUID } from "node:crypto";

const CATS = ["main", "side", "dessert", "drinks", "snacks", "other"]; // "other" kept for older records
const MAX_DISHES = 500;

function clean(b) {
  const out = {};
  if ("who" in b) out.who = str(b.who, 60);
  if ("dish" in b) out.dish = str(b.dish, 120);
  if ("cat" in b) out.cat = CATS.includes(b.cat) ? b.cat : "main";
  if ("qty" in b) out.qty = str(b.qty, 40);
  if ("note" in b) out.note = str(b.note, 300);
  return out;
}

export default async function handler(req, res) {
  if (!checkAccess(req, res)) return;
  if (!(await writeGuard(req, res))) return;
  const q = query(req);
  try {
    const b = req.method === "DELETE" ? {} : await body(req);
    if (req.method === "POST") {
      const d = clean({ cat: "main", ...b });
      if (!d.dish) return send(res, 400, { error: "Dish name is required" });
      if (!d.who) return send(res, 400, { error: "Please enter who's bringing it" });
      const id = clientId(b.id) || randomUUID();
      const again = await store.get(K.potluck, id);
      if (again) return send(res, 200, { dish: again, duplicate: true }); // repeated tap
      if ((await store.count(K.potluck)) >= MAX_DISHES) return send(res, 400, { error: "The potluck list is full" });
      const now = Date.now();
      const dish = { id, createdAt: now, qty: "", note: "", ...d, updatedAt: now };
      if (!(await store.create(K.potluck, dish))) return send(res, 200, { dish: await store.get(K.potluck, id), duplicate: true });
      await store.bump();
      return send(res, 201, { dish });
    }
    if (req.method === "PATCH") {
      const cur = await store.get(K.potluck, q.id);
      if (!cur) return send(res, 404, { error: "This dish was removed" });
      const d = clean(b);
      if ("who" in d && !d.who) return send(res, 400, { error: "Please enter who's bringing it" });
      if ("dish" in d && !d.dish) return send(res, 400, { error: "Dish name is required" });
      const next = { ...cur, ...d, updatedAt: Date.now() };
      if ("qty" in d) delete next.serves; // legacy numeric field replaced by free-text quantity
      const r = await store.cas(K.potluck, next, baseOf(b));
      if (r === "missing") return send(res, 404, { error: "This dish was removed" });
      if (r === "conflict") return send(res, 409, { error: "conflict", current: await store.get(K.potluck, q.id) });
      return send(res, 200, { dish: next });
    }
    if (req.method === "DELETE") {
      await store.del(K.potluck, q.id); await store.bump();
      return send(res, 200, { ok: true });
    }
    send(res, 405, { error: "Method not allowed" });
  } catch (e) {
    console.error(e);
    send(res, 500, { error: "Server error" });
  }
}
