import store, { K } from "../lib/store.js";
import { send, query, body, checkAccess, writeGuard, str, httpUrl, clientId, baseOf } from "../lib/http.js";
import { randomUUID } from "node:crypto";

const MAX_PHOTO = 400_000;   // ~300 KB image as base64
const MAX_ITEMS = 3000;

function clean(b) {
  const out = {};
  if ("personId" in b) out.personId = str(b.personId, 64);
  if ("item" in b) out.item = str(b.item, 200);
  if ("link" in b) out.link = httpUrl(b.link);
  if ("price" in b) out.price = Math.max(0, Math.min(1e11, Math.round(Number(b.price) || 0)));
  if ("prio" in b) out.prio = [1, 2, 3].includes(Number(b.prio)) ? Number(b.prio) : 2;
  if ("note" in b) out.note = str(b.note, 500);
  if ("photoUrl" in b) out.photoUrl = httpUrl(b.photoUrl);
  if ("status" in b) out.status = b.status === "done" ? "done" : "open";
  if ("boughtBy" in b) out.boughtBy = str(b.boughtBy, 60);
  if ("updatedBy" in b) out.updatedBy = str(b.updatedBy, 60);
  return out;
}
const photoOk = p => typeof p === "string" && /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(p) && p.length <= MAX_PHOTO;

export default async function handler(req, res) {
  if (!checkAccess(req, res)) return;
  if (!(await writeGuard(req, res))) return;
  const q = query(req);
  try {
    if (req.method === "GET") return send(res, 405, { error: "Use /api/data" });
    const b = await body(req);

    // Mark as purchased — atomic: if someone else already claimed it, nothing is overwritten.
    if (req.method === "POST" && q.action === "buy") {
      const by = str(b.by, 60);
      if (!by) return send(res, 400, { error: "Please enter the purchaser's name" });
      const r = await store.claim(q.id, by, Date.now());
      if (r === "missing") return send(res, 404, { error: "This gift was deleted" });
      if (r.startsWith("taken:")) return send(res, 409, { error: "taken", boughtBy: r.slice(6) });
      return send(res, 200, { ok: true });
    }

    if (req.method === "POST") {
      const data = clean(b);
      if (!data.item) return send(res, 400, { error: "Gift name is required" });
      if (!data.personId || !(await store.get(K.people, data.personId))) return send(res, 400, { error: "Please choose who the gift is for" });
      const id = clientId(b.id) || randomUUID();
      const existing = await store.get(K.items, id);
      if (existing) return send(res, 200, { item: existing, duplicate: true }); // repeated tap
      if ((await store.count(K.items)) >= MAX_ITEMS) return send(res, 400, { error: "The wishlist is full" });
      const now = Date.now();
      const item = { id, createdAt: now, item: "", link: "", price: 0, prio: 2, note: "", photoUrl: "", boughtBy: "", updatedBy: "", ...data, status: data.status || "open", updatedAt: now, photoV: 0 };
      if (item.status === "open") item.boughtBy = "";
      if (b.photo) {
        if (!photoOk(b.photo)) return send(res, 400, { error: "Photo is invalid or too large" });
        await store.setPhoto(id, b.photo); item.photoV = now;
      }
      if (!(await store.create(K.items, item))) return send(res, 200, { item: await store.get(K.items, id), duplicate: true });
      await store.bump();
      return send(res, 201, { item });
    }

    if (req.method === "PATCH") {
      const cur = await store.get(K.items, q.id);
      if (!cur) return send(res, 404, { error: "This gift was deleted" });
      const data = clean(b);
      if ("item" in data && !data.item) delete data.item;
      if ("personId" in data && !(await store.get(K.people, data.personId))) delete data.personId;
      const next = { ...cur, ...data, updatedAt: Date.now() };
      if (next.status === "open") next.boughtBy = "";
      if (next.status === "done" && !next.boughtBy) return send(res, 400, { error: "Please enter the purchaser's name" });
      let newPhoto;
      if ("photo" in b && b.photo !== "keep") {
        if (!b.photo) next.photoV = 0;
        else { if (!photoOk(b.photo)) return send(res, 400, { error: "Photo is invalid or too large" }); newPhoto = b.photo; next.photoV = next.updatedAt; }
      }
      const r = await store.cas(K.items, next, baseOf(b));
      if (r === "missing") return send(res, 404, { error: "This gift was deleted" });
      if (r === "conflict") return send(res, 409, { error: "conflict", current: await store.get(K.items, q.id) });
      if (newPhoto) await store.setPhoto(cur.id, newPhoto);
      else if (next.photoV === 0 && cur.photoV) await store.setPhoto(cur.id, null);
      return send(res, 200, { item: next });
    }

    if (req.method === "DELETE") {
      await store.del(K.items, q.id); await store.setPhoto(q.id, null); await store.bump();
      return send(res, 200, { ok: true });
    }

    send(res, 405, { error: "Method not allowed" });
  } catch (e) {
    console.error(e);
    send(res, 500, { error: "Server error" });
  }
}
